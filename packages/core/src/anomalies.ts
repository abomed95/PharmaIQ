/**
 * Détection d'anomalies (§7.4).
 *
 * Le jeu de données réel contient des prix d'achat aberrants (facteur ×1000) et
 * des marges négatives. Ces contrôles tournent à l'import, à la confirmation
 * d'un achat et dans le rapport « santé du catalogue ».
 */

export function median(values: number[]): number {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export type AnomalyKind =
  | 'negative_margin'
  | 'zero_selling_price'
  | 'outlier_purchase_price'
  | 'suspicious_quantity';

export type Severity = 'low' | 'medium' | 'high';

export interface PriceRow {
  productId: string;
  name: string;
  categoryName?: string | null;
  purchasePrice: number;
  sellingPrice: number;
}

export interface Anomaly {
  productId: string;
  name: string;
  kind: AnomalyKind;
  severity: Severity;
  detail: string;
  value: number;
  reference?: number;
}

export interface AnomalyOptions {
  /** Rapport prix d'achat / médiane de catégorie au-delà duquel on alerte. */
  outlierRatio: number;
  /** Nombre minimum de produits dans une catégorie pour que la médiane compte. */
  minCategorySize: number;
}

export const DEFAULT_ANOMALY_OPTIONS: AnomalyOptions = {
  outlierRatio: 20,
  minCategorySize: 5,
};

export function detectPriceAnomalies(
  rows: PriceRow[],
  overrides: Partial<AnomalyOptions> = {},
): Anomaly[] {
  const options = { ...DEFAULT_ANOMALY_OPTIONS, ...overrides };
  const out: Anomaly[] = [];

  // Médiane par catégorie, avec repli sur la médiane globale.
  const byCategory = new Map<string, number[]>();
  for (const row of rows) {
    if (row.purchasePrice <= 0) continue;
    const key = row.categoryName?.trim() || '__global__';
    const list = byCategory.get(key);
    if (list) list.push(row.purchasePrice);
    else byCategory.set(key, [row.purchasePrice]);
  }
  const globalMedian = median(rows.map((r) => r.purchasePrice).filter((p) => p > 0));
  const medians = new Map<string, number>();
  for (const [key, values] of byCategory) {
    medians.set(key, values.length >= options.minCategorySize ? median(values) : globalMedian);
  }

  for (const row of rows) {
    if (row.sellingPrice <= 0) {
      out.push({
        productId: row.productId,
        name: row.name,
        kind: 'zero_selling_price',
        severity: 'high',
        detail: 'Prix de vente non renseigné — le produit ne peut pas être encaissé correctement.',
        value: row.sellingPrice,
      });
    } else if (row.purchasePrice > row.sellingPrice) {
      out.push({
        productId: row.productId,
        name: row.name,
        kind: 'negative_margin',
        severity: 'high',
        detail: `Vendu à perte : achat ${row.purchasePrice} > vente ${row.sellingPrice}.`,
        value: row.sellingPrice - row.purchasePrice,
        reference: row.purchasePrice,
      });
    }

    const ref = medians.get(row.categoryName?.trim() || '__global__') ?? globalMedian;
    if (ref > 0 && row.purchasePrice > 0 && row.purchasePrice / ref >= options.outlierRatio) {
      out.push({
        productId: row.productId,
        name: row.name,
        kind: 'outlier_purchase_price',
        severity: 'medium',
        detail: `Prix d'achat ${Math.round(row.purchasePrice / ref)}× la médiane de la catégorie — erreur de saisie probable (virgule, ×1000).`,
        value: row.purchasePrice,
        reference: ref,
      });
    }
  }

  return out;
}

/**
 * Valeurs hors norme d'une série (ventes quotidiennes, écarts de caisse…),
 * par écart à la médiane normalisé (MAD) — plus robuste que l'écart-type.
 */
export function outlierIndexes(values: number[], zThreshold = 3.5): number[] {
  if (values.length < 4) return [];
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med)));
  if (mad === 0) return [];
  const out: number[] = [];
  values.forEach((v, i) => {
    const score = (0.6745 * (v - med)) / mad;
    if (Math.abs(score) >= zThreshold) out.push(i);
  });
  return out;
}

/** Une ligne de reçu extraite par l'IA est-elle plausible ? */
export function isPlausibleReceiptLine(line: {
  quantity: number;
  purchasePrice: number | null;
  knownPurchasePrice?: number | null;
}): { ok: boolean; warning?: string } {
  if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
    return { ok: false, warning: 'Quantité illisible ou nulle' };
  }
  if (line.quantity > 10_000) {
    return { ok: false, warning: 'Quantité anormalement élevée' };
  }
  if (line.purchasePrice != null && line.purchasePrice < 0) {
    return { ok: false, warning: "Prix d'achat négatif" };
  }
  if (
    line.purchasePrice != null &&
    line.knownPurchasePrice != null &&
    line.knownPurchasePrice > 0 &&
    (line.purchasePrice / line.knownPurchasePrice > 10 ||
      line.purchasePrice / line.knownPurchasePrice < 0.1)
  ) {
    return { ok: true, warning: "Prix d'achat très différent du prix habituel — à vérifier" };
  }
  return { ok: true };
}
