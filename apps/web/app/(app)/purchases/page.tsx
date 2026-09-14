import Link from 'next/link';
import { withTenant } from '@pharmaiq/db';
import { requirePermission, toTenantContext } from '@/lib/auth';
import { getDictionary } from '@/lib/i18n';
import { money, shortDate } from '@/lib/format';
import { Badge, EmptyState, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function PurchasesPage() {
  const user = await requirePermission('receipts.scan');
  const dict = getDictionary(user.locale);
  const ctx = toTenantContext(user);

  const purchases = await withTenant(ctx, (tx) =>
    tx.purchase.findMany({
      where: { pharmacyId: ctx.pharmacyId },
      orderBy: { date: 'desc' },
      take: 50,
      select: {
        id: true,
        date: true,
        invoiceRef: true,
        total: true,
        status: true,
        aiExtracted: true,
        aiConfidence: true,
        supplier: { select: { name: true } },
        _count: { select: { items: true } },
      },
    }),
  );

  return (
    <>
      <PageHeader
        title={dict.nav.purchases}
        subtitle="Entrées de stock et factures fournisseurs"
        action={
          <Link href="/purchases/new" className="btn-primary">
            {dict.receipts.takePhoto}
          </Link>
        }
      />

      {purchases.length === 0 ? (
        <EmptyState
          title="Aucun achat enregistré"
          hint="Photographie un reçu fournisseur : les lignes sont lues automatiquement, tu n'as plus qu'à vérifier."
        />
      ) : (
        <div className="card table-wrap">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Date</th>
                <th className="th">Fournisseur</th>
                <th className="th">Facture</th>
                <th className="th">Lignes</th>
                <th className="th">Total</th>
                <th className="th">Source</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((purchase) => (
                <tr key={purchase.id}>
                  <td className="td">{shortDate(purchase.date, user.locale)}</td>
                  <td className="td">{purchase.supplier?.name ?? '—'}</td>
                  <td className="td text-slate-500">{purchase.invoiceRef ?? '—'}</td>
                  <td className="td tabular-nums">{purchase._count.items}</td>
                  <td className="td tabular-nums">
                    {money(Number(purchase.total), user.currency, user.locale)}
                  </td>
                  <td className="td">
                    {purchase.aiExtracted ? (
                      <Badge className="bg-brand-50 text-brand-700">
                        📷 photo
                        {purchase.aiConfidence
                          ? ` · ${Math.round(Number(purchase.aiConfidence) * 100)} %`
                          : ''}
                      </Badge>
                    ) : (
                      <Badge>saisie</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
