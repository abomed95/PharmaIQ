import { PrismaClient } from '@prisma/client';

/**
 * Client « système » qui CONTOURNE la Row-Level Security.
 *
 * ⚠️⚠️ Règles d'usage — toute exception doit être justifiée en revue :
 *   - inscription d'une pharmacie (aucun tenant n'existe encore) ;
 *   - jobs planifiés qui doivent énumérer les pharmacies (alertes) ;
 *   - scripts d'import / migrations de données.
 *
 * INTERDIT : l'utiliser dans une route applicative avec un identifiant venant
 * du client. Le travail par pharmacie doit repartir dans `withTenant()` pour
 * que la RLS s'applique.
 *
 * Nécessite un rôle BYPASSRLS (ou le propriétaire sans FORCE RLS) :
 * `ADMIN_DATABASE_URL`, sinon retombe sur `DIRECT_URL`/`DATABASE_URL`.
 */
const adminUrl =
  process.env.ADMIN_DATABASE_URL ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL;

const globalForPrisma = globalThis as unknown as { pharmaiqPrismaAdmin?: PrismaClient };

export const prismaAdmin: PrismaClient =
  globalForPrisma.pharmaiqPrismaAdmin ??
  new PrismaClient({
    datasourceUrl: adminUrl,
    log: ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.pharmaiqPrismaAdmin = prismaAdmin;
}
