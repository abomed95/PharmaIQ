/**
 * Lecture et normalisation d'un fichier de catalogue (CSV/XLSX).
 *
 * Fonctions pures, sans effet de bord — isolées ici pour être testées sans
 * lancer l'import (voir tests/catalog-import.test.ts).
 */

/** Analyseur CSV tolérant : BOM, guillemets doublés, séparateur `,` ou `;`. */
export function parseCsv(content: string): Array<Record<string, string>> {
  const text = content.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const newline = text.indexOf('\n');
  const firstLine = newline === -1 ? text : text.slice(0, newline);
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows;
  if (!header) return [];

  const keys = header.map((key) => key.trim());
  return body
    .filter((line) => line.some((cell) => cell.trim() !== ''))
    .map((line) => {
      const record: Record<string, string> = {};
      keys.forEach((key, index) => {
        record[key] = (line[index] ?? '').trim();
      });
      return record;
    });
}

/**
 * Entêtes acceptées pour chaque champ. Toute pharmacie qui arrive avec son
 * propre export Excel doit pouvoir être importée sans renommer ses colonnes.
 */
export const COLUMN_ALIASES: Record<string, string[]> = {
  name: ['nom', 'name', 'produit', 'designation', 'désignation', 'libelle', 'libellé'],
  category: ['categorie', 'catégorie', 'category', 'famille'],
  purchasePrice: ['prixachat_fdj', 'prixachat', 'prix_achat', 'purchaseprice', 'achat', 'pa'],
  sellingPrice: ['prixvente_fdj', 'prixvente', 'prix_vente', 'sellingprice', 'vente', 'pv'],
  quantity: ['quantite', 'quantité', 'qte', 'quantity', 'stock'],
  expiryDate: [
    'dateexpiration',
    'date_expiration',
    'peremption',
    'péremption',
    'expiry',
    'expirydate',
  ],
  barcode: ['codebarre', 'code_barre', 'barcode', 'ean'],
  externalRef: ['productid', 'product_id', 'reference', 'référence', 'ref', 'id'],
};

export function normalizeKey(key: string): string {
  return key
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
}

export type ColumnMapping = Record<string, string | null>;

export function buildMapping(headers: string[]): ColumnMapping {
  const normalized = new Map(headers.map((header) => [normalizeKey(header), header]));
  const mapping: ColumnMapping = {};

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    mapping[field] = null;
    for (const alias of aliases) {
      const match = normalized.get(normalizeKey(alias));
      if (match) {
        mapping[field] = match;
        break;
      }
    }
  }
  return mapping;
}

/** Gère « 1 200 », « 1.200,50 » et « 1200.5 ». */
export function toNumber(value: string | undefined): number {
  if (value === undefined || value === null) return 0;
  const cleaned = String(value)
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Accepte AAAA-MM-JJ, JJ/MM/AAAA, MM/AAAA. Renvoie `null` si illisible. */
export function toDate(value: string | undefined): Date | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const [, year = '1970', month = '1', day = '1'] = iso;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  }

  const slash = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slash) {
    const [, day = '1', month = '1', year = '1970'] = slash;
    const fullYear = year.length === 2 ? 2000 + Number(year) : Number(year);
    const date = new Date(Date.UTC(fullYear, Number(month) - 1, Number(day)));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const monthYear = trimmed.match(/^(\d{1,2})[/-](\d{4})$/);
  if (monthYear) {
    const [, month = '1', year = '1970'] = monthYear;
    return new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const CATEGORY_NORMALIZATION: Record<string, string> = {
  medicament: 'Médicaments',
  medicaments: 'Médicaments',
  sirop: 'Sirop',
  sirops: 'Sirop',
  vitamine: 'Vitamine',
  vitamines: 'Vitamine',
  collyre: 'Collyre',
  creme: 'Crème',
  cremes: 'Crème',
  pommade: 'Pommade',
  sachet: 'Sachet',
  suppositoire: 'Suppositoire',
  injectable: 'Injectable',
  spray: 'Spray',
  lait: 'Lait',
  paramedical: 'Para-médical',
  dermocosmetique: 'Dermo-cosmétique',
  noncategorise: 'Non catégorisé',
};

export function normalizeCategory(value: string | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw) return 'Non catégorisé';
  const key = normalizeKey(raw).replace(/_/g, '');
  return CATEGORY_NORMALIZATION[key] ?? raw;
}

export interface ImportRow {
  name: string;
  category: string;
  purchasePrice: number;
  sellingPrice: number;
  quantity: number;
  expiryDate: Date | null;
  barcode: string | null;
  externalRef: string | null;
}

/**
 * Transforme les lignes brutes en lignes importables.
 * Les produits sans nom et les doublons de nom sont écartés (la première
 * occurrence gagne) : un doublon casserait l'upsert sur `pharmacyId + name`.
 */
export function buildImportRows(
  raw: Array<Record<string, string>>,
  mapping: ColumnMapping,
): { rows: ImportRow[]; skipped: string[] } {
  const skipped: string[] = [];
  const seen = new Set<string>();
  const rows: ImportRow[] = [];

  const pick = (record: Record<string, string>, field: string): string | undefined => {
    const column = mapping[field];
    return column ? record[column] : undefined;
  };

  for (const record of raw) {
    const name = pick(record, 'name')?.trim() ?? '';
    if (!name) {
      skipped.push('(ligne sans nom)');
      continue;
    }
    const key = name.toUpperCase();
    if (seen.has(key)) {
      skipped.push(`${name} (doublon dans le fichier)`);
      continue;
    }
    seen.add(key);

    rows.push({
      name,
      category: normalizeCategory(pick(record, 'category')),
      purchasePrice: toNumber(pick(record, 'purchasePrice')),
      sellingPrice: toNumber(pick(record, 'sellingPrice')),
      quantity: Math.max(0, Math.round(toNumber(pick(record, 'quantity')))),
      expiryDate: toDate(pick(record, 'expiryDate')),
      barcode: pick(record, 'barcode')?.trim() || null,
      externalRef: pick(record, 'externalRef')?.trim() || null,
    });
  }

  return { rows, skipped };
}
