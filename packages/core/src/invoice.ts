/** Numérotation des factures : séquence par pharmacie et par mois. */

export function counterKey(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `invoice:${year}-${month}`;
}

/** Ex. `INV-202609-000042`. */
export function formatInvoiceNumber(prefix: string, sequence: number, date: Date = new Date()): string {
  const safePrefix = (prefix || 'INV').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'INV';
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${safePrefix}-${year}${month}-${String(sequence).padStart(6, '0')}`;
}

/** Période d'analyse au format `YYYY-MM` (clé de `Recommendation.period`). */
export function periodKey(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
