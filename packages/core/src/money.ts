/**
 * Arithmétique monétaire. Les montants circulent en nombres (unité principale,
 * ex. FDJ) et sont arrondis au centime à chaque étape pour éviter la dérive des
 * flottants. Le stockage reste en `Decimal(12,2)` côté PostgreSQL.
 */

export const PAYMENT_METHODS = [
  'Cash',
  'Waafi',
  'CAC pay',
  'D money',
  'Saba pay',
  'banque',
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value);
}

/** Arrondi bancaire à 2 décimales, robuste aux erreurs de représentation. */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  // Prisma Decimal, Big.js… exposent toString()
  if (value && typeof (value as { toString?: unknown }).toString === 'function') {
    const n = Number((value as { toString(): string }).toString());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export interface CartLine {
  quantity: number;
  unitPrice: number;
  /** Remise sur la ligne, en montant absolu. */
  discount?: number;
}

export interface CartTotals {
  subtotal: number;
  discount: number;
  tax: number;
  grandTotal: number;
}

/**
 * Totaux d'un panier de caisse.
 * La taxe s'applique après remise (pratique locale la plus courante).
 */
export function computeTotals(
  lines: CartLine[],
  options: { taxRate?: number; globalDiscount?: number } = {},
): CartTotals {
  const taxRate = Math.max(0, options.taxRate ?? 0);
  const globalDiscount = Math.max(0, options.globalDiscount ?? 0);

  let gross = 0;
  let lineDiscounts = 0;
  for (const line of lines) {
    const qty = Math.max(0, line.quantity);
    gross = round2(gross + qty * line.unitPrice);
    lineDiscounts = round2(lineDiscounts + Math.max(0, line.discount ?? 0));
  }

  const discount = round2(Math.min(gross, lineDiscounts + globalDiscount));
  const subtotal = round2(gross - discount);
  const tax = round2((subtotal * taxRate) / 100);
  const grandTotal = round2(subtotal + tax);

  return { subtotal, discount, tax, grandTotal };
}

export function lineTotal(line: CartLine): number {
  return round2(Math.max(0, line.quantity) * line.unitPrice - Math.max(0, line.discount ?? 0));
}

/** Monnaie à rendre (jamais négative). */
export function computeChange(grandTotal: number, paid: number): { change: number; due: number } {
  const diff = round2(paid - grandTotal);
  return diff >= 0 ? { change: diff, due: 0 } : { change: 0, due: round2(-diff) };
}

/** Marge en % du prix de vente. `null` si le prix de vente est nul. */
export function marginRate(purchasePrice: number, sellingPrice: number): number | null {
  if (sellingPrice <= 0) return null;
  return round2(((sellingPrice - purchasePrice) / sellingPrice) * 100);
}

export function formatMoney(value: number, currency = 'DJF', locale = 'fr-DJ'): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: currency === 'DJF' ? 0 : 2,
    }).format(value);
  } catch {
    return `${Math.round(value)} ${currency}`;
  }
}
