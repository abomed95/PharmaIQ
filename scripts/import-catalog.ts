/**
 * Import d'un catalogue (§8) — `pnpm import:catalog`.
 *
 *   pnpm import:catalog --pharmacy-id <uuid> --file data/seed/Shifa_Medicaments_Nettoye.csv
 *
 * Options :
 *   --pharmacy-id <uuid>   pharmacie cible (obligatoire)
 *   --file <chemin>        .csv (UTF-8, séparateur , ou ;) ou .xlsx (nécessite `xlsx`)
 *   --reorder-level <n>    seuil d'alerte par défaut (10)
 *   --dry-run              n'écrit rien, affiche seulement le rapport
 *   --skip-stock           n'importe que le catalogue, sans stock initial
 *
 * L'import est IDEMPOTENT : réexécutable sans créer de doublons (upsert sur
 * pharmacyId + nom ; le lot « IMPORT » est remis à la quantité du fichier).
 * Il passe par `withTenant()`, donc sous RLS — comme l'application.
 */

import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { withTenant, type TenantContext, type TenantTx } from '@pharmaiq/db';
import { detectPriceAnomalies, type PriceRow } from '@pharmaiq/core';
import { buildImportRows, buildMapping, parseCsv, type ImportRow } from './lib/catalog-parsing';

interface Options {
  pharmacyId: string;
  file: string;
  reorderLevel: number;
  dryRun: boolean;
  skipStock: boolean;
}

function parseArgs(argv: string[]): Options {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const pharmacyId = get('--pharmacy-id') ?? get('--pharmacy_id');
  const file = get('--file');

  if (!pharmacyId || !file) {
    console.error(
      'Usage : pnpm import:catalog --pharmacy-id <uuid> --file <catalogue.csv> [--reorder-level 10] [--dry-run] [--skip-stock]',
    );
    process.exit(1);
  }

  return {
    pharmacyId,
    file,
    reorderLevel: Number(get('--reorder-level') ?? '10') || 10,
    dryRun: argv.includes('--dry-run'),
    skipStock: argv.includes('--skip-stock'),
  };
}

async function readRows(path: string): Promise<Array<Record<string, string>>> {
  const absolute = resolve(process.cwd(), path);

  if (extname(absolute).toLowerCase() === '.xlsx') {
    try {
      // Dépendance optionnelle : seuls les imports Excel en ont besoin.
      const xlsx = (await import('xlsx')) as typeof import('xlsx');
      const workbook = xlsx.readFile(absolute);
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error('classeur vide');
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) throw new Error('feuille introuvable');
      return xlsx.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '', raw: false });
    } catch (error) {
      throw new Error(
        `Lecture .xlsx impossible (${error instanceof Error ? error.message : error}). Installe la dépendance : pnpm add -D -w xlsx — ou convertis le fichier en CSV.`,
      );
    }
  }

  return parseCsv(await readFile(absolute, 'utf8'));
}

async function importRows(
  tx: TenantTx,
  ctx: TenantContext,
  rows: ImportRow[],
  options: Options,
): Promise<{ products: number; categories: number; lots: number }> {
  const branch = await tx.branch.findFirst({
    where: { pharmacyId: ctx.pharmacyId },
    orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  if (!branch) {
    throw new Error(
      "Aucune succursale visible : vérifie l'identifiant de pharmacie et les droits de la connexion.",
    );
  }

  const categoryIds = new Map<string, string>();
  let categoriesCreated = 0;

  for (const name of new Set(rows.map((row) => row.category))) {
    const existing = await tx.category.findFirst({
      where: { pharmacyId: ctx.pharmacyId, name },
      select: { id: true },
    });
    if (existing) {
      categoryIds.set(name, existing.id);
      continue;
    }
    const created = await tx.category.create({
      data: { pharmacyId: ctx.pharmacyId, name },
      select: { id: true },
    });
    categoryIds.set(name, created.id);
    categoriesCreated += 1;
  }

  let products = 0;
  let lots = 0;

  for (const row of rows) {
    const product = await tx.product.upsert({
      where: { pharmacyId_name: { pharmacyId: ctx.pharmacyId, name: row.name } },
      create: {
        pharmacyId: ctx.pharmacyId,
        name: row.name,
        categoryId: categoryIds.get(row.category) ?? null,
        purchasePrice: row.purchasePrice,
        sellingPrice: row.sellingPrice,
        reorderLevel: options.reorderLevel,
        barcode: row.barcode,
        externalRef: row.externalRef,
      },
      update: {
        categoryId: categoryIds.get(row.category) ?? null,
        purchasePrice: row.purchasePrice,
        sellingPrice: row.sellingPrice,
        ...(row.barcode ? { barcode: row.barcode } : {}),
        ...(row.externalRef ? { externalRef: row.externalRef } : {}),
      },
      select: { id: true },
    });
    products += 1;

    if (options.skipStock || row.quantity <= 0) continue;

    // Lot « IMPORT » : rejouer l'import ne double pas le stock.
    const existingLot = await tx.stock.findFirst({
      where: {
        pharmacyId: ctx.pharmacyId,
        productId: product.id,
        branchId: branch.id,
        batchNo: 'IMPORT',
      },
      select: { id: true, quantity: true },
    });

    if (existingLot) {
      if (existingLot.quantity !== row.quantity) {
        await tx.stock.update({
          where: { id: existingLot.id },
          data: {
            quantity: row.quantity,
            expiryDate: row.expiryDate,
            purchasePrice: row.purchasePrice,
          },
        });
        await tx.stockMovement.create({
          data: {
            pharmacyId: ctx.pharmacyId,
            productId: product.id,
            branchId: branch.id,
            type: 'adjustment',
            source: 'import',
            quantityDelta: row.quantity - existingLot.quantity,
            batchNo: 'IMPORT',
            expiryDate: row.expiryDate,
            reason: 'Réimport du catalogue',
          },
        });
      }
    } else {
      await tx.stock.create({
        data: {
          pharmacyId: ctx.pharmacyId,
          productId: product.id,
          branchId: branch.id,
          quantity: row.quantity,
          batchNo: 'IMPORT',
          expiryDate: row.expiryDate,
          purchasePrice: row.purchasePrice,
        },
      });
      await tx.stockMovement.create({
        data: {
          pharmacyId: ctx.pharmacyId,
          productId: product.id,
          branchId: branch.id,
          type: 'purchase',
          source: 'import',
          quantityDelta: row.quantity,
          batchNo: 'IMPORT',
          expiryDate: row.expiryDate,
          reason: 'Import initial du catalogue',
        },
      });
      lots += 1;
    }
  }

  return { products, categories: categoriesCreated, lots };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const raw = await readRows(options.file);

  if (raw.length === 0) {
    console.error('Fichier vide ou illisible.');
    process.exit(1);
  }

  const headers = Object.keys(raw[0] ?? {});
  const mapping = buildMapping(headers);
  if (!mapping.name) {
    console.error(`Colonne « nom du produit » introuvable. Colonnes détectées : ${headers.join(', ')}`);
    process.exit(1);
  }

  const { rows, skipped } = buildImportRows(raw, mapping);

  // Contrôle qualité avant écriture (prix aberrants, marges négatives).
  const priceRows: PriceRow[] = rows.map((row, index) => ({
    productId: String(index),
    name: row.name,
    categoryName: row.category,
    purchasePrice: row.purchasePrice,
    sellingPrice: row.sellingPrice,
  }));
  const anomalies = detectPriceAnomalies(priceRows);

  console.log(`\nFichier      : ${options.file}`);
  console.log(`Colonnes     : ${JSON.stringify(mapping)}`);
  console.log(`Lignes lues  : ${raw.length}`);
  console.log(`À importer   : ${rows.length}`);
  console.log(`Ignorées     : ${skipped.length}`);
  console.log(`Anomalies    : ${anomalies.length}`);

  for (const anomaly of anomalies.slice(0, 10)) {
    console.log(`  ⚠️  ${anomaly.name} — ${anomaly.detail}`);
  }
  if (anomalies.length > 10) console.log(`  … et ${anomalies.length - 10} autres`);

  if (options.dryRun) {
    console.log('\n--dry-run : aucune écriture.\n');
    return;
  }

  const ctx: TenantContext = {
    pharmacyId: options.pharmacyId,
    userId: null,
    role: 'owner',
    branchId: null,
  };

  const result = await withTenant(ctx, (tx) => importRows(tx, ctx, rows, options), {
    timeout: 10 * 60_000,
    maxWait: 30_000,
  });

  console.log(
    `\n✅ Import terminé : ${result.products} produits, ${result.categories} catégorie(s) créée(s), ${result.lots} lot(s) de stock.\n`,
  );
}

main().catch((error) => {
  console.error('\n❌ Import interrompu :', error instanceof Error ? error.message : error);
  process.exit(1);
});
