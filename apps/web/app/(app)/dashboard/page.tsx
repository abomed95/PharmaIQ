import Link from 'next/link';
import { can } from '@pharmaiq/core';
import { requireSession, toTenantContext } from '@/lib/auth';
import { getDashboard } from '@/lib/analytics';
import { getDictionary } from '@/lib/i18n';
import { money } from '@/lib/format';
import { Card, PageHeader, StatCard } from '@/components/ui';
import { RevenueChart } from '@/components/dashboard/RevenueChart';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requireSession();
  const dict = getDictionary(user.locale);
  const data = await getDashboard(toTenantContext(user), { windowDays: 30 });
  const fullView = can(user.role, 'dashboard.view');

  return (
    <>
      <PageHeader
        title={dict.nav.dashboard}
        subtitle={user.pharmacyName}
        action={
          <Link href="/pos" className="btn-primary">
            {dict.pos.checkout}
          </Link>
        }
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={dict.dashboard.revenueToday}
          value={money(data.today.revenue, user.currency, user.locale)}
          hint={`${data.today.salesCount} ventes`}
        />
        {fullView ? (
          <>
            <StatCard
              label={dict.dashboard.revenueWindow}
              value={money(data.window.revenue, user.currency, user.locale)}
              hint={`${data.window.salesCount} ventes`}
            />
            <StatCard
              label={dict.dashboard.profit}
              value={money(data.window.profit, user.currency, user.locale)}
              tone="success"
              hint="30 jours"
            />
            <StatCard
              label={dict.dashboard.stockValue}
              value={money(data.stockValue, user.currency, user.locale)}
              hint={`${data.counts.products} produits actifs`}
            />
          </>
        ) : (
          <StatCard label="Produits actifs" value={String(data.counts.products)} />
        )}
      </section>

      <section className="mt-3 grid grid-cols-3 gap-3">
        <StatCard
          label={dict.dashboard.outOfStock}
          value={String(data.counts.outOfStock)}
          tone={data.counts.outOfStock > 0 ? 'danger' : 'default'}
        />
        <StatCard
          label={dict.dashboard.lowStock}
          value={String(data.counts.lowStock)}
          tone={data.counts.lowStock > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label={dict.dashboard.expiring}
          value={String(data.counts.expiring)}
          tone={data.counts.expiring > 0 ? 'warning' : 'default'}
          hint="sous 30 j"
        />
      </section>

      {fullView ? (
        <Card className="mt-6">
          <h2 className="mb-3 font-semibold">Ventes et bénéfice — 30 jours</h2>
          <RevenueChart data={data.series} currency={user.currency} />
        </Card>
      ) : null}

      <Card className="mt-6">
        <h2 className="mb-3 font-semibold">{dict.dashboard.topProducts}</h2>
        {data.topProducts.length === 0 ? (
          <p className="text-sm text-slate-500">{dict.dashboard.noSales}</p>
        ) : (
          <div className="table-wrap">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Produit</th>
                  <th className="th">Unités</th>
                  {fullView ? <th className="th">CA</th> : null}
                  {fullView ? <th className="th">Bénéfice</th> : null}
                </tr>
              </thead>
              <tbody>
                {data.topProducts.map((product) => (
                  <tr key={product.productId}>
                    <td className="td font-medium">{product.name}</td>
                    <td className="td tabular-nums">{product.units}</td>
                    {fullView ? (
                      <td className="td tabular-nums">
                        {money(product.revenue, user.currency, user.locale)}
                      </td>
                    ) : null}
                    {fullView ? (
                      <td className="td tabular-nums text-brand-700">
                        {money(product.profit, user.currency, user.locale)}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {can(user.role, 'suggestions.view') ? (
        <Card className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Que dois-je commander ?</h2>
            <p className="text-sm text-slate-500">
              Calculé sur la vitesse de vente réelle de ta pharmacie.
            </p>
          </div>
          <Link href="/suggestions" className="btn-secondary">
            Voir les suggestions
          </Link>
        </Card>
      ) : null}
    </>
  );
}
