import { Prisma, withTenant, type TenantContext, type TenantTx } from '@pharmaiq/db';
import type { ProductStat, StockAlertLine, ExpiryAlertLine } from '@pharmaiq/core';

/**
 * Couche d'analyse : tout le SQL qui alimente le tableau de bord, les conseils
 * d'achat, les alertes et l'assistant.
 *
 * Chaque requête tourne dans `withTenant()` : la RLS filtre au niveau base, et
 * le `where "pharmacyId" = ...` explicite double la protection. Les deux sont
 * volontairement redondants.
 */

function days(n: number): Prisma.Sql {
  return Prisma.sql`make_interval(days => ${Math.max(1, Math.floor(n))}::int)`;
}

// -----------------------------------------------------------------------------
// Statistiques produit (base des conseils d'achat)
// -----------------------------------------------------------------------------

interface ProductStatRow {
  productId: string;
  name: string;
  categoryName: string | null;
  supplierName: string | null;
  unitsSold: number;
  revenue: number;
  stock: number;
  purchasePrice: number;
  sellingPrice: number;
  reorderLevel: number;
  leadTimeDays: number | null;
  nearestExpiry: Date | null;
  nearestExpiryQty: number | null;
  lastSaleAt: Date | null;
}

export async function getProductStats(
  ctx: TenantContext,
  options: { periodDays?: number } = {},
): Promise<ProductStat[]> {
  const periodDays = options.periodDays ?? 90;

  const rows = await withTenant(ctx, (tx) =>
    tx.$queryRaw<ProductStatRow[]>(Prisma.sql`
      with ventes as (
        select si."productId",
               sum(si.quantity)::float      as units_sold,
               sum(si."lineTotal")::float   as revenue,
               max(si."soldAt")             as last_sale
        from "SaleItem" si
        where si."pharmacyId" = ${ctx.pharmacyId}::uuid
          and si."soldAt" >= now() - ${days(periodDays)}
        group by si."productId"
      ),
      stock_actuel as (
        select s."productId", sum(s.quantity)::int as qte
        from "Stock" s
        where s."pharmacyId" = ${ctx.pharmacyId}::uuid
        group by s."productId"
      ),
      -- Lot qui périme le plus tôt, par produit (FEFO).
      peremption as (
        select distinct on (s."productId")
               s."productId", s."expiryDate", s.quantity
        from "Stock" s
        where s."pharmacyId" = ${ctx.pharmacyId}::uuid
          and s.quantity > 0
          and s."expiryDate" is not null
        order by s."productId", s."expiryDate" asc
      )
      select p.id                              as "productId",
             p.name                            as "name",
             c.name                            as "categoryName",
             p."supplierName"                  as "supplierName",
             coalesce(v.units_sold, 0)         as "unitsSold",
             coalesce(v.revenue, 0)            as "revenue",
             coalesce(sa.qte, 0)               as "stock",
             p."purchasePrice"::float          as "purchasePrice",
             p."sellingPrice"::float           as "sellingPrice",
             p."reorderLevel"                  as "reorderLevel",
             sup."leadTimeDays"                as "leadTimeDays",
             e."expiryDate"                    as "nearestExpiry",
             e.quantity                        as "nearestExpiryQty",
             v.last_sale                       as "lastSaleAt"
      from "Product" p
      left join "Category" c   on c.id = p."categoryId"
      left join ventes v       on v."productId" = p.id
      left join stock_actuel sa on sa."productId" = p.id
      left join peremption e   on e."productId" = p.id
      left join "Supplier" sup on sup."pharmacyId" = p."pharmacyId" and sup.name = p."supplierName"
      where p."pharmacyId" = ${ctx.pharmacyId}::uuid
        and p."isActive" = true
    `),
  );

  return rows.map((row) => ({
    productId: row.productId,
    name: row.name,
    categoryName: row.categoryName,
    supplierName: row.supplierName,
    unitsSold: Number(row.unitsSold ?? 0),
    revenue: Number(row.revenue ?? 0),
    stock: Number(row.stock ?? 0),
    purchasePrice: Number(row.purchasePrice ?? 0),
    sellingPrice: Number(row.sellingPrice ?? 0),
    reorderLevel: Number(row.reorderLevel ?? 0),
    leadTimeDays: row.leadTimeDays ?? undefined,
    nearestExpiry: row.nearestExpiry,
    nearestExpiryQty: row.nearestExpiryQty ?? undefined,
    lastSaleAt: row.lastSaleAt,
  }));
}

// -----------------------------------------------------------------------------
// Alertes stock / péremption (cron WhatsApp + bandeau du tableau de bord)
// -----------------------------------------------------------------------------

export interface StockAlerts {
  outOfStock: StockAlertLine[];
  lowStock: StockAlertLine[];
  expiring: ExpiryAlertLine[];
}

export async function getStockAlerts(
  ctx: TenantContext,
  options: { expiryHorizonDays?: number } = {},
): Promise<StockAlerts> {
  const horizon = options.expiryHorizonDays ?? 30;

  return withTenant(ctx, async (tx) => {
    const stockRows = await tx.$queryRaw<
      Array<{ productId: string; name: string; quantity: number; reorderLevel: number }>
    >(Prisma.sql`
      select p.id                                as "productId",
             p.name                              as "name",
             coalesce(sum(s.quantity), 0)::int   as "quantity",
             p."reorderLevel"                    as "reorderLevel"
      from "Product" p
      left join "Stock" s
        on s."productId" = p.id and s."pharmacyId" = p."pharmacyId"
      where p."pharmacyId" = ${ctx.pharmacyId}::uuid
        and p."isActive" = true
      group by p.id, p.name, p."reorderLevel"
      having coalesce(sum(s.quantity), 0) <= p."reorderLevel"
      order by coalesce(sum(s.quantity), 0) asc
    `);

    const expiring = await tx.$queryRaw<
      Array<{ productId: string; name: string; quantity: number; daysToExpiry: number }>
    >(Prisma.sql`
      select s."productId"                          as "productId",
             p.name                                 as "name",
             s.quantity                             as "quantity",
             (s."expiryDate" - current_date)::int   as "daysToExpiry"
      from "Stock" s
      join "Product" p on p.id = s."productId"
      where s."pharmacyId" = ${ctx.pharmacyId}::uuid
        and s.quantity > 0
        and s."expiryDate" is not null
        and s."expiryDate" <= current_date + ${days(horizon)}
      order by s."expiryDate" asc
    `);

    const outOfStock = stockRows
      .filter((r) => Number(r.quantity) <= 0)
      .map((r) => ({ ...r, quantity: Number(r.quantity), reorderLevel: Number(r.reorderLevel) }));
    const lowStock = stockRows
      .filter((r) => Number(r.quantity) > 0)
      .map((r) => ({ ...r, quantity: Number(r.quantity), reorderLevel: Number(r.reorderLevel) }));

    return {
      outOfStock,
      lowStock,
      expiring: expiring.map((r) => ({
        productId: r.productId,
        name: r.name,
        quantity: Number(r.quantity),
        daysToExpiry: Number(r.daysToExpiry),
      })),
    };
  });
}

// -----------------------------------------------------------------------------
// Tableau de bord
// -----------------------------------------------------------------------------

export interface DashboardData {
  today: { revenue: number; profit: number; salesCount: number };
  window: { days: number; revenue: number; profit: number; salesCount: number };
  allTime: { revenue: number; salesCount: number };
  series: Array<{ day: string; revenue: number; profit: number; sales: number }>;
  topProducts: Array<{ productId: string; name: string; units: number; revenue: number; profit: number }>;
  counts: { products: number; lowStock: number; expiring: number; outOfStock: number };
  stockValue: number;
}

export async function getDashboard(
  ctx: TenantContext,
  options: { windowDays?: number } = {},
): Promise<DashboardData> {
  const windowDays = options.windowDays ?? 30;

  return withTenant(ctx, async (tx) => {
    const [totals] = await tx.$queryRaw<
      Array<{
        today_revenue: number;
        today_profit: number;
        today_sales: number;
        window_revenue: number;
        window_profit: number;
        window_sales: number;
        all_revenue: number;
        all_sales: number;
      }>
    >(Prisma.sql`
      select
        coalesce(sum("grandTotal") filter (where date >= current_date), 0)::float            as today_revenue,
        coalesce(sum("grandTotal" - "costTotal") filter (where date >= current_date), 0)::float as today_profit,
        count(*) filter (where date >= current_date)::int                                    as today_sales,
        coalesce(sum("grandTotal") filter (where date >= now() - ${days(windowDays)}), 0)::float as window_revenue,
        coalesce(sum("grandTotal" - "costTotal") filter (where date >= now() - ${days(windowDays)}), 0)::float as window_profit,
        count(*) filter (where date >= now() - ${days(windowDays)})::int                     as window_sales,
        coalesce(sum("grandTotal"), 0)::float                                                as all_revenue,
        count(*)::int                                                                        as all_sales
      from "Sale"
      where "pharmacyId" = ${ctx.pharmacyId}::uuid
        and status::text = 'completed'
    `);

    const series = await tx.$queryRaw<
      Array<{ day: Date; revenue: number; profit: number; sales: number }>
    >(Prisma.sql`
      select date_trunc('day', date)::date                       as day,
             coalesce(sum("grandTotal"), 0)::float               as revenue,
             coalesce(sum("grandTotal" - "costTotal"), 0)::float as profit,
             count(*)::int                                       as sales
      from "Sale"
      where "pharmacyId" = ${ctx.pharmacyId}::uuid
        and status::text = 'completed'
        and date >= current_date - ${days(windowDays)}
      group by 1
      order by 1
    `);

    const topProducts = await tx.$queryRaw<
      Array<{ productId: string; name: string; units: number; revenue: number; profit: number }>
    >(Prisma.sql`
      select si."productId"                                                  as "productId",
             p.name                                                          as "name",
             sum(si.quantity)::int                                           as "units",
             sum(si."lineTotal")::float                                      as "revenue",
             sum(si."lineTotal" - si."unitCost" * si.quantity)::float        as "profit"
      from "SaleItem" si
      join "Product" p on p.id = si."productId"
      where si."pharmacyId" = ${ctx.pharmacyId}::uuid
        and si."soldAt" >= now() - ${days(windowDays)}
      group by si."productId", p.name
      order by "revenue" desc
      limit 10
    `);

    const [stockAgg] = await tx.$queryRaw<Array<{ value: number; products: number }>>(Prisma.sql`
      select coalesce(sum(s.quantity * s."purchasePrice"), 0)::float as value,
             count(distinct s."productId")::int                      as products
      from "Stock" s
      where s."pharmacyId" = ${ctx.pharmacyId}::uuid and s.quantity > 0
    `);

    const alerts = await getStockAlertsWithin(tx, ctx.pharmacyId, 30);
    const productCount = await tx.product.count({
      where: { pharmacyId: ctx.pharmacyId, isActive: true },
    });

    return {
      today: {
        revenue: Number(totals?.today_revenue ?? 0),
        profit: Number(totals?.today_profit ?? 0),
        salesCount: Number(totals?.today_sales ?? 0),
      },
      window: {
        days: windowDays,
        revenue: Number(totals?.window_revenue ?? 0),
        profit: Number(totals?.window_profit ?? 0),
        salesCount: Number(totals?.window_sales ?? 0),
      },
      allTime: {
        revenue: Number(totals?.all_revenue ?? 0),
        salesCount: Number(totals?.all_sales ?? 0),
      },
      series: series.map((s) => ({
        day: s.day instanceof Date ? s.day.toISOString().slice(0, 10) : String(s.day),
        revenue: Number(s.revenue),
        profit: Number(s.profit),
        sales: Number(s.sales),
      })),
      topProducts: topProducts.map((p) => ({
        productId: p.productId,
        name: p.name,
        units: Number(p.units),
        revenue: Number(p.revenue),
        profit: Number(p.profit),
      })),
      counts: {
        products: productCount,
        lowStock: alerts.low,
        outOfStock: alerts.out,
        expiring: alerts.expiring,
      },
      stockValue: Number(stockAgg?.value ?? 0),
    };
  });
}

/** Compteurs d'alertes, réutilisés dans une transaction tenant déjà ouverte. */
async function getStockAlertsWithin(
  tx: TenantTx,
  pharmacyId: string,
  horizonDays: number,
): Promise<{ low: number; out: number; expiring: number }> {
  const [row] = await tx.$queryRaw<Array<{ low: number; out: number; expiring: number }>>(Prisma.sql`
    with niveaux as (
      select p.id, coalesce(sum(s.quantity), 0)::int as qte, p."reorderLevel"
      from "Product" p
      left join "Stock" s on s."productId" = p.id and s."pharmacyId" = p."pharmacyId"
      where p."pharmacyId" = ${pharmacyId}::uuid and p."isActive" = true
      group by p.id, p."reorderLevel"
    )
    select
      (select count(*) from niveaux where qte > 0 and qte <= "reorderLevel")::int as low,
      (select count(*) from niveaux where qte <= 0)::int                          as out,
      (select count(*) from "Stock" s
        where s."pharmacyId" = ${pharmacyId}::uuid
          and s.quantity > 0
          and s."expiryDate" is not null
          and s."expiryDate" <= current_date + ${days(horizonDays)})::int          as expiring
  `);
  return {
    low: Number(row?.low ?? 0),
    out: Number(row?.out ?? 0),
    expiring: Number(row?.expiring ?? 0),
  };
}

// -----------------------------------------------------------------------------
// Instantané pour l'assistant conversationnel
// -----------------------------------------------------------------------------

/**
 * Résumé chiffré compact envoyé au modèle. Ne contient QUE les données de la
 * pharmacie du contexte — c'est la garantie d'isolation côté IA.
 */
export async function buildAssistantSnapshot(
  ctx: TenantContext,
  options: { windowDays?: number } = {},
): Promise<string> {
  const windowDays = options.windowDays ?? 30;
  const [dashboard, stats] = await Promise.all([
    getDashboard(ctx, { windowDays }),
    getProductStats(ctx, { periodDays: windowDays }),
  ]);

  const rotation = [...stats]
    .filter((s) => s.unitsSold > 0)
    .sort((a, b) => b.unitsSold - a.unitsSold)
    .slice(0, 25)
    .map((s) => {
      const margin =
        s.sellingPrice > 0
          ? Math.round(((s.sellingPrice - s.purchasePrice) / s.sellingPrice) * 100)
          : null;
      return `- ${s.name} : ${s.unitsSold} vendus / ${windowDays} j, stock ${s.stock}, achat ${s.purchasePrice}, vente ${s.sellingPrice}, marge ${margin ?? '?'} %`;
    });

  const dormant = stats
    .filter((s) => s.unitsSold === 0 && s.stock > 0)
    .sort((a, b) => b.stock * b.purchasePrice - a.stock * a.purchasePrice)
    .slice(0, 10)
    .map((s) => `- ${s.name} : ${s.stock} en stock, ${Math.round(s.stock * s.purchasePrice)} immobilisés`);

  return [
    `PÉRIODE : ${windowDays} derniers jours`,
    `Chiffre d'affaires : ${Math.round(dashboard.window.revenue)} (aujourd'hui ${Math.round(dashboard.today.revenue)})`,
    `Bénéfice estimé : ${Math.round(dashboard.window.profit)}`,
    `Ventes : ${dashboard.window.salesCount}`,
    `Valeur du stock (au prix d'achat) : ${Math.round(dashboard.stockValue)}`,
    `Produits actifs : ${dashboard.counts.products} | stock bas : ${dashboard.counts.lowStock} | ruptures : ${dashboard.counts.outOfStock} | périment sous 30 j : ${dashboard.counts.expiring}`,
    '',
    'PRODUITS LES PLUS VENDUS',
    ...rotation,
    '',
    'STOCK DORMANT (aucune vente sur la période)',
    ...(dormant.length ? dormant : ['- aucun']),
  ].join('\n');
}
