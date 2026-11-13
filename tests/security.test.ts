import { describe, expect, it } from 'vitest';
import {
  aiDailyLimit,
  aiQuotaKey,
  clientIpFromForwardedFor,
  createRateLimiter,
  isSameOrigin,
  safeRedirectPath,
} from '@pharmaiq/core';

describe('redirection après connexion', () => {
  it('garde un chemin interne', () => {
    expect(safeRedirectPath('/sales?from=2026-01-01')).toBe('/sales?from=2026-01-01');
  });

  it('refuse toute forme d’URL externe', () => {
    for (const hostile of ['https://pirate.example', '//pirate.example', '/\\pirate.example', 'javascript:alert(1)', '/\tpirate']) {
      expect(safeRedirectPath(hostile)).toBe('/dashboard');
    }
    expect(safeRedirectPath(null)).toBe('/dashboard');
    expect(safeRedirectPath('')).toBe('/dashboard');
  });
});

describe('contrôle d’origine (CSRF)', () => {
  it('accepte l’application elle-même et l’absence d’en-tête', () => {
    expect(isSameOrigin('https://app.pharmaiq.dj', ['app.pharmaiq.dj'])).toBe(true);
    expect(isSameOrigin(null, ['app.pharmaiq.dj'])).toBe(true);
  });

  it('refuse un site tiers, un sous-domaine imitateur et une origine illisible', () => {
    expect(isSameOrigin('https://pirate.example', ['app.pharmaiq.dj'])).toBe(false);
    expect(isSameOrigin('https://app.pharmaiq.dj.pirate.example', ['app.pharmaiq.dj'])).toBe(false);
    expect(isSameOrigin('null', ['app.pharmaiq.dj'])).toBe(false);
    expect(isSameOrigin('https://app.pharmaiq.dj', [null, undefined])).toBe(false);
  });
});

describe('IP cliente derrière un proxy', () => {
  it('prend l’adresse ajoutée par le proxy de confiance, pas celle fournie par le client', () => {
    expect(clientIpFromForwardedFor('1.1.1.1, 203.0.113.7', 1)).toBe('203.0.113.7');
  });

  it('remonte d’un cran par proxy de confiance supplémentaire', () => {
    expect(clientIpFromForwardedFor('1.1.1.1, 203.0.113.7, 10.0.0.1', 2)).toBe('203.0.113.7');
  });

  it('reste dans les bornes et gère l’absence d’en-tête', () => {
    expect(clientIpFromForwardedFor('203.0.113.7', 3)).toBe('203.0.113.7');
    expect(clientIpFromForwardedFor(null)).toBeNull();
    expect(clientIpFromForwardedFor(' , ')).toBeNull();
  });
});

describe('limitation de débit', () => {
  it('bloque au-delà de la limite puis rouvre après la fenêtre', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000 });
    expect(limiter.check('ip', 0).allowed).toBe(true);
    expect(limiter.check('ip', 100).allowed).toBe(true);

    const blocked = limiter.check('ip', 200);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1);

    expect(limiter.check('ip', 1001).allowed).toBe(true);
  });

  it('compte chaque clé séparément', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('b', 0).allowed).toBe(true);
    expect(limiter.check('a', 1).allowed).toBe(false);
  });

  it('purge les clés inactives pour borner la mémoire', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 3 });
    limiter.check('a', 0);
    limiter.check('b', 0);
    limiter.check('c', 0);
    limiter.check('d', 5000);
    expect(limiter.size()).toBe(1);
  });
});

describe('plafond journalier IA', () => {
  it('donne une clé par type d’usage et par jour', () => {
    expect(aiQuotaKey('assistant', new Date('2026-11-13T23:59:00Z'))).toBe('ai:assistant:2026-11-13');
  });

  it('lit le plafond dans l’environnement, sinon prend le défaut', () => {
    expect(aiDailyLimit('assistant', '50')).toBe(50);
    expect(aiDailyLimit('assistant', '0')).toBe(0);
    expect(aiDailyLimit('assistant', undefined)).toBe(200);
    expect(aiDailyLimit('assistant', '')).toBe(200);
    expect(aiDailyLimit('receipt', 'beaucoup')).toBe(100);
    expect(aiDailyLimit('advice', '-3')).toBe(30);
  });
});
