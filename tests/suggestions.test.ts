import { describe, expect, it } from 'vitest';
import { buildSuggestions, coverageDays, groupBySupplier, type ProductStat } from '@pharmaiq/core';

const TODAY = new Date('2026-09-14T00:00:00Z');

function stat(overrides: Partial<ProductStat> & { productId: string; name: string }): ProductStat {
  return {
    unitsSold: 0,
    stock: 0,
    purchasePrice: 100,
    sellingPrice: 200,
    reorderLevel: 10,
    nearestExpiry: null,
    lastSaleAt: null,
    ...overrides,
  };
}

describe('conseils d’achat', () => {
  it('calcule les jours de couverture', () => {
    expect(coverageDays(90, 3)).toBe(30);
    expect(coverageDays(90, 0)).toBeNull();
  });

  it('recommande d’acheter un produit à rotation rapide bientôt épuisé', () => {
    const result = buildSuggestions(
      [stat({ productId: 'p1', name: 'AMOXICILLINE', unitsSold: 180, stock: 20, leadTimeDays: 7 })],
      { periodDays: 90, horizonDays: 30, today: TODAY },
    );

    const buy = result.find((s) => s.type === 'buy_more');
    expect(buy).toBeDefined();
    // 2 unités/jour, horizon 30 j + délai 7 j + sécurité 7 j = 88 - 20 en stock.
    expect(buy?.payload.suggestedQty).toBe(68);
  });

  it('met une rupture en priorité maximale', () => {
    const result = buildSuggestions(
      [stat({ productId: 'p1', name: 'DOLIPRANE', unitsSold: 90, stock: 0 })],
      { periodDays: 90, today: TODAY },
    );

    const buy = result.find((s) => s.type === 'buy_more');
    expect(buy?.priority).toBe(100);
    expect(buy?.reason).toContain('Rupture');
  });

  it('ne recommande pas d’acheter un produit qui ne se vend pas', () => {
    const result = buildSuggestions(
      [stat({ productId: 'p1', name: 'CREME', unitsSold: 0, stock: 2 })],
      { periodDays: 90, today: TODAY },
    );

    expect(result.some((s) => s.type === 'buy_more')).toBe(false);
  });

  it('signale le capital dormant', () => {
    const result = buildSuggestions(
      [stat({ productId: 'p1', name: 'LAIT BEBE', unitsSold: 0, stock: 40, purchasePrice: 1200 })],
      { periodDays: 90, today: TODAY },
    );

    const dead = result.find((s) => s.type === 'dead_stock');
    expect(dead?.payload.capitalTied).toBe(48_000);
  });

  it('alerte sur un lot qui périme plus vite qu’il ne se vend', () => {
    const result = buildSuggestions(
      [
        stat({
          productId: 'p1',
          name: 'SIROP',
          unitsSold: 9, // 0,1 / jour
          stock: 30,
          nearestExpiry: new Date('2026-10-14T00:00:00Z'), // 30 jours
          nearestExpiryQty: 30,
        }),
      ],
      { periodDays: 90, today: TODAY },
    );

    const risk = result.find((s) => s.type === 'expiry_risk');
    expect(risk).toBeDefined();
    // 30 j × 0,1 = 3 unités écoulables → 27 à risque.
    expect(risk?.payload.qtyAtRisk).toBe(27);
  });

  it('signale une marge négative', () => {
    const result = buildSuggestions(
      [stat({ productId: 'p1', name: 'PERTE', purchasePrice: 900, sellingPrice: 700, stock: 5 })],
      { periodDays: 90, today: TODAY },
    );

    const price = result.find((s) => s.type === 'price_suggestion');
    expect(price?.reason).toContain('Marge négative');
    expect(price?.payload.suggestedPrice).toBe(1200);
  });

  it('trie par priorité décroissante', () => {
    const result = buildSuggestions(
      [
        stat({ productId: 'p1', name: 'Calme', unitsSold: 10, stock: 400 }),
        stat({ productId: 'p2', name: 'Rupture', unitsSold: 200, stock: 0 }),
      ],
      { periodDays: 90, today: TODAY },
    );

    expect(result[0]?.priority).toBeGreaterThanOrEqual(result[result.length - 1]?.priority ?? 0);
  });

  it('regroupe les commandes par fournisseur', () => {
    const suggestions = buildSuggestions(
      [
        stat({ productId: 'p1', name: 'A', unitsSold: 90, stock: 0, supplierName: 'PHARMA 5' }),
        stat({ productId: 'p2', name: 'B', unitsSold: 90, stock: 0, supplierName: 'PHARMA 5' }),
        stat({ productId: 'p3', name: 'C', unitsSold: 90, stock: 0 }),
      ],
      { periodDays: 90, today: TODAY },
    );

    const groups = groupBySupplier(suggestions.filter((s) => s.type === 'buy_more'));
    expect(groups.get('PHARMA 5')).toHaveLength(2);
    expect(groups.get('Sans fournisseur')).toHaveLength(1);
  });
});
