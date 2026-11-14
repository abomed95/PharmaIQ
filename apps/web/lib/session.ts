import type { TenantContext } from '@pharmaiq/db';

/**
 * Types et utilitaires de session, SANS dépendance à React ni à Next.
 *
 * Les services métier n'ont besoin que de ces définitions. Les garder hors de
 * `auth.ts` (qui lit les cookies et utilise `cache()` de React serveur) permet
 * de tester les services contre une vraie base, sans démarrer Next.
 */

export class UnauthorizedError extends Error {
  constructor(message = 'Authentification requise') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export interface SessionUser extends TenantContext {
  fullName: string;
  pharmacyName: string;
  pharmacySlug: string;
  currency: string;
  locale: string;
  invoicePrefix: string;
  taxRate: number;
}

/** Contexte tenant nu, à passer à `withTenant()`. */
export function toTenantContext(user: SessionUser): TenantContext {
  return {
    pharmacyId: user.pharmacyId,
    userId: user.userId,
    role: user.role,
    branchId: user.branchId,
    email: user.email,
  };
}
