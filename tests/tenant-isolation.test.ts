import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Prisma,
  currentPharmacyId,
  prisma,
  prismaAdmin,
  withTenant,
  type TenantContext,
} from '@pharmaiq/db';

/**
 * LE test qui conditionne tout le reste (§12, étape 3 du plan de construction) :
 * deux pharmacies ne doivent JAMAIS se voir.
 *
 * Il exige une base réelle avec les migrations ET `prisma/rls.sql` appliqués :
 *
 *     export DATABASE_URL=postgresql://pharmaiq_app:...@localhost:5432/pharmaiq
 *     export ADMIN_DATABASE_URL=postgresql://postgres:...@localhost:5432/pharmaiq
 *     pnpm db:migrate && pnpm db:rls && pnpm test:rls
 *
 * Sans `DATABASE_URL`, la suite est ignorée (elle tourne en CI, voir
 * .github/workflows/ci.yml).
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);

const SUFFIX = randomUUID().slice(0, 8);
const SLUG_A = `test-a-${SUFFIX}`;
const SLUG_B = `test-b-${SUFFIX}`;

interface Fixture {
  pharmacyId: string;
  branchId: string;
  productId: string;
  productName: string;
  ctx: TenantContext;
}

async function createFixture(slug: string, productName: string): Promise<Fixture> {
  const pharmacy = await prismaAdmin.pharmacy.create({
    data: { name: slug, slug },
    select: { id: true },
  });
  const branch = await prismaAdmin.branch.create({
    data: { pharmacyId: pharmacy.id, name: 'Principale', isMain: true },
    select: { id: true },
  });
  const product = await prismaAdmin.product.create({
    data: {
      pharmacyId: pharmacy.id,
      name: productName,
      purchasePrice: 100,
      sellingPrice: 200,
    },
    select: { id: true },
  });
  await prismaAdmin.stock.create({
    data: {
      pharmacyId: pharmacy.id,
      productId: product.id,
      branchId: branch.id,
      quantity: 25,
      purchasePrice: 100,
    },
  });

  return {
    pharmacyId: pharmacy.id,
    branchId: branch.id,
    productId: product.id,
    productName,
    ctx: { pharmacyId: pharmacy.id, userId: null, role: 'owner', branchId: branch.id },
  };
}

describe.skipIf(!hasDatabase)('isolation multi-tenant (RLS PostgreSQL)', () => {
  let a: Fixture;
  let b: Fixture;
  /** Un rôle superutilisateur / BYPASSRLS échappe à la RLS par conception. */
  let connectionBypassesRls = false;

  beforeAll(async () => {
    a = await createFixture(SLUG_A, `PRODUIT A ${SUFFIX}`);
    b = await createFixture(SLUG_B, `PRODUIT B ${SUFFIX}`);

    const rows = await prisma.$queryRaw<Array<{ bypass: boolean }>>(Prisma.sql`
      select (rolsuper or rolbypassrls) as bypass
      from pg_roles where rolname = current_user
    `);
    connectionBypassesRls = rows[0]?.bypass ?? false;
    if (connectionBypassesRls) {
      console.warn(
        '[test] DATABASE_URL utilise un rôle BYPASSRLS : le contrôle base est ignoré. ' +
          'En production, DATABASE_URL DOIT pointer sur un rôle sans BYPASSRLS.',
      );
    }
  });

  afterAll(async () => {
    await prismaAdmin.pharmacy
      .deleteMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } })
      .catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    await prismaAdmin.$disconnect().catch(() => undefined);
  });

  it('pose bien le tenant dans la session base', async () => {
    const resolved = await withTenant(a.ctx, (tx) => currentPharmacyId(tx));
    expect(resolved).toBe(a.pharmacyId);
  });

  it('ne liste que les produits de sa propre pharmacie', async () => {
    const products = await withTenant(a.ctx, (tx) => tx.product.findMany({ select: { id: true } }));

    expect(products.map((p) => p.id)).toContain(a.productId);
    expect(products.map((p) => p.id)).not.toContain(b.productId);
  });

  it('ne lit pas un produit d’une autre pharmacie, même avec son identifiant', async () => {
    const stolen = await withTenant(a.ctx, (tx) =>
      tx.product.findUnique({ where: { id: b.productId } }),
    );
    expect(stolen).toBeNull();
  });

  it('ne modifie pas les données d’une autre pharmacie', async () => {
    const result = await withTenant(a.ctx, (tx) =>
      tx.product.updateMany({ where: { id: b.productId }, data: { sellingPrice: 1 } }),
    );
    expect(result.count).toBe(0);

    const untouched = await prismaAdmin.product.findUniqueOrThrow({
      where: { id: b.productId },
      select: { sellingPrice: true },
    });
    expect(Number(untouched.sellingPrice)).toBe(200);
  });

  it('ne supprime pas les données d’une autre pharmacie', async () => {
    const result = await withTenant(a.ctx, (tx) =>
      tx.stock.deleteMany({ where: { pharmacyId: b.pharmacyId } }),
    );
    expect(result.count).toBe(0);

    const stillThere = await prismaAdmin.stock.count({ where: { pharmacyId: b.pharmacyId } });
    expect(stillThere).toBe(1);
  });

  it('refuse d’écrire une ligne étiquetée d’un autre tenant', async () => {
    await expect(
      withTenant(a.ctx, (tx) =>
        tx.product.create({
          data: {
            // Tentative d'injection du pharmacyId d'autrui : la clause
            // WITH CHECK de la politique RLS doit la rejeter.
            pharmacyId: b.pharmacyId,
            name: `INJECTION ${SUFFIX}`,
            purchasePrice: 1,
            sellingPrice: 2,
          },
        }),
      ),
    ).rejects.toThrow();

    const leaked = await prismaAdmin.product.count({ where: { name: `INJECTION ${SUFFIX}` } });
    expect(leaked).toBe(0);
  });

  it('filtre même le SQL brut sans clause where', async () => {
    const rows = await withTenant(a.ctx, (tx) =>
      tx.$queryRaw<Array<{ id: string; pharmacyId: string }>>(
        Prisma.sql`select id, "pharmacyId" from "Product"`,
      ),
    );

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.pharmacyId).toBe(a.pharmacyId);
    }
  });

  it('ne voit rien hors d’une transaction tenant', async () => {
    if (connectionBypassesRls) return;

    const count = await prisma.product.count();
    expect(count).toBe(0);
  });

  it('ne laisse pas fuir le tenant d’une transaction à la suivante', async () => {
    await withTenant(a.ctx, (tx) => currentPharmacyId(tx));

    if (!connectionBypassesRls) {
      // SET LOCAL est limité à la transaction : hors transaction, plus de tenant.
      const rows = await prisma.$queryRaw<Array<{ id: string | null }>>(
        Prisma.sql`select app.current_pharmacy_id()::text as id`,
      );
      expect(rows[0]?.id).toBeNull();
    }

    const fromB = await withTenant(b.ctx, (tx) => currentPharmacyId(tx));
    expect(fromB).toBe(b.pharmacyId);
  });
});
