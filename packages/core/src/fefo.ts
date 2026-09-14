/**
 * FEFO — First Expired, First Out.
 *
 * Toute sortie de stock (vente, casse, transfert) sert d'abord les lots qui
 * périment le plus tôt. Les lots sans date de péremption passent en dernier :
 * ils ne risquent pas la perte.
 */

export interface StockLot {
  id: string;
  quantity: number;
  expiryDate: Date | null;
  purchasePrice: number;
  batchNo?: string | null;
}

export interface LotAllocation {
  lotId: string;
  quantity: number;
  unitCost: number;
  expiryDate: Date | null;
  batchNo?: string | null;
}

export interface AllocationResult {
  allocations: LotAllocation[];
  allocated: number;
  /** Quantité manquante : > 0 signifie stock insuffisant. */
  shortage: number;
  /** Coût d'achat total des unités servies. */
  cost: number;
}

/** Tri FEFO : péremption la plus proche d'abord, lots sans date en dernier. */
export function sortFefo(lots: StockLot[]): StockLot[] {
  return [...lots].sort((a, b) => {
    const ta = a.expiryDate ? a.expiryDate.getTime() : Number.POSITIVE_INFINITY;
    const tb = b.expiryDate ? b.expiryDate.getTime() : Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    // À date égale, on vide d'abord le plus petit lot (moins de reliquats).
    if (a.quantity !== b.quantity) return a.quantity - b.quantity;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Répartit `requested` unités sur les lots disponibles selon FEFO.
 * N'écrit rien : la persistance est faite par l'appelant, dans une transaction.
 */
export function allocateFefo(lots: StockLot[], requested: number): AllocationResult {
  const target = Math.max(0, Math.floor(requested));
  const allocations: LotAllocation[] = [];
  let remaining = target;
  let cost = 0;

  for (const lot of sortFefo(lots)) {
    if (remaining <= 0) break;
    const available = Math.max(0, lot.quantity);
    if (available === 0) continue;

    const take = Math.min(available, remaining);
    allocations.push({
      lotId: lot.id,
      quantity: take,
      unitCost: lot.purchasePrice,
      expiryDate: lot.expiryDate,
      batchNo: lot.batchNo ?? null,
    });
    cost += take * lot.purchasePrice;
    remaining -= take;
  }

  const allocated = target - remaining;
  return {
    allocations,
    allocated,
    shortage: remaining,
    cost: Math.round((cost + Number.EPSILON) * 100) / 100,
  };
}

/** Coût d'achat unitaire moyen des unités servies (pour la marge réelle). */
export function weightedUnitCost(result: AllocationResult): number {
  if (result.allocated <= 0) return 0;
  return Math.round(((result.cost / result.allocated) + Number.EPSILON) * 100) / 100;
}

export function daysUntil(date: Date | null, from: Date = new Date()): number | null {
  if (!date) return null;
  const MS_PER_DAY = 86_400_000;
  const a = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const b = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  return Math.round((a - b) / MS_PER_DAY);
}

export function isExpired(date: Date | null, from: Date = new Date()): boolean {
  const d = daysUntil(date, from);
  return d !== null && d < 0;
}
