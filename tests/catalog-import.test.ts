import { describe, expect, it } from 'vitest';
import {
  buildImportRows,
  buildMapping,
  normalizeCategory,
  parseCsv,
  toDate,
  toNumber,
} from '../scripts/lib/catalog-parsing';

/** Entêtes réelles du fichier Shifa fourni comme jeu d'amorçage. */
const SHIFA_HEADER =
  'ID,Nom,Categorie,PrixAchat_FDJ,PrixVente_FDJ,Quantite,DateExpiration,PrixAchat_original_avant_correction,ProductID';

describe('lecture du fichier de catalogue', () => {
  it('lit un CSV avec BOM et entêtes réelles', () => {
    const rows = parseCsv(
      `﻿${SHIFA_HEADER}\n1235,WELL BABY DROPS VIT 4-24M YEARS,Non catégorisé,1100,1400,19,,,1E64611A\n`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.Nom).toBe('WELL BABY DROPS VIT 4-24M YEARS');
    expect(rows[0]?.PrixVente_FDJ).toBe('1400');
  });

  it('gère les guillemets, les virgules internes et le point-virgule', () => {
    const rows = parseCsv('Nom;Quantite\n"SIROP TOUX, MIEL";12\n');
    expect(rows[0]?.Nom).toBe('SIROP TOUX, MIEL');
    expect(rows[0]?.Quantite).toBe('12');
  });

  it('ignore les lignes vides', () => {
    const rows = parseCsv('Nom,Quantite\nA,1\n\n\nB,2\n');
    expect(rows).toHaveLength(2);
  });

  it('reconnaît les colonnes du fichier Shifa', () => {
    const mapping = buildMapping(SHIFA_HEADER.split(','));

    expect(mapping.name).toBe('Nom');
    expect(mapping.category).toBe('Categorie');
    expect(mapping.purchasePrice).toBe('PrixAchat_FDJ');
    expect(mapping.sellingPrice).toBe('PrixVente_FDJ');
    expect(mapping.quantity).toBe('Quantite');
    expect(mapping.expiryDate).toBe('DateExpiration');
    expect(mapping.externalRef).toBe('ProductID');
  });

  it('reconnaît aussi des entêtes anglaises', () => {
    const mapping = buildMapping(['Name', 'Category', 'PurchasePrice', 'SellingPrice', 'Quantity']);
    expect(mapping.name).toBe('Name');
    expect(mapping.purchasePrice).toBe('PurchasePrice');
  });
});

describe('normalisation des valeurs', () => {
  it('lit les nombres quel que soit le format local', () => {
    expect(toNumber('1200')).toBe(1200);
    expect(toNumber('1 200')).toBe(1200);
    expect(toNumber('1.200')).toBe(1200);
    expect(toNumber('1200,50')).toBe(1200.5);
    expect(toNumber('')).toBe(0);
    expect(toNumber('n/a')).toBe(0);
  });

  it('lit les dates de péremption dans plusieurs formats', () => {
    expect(toDate('2028-04-01')?.toISOString().slice(0, 10)).toBe('2028-04-01');
    expect(toDate('01/04/2028')?.toISOString().slice(0, 10)).toBe('2028-04-01');
    expect(toDate('04/2028')?.toISOString().slice(0, 10)).toBe('2028-04-01');
    expect(toDate('')).toBeNull();
    expect(toDate('illisible')).toBeNull();
  });

  it('normalise les catégories', () => {
    expect(normalizeCategory('medicaments')).toBe('Médicaments');
    expect(normalizeCategory('SIROP')).toBe('Sirop');
    expect(normalizeCategory('')).toBe('Non catégorisé');
    expect(normalizeCategory('Matériel dentaire')).toBe('Matériel dentaire');
  });
});

describe('préparation des lignes importables', () => {
  const mapping = buildMapping(SHIFA_HEADER.split(','));

  it('convertit une ligne complète', () => {
    const { rows } = buildImportRows(
      parseCsv(
        `${SHIFA_HEADER}\n458,DUPHASTON CPR 10MG BT10,Medicaments,950,1300,16,2028-04-01,,994EC9D6\n`,
      ),
      mapping,
    );

    expect(rows[0]).toMatchObject({
      name: 'DUPHASTON CPR 10MG BT10',
      category: 'Médicaments',
      purchasePrice: 950,
      sellingPrice: 1300,
      quantity: 16,
      externalRef: '994EC9D6',
    });
    expect(rows[0]?.expiryDate?.toISOString().slice(0, 10)).toBe('2028-04-01');
  });

  it('écarte les doublons de nom et les lignes sans nom', () => {
    const { rows, skipped } = buildImportRows(
      parseCsv(
        `${SHIFA_HEADER}\n1,ASPIRINE,Medicaments,100,200,5,,,A\n2,aspirine,Medicaments,110,210,3,,,B\n3,,Medicaments,100,200,1,,,C\n`,
      ),
      mapping,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.purchasePrice).toBe(100);
    expect(skipped).toHaveLength(2);
  });

  it('ne produit jamais de quantité négative', () => {
    const { rows } = buildImportRows(
      parseCsv(`${SHIFA_HEADER}\n1,PRODUIT,Medicaments,100,200,-9,,,A\n`),
      mapping,
    );
    expect(rows[0]?.quantity).toBe(0);
  });
});
