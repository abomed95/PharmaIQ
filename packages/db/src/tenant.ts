import { Prisma, type Role } from '@prisma/client';
import { prisma } from './client';

/**
 * Contexte tenant — TOUJOURS construit côté serveur à partir de la session.
 * Aucun champ ne doit provenir du corps d'une requête HTTP.
 */
export interface TenantContext {
  pharmacyId: string;
  userId: string | null;
  role: Role;
  branchId: string | null;
  email?: string | null;
}

/** Client Prisma lié à une transaction dont le tenant est déjà posé. */
export type TenantTx = Prisma.TransactionClient;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TenantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantError';
  }
}

export function assertUuid(value: unknown, label = 'identifiant'): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new TenantError(`${label} invalide`);
  }
  return value;
}

/**
 * Exécute `fn` dans une transaction où le tenant courant est posé au niveau
 * PostgreSQL (`SET LOCAL app.pharmacy_id`). La RLS filtre alors TOUTES les
 * requêtes — y compris le SQL brut — même si le code oublie un `where`.
 *
 * `SET LOCAL` est limité à la transaction : aucune fuite entre requêtes
 * concurrentes partageant le pool de connexions.
 */
export async function withTenant<T>(
  ctx: TenantContext,
  fn: (tx: TenantTx) => Promise<T>,
  options: { maxWait?: number; timeout?: number } = {},
): Promise<T> {
  assertUuid(ctx.pharmacyId, 'pharmacyId');
  if (ctx.userId) assertUuid(ctx.userId, 'userId');

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`select set_config('app.pharmacy_id', ${ctx.pharmacyId}::text, true)`;
      if (ctx.userId) {
        await tx.$executeRaw`select set_config('app.user_id', ${ctx.userId}::text, true)`;
      }
      return fn(tx);
    },
    { maxWait: options.maxWait ?? 5_000, timeout: options.timeout ?? 20_000 },
  );
}

/**
 * Filtre à étaler dans chaque `where` — défense en profondeur par-dessus la RLS.
 *
 *     tx.product.findMany({ where: { ...tenantScope(ctx), isActive: true } })
 */
export function tenantScope(ctx: TenantContext): { pharmacyId: string } {
  return { pharmacyId: ctx.pharmacyId };
}

/** Requête SQL brute exécutée sous RLS (analyses, agrégats). */
export async function tenantQuery<T>(ctx: TenantContext, sql: Prisma.Sql): Promise<T[]> {
  return withTenant(ctx, (tx) => tx.$queryRaw<T[]>(sql));
}

/**
 * Compteur atomique par tenant (numérotation des factures, des bons…).
 * À appeler DANS une transaction tenant.
 */
export async function nextCounter(tx: TenantTx, pharmacyId: string, key: string): Promise<number> {
  const row = await tx.counter.upsert({
    where: { pharmacyId_key: { pharmacyId, key } },
    create: { pharmacyId, key, value: 1 },
    update: { value: { increment: 1 } },
    select: { value: true },
  });
  return row.value;
}

/**
 * Vérifie que le tenant est bien appliqué côté base. Utilisé par les tests
 * d'isolation et par un contrôle de démarrage en production.
 */
export async function currentPharmacyId(tx: TenantTx): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string | null }[]>`
    select app.current_pharmacy_id()::text as id
  `;
  return rows[0]?.id ?? null;
}
