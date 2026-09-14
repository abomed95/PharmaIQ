import { z } from 'zod';
import { withTenant } from '@pharmaiq/db';
import { allocateFefo, type StockLot } from '@pharmaiq/core';
import { ConflictError, NotFoundError } from '../http';
import { toTenantContext, type SessionUser } from '../auth';
import { stockAdjustSchema } from '../validation';

/** Ajustements manuels de stock (casse, inventaire, retour, péremption). */

export type StockAdjustInput = z.infer<typeof stockAdjustSchema>;

export interface StockAdjustResult {
  productId: string;
  quantityAfter: number;
  movements: number;
}

export async function adjustStock(
  user: SessionUser,
  input: StockAdjustInput,
): Promise<StockAdjustResult> {
  const ctx = toTenantContext(user);

  return withTenant(ctx, async (tx) => {
    const product = await tx.product.findFirst({
      where: { id: input.productId, pharmacyId: ctx.pharmacyId },
      select: { id: true, name: true, purchasePrice: true },
    });
    if (!product) throw new NotFoundError('Produit introuvable');

    const branchId =
      input.branchId ??
      user.branchId ??
      (
        await tx.branch.findFirst({
          where: { pharmacyId: ctx.pharmacyId },
          orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }],
          select: { id: true },
        })
      )?.id;
    if (!branchId) throw new NotFoundError('Aucune succursale configurée');

    let movements = 0;

    if (input.quantityDelta > 0) {
      // Entrée : on fusionne avec un lot identique s'il existe.
      const existing = await tx.stock.findFirst({
        where: {
          pharmacyId: ctx.pharmacyId,
          productId: product.id,
          branchId,
          batchNo: input.batchNo ?? null,
          expiryDate: input.expiryDate ?? null,
        },
        select: { id: true },
      });

      if (existing) {
        await tx.stock.update({
          where: { id: existing.id },
          data: { quantity: { increment: input.quantityDelta } },
        });
      } else {
        await tx.stock.create({
          data: {
            pharmacyId: ctx.pharmacyId,
            productId: product.id,
            branchId,
            quantity: input.quantityDelta,
            batchNo: input.batchNo ?? null,
            expiryDate: input.expiryDate ?? null,
            purchasePrice: input.purchasePrice ?? Number(product.purchasePrice),
          },
        });
      }

      await tx.stockMovement.create({
        data: {
          pharmacyId: ctx.pharmacyId,
          productId: product.id,
          branchId,
          type: input.type,
          source: 'manual',
          quantityDelta: input.quantityDelta,
          batchNo: input.batchNo ?? null,
          expiryDate: input.expiryDate ?? null,
          reason: input.reason,
          userId: ctx.userId,
        },
      });
      movements = 1;
    } else {
      // Sortie : FEFO, comme une vente — on ne choisit pas le lot au hasard.
      const lots = await tx.stock.findMany({
        where: {
          pharmacyId: ctx.pharmacyId,
          productId: product.id,
          branchId,
          quantity: { gt: 0 },
          ...(input.batchNo ? { batchNo: input.batchNo } : {}),
        },
        orderBy: [{ expiryDate: 'asc' }, { quantity: 'asc' }],
        select: { id: true, quantity: true, expiryDate: true, purchasePrice: true, batchNo: true },
      });

      const stockLots: StockLot[] = lots.map((lot) => ({
        id: lot.id,
        quantity: lot.quantity,
        expiryDate: lot.expiryDate,
        purchasePrice: Number(lot.purchasePrice),
        batchNo: lot.batchNo,
      }));

      const allocation = allocateFefo(stockLots, Math.abs(input.quantityDelta));
      if (allocation.shortage > 0) {
        throw new ConflictError(
          `Stock insuffisant pour « ${product.name} » : ${allocation.allocated} disponible(s)`,
        );
      }

      for (const alloc of allocation.allocations) {
        const updated = await tx.stock.updateMany({
          where: { id: alloc.lotId, pharmacyId: ctx.pharmacyId, quantity: { gte: alloc.quantity } },
          data: { quantity: { decrement: alloc.quantity } },
        });
        if (updated.count !== 1) {
          throw new ConflictError('Le stock a changé pendant l’ajustement. Recommence.');
        }
        await tx.stockMovement.create({
          data: {
            pharmacyId: ctx.pharmacyId,
            productId: product.id,
            branchId,
            type: input.type,
            source: 'manual',
            quantityDelta: -alloc.quantity,
            batchNo: alloc.batchNo,
            expiryDate: alloc.expiryDate,
            reason: input.reason,
            userId: ctx.userId,
          },
        });
        movements += 1;
      }
    }

    const agg = await tx.stock.aggregate({
      where: { pharmacyId: ctx.pharmacyId, productId: product.id },
      _sum: { quantity: true },
    });

    return {
      productId: product.id,
      quantityAfter: agg._sum.quantity ?? 0,
      movements,
    };
  });
}

/** État du stock par lot, trié FEFO — écran `/stock`. */
export async function listStock(
  user: SessionUser,
  options: { search?: string; onlyExpiring?: boolean; limit?: number } = {},
) {
  const ctx = toTenantContext(user);
  const limit = Math.min(options.limit ?? 200, 500);

  return withTenant(ctx, (tx) =>
    tx.stock.findMany({
      where: {
        pharmacyId: ctx.pharmacyId,
        quantity: { gt: 0 },
        ...(options.search
          ? { product: { name: { contains: options.search, mode: 'insensitive' } } }
          : {}),
        ...(options.onlyExpiring
          ? {
              expiryDate: {
                not: null,
                lte: new Date(Date.now() + 90 * 86_400_000),
              },
            }
          : {}),
      },
      orderBy: [{ expiryDate: 'asc' }, { quantity: 'asc' }],
      take: limit,
      select: {
        id: true,
        quantity: true,
        batchNo: true,
        expiryDate: true,
        purchasePrice: true,
        branch: { select: { name: true } },
        product: { select: { id: true, name: true, unit: true, reorderLevel: true } },
      },
    }),
  );
}
