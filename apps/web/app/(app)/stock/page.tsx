import Link from 'next/link';
import { daysUntil } from '@pharmaiq/core';
import { requirePermission } from '@/lib/auth';
import { listStock } from '@/lib/services/stock';
import { getDictionary } from '@/lib/i18n';
import { expiryTone, money, shortDate } from '@/lib/format';
import { Badge, EmptyState, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function StockPage({
  searchParams,
}: {
  searchParams: { q?: string; expiring?: string };
}) {
  const user = await requirePermission('stock.view');
  const dict = getDictionary(user.locale);
  const onlyExpiring = searchParams.expiring === '1';

  const lots = await listStock(user, {
    search: searchParams.q?.trim() || undefined,
    onlyExpiring,
    limit: 300,
  });

  const totalValue = lots.reduce(
    (sum, lot) => sum + lot.quantity * Number(lot.purchasePrice),
    0,
  );

  return (
    <>
      <PageHeader
        title={dict.nav.stock}
        subtitle={`${lots.length} lots · ${money(totalValue, user.currency, user.locale)} immobilisés`}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <form className="flex flex-1 gap-2" action="/stock">
          <input
            name="q"
            defaultValue={searchParams.q ?? ''}
            placeholder={dict.common.search}
            className="input"
            inputMode="search"
          />
          {onlyExpiring ? <input type="hidden" name="expiring" value="1" /> : null}
          <button type="submit" className="btn-secondary">
            {dict.common.search}
          </button>
        </form>
        <Link
          href={onlyExpiring ? '/stock' : '/stock?expiring=1'}
          className={onlyExpiring ? 'btn-primary' : 'btn-secondary'}
        >
          Péremptions ≤ 90 j
        </Link>
      </div>

      {lots.length === 0 ? (
        <EmptyState
          title="Aucun lot en stock"
          hint="Le stock se remplit par photo de reçu fournisseur ou par import de catalogue."
        />
      ) : (
        <div className="card table-wrap">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Produit</th>
                <th className="th">Lot</th>
                <th className="th">Péremption</th>
                <th className="th">Quantité</th>
                <th className="th">Valeur</th>
                <th className="th">Succursale</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((lot) => {
                const dte = daysUntil(lot.expiryDate);
                return (
                  <tr key={lot.id}>
                    <td className="td max-w-[220px] truncate font-medium">{lot.product.name}</td>
                    <td className="td text-slate-500">{lot.batchNo ?? '—'}</td>
                    <td className="td">
                      {lot.expiryDate ? (
                        <Badge className={expiryTone(dte)}>
                          {shortDate(lot.expiryDate, user.locale)}
                          {dte !== null ? ` · ${dte} j` : ''}
                        </Badge>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="td tabular-nums">
                      {lot.quantity} {lot.product.unit}
                    </td>
                    <td className="td tabular-nums">
                      {money(lot.quantity * Number(lot.purchasePrice), user.currency, user.locale)}
                    </td>
                    <td className="td text-slate-500">{lot.branch.name}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">
            Tri FEFO : les lots qui périment le plus tôt sortent en premier à la caisse.
          </p>
        </div>
      )}
    </>
  );
}
