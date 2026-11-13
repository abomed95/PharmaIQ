/**
 * Garde-fous HTTP sans dépendance : redirection, origine, IP cliente, débit.
 * Purs et testés — les routes ne font que les appeler.
 */

/**
 * Chemin de redirection interne sûr.
 *
 * `?next=https://site-pirate` ou `//site-pirate` enverrait l'utilisateur, juste
 * après sa connexion, sur un site qui imite PharmaIQ. On n'accepte qu'un chemin
 * local commençant par un seul `/`.
 */
export function safeRedirectPath(value: string | null | undefined, fallback = '/dashboard'): string {
  if (!value) return fallback;
  if (!value.startsWith('/')) return fallback;
  // `//hôte` et `/\hôte` sont lus par les navigateurs comme des URL absolues.
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  // Caractères de contrôle : certains navigateurs les ignorent en tête d'URL.
  if (/[\u0000-\u001f]/.test(value)) return fallback;
  return value;
}

/**
 * Vrai si l'en-tête `Origin` d'une requête d'écriture désigne l'application.
 *
 * Défense contre le CSRF : un site tiers peut faire émettre une requête avec
 * les cookies de l'utilisateur, mais il ne peut pas falsifier `Origin`. Sans
 * en-tête (appel serveur à serveur, cron), il n'y a pas de navigateur à piéger.
 */
export function isSameOrigin(origin: string | null | undefined, allowedHosts: Array<string | null | undefined>): boolean {
  if (!origin) return true;
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  return allowedHosts.some((allowed) => typeof allowed === 'string' && allowed.toLowerCase() === host);
}

/**
 * IP cliente derrière un ou plusieurs proxys de confiance.
 *
 * `X-Forwarded-For` se lit de DROITE à gauche : chaque proxy ajoute à la fin
 * l'adresse qu'il a vue. Les entrées de gauche sont fournies par le client et
 * donc falsifiables — s'y fier permettrait de contourner toute limite par IP.
 * `trustedHops` = nombre de proxys de confiance (1 sur Cloud Run en direct).
 */
export function clientIpFromForwardedFor(header: string | null | undefined, trustedHops = 1): string | null {
  if (!header) return null;
  const parts = header
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const index = parts.length - Math.max(1, trustedHops);
  return parts[Math.max(0, index)] ?? null;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Secondes à attendre avant le prochain essai (0 si autorisé). */
  retryAfterSeconds: number;
}

/**
 * Limiteur à fenêtre glissante, en mémoire.
 *
 * Par instance : sur plusieurs instances, la limite réelle est multipliée
 * d'autant. C'est un frein contre l'abus, pas un quota — les quotas (coût IA)
 * sont comptés en base.
 */
export function createRateLimiter(options: { limit: number; windowMs: number; maxKeys?: number }) {
  const hits = new Map<string, number[]>();
  const maxKeys = options.maxKeys ?? 10_000;

  function purge(now: number): void {
    for (const [key, stamps] of hits) {
      const last = stamps[stamps.length - 1];
      if (last === undefined || now - last > options.windowMs) hits.delete(key);
    }
  }

  return {
    check(key: string, now: number = Date.now()): RateLimitDecision {
      // Borne la mémoire : sans purge, chaque nouvelle IP resterait à vie.
      if (hits.size >= maxKeys) purge(now);

      const stamps = (hits.get(key) ?? []).filter((stamp) => now - stamp < options.windowMs);
      if (stamps.length >= options.limit) {
        const oldest = stamps[0] ?? now;
        hits.set(key, stamps);
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((options.windowMs - (now - oldest)) / 1000)),
        };
      }
      stamps.push(now);
      hits.set(key, stamps);
      return { allowed: true, retryAfterSeconds: 0 };
    },
    size: () => hits.size,
  };
}

export type AiUsageKind = 'assistant' | 'receipt' | 'advice';

/** Clé du compteur journalier d'appels IA d'une pharmacie (jour UTC). */
export function aiQuotaKey(kind: AiUsageKind, date: Date = new Date()): string {
  return `ai:${kind}:${date.toISOString().slice(0, 10)}`;
}

/** Plafonds journaliers par pharmacie : bornent la facture même si un compte est compromis. */
export const DEFAULT_AI_DAILY_LIMITS: Record<AiUsageKind, number> = {
  assistant: 200,
  receipt: 100,
  advice: 30,
};

/** Plafond effectif : valeur d'environnement si c'est un entier positif, sinon le défaut. */
export function aiDailyLimit(kind: AiUsageKind, envValue?: string | null): number {
  // Une variable vide ne doit pas valoir « 0 appel autorisé ».
  if (envValue == null || envValue.trim() === '') return DEFAULT_AI_DAILY_LIMITS[kind];
  const parsed = Number(envValue);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_AI_DAILY_LIMITS[kind];
}
