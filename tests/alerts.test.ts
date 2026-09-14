import { describe, expect, it } from 'vitest';
import { DEFAULT_ALERT_CONFIG, buildDigest, expiryTier, parseAlertConfig } from '@pharmaiq/core';
import { maskPhone, normalizePhone } from '@pharmaiq/whatsapp';

describe('récapitulatif d’alertes', () => {
  const base = {
    pharmacyName: 'Shifa Pharmacie',
    outOfStock: [{ productId: '1', name: 'DOLIPRANE 1G', quantity: 0, reorderLevel: 10 }],
    lowStock: [{ productId: '2', name: 'AMOXICILLINE 500', quantity: 3, reorderLevel: 10 }],
    expiring: [{ productId: '3', name: 'SIROP TOUX', quantity: 5, daysToExpiry: 7 }],
  };

  it('regroupe tout dans UN seul message', () => {
    const digest = buildDigest({ ...base, link: 'https://app.test/suggestions' });

    expect(digest.empty).toBe(false);
    expect(digest.counts).toEqual({ outOfStock: 1, lowStock: 1, expiring: 1, total: 3 });
    expect(digest.text).toContain('Shifa Pharmacie');
    expect(digest.text).toContain('1 en rupture');
    expect(digest.text).toContain('https://app.test/suggestions');
    // Une seule occurrence de chaque produit : pas un message par produit.
    expect(digest.text.match(/DOLIPRANE 1G/g)).toHaveLength(1);
  });

  it('place les ruptures avant les péremptions et les stocks bas', () => {
    const digest = buildDigest(base);
    const lines = digest.text.split('\n').filter((line) => line.startsWith('•'));

    expect(lines[0]).toContain('DOLIPRANE');
    expect(lines[1]).toContain('SIROP');
    expect(lines[2]).toContain('AMOXICILLINE');
  });

  it('n’envoie rien quand il n’y a rien à signaler', () => {
    const digest = buildDigest({
      pharmacyName: 'Shifa',
      outOfStock: [],
      lowStock: [],
      expiring: [],
    });

    expect(digest.empty).toBe(true);
    expect(digest.text).toBe('');
  });

  it('tronque les longues listes en annonçant le reste', () => {
    const digest = buildDigest({
      pharmacyName: 'Shifa',
      outOfStock: [],
      lowStock: Array.from({ length: 12 }, (_, i) => ({
        productId: String(i),
        name: `PRODUIT ${i}`,
        quantity: i,
        reorderLevel: 10,
      })),
      expiring: [],
      maxLines: 3,
    });

    expect(digest.text).toContain('… et 9 autres');
  });

  it('fournit des paramètres de template sans saut de ligne', () => {
    const digest = buildDigest(base);
    expect(digest.templateParams).toHaveLength(4);
    expect(digest.templateParams.some((param) => param.includes('\n'))).toBe(false);
  });
});

describe('configuration des alertes', () => {
  it('retombe sur les valeurs par défaut si la configuration est absente', () => {
    expect(parseAlertConfig(null)).toEqual(DEFAULT_ALERT_CONFIG);
    expect(parseAlertConfig('cassé')).toEqual(DEFAULT_ALERT_CONFIG);
  });

  it('ignore les valeurs hors bornes', () => {
    expect(parseAlertConfig({ sendHour: 25 }).sendHour).toBe(DEFAULT_ALERT_CONFIG.sendHour);
    expect(parseAlertConfig({ maxLines: 0 }).maxLines).toBe(DEFAULT_ALERT_CONFIG.maxLines);
  });

  it('nettoie et trie les paliers de péremption', () => {
    expect(parseAlertConfig({ expiryDays: [7, 'x', 30, 999] }).expiryDays).toEqual([30, 7]);
  });

  it('détermine le palier atteint', () => {
    expect(expiryTier(5, [30, 15, 7])).toBe(7);
    expect(expiryTier(20, [30, 15, 7])).toBe(30);
    expect(expiryTier(45, [30, 15, 7])).toBeNull();
    expect(expiryTier(-2, [30, 15, 7])).toBe(7);
  });
});

describe('numéros WhatsApp (Djibouti)', () => {
  it('complète l’indicatif pour un numéro local', () => {
    expect(normalizePhone('77 12 34 56')).toBe('25377123456');
    expect(normalizePhone('0077123456')).toBe('25377123456');
    expect(normalizePhone('+253 77 12 34 56')).toBe('25377123456');
  });

  it('rejette ce qui n’est pas un numéro', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('abc')).toBeNull();
  });

  it('masque le numéro dans les journaux', () => {
    expect(maskPhone('25377123456')).toBe('253771***56');
  });
});
