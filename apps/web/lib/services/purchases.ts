import { z } from 'zod';
import { Prisma, withTenant, type TenantTx } from '@pharmaiq/db';
import { round2 } from '@pharmaiq/core';
import { NotFoundError } from '../http';
import { toTenantContext, type SessionUser } from '../auth';
import { purchaseConfirmSchema } from '../validation';

/**
 * Confirmation d'un achat fournisseur → entrée en stock (§6.2 étape 5).
 *
 * Appelé APRÈS l'écran de validation humaine : les lignes reçues ici sont celles
 * que l'employé a relues et corrigées, jamais la sortie brute du modèle.
 */

export type PurchaseConfirmInput = z.infer<typeof purchaseConfirmSchema>;

export interface PurchaseResult {
  purchaseId: string;
  total: number;
  createdProducts: number;
  updatedLots: number;
}

async function resolveBranchId(
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
  if (!main) throw new NotFoundError('Aucune succursale configurée');
  return main.id;
}

/** Prix de vente par défaut d'un nouveau produit : marge 25 %, arrondi à 5. */
function defaultSellingPrice(purchasePrice: number): number {
  if (purchasePrice <= 0) return 0;
  return Math.ceil(purchasePrice / 0.75 / 5) * 5;
}

export async function confirmPurchase(
  user: SessionUser,
  input: PurchaseConfirmInput,
): Promise<PurchaseResult> {
  const ctx = toTenantContext(user);

  return withTenant(ctx, async (tx) => {
    const branchId = await resolveBranchId(tx, ctx.pharmacyId, input.branchId, user.branchId);

    // --- Fournisseur ---------------------------------------------------------
    let supplierId: string | null = null;
    const supplierName = input.supplierName?.trim();
    if (supplierName) {
      const supplier = await tx.supplier.upsert({
        where: { pharmacyId_name: { pharmacyId: ctx.pharmacyId, name: supplierName } },
        create: { pharmacyId: ctx.pharmacyId, name: supplierName },
        update: {},
        select: { id: true },
      });
      supplierId = supplier.id;
    }

    const purchase = await tx.purchase.create({
      data: {
        pharmacyId: ctx.pharmacyId,
        supplierId,
        branchId,
        invoiceRef: input.invoiceRef ?? null,
        date: input.date ?? new Date(),
        status: 'confirmed',
        receiptImageUrl: input.receiptImageUrl ?? null,
        aiExtracted: input.aiExtracted,
        aiConfidence: input.aiConfidence ?? null,
        // Sortie brute du modèle, conservée pour audit — forme non garantie.
        aiRaw: (input.aiRaw ?? undefined) as Prisma.InputJsonValue | undefined,
        confirmedById: ctx.userId,
        confirmedAt: new Date(),
      },
      select: { id: true },
    });

    let total = 0;
    let createdProducts = 0;
    let updatedLots = 0;

    for (const item of input.items) {
      // --- Produit : existant (vérifié dans le tenant) ou créé ---------------
      let productId = item.productId ?? null;

      if (productId) {
        const product = await tx.product.findFirst({
          where: { id: productId, pharmacyId: ctx.pharmacyId },
          select: { id: true },
        });
        if (!product) throw new NotFoundError('Produit inconnu dans cette pharmacie');
      } else {
        const name = (item.newProductName ?? item.rawName ?? '').trim();
        if (!name) throw new NotFoundError('Nom de produit manquant');
        const created = await tx.product.upsert({
          where: { pharmacyId_name: { pharmacyId: ctx.pharmacyId, name } },
          create: {
            pharmacyId: ctx.pharmacyId,
            name,
            purchasePrice: item.purchasePrice,
            sellingPrice: item.sellingPrice ?? defaultSellingPrice(item.purchasePrice),
            supplierName: supplierName ?? null,
          },
          update: {},
          select: { id: true },
        });
        productId = created.id;
        createdProducts += 1;
      }

      // --- Lot : on fusionne avec un lot identique (même n° + même date) -----
      const existingLot = await tx.stock.findFirst({
        where: {
          pharmacyId: ctx.pharmacyId,
          productId,
          branchId,
          batchNo: item.batchNo ?? null,
          expiryDate: item.expiryDate ?? null,
        },
        select: { id: true },
      });

      if (existingLot) {
        await tx.stock.update({
          where: { id: existingLot.id },
          data: {
            quantity: { increment: item.quantity },
            // Le dernier prix payé devient la référence de valorisation du lot.
            purchasePrice: item.purchasePrice,
          },
        });
      } else {
        await tx.stock.create({
          data: {
            pharmacyId: ctx.pharmacyId,
            productId,
            branchId,
            quantity: item.quantity,
            batchNo: item.batchNo ?? null,
            expiryDate: item.expiryDate ?? null,
            purchasePrice: item.purchasePrice,
          },
        });
      }
      updatedLots += 1;

      await tx.purchaseItem.create({
        data: {
          pharmacyId: ctx.pharmacyId,
          purchaseId: purchase.id,
          productId,
          quantity: item.quantity,
          purchasePrice: item.purchasePrice,
          batchNo: item.batchNo ?? null,
          expiryDate: item.expiryDate ?? null,
          rawName: item.rawName ?? null,
        },
      });

      await tx.stockMovement.create({
        data: {
          pharmacyId: ctx.pharmacyId,
          productId,
          branchId,
          type: 'purchase',
          source: input.aiExtracted ? 'receipt_photo' : 'manual',
          quantityDelta: item.quantity,
          batchNo: item.batchNo ?? null,
          expiryDate: item.expiryDate ?? null,
          unitPrice: item.purchasePrice,
          refType: 'purchase',
          refId: purchase.id,
          userId: ctx.userId,
        },
      });

      // Le prix d'achat de référence du produit suit le dernier achat.
      await tx.product.update({
        where: { id: productId },
        data: { purchasePrice: item.purchasePrice },
      });

      total = round2(total + item.quantity * item.purchasePrice);
    }

    await tx.purchase.update({ where: { id: purchase.id }, data: { total } });
    await tx.auditLog.create({
      data: {
        pharmacyId: ctx.pharmacyId,
        userId: ctx.userId,
        action: 'purchase.confirmed',
        entity: 'Purchase',
        entityId: purchase.id,
        meta: {
          total,
          lines: input.items.length,
          aiExtracted: input.aiExtracted,
          createdProducts,
        },
      },
    });

    return { purchaseId: purchase.id, total, createdProducts, updatedLots };
  });
}
