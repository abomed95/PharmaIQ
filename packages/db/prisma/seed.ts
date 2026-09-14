/**
 * Jeu de démonstration — `pnpm db:seed`.
 *
 * Crée DEUX pharmacies : c'est volontaire. Cela permet de vérifier à l'œil (et
 * dans les tests) qu'aucune ne voit les données de l'autre.
 *
 * Utilise `prismaAdmin` (contourne la RLS) : à l'amorçage, aucun tenant
 * n'existe encore. Les comptes créés ici n'ont PAS d'identité Supabase :
 * passe par /signup pour obtenir un compte connectable.
 */

import { prismaAdmin } from '../src/admin';

/**
 * Même format que `@pharmaiq/core` (`INV-202609-000042`), recopié ici pour que
 * le paquet `db` ne dépende pas de `core` juste pour son jeu de démonstration.
 */
function demoInvoiceNumber(prefix: string, sequence: number, date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${prefix}-${year}${month}-${String(sequence).padStart(6, '0')}`;
}

const DEMO_PRODUCTS = [
  { name: 'PARACETAMOL 500MG B/20', category: 'Médicaments', purchase: 180, selling: 300, qty: 120 },
  { name: 'AMOXICILLINE 500MG B/12', category: 'Médicaments', purchase: 800, selling: 1200, qty: 40 },
  { name: 'DOLIPRANE 1G B/8', category: 'Médicaments', purchase: 450, selling: 700, qty: 6 },
  { name: 'SIROP TOUX ENFANT 100ML', category: 'Sirop', purchase: 600, selling: 950, qty: 25 },
  { name: 'VITAMINE C 1000MG B/10', category: 'Vitamine', purchase: 350, selling: 600, qty: 80 },
  { name: 'COLLYRE ANTISEPTIQUE 10ML', category: 'Collyre', purchase: 900, selling: 1400, qty: 12 },
  { name: 'CREME HYDRATANTE 50ML', category: 'Crème', purchase: 1200, selling: 1800, qty: 4 },
  { name: 'ARTEMETHER 20MG B/24', category: 'Médicaments', purchase: 1500, selling: 2200, qty: 30 },
  { name: 'SERUM PHYSIOLOGIQUE 5ML B/20', category: 'Sachet', purchase: 250, selling: 400, qty: 200 },
  { name: 'POMMADE ANTIBIOTIQUE 15G', category: 'Pommade', purchase: 700, selling: 1000, qty: 0 },
];

const PAYMENTS = ['Cash', 'Waafi', 'CAC pay', 'D money'];

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

async function createPharmacy(options: {
  name: string;
  slug: string;
  city: string;
  phone: string;
  withSales: boolean;
}) {
  const pharmacy = await prismaAdmin.pharmacy.upsert({
    where: { slug: options.slug },
    create: {
      name: options.name,
      slug: options.slug,
      city: options.city,
      phoneWhatsapp: options.phone,
      alertConfig: { enabled: true, whatsapp: true, sendHour: 8, expiryDays: [30, 15, 7] },
    },
    update: {},
    select: { id: true },
  });

  const branch = await prismaAdmin.branch.upsert({
    where: { pharmacyId_name: { pharmacyId: pharmacy.id, name: 'Principale' } },
    create: { pharmacyId: pharmacy.id, name: 'Principale', isMain: true },
    update: {},
    select: { id: true },
  });

  const owner = await prismaAdmin.user.upsert({
    where: {
      pharmacyId_email: { pharmacyId: pharmacy.id, email: `owner@${options.slug}.test` },
    },
    create: {
      pharmacyId: pharmacy.id,
      branchId: branch.id,
      fullName: `Propriétaire ${options.name}`,
      email: `owner@${options.slug}.test`,
      role: 'owner',
    },
    update: {},
    select: { id: true },
  });

  const products = [];
  for (const item of DEMO_PRODUCTS) {
    const category = await prismaAdmin.category.upsert({
      where: { pharmacyId_name: { pharmacyId: pharmacy.id, name: item.category } },
      create: { pharmacyId: pharmacy.id, name: item.category },
      update: {},
      select: { id: true },
    });

    const product = await prismaAdmin.product.upsert({
      where: { pharmacyId_name: { pharmacyId: pharmacy.id, name: item.name } },
      create: {
        pharmacyId: pharmacy.id,
        name: item.name,
        categoryId: category.id,
        purchasePrice: item.purchase,
        sellingPrice: item.selling,
        reorderLevel: 10,
      },
      update: {},
      select: { id: true, sellingPrice: true, purchasePrice: true },
    });

    const existingLot = await prismaAdmin.stock.findFirst({
      where: { pharmacyId: pharmacy.id, productId: product.id, batchNo: 'DEMO' },
      select: { id: true },
    });
    if (!existingLot && item.qty > 0) {
      await prismaAdmin.stock.create({
        data: {
          pharmacyId: pharmacy.id,
          productId: product.id,
          branchId: branch.id,
          quantity: item.qty,
          batchNo: 'DEMO',
          // Quelques lots périment bientôt : de quoi déclencher les alertes.
          expiryDate: daysAgo(-(20 + Math.floor(Math.random() * 300))),
          purchasePrice: item.purchase,
        },
      });
    }

    products.push({ ...product, item });
  }

  if (!options.withSales) return pharmacy.id;

  // 60 jours de ventes : assez d'historique pour les conseils d'achat.
  const existingSales = await prismaAdmin.sale.count({ where: { pharmacyId: pharmacy.id } });
  if (existingSales > 0) return pharmacy.id;

  let sequence = 0;
  for (let day = 60; day >= 0; day--) {
    const salesToday = 1 + Math.floor(Math.random() * 4);
    for (let s = 0; s < salesToday; s++) {
      const date = daysAgo(day);
      sequence += 1;

      const lines = products
        .filter(() => Math.random() < 0.3)
        .slice(0, 3)
        .map((entry) => {
          const quantity = 1 + Math.floor(Math.random() * 3);
          const unitPrice = Number(entry.sellingPrice);
          return {
            productId: entry.id,
            quantity,
            unitPrice,
            unitCost: Number(entry.purchasePrice),
            lineTotal: quantity * unitPrice,
          };
        });

      if (lines.length === 0) continue;

      const grandTotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
      const costTotal = lines.reduce((sum, line) => sum + line.unitCost * line.quantity, 0);

      await prismaAdmin.sale.create({
        data: {
          pharmacyId: pharmacy.id,
          branchId: branch.id,
          invoiceId: demoInvoiceNumber('DEMO', sequence, date),
          date,
          subtotal: grandTotal,
          grandTotal,
          paid: grandTotal,
          costTotal,
          paymentMethod: PAYMENTS[Math.floor(Math.random() * PAYMENTS.length)] ?? 'Cash',
          soldById: owner.id,
          items: {
            create: lines.map((line) => ({
              pharmacyId: pharmacy.id,
              productId: line.productId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              unitCost: line.unitCost,
              lineTotal: line.lineTotal,
              soldAt: date,
            })),
          },
        },
      });
    }
  }

  return pharmacy.id;
}

async function main() {
  const shifa = await createPharmacy({
    name: 'Shifa Pharmacie (démo)',
    slug: 'shifa-demo',
    city: 'Djibouti',
    phone: '77123456',
    withSales: true,
  });

  const amal = await createPharmacy({
    name: 'Al Amal Pharmacie (démo)',
    slug: 'al-amal-demo',
    city: 'Ali Sabieh',
    phone: '77654321',
    withSales: false,
  });

  console.log('\n✅ Données de démonstration créées');
  console.log(`   Pharmacie A : ${shifa}`);
  console.log(`   Pharmacie B : ${amal}`);
  console.log('\n   Importer le catalogue réel :');
  console.log(
    `   pnpm import:catalog --pharmacy-id ${shifa} --file data/seed/Shifa_Medicaments_Nettoye.csv\n`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prismaAdmin.$disconnect());
