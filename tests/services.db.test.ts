import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, prismaAdmin } from '@pharmaiq/db';
import { getProductStats } from '../apps/web/lib/analytics';
import type { SessionUser } from '../apps/web/lib/session';
import { confirmPurchase } from '../apps/web/lib/services/purchases';
import { cancelSale, createSale } from '../apps/web/lib/services/sales';

/**
 * Chemins critiques de la caisse et des achats, sur une base réelle (mêmes
 * prérequis que tests/tenant-isolation.test.ts : schéma + `pnpm db:rls`).
 *
 * Ces règles touchent à la sécurité du patient (lot périmé) et à l'argent
 * (double vente, double entrée en stock) : elles se vérifient contre
 * PostgreSQL, pas contre un double.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const SUFFIX = randomUUID().slice(0, 8);
const SLUG = `test-svc-${SUFFIX}`;
const OTHER_SLUG = `test-svc-autre-${SUFFIX}`;

const DAY = 86_400_000;
const yesterday = new Date(Date.now() - 2 * DAY);
const nextYear = new Date(Date.now() + 365 * DAY);
/** `@db.Date` : on compare des jours, pas des instants. */
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

describe.skipIf(!hasDatabase)('services caisse et achats (PostgreSQL)', () => {
  let user: SessionUser;
  let pharmacyId: string;
  let branchId: string;
  let productId: string;
  let foreignCustomerId: string;

  const lotQuantity = async (batchNo: string) => {
    const lots = await prismaAdmin.stock.findMany({
      where: { pharmacyId, productId, batchNo },
      select: { quantity: true },
    });
    return lots.reduce((sum, lot) => sum + lot.quantity, 0);
  };

  const cart = (quantity: number, unitPrice = 200) => ({
    items: [{ productId, quantity, unitPrice, discount: 0 }],
    paymentMethod: 'Cash' as const,
    discount: 0,
    paid: 0,
  });

  beforeAll(async () => {
    const pharmacy = await prismaAdmin.pharmacy.create({
      data: { name: SLUG, slug: SLUG },
      select: { id: true },
    });
    pharmacyId = pharmacy.id;
    const branch = await prismaAdmin.branch.create({
      data: { pharmacyId, name: 'Principale', isMain: true },
      select: { id: true },
    });
    branchId = branch.id;
    const product = await prismaAdmin.product.create({
      data: { pharmacyId, name: `PARACETAMOL ${SUFFIX}`, purchasePrice: 100, sellingPrice: 200 },
      select: { id: true },
    });
    productId = product.id;

    await prismaAdmin.stock.createMany({
      data: [
        // Périmé : premier dans l'ordre FEFO, mais invendable.
        { pharmacyId, productId, branchId, quantity: 10, batchNo: 'PERIME', expiryDate: yesterday, purchasePrice: 100 },
        { pharmacyId, productId, branchId, quantity: 5, batchNo: 'BON', expiryDate: nextYear, purchasePrice: 100 },
      ],
    });

    const other = await prismaAdmin.pharmacy.create({
      data: { name: OTHER_SLUG, slug: OTHER_SLUG },
      select: { id: true },
    });
    const foreign = await prismaAdmin.customer.create({
      data: { pharmacyId: other.id, name: 'Client d’une autre pharmacie' },
      select: { id: true },
    });
    foreignCustomerId = foreign.id;

    user = {
      pharmacyId,
      userId: null,
      role: 'owner',
      branchId,
      email: null,
      fullName: 'Test',
      pharmacyName: SLUG,
      pharmacySlug: SLUG,
      currency: 'DJF',
      locale: 'fr',
      invoicePrefix: 'T',
      taxRate: 0,
    };
  });

  afterAll(async () => {
    await prismaAdmin.pharmacy
      .deleteMany({ where: { slug: { in: [SLUG, OTHER_SLUG] } } })
      .catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    await prismaAdmin.$disconnect().catch(() => undefined);
  });

  it('ne sert jamais un lot périmé, même premier dans l’ordre FEFO', async () => {
    await createSale(user, cart(2));

    expect(await lotQuantity('PERIME')).toBe(10);
    expect(await lotQuantity('BON')).toBe(3);
  });

  it('refuse la vente quand seul du stock périmé couvrirait la demande', async () => {
    await expect(createSale(user, cart(4))).rejects.toThrow(/périmée/);
    // Rien n'est écrit : la transaction est annulée en bloc.
    expect(await lotQuantity('BON')).toBe(3);
  });

  it('ne vend pas deux fois avec la même clé d’idempotence', async () => {
    const clientRef = `ref-${randomUUID()}`;
    const first = await createSale(user, { ...cart(1), clientRef });
    const replay = await createSale(user, { ...cart(1), clientRef });

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.id).toBe(first.id);
    expect(await lotQuantity('BON')).toBe(2);
  });

  it('trace un prix encaissé différent du catalogue, et seulement celui-là', async () => {
    const normal = await createSale(user, cart(1, 200));
    const bargain = await createSale(user, cart(1, 50));

    const audits = await prismaAdmin.auditLog.findMany({
      where: { pharmacyId, action: 'sale.price_override' },
      select: { entityId: true },
    });
    expect(audits.map((a) => a.entityId)).toEqual([bargain.id]);
    expect(audits.map((a) => a.entityId)).not.toContain(normal.id);
    expect(await lotQuantity('BON')).toBe(0);
  });

  it('refuse de rattacher la vente au client d’une autre pharmacie', async () => {
    await expect(
      createSale(user, { ...cart(1), customerId: foreignCustomerId }),
    ).rejects.toThrow(/Client inconnu/);
  });

  it('annule une vente en rendant le stock à son lot d’origine, une seule fois', async () => {
    await prismaAdmin.stock.create({
      data: { pharmacyId, productId, branchId, quantity: 4, batchNo: 'RETOUR-TEST', expiryDate: nextYear, purchasePrice: 100 },
    });
    const sale = await createSale(user, cart(3));
    expect(await lotQuantity('RETOUR-TEST')).toBe(1);

    await cancelSale(user, sale.id, 'erreur de saisie');

    const lots = await prismaAdmin.stock.findMany({
      where: { pharmacyId, productId, batchNo: 'RETOUR-TEST' },
      select: { quantity: true, expiryDate: true },
    });
    // Même lot, même péremption : pas de lot « retour » sans date.
    expect(lots).toHaveLength(1);
    expect(lots[0]?.quantity).toBe(4);
    expect(day(lots[0]?.expiryDate ?? null)).toBe(day(nextYear));

    await expect(cancelSale(user, sale.id, 'deuxième essai')).rejects.toThrow(/déjà annulée/);
    expect(await lotQuantity('RETOUR-TEST')).toBe(4);
  });

  it('exclut les ventes annulées des statistiques de vente', async () => {
    const before = await getProductStats(user, { periodDays: 30 });
    const sale = await createSale(user, cart(2));
    const during = await getProductStats(user, { periodDays: 30 });
    await cancelSale(user, sale.id, 'annulation pour test');
    const after = await getProductStats(user, { periodDays: 30 });

    const units = (stats: typeof before) => stats.find((s) => s.productId === productId)?.unitsSold ?? 0;
    expect(units(during)).toBe(units(before) + 2);
    expect(units(after)).toBe(units(before));
  });

  it('n’entre pas deux fois le stock d’un achat rejoué', async () => {
    const clientRef = `achat-${randomUUID()}`;
    const purchase = {
      aiExtracted: false,
      clientRef,
      items: [
        { productId, quantity: 20, purchasePrice: 110, batchNo: 'ACHAT', expiryDate: nextYear },
        { newProductName: `NOUVEAU ${SUFFIX}`, quantity: 5, purchasePrice: 300 },
        // Même nom une seconde fois : un seul produit doit être créé.
        { newProductName: `NOUVEAU ${SUFFIX}`, quantity: 5, purchasePrice: 300 },
      ],
    };

    const first = await confirmPurchase(user, purchase);
    const replay = await confirmPurchase(user, purchase);

    expect(first.replayed).toBe(false);
    expect(first.createdProducts).toBe(1);
    expect(first.total).toBe(20 * 110 + 10 * 300);
    expect(replay.replayed).toBe(true);
    expect(replay.purchaseId).toBe(first.purchaseId);
    expect(await lotQuantity('ACHAT')).toBe(20);
  });
});
