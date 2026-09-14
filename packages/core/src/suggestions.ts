/**
 * Conseils d'achat (§6.3) — « quoi acheter en plus, quoi acheter en moins ».
 *
 * Tout est calculé à partir de l'historique RÉEL de la pharmacie (`SaleItem`),
 * jamais d'une moyenne inter-pharmacies. Fonctions pures : l'accès base se fait
 * en amont (apps/web/lib/analytics.ts) et le résultat est persisté dans
 * `Recommendation`.
 */

import { daysUntil } from './fefo';
import { marginRate, round2 } from './money';

export type SuggestionType =
  | 'buy_more'
  | 'buy_less'
  | 'dead_stock'
  | 'price_suggestion'
  | 'expiry_risk';

/** Une ligne agrégée par produit, sortie de la requête d'analyse. */
export interface ProductStat {
  productId: string;
  name: string;
  categoryName?: string | null;
  supplierName?: string | null;
  /** Unités vendues sur la fenêtre d'analyse. */
  unitsSold: number;
  /** Chiffre d'affaires sur la fenêtre. */
  revenue?: number;
  stock: number;
  purchasePrice: number;
  sellingPrice: number;
  reorderLevel: number;
  leadTimeDays?: number;
  nearestExpiry?: Date | null;
  /** Quantité présente sur le lot qui périme le plus tôt. */
  nearestExpiryQty?: number;
  lastSaleAt?: Date | null;
}

export interface SuggestionParams {
  /** Fenêtre d'observation des ventes, en jours. */
  periodDays: number;
  /** Horizon de couverture visé pour une commande (jours). */
  horizonDays: number;
  /** Stock de sécurité, en jours de vente. */
  safetyDays: number;
  /** Délai fournisseur par défaut si le produit n'en a pas. */
  defaultLeadTimeDays: number;
  /** Sans vente depuis N jours => capital dormant. */
  deadStockDays: number;
  /** Fenêtre de vigilance péremption (jours). */
  expiryHorizonDays: number;
  /** Marge en % sous laquelle on signale un problème de prix. */
  minMarginRate: number;
  today: Date;
}

export const DEFAULT_SUGGESTION_PARAMS: SuggestionParams = {
  periodDays: 90,
  horizonDays: 30,
  safetyDays: 7,
  defaultLeadTimeDays: 7,
  deadStockDays: 90,
  expiryHorizonDays: 60,
  minMarginRate: 5,
  today: new Date(),
};

export interface Suggestion {
  type: SuggestionType;
  productId: string;
  name: string;
  supplierName?: string | null;
  /** 0 → 100. Sert au tri de l'écran /suggestions. */
  priority: number;
  /** Phrase courte affichable telle quelle (FR). */
  reason: string;
  payload: {
    velocityPerDay: number;
    coverageDays: number | null;
    stock: number;
    unitsSold: number;
    suggestedQty?: number;
    capitalTied?: number;
    daysToExpiry?: number | null;
    qtyAtRisk?: number;
    currentMarginRate?: number | null;
    suggestedPrice?: number;
  };
}

function velocityOf(stat: ProductStat, periodDays: number): number {
  if (periodDays <= 0) return 0;
  return stat.unitsSold / periodDays;
}

function clampPriority(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Jours de couverture = stock / vitesse de vente.
 * `null` = produit sans vente sur la période (couverture infinie).
 */
export function coverageDays(stock: number, velocityPerDay: number): number | null {
  if (velocityPerDay <= 0) return null;
  return round2(stock / velocityPerDay);
}

/**
 * Quantité à commander : couvrir l'horizon + le délai fournisseur, sans
 * descendre sous le seuil de réappro, moins ce qui est déjà en stock.
 */
export function suggestedOrderQty(
  stat: ProductStat,
  params: SuggestionParams,
  velocityPerDay: number,
): number {
  const lead = stat.leadTimeDays ?? params.defaultLeadTimeDays;
  const target = Math.max(
    velocityPerDay * (params.horizonDays + lead + params.safetyDays),
    stat.reorderLevel,
  );
  return Math.max(0, Math.ceil(target - stat.stock));
}

export function buildSuggestions(
  stats: ProductStat[],
  overrides: Partial<SuggestionParams> = {},
): Suggestion[] {
  const params: SuggestionParams = { ...DEFAULT_SUGGESTION_PARAMS, ...overrides };
  const out: Suggestion[] = [];

  for (const stat of stats) {
    const velocity = velocityOf(stat, params.periodDays);
    const coverage = coverageDays(stat.stock, velocity);
    const lead = stat.leadTimeDays ?? params.defaultLeadTimeDays;
    const base = {
      velocityPerDay: round2(velocity),
      coverageDays: coverage,
      stock: stat.stock,
      unitsSold: stat.unitsSold,
    };

    // --- 1. À commander ------------------------------------------------------
    const rupture = stat.stock <= 0 && velocity > 0;
    const sousSeuil = stat.stock <= stat.reorderLevel;
    const couvertureCourte = coverage !== null && coverage < lead + params.safetyDays;

    if (rupture || ((sousSeuil || couvertureCourte) && velocity > 0)) {
      const qty = suggestedOrderQty(stat, params, velocity);
      if (qty > 0) {
        // Rupture = 100. Sinon on pénalise proportionnellement à la couverture.
        const priority = rupture
          ? 100
          : clampPriority(90 - ((coverage ?? 0) / Math.max(1, lead + params.safetyDays)) * 40);
        out.push({
          type: 'buy_more',
          productId: stat.productId,
          name: stat.name,
          supplierName: stat.supplierName ?? null,
          priority,
          reason: rupture
            ? `Rupture — ${round2(velocity * 30)} unités vendues par mois`
            : `Couverture ${coverage === null ? '—' : Math.floor(coverage)} j < délai ${lead + params.safetyDays} j`,
          payload: { ...base, suggestedQty: qty },
        });
      }
    }

    // --- 2. Capital dormant --------------------------------------------------
    const daysSinceSale =
      stat.lastSaleAt == null
        ? null
        : Math.max(0, -(daysUntil(stat.lastSaleAt, params.today) ?? 0));
    const dormant =
      stat.stock > 0 &&
      stat.unitsSold === 0 &&
      (daysSinceSale === null || daysSinceSale >= params.deadStockDays);

    if (dormant) {
      const capital = round2(stat.stock * stat.purchasePrice);
      out.push({
        type: 'dead_stock',
        productId: stat.productId,
        name: stat.name,
        supplierName: stat.supplierName ?? null,
        // Plus le capital immobilisé est élevé, plus c'est prioritaire.
        priority: clampPriority(Math.log10(Math.max(1, capital)) * 20),
        reason:
          daysSinceSale === null
            ? `Jamais vendu — ${stat.stock} en stock`
            : `Aucune vente depuis ${daysSinceSale} j — ${stat.stock} en stock`,
        payload: { ...base, capitalTied: capital },
      });
    } else if (stat.stock > 0 && velocity > 0 && coverage !== null && coverage > 180) {
      out.push({
        type: 'buy_less',
        productId: stat.productId,
        name: stat.name,
        supplierName: stat.supplierName ?? null,
        priority: clampPriority(Math.min(60, coverage / 10)),
        reason: `Sur-stock : ${Math.floor(coverage)} j de couverture`,
        payload: { ...base, capitalTied: round2(stat.stock * stat.purchasePrice) },
      });
    }

    // --- 3. Risque de péremption --------------------------------------------
    const dte = daysUntil(stat.nearestExpiry ?? null, params.today);
    if (dte !== null && dte <= params.expiryHorizonDays) {
      const qtyOnLot = stat.nearestExpiryQty ?? stat.stock;
      const sellableBeforeExpiry = velocity * Math.max(0, dte);
      const atRisk = Math.max(0, Math.ceil(qtyOnLot - sellableBeforeExpiry));
      if (atRisk > 0) {
        const loss = round2(atRisk * stat.purchasePrice);
        out.push({
          type: 'expiry_risk',
          productId: stat.productId,
          name: stat.name,
          supplierName: stat.supplierName ?? null,
          priority: clampPriority(
            100 - (Math.max(0, dte) / Math.max(1, params.expiryHorizonDays)) * 50,
          ),
          reason:
            dte < 0
              ? `Périmé depuis ${-dte} j — ${atRisk} unités`
              : `Périme dans ${dte} j — ${atRisk} unités invendables au rythme actuel (${loss} de perte)`,
          payload: { ...base, daysToExpiry: dte, qtyAtRisk: atRisk, capitalTied: loss },
        });
      }
    }

    // --- 4. Problème de prix -------------------------------------------------
    const rate = marginRate(stat.purchasePrice, stat.sellingPrice);
    if (stat.purchasePrice > 0 && (rate === null || rate < params.minMarginRate)) {
      // Cible : marge de 25 %, arrondie aux 5 FDJ supérieurs.
      const suggested = Math.ceil((stat.purchasePrice / 0.75) / 5) * 5;
      out.push({
        type: 'price_suggestion',
        productId: stat.productId,
        name: stat.name,
        supplierName: stat.supplierName ?? null,
        priority: clampPriority(rate === null || rate < 0 ? 95 : 70 - rate),
        reason:
          rate === null
            ? 'Prix de vente non défini'
            : rate < 0
              ? `Marge négative (${rate} %) — vendu à perte`
              : `Marge faible (${rate} %)`,
        payload: { ...base, currentMarginRate: rate, suggestedPrice: suggested },
      });
    }
  }

  return out.sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

/** Regroupe les suggestions d'achat par fournisseur (bon de commande). */
export function groupBySupplier(suggestions: Suggestion[]): Map<string, Suggestion[]> {
  const groups = new Map<string, Suggestion[]>();
  for (const s of suggestions) {
    const key = s.supplierName?.trim() || 'Sans fournisseur';
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }
  return groups;
}

/** Valeur totale d'un bon de commande suggéré (au prix d'achat connu). */
export function orderValue(suggestions: Suggestion[], priceOf: (productId: string) => number): number {
  return round2(
    suggestions
      .filter((s) => s.type === 'buy_more')
      .reduce((sum, s) => sum + (s.payload.suggestedQty ?? 0) * priceOf(s.productId), 0),
  );
}
