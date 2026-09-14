import Link from 'next/link';
import type { SuggestionType } from '@pharmaiq/core';
import { requirePermission } from '@/lib/auth';
import { computeSuggestions, formatPurchaseOrder } from '@/lib/services/suggestions';
import { getDictionary } from '@/lib/i18n';
import { money } from '@/lib/format';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

const TABS: Array<{ key: SuggestionType; labelKey: 'buyMore' | 'deadStock' | 'expiryRisk' | 'priceIssues' }> = [
  { key: 'buy_more', labelKey: 'buyMore' },
  { key: 'dead_stock', labelKey: 'deadStock' },
  { key: 'expiry_risk', labelKey: 'expiryRisk' },
  { key: 'price_suggestion', labelKey: 'priceIssues' },
];

export default async function SuggestionsPage({
  searchParams,
}: {
  searchParams: { tab?: string; days?: string; explain?: string };
}) {
  const user = await requirePermission('suggestions.view');
  const dict = getDictionary(user.locale);

  const periodDays = Math.min(365, Math.max(7, Number(searchParams.days ?? '90') || 90));
  const activeTab = (TABS.find((tab) => tab.key === searchParams.tab)?.key ??
    'buy_more') as SuggestionType;
  const explain = searchParams.explain === '1';

  const result = await computeSuggestions(user, { periodDays, explain });
  const rows = result.byType[activeTab] ?? [];

  return (
    <>
      <PageHeader
        title={dict.suggestions.title}
        subtitle={`Calculé sur ${periodDays} jours de ventes réelles`}
        action={
          explain ? undefined : (
            <Link
              href={`/suggestions?tab=${activeTab}&days=${periodDays}&explain=1`}
              className="btn-secondary"
            >
              ✨ Expliquer avec l’IA
            </Link>
          )
        }
      />

      {result.advice?.summary ? (
        <Card className="mb-4 border-brand-200 bg-brand-50">
          <p className="text-sm leading-relaxed text-brand-900">{result.advice.summary}</p>
          {result.advice.actions.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm text-brand-900">
              {result.advice.actions.map((action, index) => (
                <li key={index}>• {action}</li>
              ))}
            </ul>
          ) : null}
          {result.advice.watchouts.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm text-amber-800">
              {result.advice.watchouts.map((watchout, index) => (
                <li key={index}>⚠️ {watchout}</li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      <nav className="mb-4 flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const count = result.byType[tab.key]?.length ?? 0;
          const active = tab.key === activeTab;
          return (
            <Link
              key={tab.key}
              href={`/suggestions?tab=${tab.key}&days=${periodDays}`}
              className={active ? 'btn-primary' : 'btn-secondary'}
            >
              {dict.suggestions[tab.labelKey]}
              <Badge className={active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}>
                {count}
              </Badge>
            </Link>
          );
        })}
      </nav>

      {rows.length === 0 ? (
        <EmptyState title="Rien à signaler ici" hint={dict.suggestions.empty} />
      ) : (
        <div className="card table-wrap">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Produit</th>
                <th className="th">Stock</th>
                <th className="th">Vitesse</th>
                <th className="th">Couverture</th>
                {activeTab === 'buy_more' ? <th className="th">{dict.suggestions.suggestedQty}</th> : null}
                {activeTab === 'price_suggestion' ? <th className="th">Prix suggéré</th> : null}
                {activeTab === 'dead_stock' || activeTab === 'expiry_risk' ? (
                  <th className="th">Capital</th>
                ) : null}
                <th className="th">Pourquoi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.type}-${row.productId}`}>
                  <td className="td max-w-[220px] truncate font-medium">{row.name}</td>
                  <td className="td tabular-nums">{row.payload.stock}</td>
                  <td className="td tabular-nums">{row.payload.velocityPerDay}/j</td>
                  <td className="td tabular-nums">
                    {row.payload.coverageDays === null
                      ? '—'
                      : `${Math.floor(row.payload.coverageDays)} j`}
                  </td>
                  {activeTab === 'buy_more' ? (
                    <td className="td font-semibold tabular-nums text-brand-700">
                      {row.payload.suggestedQty}
                    </td>
                  ) : null}
                  {activeTab === 'price_suggestion' ? (
                    <td className="td tabular-nums">
                      {row.payload.suggestedPrice
                        ? money(row.payload.suggestedPrice, user.currency, user.locale)
                        : '—'}
                    </td>
                  ) : null}
                  {activeTab === 'dead_stock' || activeTab === 'expiry_risk' ? (
                    <td className="td tabular-nums text-amber-700">
                      {money(row.payload.capitalTied ?? 0, user.currency, user.locale)}
                    </td>
                  ) : null}
                  <td className="td text-slate-500">{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'buy_more' && result.orderBySupplier.length > 0 ? (
        <section className="mt-6 space-y-3">
          <h2 className="font-semibold">Bons de commande par fournisseur</h2>
          {result.orderBySupplier.map((group) => {
            const text = formatPurchaseOrder(user.pharmacyName, group.supplier, group.lines);
            return (
              <Card key={group.supplier} className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{group.supplier}</p>
                  <p className="text-sm text-slate-500">
                    {group.lines.length} produit(s) ·{' '}
                    {money(group.estimatedValue, user.currency, user.locale)}
                  </p>
                </div>
                <a
                  className="btn-secondary"
                  href={`https://wa.me/?text=${encodeURIComponent(text)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {dict.suggestions.sendOrder}
                </a>
              </Card>
            );
          })}
        </section>
      ) : null}
    </>
  );
}
