import { cache } from 'react';
import { prismaAdmin } from '@pharmaiq/db';
import { assertCan, logger, type Permission, type Role } from '@pharmaiq/core';
import { createSupabaseServerClient } from './supabase/server';
import { UnauthorizedError, type SessionUser } from './session';

// Réexportés : les routes et les pages n'ont qu'un module d'auth à connaître.
export { UnauthorizedError, toTenantContext, type SessionUser } from './session';

/**
 * Résolution du tenant — LE point de sécurité de l'application.
 *
 * `pharmacyId` provient de la session serveur puis est RELU en base à partir de
 * l'identifiant Supabase vérifié. Il n'est jamais accepté depuis le client
 * (corps de requête, query string, en-tête).
 */

/**
 * `cache()` dédoublonne l'appel pendant un même rendu : la même requête
 * n'interroge la base qu'une fois, même si dix composants la demandent.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = createSupabaseServerClient();
  // getUser() revalide le JWT auprès de Supabase — plus sûr que getSession().
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  // Lecture via le client admin : l'utilisateur n'a pas encore de tenant posé,
  // et la requête est strictement filtrée par l'identifiant Supabase vérifié.
  const dbUser = await prismaAdmin.user.findUnique({
    where: { authUserId: data.user.id },
    select: {
      id: true,
      pharmacyId: true,
      branchId: true,
      role: true,
      fullName: true,
      email: true,
      isActive: true,
      locale: true,
      pharmacy: {
        select: {
          name: true,
          slug: true,
          currency: true,
          locale: true,
          invoicePrefix: true,
          taxRate: true,
        },
      },
    },
  });

  if (!dbUser || !dbUser.isActive) return null;

  // Défense en profondeur : le claim doit correspondre à la base.
  const claimed = (data.user.app_metadata as Record<string, unknown> | undefined)?.pharmacy_id;
  if (typeof claimed === 'string' && claimed !== dbUser.pharmacyId) {
    logger.error('auth : claim pharmacy_id incohérent avec la base', {
      authUserId: data.user.id,
    });
    return null;
  }

  return {
    pharmacyId: dbUser.pharmacyId,
    userId: dbUser.id,
    role: dbUser.role as Role,
    branchId: dbUser.branchId,
    email: dbUser.email,
    fullName: dbUser.fullName,
    pharmacyName: dbUser.pharmacy.name,
    pharmacySlug: dbUser.pharmacy.slug,
    currency: dbUser.pharmacy.currency,
    locale: dbUser.locale ?? dbUser.pharmacy.locale,
    invoicePrefix: dbUser.pharmacy.invoicePrefix,
    taxRate: Number(dbUser.pharmacy.taxRate),
  };
});

/** Lève `UnauthorizedError` si personne n'est connecté. */
export async function requireSession(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** Session + contrôle de permission (§9). Lève `ForbiddenError` si refusé. */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireSession();
  assertCan(user.role, permission);
  return user;
}
