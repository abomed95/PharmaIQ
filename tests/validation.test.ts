import { describe, expect, it } from 'vitest';
import {
  httpUrl,
  purchaseConfirmSchema,
  receiptAnalyzeSchema,
  stockAdjustSchema,
} from '../apps/web/lib/validation';

const UUID = '3f2b1c9e-7c1a-4b5e-9f0a-1234567890ab';

describe('validation des entrées', () => {
  it('n’accepte que des URL http(s)', () => {
    expect(httpUrl.safeParse('https://exemple.dj/recu.jpg').success).toBe(true);
    expect(httpUrl.safeParse('javascript:alert(1)').success).toBe(false);
    expect(httpUrl.safeParse('data:text/html,<script>').success).toBe(false);
  });

  it('borne la taille de l’image de reçu', () => {
    const base = { mediaType: 'image/jpeg' as const };
    expect(receiptAnalyzeSchema.safeParse({ ...base, imageBase64: 'a'.repeat(1000) }).success).toBe(true);
    expect(receiptAnalyzeSchema.safeParse({ ...base, imageBase64: 'a'.repeat(7_200_001) }).success).toBe(false);
  });

  it('borne un ajustement de stock', () => {
    const base = { productId: UUID, reason: 'inventaire' };
    expect(stockAdjustSchema.safeParse({ ...base, quantityDelta: -5 }).success).toBe(true);
    expect(stockAdjustSchema.safeParse({ ...base, quantityDelta: 0 }).success).toBe(false);
    expect(stockAdjustSchema.safeParse({ ...base, quantityDelta: 2_000_000_000 }).success).toBe(false);
  });

  it('refuse le pharmacyId et une sortie brute de modèle démesurée', () => {
    const items = [{ productId: UUID, quantity: 1, purchasePrice: 10 }];
    expect(purchaseConfirmSchema.safeParse({ items }).success).toBe(true);
    // Le tenant ne vient jamais du client.
    expect(purchaseConfirmSchema.safeParse({ items, pharmacyId: UUID }).success).toBe(false);
    expect(
      purchaseConfirmSchema.safeParse({ items, aiRaw: { blob: 'x'.repeat(250_000) } }).success,
    ).toBe(false);
  });
});
