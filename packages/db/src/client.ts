import { PrismaClient } from '@prisma/client';

/**
 * Client Prisma applicatif.
 *
 * ⚠️ Ce client se connecte avec le rôle `pharmaiq_app`, SOUMIS à la RLS : tant
 * qu'aucun tenant n'est posé dans la transaction, il ne voit AUCUNE ligne.
 * Ne l'utilise jamais directement dans une route — passe par `withTenant()`.
 */
const globalForPrisma = globalThis as unknown as { pharmaiqPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.pharmaiqPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.pharmaiqPrisma = prisma;
}
