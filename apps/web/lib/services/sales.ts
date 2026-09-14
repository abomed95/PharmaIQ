import { z } from 'zod';
import { withTenant, nextCounter, type TenantTx } from '@pharmaiq/db';
import {
  allocateFefo,
  computeChange,
  computeTotals,
  counterKey,
  formatInvoiceNumber,
  lineTotal,
  round2,
  weightedUnitCost,
  type StockLot,
} from '@pharmaiq/core';
import { ConflictError, NotFoundError, ValidationError } from '../http';
import { toTenantContext, type SessionUser } from '../auth';
import { saleCreateSchema } from '../validation';

/**
 * Encaissement (§5.4 / §11 « caisse »).
 *
 * Tout se joue dans UNE transaction : allocation FEFO des lots, décrément du
 * stock, journal des mouvements, numérotation de la facture, lignes de vente.
 * Si quoi que ce soit échoue, rien n'est écrit — pas de stock fantôme.
 */

export type SaleInput = z.infer<typeof saleCreateSchema>;

export interface SaleResult {
  id: string;
  invoiceId: string;
  date: Date;
  subtotal: number;
  tax: number;
  discount: number;
  grandTotal: number;
  paid: number;
  change: number;
  due: number;
  costTotal: number;
  profit: number;
  paymentMethod: string;
  items: Array<{
    productId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    lineTotal: number;
    unitCost: number;
  }>;
  /** true si la vente existait déjà (rejeu de la même `clientRef`). */
  replayed: boolean;
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
  if (!main) throw new NotFoundError('Aucune succursale configurée pour cette pharmacie');
  return main.id;
}

export async function createSale(user: SessionUser, input: SaleInput): Promise<SaleResult> {
  const ctx = toTenantContext(user);

  return withTenant(ctx, async (tx) => {
    // --- Idempotence : la même clé ne crée jamais deux ventes ----------------
    if (input.clientRef) {
      const existing = await tx.sale.findFirst({
        where: { pharmacyId: ctx.pharmacyId, clientRef: input.clientRef },
        include: { items: { include: { product: { select: { name: true } } } } },
      });
      if (existing) {
        return {
          id: existing.id,
          invoiceId: existing.invoiceId,
          date: existing.date,
          subtotal: Number(existing.subtotal),
          tax: Number(existing.tax),
          discount: Number(existing.discount),
          grandTotal: Number(existing.grandTotal),
          paid: Number(existing.paid),
          change: Number(existing.change),
          due: Number(existing.due),
          costTotal: Number(existing.costTotal),
          profit: round2(Number(existing.grandTotal) - Number(existing.costTotal)),
          paymentMethod: existing.paymentMethod,
          items: existing.items.map((item) => ({
            productId: item.productId,
            name: item.product.name,
            quantity: item.quantity,
            unitPrice: Number(item.unitPrice),
            discount: Number(item.discount),
            lineTotal: Number(item.lineTotal),
            unitCost: Number(item.unitCost),
          })),
          replayed: true,
        };
      }
    }

    const branchId = await resolveBranchId(tx, ctx.pharmacyId, input.branchId, user.branchId);

    // --- Produits : ils doivent tous appartenir à CETTE pharmacie ------------
    const productIds = [...new Set(input.items.map((i) => i.productId))];
    const products = await tx.product.findMany({
      where: { id: { in: productIds }, pharmacyId: ctx.pharmacyId, isActive: true },
      select: { id: true, name: true, sellingPrice: true },
    });
    if (products.length !== productIds.length) {
      throw new NotFoundError('Un produit du panier est inconnu ou désactivé');
    }
    const productById = new Map(products.map((p) => [p.id, p]));

    // --- Allocation FEFO + décrément du stock --------------------------------
    const allocatedItems: Array<{
      productId: string;
      name: string;
      quantity: number;
      unitPrice: number;
      discount: number;
      lineTotal: number;
      unitCost: number;
      movements: Array<{ quantity: number; batchNo: string | null; expiryDate: Date | null }>;
    }> = [];

    let costTotal = 0;

    for (const item of input.items) {
      const product = productById.get(item.productId);
      if (!product) throw new NotFoundError('Produit inconnu dans le panier');

      const lots = await tx.stock.findMany({
        where: {
          pharmacyId: ctx.pharmacyId,
          productId: item.productId,
          branchId,
          quantity: { gt: 0 },
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

      const allocation = allocateFefo(stockLots, item.quantity);
      if (allocation.shortage > 0) {
        throw new ConflictError(
          `Stock insuffisant pour « ${product.name} » : ${allocation.allocated} disponible(s) sur ${item.quantity} demandé(s)`,
        );
      }

      for (const alloc of allocation.allocations) {
        // Garde `quantity >= alloc.quantity` : bloque toute vente concurrente
        // qui aurait vidé le lot entre la lecture et l'écriture.
        const updated = await tx.stock.updateMany({
          where: { id: alloc.lotId, pharmacyId: ctx.pharmacyId, quantity: { gte: alloc.quantity } },
          data: { quantity: { decrement: alloc.quantity } },
        });
        if (updated.count !== 1) {
          throw new ConflictError(
            `Le stock de « ${product.name} » a changé pendant l'encaissement. Recommence la vente.`,
          );
        }
      }

      const unitCost = weightedUnitCost(allocation);
      costTotal = round2(costTotal + allocation.cost);

      allocatedItems.push({
        productId: item.productId,
        name: product.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        lineTotal: lineTotal({
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
        }),
        unitCost,
        movements: allocation.allocations.map((a) => ({
          quantity: a.quantity,
          batchNo: a.batchNo ?? null,
          expiryDate: a.expiryDate,
        })),
      });
    }

    // --- Totaux --------------------------------------------------------------
    const totals = computeTotals(
      input.items.map((i) => ({
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        discount: i.discount,
      })),
      { taxRate: user.taxRate, globalDiscount: input.discount },
    );
    const paid = input.paid > 0 ? input.paid : totals.grandTotal;
    const { change, due } = computeChange(totals.grandTotal, paid);

    // --- Numérotation de la facture -----------------------------------------
    const now = new Date();
    const sequence = await nextCounter(tx, ctx.pharmacyId, counterKey(now));
    const invoiceId = formatInvoiceNumber(user.invoicePrefix, sequence, now);

    // --- Écriture ------------------------------------------------------------
    const sale = await tx.sale.create({
      data: {
        pharmacyId: ctx.pharmacyId,
        branchId,
        invoiceId,
        clientRef: input.clientRef ?? null,
        date: now,
        subtotal: totals.subtotal,
        tax: totals.tax,
        discount: totals.discount,
        grandTotal: totals.grandTotal,
        paid,
        due,
        change,
        costTotal,
        paymentMethod: input.paymentMethod,
        soldById: ctx.userId,
        customerId: input.customerId ?? null,
        note: input.note ?? null,
        items: {
          create: allocatedItems.map((item) => ({
            pharmacyId: ctx.pharmacyId,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount,
            lineTotal: item.lineTotal,
            unitCost: item.unitCost,
            soldAt: now,
          })),
        },
      },
      select: { id: true, invoiceId: true, date: true },
    });

    // Journal des mouvements : un par lot servi (traçabilité FEFO complète).
    for (const item of allocatedItems) {
      for (const movement of item.movements) {
        await tx.stockMovement.create({
          data: {
            pharmacyId: ctx.pharmacyId,
            productId: item.productId,
            branchId,
            type: 'sale',
            source: 'pos',
            quantityDelta: -movement.quantity,
            batchNo: movement.batchNo,
            expiryDate: movement.expiryDate,
            unitPrice: item.unitPrice,
            refType: 'sale',
            refId: sale.id,
            userId: ctx.userId,
          },
        });
      }
    }

    // Fidélité : 1 point par unité monétaire dépensée, arrondi à l'entier.
    if (input.customerId) {
      await tx.customer.updateMany({
        where: { id: input.customerId, pharmacyId: ctx.pharmacyId },
        data: { loyaltyPoints: { increment: Math.floor(totals.grandTotal) } },
      });
    }

    return {
      id: sale.id,
      invoiceId: sale.invoiceId,
      date: sale.date,
      subtotal: totals.subtotal,
      tax: totals.tax,
      discount: totals.discount,
      grandTotal: totals.grandTotal,
      paid,
      change,
      due,
      costTotal,
      profit: round2(totals.grandTotal - costTotal),
      paymentMethod: input.paymentMethod,
      items: allocatedItems.map((item) => ({
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        lineTotal: item.lineTotal,
        unitCost: item.unitCost,
      })),
      replayed: false,
    };
  });
}

/**
 * Annulation d'une vente : remet les quantités en stock sur un lot de retour et
 * journalise. On ne supprime jamais une vente (piste d'audit).
 */
export async function cancelSale(user: SessionUser, saleId: string, reason: string): Promise<void> {
  const ctx = toTenantContext(user);
  if (!reason.trim()) throw new ValidationError(['Un motif est requis pour annuler une vente']);

  await withTenant(ctx, async (tx) => {
    const sale = await tx.sale.findFirst({
      where: { id: saleId, pharmacyId: ctx.pharmacyId },
      include: { items: true },
    });
    if (!sale) throw new NotFoundError('Vente introuvable');
    if (sale.status !== 'completed') throw new ConflictError('Cette vente est déjà annulée');

    for (const item of sale.items) {
      await tx.stock.create({
        data: {
          pharmacyId: ctx.pharmacyId,
          productId: item.productId,
          branchId: sale.branchId,
          quantity: item.quantity,
          batchNo: `RETOUR-${sale.invoiceId}`,
          purchasePrice: item.unitCost,
        },
      });
      await tx.stockMovement.create({
        data: {
          pharmacyId: ctx.pharmacyId,
          productId: item.productId,
          branchId: sale.branchId,
          type: 'return',
          source: 'pos',
          quantityDelta: item.quantity,
          reason,
          refType: 'sale',
          refId: sale.id,
          userId: ctx.userId,
        },
      });
    }

    await tx.sale.update({ where: { id: sale.id }, data: { status: 'cancelled' } });
    await tx.auditLog.create({
      data: {
        pharmacyId: ctx.pharmacyId,
        userId: ctx.userId,
        action: 'sale.cancelled',
        entity: 'Sale',
        entityId: sale.id,
        meta: { invoiceId: sale.invoiceId, reason },
      },
    });
  });
}
