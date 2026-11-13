import { describe, expect, it } from 'vitest';
import { formatLogEntry } from '@pharmaiq/core';

const NOW = new Date('2026-11-13T08:00:00.000Z');

describe('journalisation structurée', () => {
  it('produit une ligne JSON avec gravité, message et horodatage', () => {
    const entry = JSON.parse(formatLogEntry('info', 'vente créée', { pharmacyId: 'p1' }, NOW));
    expect(entry).toEqual({
      pharmacyId: 'p1',
      severity: 'INFO',
      message: 'vente créée',
      time: '2026-11-13T08:00:00.000Z',
    });
  });

  it('traduit les niveaux vers les gravités Cloud Logging', () => {
    expect(JSON.parse(formatLogEntry('warn', 'm', {}, NOW)).severity).toBe('WARNING');
    expect(JSON.parse(formatLogEntry('error', 'm', {}, NOW)).severity).toBe('ERROR');
    expect(JSON.parse(formatLogEntry('debug', 'm', {}, NOW)).severity).toBe('DEBUG');
  });

  it('sérialise une erreur avec son nom, son message et sa pile', () => {
    const entry = JSON.parse(formatLogEntry('error', 'échec', { error: new TypeError('boum') }, NOW));
    expect(entry.error.name).toBe('TypeError');
    expect(entry.error.message).toBe('boum');
    expect(entry.error.stack).toContain('TypeError: boum');
  });

  it('ne laisse pas un champ métier écraser la gravité ou le message', () => {
    const entry = JSON.parse(
      formatLogEntry('error', 'vrai message', { severity: 'INFO', message: 'faux' }, NOW),
    );
    expect(entry.severity).toBe('ERROR');
    expect(entry.message).toBe('vrai message');
  });

  it('survit à une référence circulaire et à un BigInt', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    const circular = JSON.parse(formatLogEntry('info', 'boucle', { loop }, NOW));
    expect(circular.message).toBe('boucle');

    const big = JSON.parse(formatLogEntry('info', 'grand', { n: 10n }, NOW));
    expect(big.n).toBe('10');
  });
});
