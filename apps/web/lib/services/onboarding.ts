import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { Prisma, prismaAdmin, withTenant, type Role } from '@pharmaiq/db';
import { DEFAULT_ALERT_CONFIG } from '@pharmaiq/core';
import { ConflictError, NotFoundError, ValidationError } from '../http';
import { createSupabaseAdminClient } from '../supabase/admin';
import { toTenantContext, type SessionUser } from '../auth';
import { inviteSchema, signupPharmacySchema } from '../validation';

/**
 * Inscription d'une pharmacie et invitation des employés (§5.1).
 *
 * C'est le SEUL endroit qui écrit sans tenant posé : à l'inscription, le tenant
 * n'existe pas encore. Tout le reste de l'application passe par `withTenant()`.
 */

export type SignupInput = z.infer<typeof signupPharmacySchema>;
export type InviteInput = z.infer<typeof inviteSchema>;

const DEFAULT_CATEGORIES = [
  'Médicaments',
  'Sirop',
  'Vitamine',
  'Collyre',
  'Crème',
  'Pommade',
  'Sachet',
  'Suppositoire',
  'Injectable',
  'Spray',
  'Lait',
  'Para-médical',
  'Dermo-cosmétique',
  'Non catégorisé',
];

export function slugify(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'pharmacie'
  );
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  for (let i = 2; i < 100; i++) {
    const existing = await prismaAdmin.pharmacy.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${randomBytes(3).toString('hex')}`;
}

export interface SignupResult {
  pharmacyId: string;
  slug: string;
  userId: string;
}

export async function signupPharmacy(input: SignupInput): Promise<SignupResult> {
  const supabase = createSupabaseAdminClient();
  const email = input.email.toLowerCase();

  const existingUser = await prismaAdmin.user.findFirst({
    where: { email },
    select: { id: true },
  });
  if (existingUser) {
    throw new ConflictError('Un compte existe déjà avec cet e-mail');
  }

  const slug = await uniqueSlug(slugify(input.pharmacyName));

  // 1. Le tenant et son propriétaire, en une transaction.
  const created = await prismaAdmin.$transaction(async (tx) => {
    const pharmacy = await tx.pharmacy.create({
      data: {
        name: input.pharmacyName.trim(),
        slug,
        city: input.city ?? null,
        currency: input.currency,
        locale: input.locale,
        phoneWhatsapp: input.phoneWhatsapp ?? null,
        alertConfig: { ...DEFAULT_ALERT_CONFIG } as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    const branch = await tx.branch.create({
      data: {
        pharmacyId: pharmacy.id,
        name: 'Principale',
        isMain: true,
      },
      select: { id: true },
    });

    await tx.category.createMany({
      data: DEFAULT_CATEGORIES.map((name) => ({ pharmacyId: pharmacy.id, name })),
      skipDuplicates: true,
    });

    const user = await tx.user.create({
      data: {
        pharmacyId: pharmacy.id,
        branchId: branch.id,
        fullName: input.ownerName.trim(),
        email,
        role: 'owner',
        locale: input.locale,
      },
      select: { id: true },
    });

    return { pharmacyId: pharmacy.id, branchId: branch.id, userId: user.id };
  });

  // 2. Le compte d'authentification, porteur du claim de tenant.
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.ownerName.trim() },
    app_metadata: { pharmacy_id: created.pharmacyId, role: 'owner' },
  });

  if (error || !data.user) {
    // Rien de moitié créé : on annule le tenant (cascade sur branche/user).
    await prismaAdmin.pharmacy.delete({ where: { id: created.pharmacyId } }).catch(() => undefined);
    throw new ConflictError(error?.message ?? "Création du compte d'authentification impossible");
  }

  await prismaAdmin.user.update({
    where: { id: created.userId },
    data: { authUserId: data.user.id },
  });

  return { pharmacyId: created.pharmacyId, slug, userId: created.userId };
}

// -----------------------------------------------------------------------------
// Invitations
// -----------------------------------------------------------------------------

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface InviteResult {
  userId: string;
  /** Lien à transmettre (WhatsApp/SMS) si l'e-mail n'arrive pas. */
  inviteUrl: string;
  emailSent: boolean;
}

export async function inviteEmployee(user: SessionUser, input: InviteInput): Promise<InviteResult> {
  const ctx = toTenantContext(user);
  const email = input.email.toLowerCase();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';

  const existing = await prismaAdmin.user.findFirst({
    where: { pharmacyId: ctx.pharmacyId, email },
    select: { id: true },
  });
  if (existing) throw new ConflictError('Cet e-mail est déjà rattaché à la pharmacie');

  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + 7 * 86_400_000);

  const invitation = await withTenant(ctx, async (tx) => {
    const created = await tx.user.create({
      data: {
        pharmacyId: ctx.pharmacyId,
        branchId: input.branchId ?? user.branchId,
        fullName: input.fullName.trim(),
        email,
        role: input.role as Role,
        isActive: false, // activé à l'acceptation
      },
      select: { id: true },
    });

    await tx.invitation.create({
      data: {
        pharmacyId: ctx.pharmacyId,
        email,
        role: input.role as Role,
        branchId: input.branchId ?? null,
        tokenHash: hashToken(token),
        invitedById: ctx.userId,
        expiresAt,
      },
    });

    await tx.auditLog.create({
      data: {
        pharmacyId: ctx.pharmacyId,
        userId: ctx.userId,
        action: 'user.invited',
        entity: 'User',
        entityId: created.id,
        meta: { email, role: input.role },
      },
    });

    return created;
  });

  // Tentative d'e-mail Supabase — non bloquante : le lien direct reste utilisable.
  let emailSent = false;
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: { full_name: input.fullName.trim() },
      redirectTo: appUrl ? `${appUrl}/invite/${token}` : undefined,
    });
    emailSent = !error;
  } catch (error) {
    console.warn('[invite] e-mail Supabase indisponible', error);
  }

  return {
    userId: invitation.id,
    inviteUrl: `${appUrl}/invite/${token}`,
    emailSent,
  };
}

export interface AcceptInviteInput {
  token: string;
  password: string;
  fullName?: string;
}

export async function acceptInvitation(input: AcceptInviteInput): Promise<{ pharmacyId: string }> {
  if (input.password.length < 8) {
    throw new ValidationError(['Le mot de passe doit faire au moins 8 caractères']);
  }

  const invitation = await prismaAdmin.invitation.findUnique({
    where: { tokenHash: hashToken(input.token) },
    select: {
      id: true,
      pharmacyId: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
    },
  });

  if (!invitation) throw new NotFoundError('Invitation introuvable');
  if (invitation.acceptedAt) throw new ConflictError('Invitation déjà utilisée');
  if (invitation.expiresAt < new Date()) throw new ConflictError('Invitation expirée');

  const pending = await prismaAdmin.user.findFirst({
    where: { pharmacyId: invitation.pharmacyId, email: invitation.email },
    select: { id: true, fullName: true },
  });
  if (!pending) throw new NotFoundError('Utilisateur invité introuvable');

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.auth.admin.createUser({
    email: invitation.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName ?? pending.fullName },
    app_metadata: { pharmacy_id: invitation.pharmacyId, role: invitation.role },
  });

  if (error || !data.user) {
    throw new ConflictError(error?.message ?? 'Création du compte impossible');
  }

  await prismaAdmin.$transaction([
    prismaAdmin.user.update({
      where: { id: pending.id },
      data: {
        authUserId: data.user.id,
        isActive: true,
        ...(input.fullName ? { fullName: input.fullName } : {}),
      },
    }),
    prismaAdmin.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    }),
  ]);

  return { pharmacyId: invitation.pharmacyId };
}
