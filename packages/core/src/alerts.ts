/**
 * Alertes stock / péremption (§6.1).
 *
 * Un SEUL message récapitulatif par pharmacie et par exécution — jamais un
 * message par produit (anti-spam, et coût WhatsApp maîtrisé).
 */

export interface AlertConfig {
  /** Coupe-circuit global des alertes de la pharmacie. */
  enabled: boolean;
  whatsapp: boolean;
  inApp: boolean;
  /** Heure locale d'envoi du récapitulatif (0-23). */
  sendHour: number;
  lowStock: boolean;
  outOfStock: boolean;
  expiry: boolean;
  /** Paliers d'alerte péremption, en jours. */
  expiryDays: number[];
  /** Nombre de lignes détaillées dans le message (le reste est résumé). */
  maxLines: number;
}

export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  enabled: true,
  whatsapp: true,
  inApp: true,
  sendHour: 8,
  lowStock: true,
  outOfStock: true,
  expiry: true,
  expiryDays: [30, 15, 7],
  maxLines: 8,
};

/** Lit un `alertConfig` JSON venant de la base sans jamais faire confiance à sa forme. */
export function parseAlertConfig(raw: unknown): AlertConfig {
  const cfg = { ...DEFAULT_ALERT_CONFIG };
  if (!raw || typeof raw !== 'object') return cfg;
  const o = raw as Record<string, unknown>;

  if (typeof o.enabled === 'boolean') cfg.enabled = o.enabled;
  if (typeof o.whatsapp === 'boolean') cfg.whatsapp = o.whatsapp;
  if (typeof o.inApp === 'boolean') cfg.inApp = o.inApp;
  if (typeof o.sendHour === 'number' && o.sendHour >= 0 && o.sendHour <= 23) {
    cfg.sendHour = Math.floor(o.sendHour);
  }
  if (typeof o.lowStock === 'boolean') cfg.lowStock = o.lowStock;
  if (typeof o.outOfStock === 'boolean') cfg.outOfStock = o.outOfStock;
  if (typeof o.expiry === 'boolean') cfg.expiry = o.expiry;
  if (Array.isArray(o.expiryDays)) {
    const days = o.expiryDays
      .filter((d): d is number => typeof d === 'number' && d > 0 && d <= 365)
      .map((d) => Math.floor(d))
      .sort((a, b) => b - a);
    if (days.length > 0) cfg.expiryDays = days;
  }
  if (typeof o.maxLines === 'number' && o.maxLines >= 1 && o.maxLines <= 30) {
    cfg.maxLines = Math.floor(o.maxLines);
  }
  return cfg;
}

export interface StockAlertLine {
  productId: string;
  name: string;
  quantity: number;
  reorderLevel: number;
}

export interface ExpiryAlertLine {
  productId: string;
  name: string;
  quantity: number;
  daysToExpiry: number;
}

export interface DigestInput {
  pharmacyName: string;
  outOfStock: StockAlertLine[];
  lowStock: StockAlertLine[];
  expiring: ExpiryAlertLine[];
  link?: string;
  maxLines?: number;
}

export interface Digest {
  /** Message prêt à envoyer (WhatsApp texte libre / notification in-app). */
  text: string;
  /** Paramètres pour un template WhatsApp approuvé par Meta. */
  templateParams: string[];
  counts: { outOfStock: number; lowStock: number; expiring: number; total: number };
  /** true => rien à signaler, ne pas envoyer de message. */
  empty: boolean;
}

/**
 * Construit le récapitulatif. Priorité d'affichage : ruptures, puis péremptions
 * les plus proches, puis stocks bas — c'est l'ordre d'urgence pour le pharmacien.
 */
export function buildDigest(input: DigestInput): Digest {
  const maxLines = input.maxLines ?? DEFAULT_ALERT_CONFIG.maxLines;
  const counts = {
    outOfStock: input.outOfStock.length,
    lowStock: input.lowStock.length,
    expiring: input.expiring.length,
    total: input.outOfStock.length + input.lowStock.length + input.expiring.length,
  };

  if (counts.total === 0) {
    return { text: '', templateParams: [], counts, empty: true };
  }

  const lines: string[] = [];

  for (const item of input.outOfStock) {
    lines.push(`• ${item.name} — RUPTURE ❌`);
  }
  for (const item of [...input.expiring].sort((a, b) => a.daysToExpiry - b.daysToExpiry)) {
    lines.push(
      item.daysToExpiry < 0
        ? `• ${item.name} — périmé (${item.quantity}) ⛔`
        : `• ${item.name} — périme dans ${item.daysToExpiry} j (${item.quantity}) ⏳`,
    );
  }
  for (const item of [...input.lowStock].sort((a, b) => a.quantity - b.quantity)) {
    lines.push(`• ${item.name} — reste ${item.quantity} (seuil ${item.reorderLevel})`);
  }

  const shown = lines.slice(0, maxLines);
  const hidden = lines.length - shown.length;
  if (hidden > 0) shown.push(`… et ${hidden} autre${hidden > 1 ? 's' : ''}`);

  const headline = [
    counts.outOfStock > 0 ? `${counts.outOfStock} en rupture` : null,
    counts.lowStock > 0 ? `${counts.lowStock} en stock bas` : null,
    counts.expiring > 0 ? `${counts.expiring} périment bientôt` : null,
  ]
    .filter(Boolean)
    .join(', ');

  const text = [
    `🔔 PharmaIQ — ${input.pharmacyName}`,
    headline,
    '',
    ...shown,
    input.link ? `\n👉 Liste de réapprovisionnement : ${input.link}` : '',
  ]
    .filter((l) => l !== '')
    .join('\n');

  return {
    text,
    // Ordre attendu par le template Meta : {{1}} pharmacie, {{2}} résumé, {{3}} détail, {{4}} lien
    templateParams: [input.pharmacyName, headline, shown.join(' | '), input.link ?? ''],
    counts,
    empty: false,
  };
}

/** Palier d'alerte atteint (30 / 15 / 7 j…) ou `null` si hors fenêtre. */
export function expiryTier(daysToExpiry: number, thresholds: number[]): number | null {
  const sorted = [...thresholds].sort((a, b) => a - b);
  for (const t of sorted) {
    if (daysToExpiry <= t) return t;
  }
  return null;
}
