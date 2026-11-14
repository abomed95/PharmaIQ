import type { NextRequest } from 'next/server';
import { clientIpFromForwardedFor, createRateLimiter } from '@pharmaiq/core';
import { TooManyRequestsError } from './http';

/**
 * Frein par adresse IP sur les routes SANS session (inscription, acceptation
 * d'invitation) : elles créent des comptes et des pharmacies, et rien d'autre
 * ne borne leur usage.
 *
 * Compteurs en mémoire, donc par instance — voir `createRateLimiter`. Devant un
 * abus massif, la vraie barrière est en amont (Cloud Armor, voir DEPLOY.md).
 */

/** Nombre de proxys de confiance devant l'application (1 sur Cloud Run en direct). */
const TRUSTED_HOPS = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS ?? '1') || 1);

const limiters = new Map<string, ReturnType<typeof createRateLimiter>>();

export function assertRateLimit(
  request: NextRequest,
  name: string,
  options: { limit: number; windowMs: number },
): void {
  if (process.env.RATE_LIMIT_DISABLED === 'true') return;

  let limiter = limiters.get(name);
  if (!limiter) {
    limiter = createRateLimiter(options);
    limiters.set(name, limiter);
  }

  const ip = clientIpFromForwardedFor(request.headers.get('x-forwarded-for'), TRUSTED_HOPS) ?? 'inconnue';
  const decision = limiter.check(ip);
  if (!decision.allowed) {
    throw new TooManyRequestsError(
      'Trop de tentatives. Réessaie dans quelques minutes.',
      decision.retryAfterSeconds,
    );
  }
}
