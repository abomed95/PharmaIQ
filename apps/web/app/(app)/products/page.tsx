import Link from 'next/link';
import { withTenant } from '@pharmaiq/db';
import { daysUntil, marginRate } from '@pharmaiq/core';
import { requirePermission, toTenantContext } from '@/lib/auth';
import { getDictionary } from '@/lib/i18n';
import { expiryTone, money, shortDate } from '@/lib/format';
import { Badge, EmptyState, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: { q?: string; page?: string };
}) {
  const user = await requirePermission('products.view');
  const dict = getDictionary(user.locale);
  const ctx = toTenantContext(user);
  const search = searchParams.q?.trim() ?? '';
  const page = Math.max(1, Number(searchParams.page ?? '1') || 1);
  const pageSize = 50;

  const { items, total } = await withTenant(ctx, async (tx) => {
    const where = {
      pharmacyId: ctx.pharmacyId,
      isActive: true,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { dci: { contains: search, mode: 'insensitive' as const } },
              { barcode: { equals: search } },
            ],
          }
        : {}),
    };

    const [rows, count] = await Promise.all([
      tx.product.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          unit: true,
          purchasePrice: true,
          sellingPrice: true,
          reorderLevel: true,
          category: { select: { name: true } },
          stock: { select: { quantity: true, expiryDate: true } },
        },
      }),
      tx.product.count({ where }),
    ]);

    return {
      items: rows.map((product) => {
        const quantity = product.stock.reduce((sum, lot) => sum + lot.quantity, 0);
        const expiries = product.stock
          .filter((lot) => lot.quantity > 0 && lot.expiryDate)
          .map((lot) => lot.expiryDate as Date)
          .sort((a, b) => a.getTime() - b.getTime());
        return {
          id: product.id,
          name: product.name,
          unit: product.unit,
          category: product.category?.name ?? '—',
          purchasePrice: Number(product.purchasePrice),
          sellingPrice: Number(product.sellingPrice),
          reorderLevel: product.reorderLevel,
          quantity,
          nearestExpiry: expiries[0] ?? null,
        };
      }),
      total: count,
    };
  });

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <PageHeader
        title={dict.nav.products}
        subtitle={`${total} produits actifs`}
        action={
          <Link href="/purchases/new" className="btn-primary">
            {dict.receipts.takePhoto}
          </Link>
        }
      />

      <form className="mb-4 flex gap-2" action="/products">
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

      {items.length === 0 ? (
        <EmptyState
          title="Aucun produit"
          hint="Importe ton catalogue Excel depuis les paramètres, ou photographie un reçu fournisseur."
        />
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Produit</th>
                  <th className="th">Catégorie</th>
                  <th className="th">Stock</th>
                  <th className="th">Achat</th>
                  <th className="th">Vente</th>
                  <th className="th">Marge</th>
                  <th className="th">Péremption</th>
                </tr>
              </thead>
              <tbody>
                {items.map((product) => {
                  const margin = marginRate(product.purchasePrice, product.sellingPrice);
                  const dte = daysUntil(product.nearestExpiry);
                  return (
                    <tr key={product.id}>
                      <td className="td max-w-[220px] truncate font-medium">{product.name}</td>
                      <td className="td text-slate-500">{product.category}</td>
                      <td className="td tabular-nums">
                        {product.quantity <= 0 ? (
                          <Badge className="bg-red-100 text-red-800">Rupture</Badge>
                        ) : product.quantity <= product.reorderLevel ? (
                          <Badge className="bg-amber-100 text-amber-800">
                            {product.quantity} · bas
                          </Badge>
                        ) : (
                          `${product.quantity} ${product.unit}`
                        )}
                      </td>
                      <td className="td tabular-nums">
                        {money(product.purchasePrice, user.currency, user.locale)}
                      </td>
                      <td className="td tabular-nums">
                        {money(product.sellingPrice, user.currency, user.locale)}
                      </td>
                      <td className="td tabular-nums">
                        {margin === null ? (
                          <Badge className="bg-red-100 text-red-800">prix manquant</Badge>
                        ) : margin < 0 ? (
                          <Badge className="bg-red-100 text-red-800">{margin} %</Badge>
                        ) : (
                          `${margin} %`
                        )}
                      </td>
                      <td className="td">
                        {product.nearestExpiry ? (
                          <Badge className={expiryTone(dte)}>
                            {shortDate(product.nearestExpiry, user.locale)}
                          </Badge>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {pages > 1 ? (
            <div className="mt-3 flex items-center justify-between text-sm">
              <Link
                href={`/products?q=${encodeURIComponent(search)}&page=${Math.max(1, page - 1)}`}
                className="btn-secondary"
                aria-disabled={page === 1}
              >
                Précédent
              </Link>
              <span className="text-slate-500">
                Page {page} / {pages}
              </span>
              <Link
                href={`/products?q=${encodeURIComponent(search)}&page=${Math.min(pages, page + 1)}`}
                className="btn-secondary"
                aria-disabled={page === pages}
              >
                Suivant
              </Link>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
