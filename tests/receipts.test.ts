import { describe, expect, it } from 'vitest';
import {
  MATCH_THRESHOLDS,
  detectPriceAnomalies,
  isPlausibleReceiptLine,
  matchProduct,
  normalizeName,
  outlierIndexes,
  similarity,
  stripPackaging,
} from '@pharmaiq/core';
import { ReceiptItemSchema, ReceiptSchema } from '@pharmaiq/ai';

const CATALOG = [
  { productId: '1', name: 'AMOXICILLINE 500MG B/12', dci: 'amoxicilline' },
  { productId: '2', name: 'PARACETAMOL 500MG B/20', dci: 'paracétamol' },
  { productId: '3', name: 'DOLIPRANE 1G B/8', dci: 'paracétamol' },
];

describe('rapprochement des lignes de reçu', () => {
  it('normalise accents, casse et ponctuation', () => {
    expect(normalizeName('Doliprane® 1g, b/8')).toBe('DOLIPRANE 1G B 8');
  });

  it('retire le conditionnement pour comparer le cœur du nom', () => {
    expect(stripPackaging('AMOXICILLINE 500MG B/12')).toBe('AMOXICILLINE');
  });

  it('reconnaît une ligne identique', () => {
    const result = matchProduct('AMOXICILLINE 500MG B/12', CATALOG);

    expect(result.candidate?.productId).toBe('1');
    expect(result.score).toBeGreaterThanOrEqual(MATCH_THRESHOLDS.auto);
    expect(result.decision).toBe('auto');
  });

  it('reconnaît une orthographe approximative', () => {
    const result = matchProduct('AMOXICILINE 500 MG BT12', CATALOG);
    expect(result.candidate?.productId).toBe('1');
  });

  it('propose la création quand rien ne correspond', () => {
    const result = matchProduct('SERINGUE 5ML STERILE', CATALOG);

    expect(result.candidate).toBeNull();
    expect(result.decision).toBe('new');
  });

  it('privilégie le code-barres quand il est connu', () => {
    const result = matchProduct('produit illisible', [
      ...CATALOG,
      { productId: '9', name: 'AUTRE', barcode: '3401579' },
    ], { barcode: '3401579' });

    expect(result.candidate?.productId).toBe('9');
    expect(result.score).toBe(1);
  });

  it('donne une similarité entre 0 et 1', () => {
    expect(similarity('DOLIPRANE', 'DOLIPRANE')).toBe(1);
    expect(similarity('DOLIPRANE', 'SERINGUE')).toBeLessThan(0.3);
  });
});

describe('validation des sorties du modèle', () => {
  it('accepte un reçu conforme au schéma', () => {
    const parsed = ReceiptSchema.safeParse({
      supplier: 'PHARMA 5 MAROC',
      invoice_ref: 'F-2026-118',
      date: '2026-03-12',
      currency: 'DJF',
      items: [
        { name: 'AMOXICILLINE 500MG B/12', quantity: 20, purchase_price: 800, expiry_date: '2028-04-01' },
      ],
      confidence: 0.86,
    });

    expect(parsed.success).toBe(true);
  });

  it('rejette une quantité négative ou une date mal formée', () => {
    expect(
      ReceiptSchema.safeParse({
        supplier: null,
        invoice_ref: null,
        date: '12/03/2026',
        currency: null,
        items: [],
        confidence: 0.5,
      }).success,
    ).toBe(false);

    expect(
      ReceiptSchema.safeParse({
        supplier: null,
        invoice_ref: null,
        date: null,
        currency: null,
        items: [{ name: 'X', quantity: -3, purchase_price: null, expiry_date: null }],
        confidence: 0.5,
      }).success,
    ).toBe(false);
  });

  it('impose un prix unitaire numérique ou nul, jamais une chaîne', () => {
    expect(
      ReceiptItemSchema.safeParse({
        name: 'X',
        quantity: 2,
        purchase_price: '1 200',
        expiry_date: null,
      }).success,
    ).toBe(false);
  });

  it('signale les lignes invraisemblables', () => {
    expect(isPlausibleReceiptLine({ quantity: 0, purchasePrice: 100 }).ok).toBe(false);
    expect(isPlausibleReceiptLine({ quantity: 50_000, purchasePrice: 100 }).ok).toBe(false);

    const suspect = isPlausibleReceiptLine({
      quantity: 10,
      purchasePrice: 90_000,
      knownPurchasePrice: 900,
    });
    expect(suspect.ok).toBe(true);
    expect(suspect.warning).toBeTruthy();
  });
});

describe('anomalies de prix', () => {
  const rows = [
    { productId: '1', name: 'A', categoryName: 'Médicaments', purchasePrice: 100, sellingPrice: 200 },
    { productId: '2', name: 'B', categoryName: 'Médicaments', purchasePrice: 120, sellingPrice: 240 },
    { productId: '3', name: 'C', categoryName: 'Médicaments', purchasePrice: 90, sellingPrice: 180 },
    { productId: '4', name: 'D', categoryName: 'Médicaments', purchasePrice: 110, sellingPrice: 220 },
    { productId: '5', name: 'E', categoryName: 'Médicaments', purchasePrice: 95, sellingPrice: 190 },
  ];

  it('détecte un prix d’achat multiplié par mille', () => {
    const anomalies = detectPriceAnomalies([
      ...rows,
      {
        productId: '6',
        name: 'SAISIE FAUSSE',
        categoryName: 'Médicaments',
        purchasePrice: 100_000,
        sellingPrice: 200_000,
      },
    ]);

    expect(anomalies.some((a) => a.kind === 'outlier_purchase_price' && a.name === 'SAISIE FAUSSE')).toBe(
      true,
    );
  });

  it('détecte la vente à perte et le prix de vente manquant', () => {
    const anomalies = detectPriceAnomalies([
      ...rows,
      { productId: '7', name: 'PERTE', categoryName: 'Médicaments', purchasePrice: 300, sellingPrice: 200 },
      { productId: '8', name: 'SANS PRIX', categoryName: 'Médicaments', purchasePrice: 300, sellingPrice: 0 },
    ]);

    expect(anomalies.some((a) => a.kind === 'negative_margin' && a.name === 'PERTE')).toBe(true);
    expect(anomalies.some((a) => a.kind === 'zero_selling_price' && a.name === 'SANS PRIX')).toBe(true);
  });

  it('ne signale rien sur un catalogue sain', () => {
    expect(detectPriceAnomalies(rows)).toHaveLength(0);
  });

  it('repère une valeur hors norme dans une série', () => {
    expect(outlierIndexes([10, 11, 9, 10, 12, 500])).toContain(5);
    expect(outlierIndexes([10, 11, 9, 10, 12])).toHaveLength(0);
  });
});
