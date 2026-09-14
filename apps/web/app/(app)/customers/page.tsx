import { withTenant } from '@pharmaiq/db';
import { requirePermission, toTenantContext } from '@/lib/auth';
import { getDictionary } from '@/lib/i18n';
import { money } from '@/lib/format';
import { EmptyState, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({ searchParams }: { searchParams: { q?: string } }) {
  const user = await requirePermission('customers.manage');
  const dict = getDictionary(user.locale);
  const ctx = toTenantContext(user);
  const search = searchParams.q?.trim() ?? '';

  const customers = await withTenant(ctx, (tx) =>
    tx.customer.findMany({
      where: {
        pharmacyId: ctx.pharmacyId,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' as const } },
                { phone: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      take: 100,
      select: {
        id: true,
        name: true,
        phone: true,
        loyaltyPoints: true,
        _count: { select: { sales: true } },
        sales: { orderBy: { date: 'desc' }, take: 1, select: { date: true, grandTotal: true } },
      },
    }),
  );

  return (
    <>
      <PageHeader title={dict.nav.customers} subtitle={`${customers.length} clients`} />

      <form className="mb-4 flex gap-2" action="/customers">
        <input
          name="q"
          defaultValue={search}
          placeholder={dict.common.search}
          className="input"
          inputMode="search"
        />
        <button type="submit" className="btn-secondary">
          {dict.common.search}
        </button>
      </form>

      {customers.length === 0 ? (
        <EmptyState
          title="Aucun client enregistré"
          hint="Ajoute un client depuis la caisse pour suivre ses achats et ses points de fidélité."
        />
      ) : (
        <div className="card table-wrap">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Client</th>
                <th className="th">Téléphone</th>
                <th className="th">Achats</th>
                <th className="th">Dernier achat</th>
                <th className="th">Points</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td className="td font-medium">{customer.name}</td>
                  <td className="td text-slate-500">{customer.phone ?? '—'}</td>
                  <td className="td tabular-nums">{customer._count.sales}</td>
                  <td className="td text-slate-500">
                    {customer.sales[0]
                      ? money(Number(customer.sales[0].grandTotal), user.currency, user.locale)
                      : '—'}
                  </td>
                  <td className="td tabular-nums">{customer.loyaltyPoints}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
