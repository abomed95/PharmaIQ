import type { TenantTx } from '@pharmaiq/db';
import { NotFoundError } from '../http';

/**
 * Succursale sur laquelle porte une opération de stock.
 *
 * Un `branchId` reçu du client n'est retenu que s'il appartient à la pharmacie :
 * les clés étrangères ne passent pas par la RLS, donc sans cette lecture un
 * identifiant d'une autre pharmacie serait accepté tel quel à l'écriture.
 * À défaut, on retombe sur la succursale principale.
 */
export async function resolveBranchId(
  tx: TenantTx,
  pharmacyId: string,
  requested: string | null | undefined,
  fallback: string | null,
): Promise<string> {
  const candidate = requested ?? fallback;
  if (candidate) {
    const branch = await tx.branch.findFirst({
      where: { id: candidate, pharmacyId },
      select: { id: true },
    });
    if (branch) return branch.id;
  }
  const main = await tx.branch.findFirst({
    where: { pharmacyId },
    orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  if (!main) throw new NotFoundError('Aucune succursale configurée pour cette pharmacie');
  return main.id;
}
