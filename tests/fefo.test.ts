import { describe, expect, it } from 'vitest';
import { allocateFefo, daysUntil, sortFefo, weightedUnitCost } from '@pharmaiq/core';

const lot = (id: string, quantity: number, expiry: string | null, price = 100) => ({
  id,
  quantity,
  expiryDate: expiry ? new Date(expiry) : null,
  purchasePrice: price,
});

describe('FEFO', () => {
  it('sert d’abord le lot qui périme le plus tôt', () => {
    const lots = [lot('a', 10, '2027-01-01'), lot('b', 10, '2026-06-01')];
    const result = allocateFefo(lots, 5);

    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]?.lotId).toBe('b');
    expect(result.shortage).toBe(0);
  });

  it('enchaîne sur le lot suivant quand le premier est épuisé', () => {
    const lots = [lot('a', 3, '2026-06-01'), lot('b', 10, '2027-01-01')];
    const result = allocateFefo(lots, 8);

    expect(result.allocations.map((a) => [a.lotId, a.quantity])).toEqual([
      ['a', 3],
      ['b', 5],
    ]);
    expect(result.allocated).toBe(8);
  });

  it('place les lots sans péremption en dernier', () => {
    const sorted = sortFefo([lot('sans', 5, null), lot('avec', 5, '2030-01-01')]);
    expect(sorted.map((l) => l.id)).toEqual(['avec', 'sans']);
  });

  it('signale le manque sans jamais servir plus que le stock', () => {
    const result = allocateFefo([lot('a', 2, '2026-06-01')], 7);

    expect(result.allocated).toBe(2);
    expect(result.shortage).toBe(5);
  });

  it('calcule un coût unitaire moyen pondéré entre lots de prix différents', () => {
    // 2 unités à 100 + 2 unités à 200 => 150 de moyenne.
    const result = allocateFefo([lot('a', 2, '2026-01-01', 100), lot('b', 5, '2026-02-01', 200)], 4);

    expect(result.cost).toBe(600);
    expect(weightedUnitCost(result)).toBe(150);
  });

  it('ne sert rien pour une demande nulle ou négative', () => {
    expect(allocateFefo([lot('a', 10, null)], 0).allocated).toBe(0);
    expect(allocateFefo([lot('a', 10, null)], -3).allocated).toBe(0);
  });

  it('compte les jours restants avant péremption', () => {
    const from = new Date('2026-09-14T10:00:00Z');
    expect(daysUntil(new Date('2026-09-21T00:00:00Z'), from)).toBe(7);
    expect(daysUntil(new Date('2026-09-01T00:00:00Z'), from)).toBe(-13);
    expect(daysUntil(null, from)).toBeNull();
  });
});
