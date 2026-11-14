import { z } from 'zod';
import { Prisma, withTenant } from '@pharmaiq/db';
import { round2 } from '@pharmaiq/core';
import { NotFoundError } from '../http';
import { toTenantContext, type SessionUser } from '../session';
import { purchaseConfirmSchema } from '../validation';
import { resolveBranchId } from './branches';

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
  /** true si l'achat existait déjà (rejeu de la même `clientRef`). */
  replayed: boolean;
}

/** Un reçu de 300 lignes fait plusieurs milliers d'écritures : 20 s ne suffisent pas. */
const PURCHASE_TX_TIMEOUT_MS = 60_000;

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
    // --- Idempotence : la même clé n'entre jamais deux fois le stock ---------
    if (input.clientRef) {
      const existing = await tx.purchase.findFirst({
        where: { pharmacyId: ctx.pharmacyId, clientRef: input.clientRef },
        select: { id: true, total: true, _count: { select: { items: true } } },
      });
      if (existing) {
        return {
          purchaseId: existing.id,
          total: Number(existing.total),
          createdProducts: 0,
          updatedLots: existing._count.items,
          replayed: true,
        };
      }
    }

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
        clientRef: input.clientRef ?? null,
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
        // Le nom peut déjà exister (même produit saisi deux fois sur le reçu) :
        // on ne compte comme « créé » que ce qui l'est vraiment.
        const known = await tx.product.findUnique({
          where: { pharmacyId_name: { pharmacyId: ctx.pharmacyId, name } },
          select: { id: true },
        });
        if (known) {
          productId = known.id;
        } else {
          const created = await tx.product.create({
            data: {
              pharmacyId: ctx.pharmacyId,
              name,
              purchasePrice: item.purchasePrice,
              sellingPrice: item.sellingPrice ?? defaultSellingPrice(item.purchasePrice),
              supplierName: supplierName ?? null,
            },
            select: { id: true },
          });
          productId = created.id;
          createdProducts += 1;
        }
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

    return { purchaseId: purchase.id, total, createdProducts, updatedLots, replayed: false };
  }, { timeout: PURCHASE_TX_TIMEOUT_MS });
}
