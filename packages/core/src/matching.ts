/**
 * Rapprochement flou des lignes de reçus avec le catalogue (§6.2).
 *
 * Stratégie en deux temps :
 *   1. PostgreSQL `pg_trgm` fait le gros tri côté base (index GIN) ;
 *   2. ce module re-classe les candidats et décide du seuil d'acceptation.
 *
 * Aucune écriture automatique : un score élevé ne fait que pré-remplir l'écran
 * de validation humaine.
 */

/** Majuscules, sans accents, sans ponctuation, espaces normalisés. */
export function normalizeName(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * Formes courantes des conditionnements sur les reçus djiboutiens :
 * `B/12`, `BT10`, `CPR`, `500MG`… Utile pour comparer le « cœur » du nom.
 */
export function stripPackaging(input: string): string {
  return normalizeName(input)
    .replace(/\b(B|BT|BTE|BOITE|FL|FLACON|SACH|SACHET|TUBE|AMP|CP|CPR|COMP|GELL?|GEL)\s?\d*\b/g, ' ')
    .replace(/\b\d+\s?(MG|G|ML|UI|MCG|%)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(value: string): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < value.length - 1; i++) {
    const g = value.slice(i, i + 2);
    map.set(g, (map.get(g) ?? 0) + 1);
  }
  return map;
}

/** Coefficient de Dice sur bigrammes — 0 (rien) à 1 (identique). */
export function similarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return na === nb ? 1 : 0;

  const ga = bigrams(na);
  const gb = bigrams(nb);
  let shared = 0;
  let totalA = 0;
  let totalB = 0;
  for (const [, n] of ga) totalA += n;
  for (const [, n] of gb) totalB += n;
  for (const [g, n] of ga) {
    const m = gb.get(g);
    if (m) shared += Math.min(n, m);
  }
  return (2 * shared) / (totalA + totalB);
}

export interface MatchCandidate {
  productId: string;
  name: string;
  dci?: string | null;
  barcode?: string | null;
}

export interface MatchResult {
  candidate: MatchCandidate | null;
  score: number;
  /** `auto` = pré-coché, `review` = à confirmer, `new` = création proposée. */
  decision: 'auto' | 'review' | 'new';
  alternatives: Array<{ candidate: MatchCandidate; score: number }>;
}

export const MATCH_THRESHOLDS = {
  /** Au-dessus : la ligne est pré-cochée comme reconnue. */
  auto: 0.82,
  /** Au-dessus : proposée mais à confirmer par l'employé. */
  review: 0.55,
} as const;

/**
 * Meilleur candidat pour un nom lu sur un reçu.
 * Le score combine le nom complet, le nom « sans conditionnement » et la DCI.
 */
export function matchProduct(
  rawName: string,
  candidates: MatchCandidate[],
  options: { barcode?: string | null } = {},
): MatchResult {
  if (options.barcode) {
    const byBarcode = candidates.find((c) => c.barcode && c.barcode === options.barcode);
    if (byBarcode) {
      return { candidate: byBarcode, score: 1, decision: 'auto', alternatives: [] };
    }
  }

  const core = stripPackaging(rawName);
  const scored = candidates
    .map((candidate) => {
      const full = similarity(rawName, candidate.name);
      const stripped = core ? similarity(core, stripPackaging(candidate.name)) : 0;
      const dci = candidate.dci ? similarity(core || rawName, candidate.dci) : 0;
      // Le nom complet prime ; la DCI ne sert qu'à départager.
      const score = Math.max(full, stripped * 0.95, dci * 0.85);
      return { candidate, score: Math.round(score * 1000) / 1000 };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < MATCH_THRESHOLDS.review) {
    return { candidate: null, score: best?.score ?? 0, decision: 'new', alternatives: scored.slice(0, 3) };
  }

  return {
    candidate: best.candidate,
    score: best.score,
    decision: best.score >= MATCH_THRESHOLDS.auto ? 'auto' : 'review',
    alternatives: scored.slice(1, 4),
  };
}
