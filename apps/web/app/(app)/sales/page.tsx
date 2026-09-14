import { withTenant } from '@pharmaiq/db';
import { PAYMENT_METHODS, can } from '@pharmaiq/core';
import { requirePermission, toTenantContext } from '@/lib/auth';
import { getDictionary } from '@/lib/i18n';
import { dateTime, money } from '@/lib/format';
import { Badge, EmptyState, PageHeader, StatCard } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function SalesPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; method?: string };
}) {
  const user = await requirePermission('sales.view');
  const dict = getDictionary(user.locale);
  const ctx = toTenantContext(user);
  const showMoney = can(user.role, 'reports.view');

  const from = searchParams.from ? new Date(searchParams.from) : undefined;
  const to = searchParams.to ? new Date(searchParams.to) : undefined;
  const method = searchParams.method || undefined;

  const where = {
    pharmacyId: ctx.pharmacyId,
    ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(method ? { paymentMethod: method } : {}),
  };

  const { sales, totals, byMethod } = await withTenant(ctx, async (tx) => {
    const [rows, aggregate, grouped] = await Promise.all([
      tx.sale.findMany({
        where,
        orderBy: { date: 'desc' },
        take: 100,
        select: {
          id: true,
          invoiceId: true,
          date: true,
          grandTotal: true,
          costTotal: true,
          paymentMethod: true,
          status: true,
          soldBy: { select: { fullName: true } },
          customer: { select: { name: true } },
          _count: { select: { items: true } },
        },
      }),
      tx.sale.aggregate({ where, _sum: { grandTotal: true, costTotal: true }, _count: true }),
      tx.sale.groupBy({
        by: ['paymentMethod'],
        where,
        _sum: { grandTotal: true },
      }),
    ]);

    return {
      sales: rows,
      totals: {
        revenue: Number(aggregate._sum.grandTotal ?? 0),
        profit: Number(aggregate._sum.grandTotal ?? 0) - Number(aggregate._sum.costTotal ?? 0),
        count: aggregate._count,
      },
      byMethod: grouped.map((group) => ({
        method: group.paymentMethod,
        revenue: Number(group._sum.grandTotal ?? 0),
      })),
    };
  });

  return (
    <>
      <PageHeader title={dict.nav.sales} subtitle={`${totals.count} ventes`} />

      <form className="card mb-4 grid gap-3 sm:grid-cols-4" action="/sales">
        <div>
          <label className="label" htmlFor="from">
            Du
          </label>
          <input id="from" name="from" type="date" className="input" defaultValue={searchParams.from} />
        </div>
        <div>
          <label className="label" htmlFor="to">
            Au
          </label>
          <input id="to" name="to" type="date" className="input" defaultValue={searchParams.to} />
        </div>
        <div>
          <label className="label" htmlFor="method">
            Paiement
          </label>
          <select id="method" name="method" className="input" defaultValue={searchParams.method ?? ''}>
            <option value="">Tous</option>
            {PAYMENT_METHODS.map((paymentMethod) => (
              <option key={paymentMethod} value={paymentMethod}>
                {paymentMethod}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button type="submit" className="btn-secondary w-full">
            Filtrer
          </button>
        </div>
      </form>

      {showMoney ? (
        <section className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Chiffre d'affaires"
            value={money(totals.revenue, user.currency, user.locale)}
          />
          <StatCard
            label="Bénéfice"
            value={money(totals.profit, user.currency, user.locale)}
            tone="success"
          />
          {byMethod.slice(0, 2).map((entry) => (
            <StatCard
              key={entry.method}
              label={entry.method}
              value={money(entry.revenue, user.currency, user.locale)}
            />
          ))}
        </section>
      ) : null}

      {sales.length === 0 ? (
        <EmptyState title="Aucune vente sur cette période" />
      ) : (
        <div className="card table-wrap">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Facture</th>
                <th className="th">Date</th>
                <th className="th">Lignes</th>
                <th className="th">Paiement</th>
                <th className="th">Vendeur</th>
                {showMoney ? <th className="th">Total</th> : null}
                {showMoney ? <th className="th">Bénéfice</th> : null}
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale.id}>
                  <td className="td font-medium">
                    {sale.invoiceId}
                    {sale.status !== 'completed' ? (
                      <Badge className="ms-2 bg-red-100 text-red-800">{sale.status}</Badge>
                    ) : null}
                  </td>
                  <td className="td text-slate-500">{dateTime(sale.date, user.locale)}</td>
                  <td className="td tabular-nums">{sale._count.items}</td>
                  <td className="td">{sale.paymentMethod}</td>
                  <td className="td text-slate-500">{sale.soldBy?.fullName ?? '—'}</td>
                  {showMoney ? (
                    <td className="td tabular-nums">
                      {money(Number(sale.grandTotal), user.currency, user.locale)}
                    </td>
                  ) : null}
                  {showMoney ? (
                    <td className="td tabular-nums text-brand-700">
                      {money(
                        Number(sale.grandTotal) - Number(sale.costTotal),
                        user.currency,
                        user.locale,
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
