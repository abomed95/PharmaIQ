import { withTenant } from '@pharmaiq/db';
import {
  buildSuggestions,
  groupBySupplier,
  periodKey,
  round2,
  type Suggestion,
  type SuggestionType,
} from '@pharmaiq/core';
import { explainPurchaseAdvice, isAiConfigured, type Advice } from '@pharmaiq/ai';
import { getDashboard, getProductStats } from '../analytics';
import { toTenantContext, type SessionUser } from '../auth';

/**
 * Conseils d'achat (§6.3).
 *
 * Les chiffres viennent du SQL, les règles de `@pharmaiq/core` — donc
 * reproductibles et testables. L'IA n'intervient qu'en surcouche explicative,
 * et son absence ne casse rien.
 */

export interface SuggestionsResult {
  period: string;
  params: { periodDays: number; horizonDays: number };
  suggestions: Suggestion[];
  byType: Record<SuggestionType, Suggestion[]>;
  orderBySupplier: Array<{
    supplier: string;
    lines: Suggestion[];
    estimatedValue: number;
  }>;
  advice: Advice | null;
}

function emptyByType(): Record<SuggestionType, Suggestion[]> {
  return {
    buy_more: [],
    buy_less: [],
    dead_stock: [],
    price_suggestion: [],
    expiry_risk: [],
  };
}

export async function computeSuggestions(
  user: SessionUser,
  options: { periodDays?: number; horizonDays?: number; explain?: boolean } = {},
): Promise<SuggestionsResult> {
  const ctx = toTenantContext(user);
  const periodDays = options.periodDays ?? 90;
  const horizonDays = options.horizonDays ?? 30;

  const stats = await getProductStats(ctx, { periodDays });
  const suggestions = buildSuggestions(stats, { periodDays, horizonDays, today: new Date() });

  const byType = emptyByType();
  for (const suggestion of suggestions) byType[suggestion.type].push(suggestion);

  const priceOf = new Map(stats.map((s) => [s.productId, s.purchasePrice]));
  const orderBySupplier = [...groupBySupplier(byType.buy_more)]
    .map(([supplier, lines]) => ({
      supplier,
      lines,
      estimatedValue: round2(
        lines.reduce(
          (sum, line) => sum + (line.payload.suggestedQty ?? 0) * (priceOf.get(line.productId) ?? 0),
          0,
        ),
      ),
    }))
    .sort((a, b) => b.estimatedValue - a.estimatedValue);

  let advice: Advice | null = null;
  if (options.explain && isAiConfigured() && suggestions.length > 0) {
    const dashboard = await getDashboard(ctx, { windowDays: periodDays });
    const deadStockValue = round2(
      byType.dead_stock.reduce((sum, s) => sum + (s.payload.capitalTied ?? 0), 0),
    );
    try {
      advice = await explainPurchaseAdvice({
        pharmacyName: user.pharmacyName,
        currency: user.currency,
        locale: user.locale,
        periodDays,
        kpis: {
          revenue: Math.round(dashboard.window.revenue),
          profit: Math.round(dashboard.window.profit),
          salesCount: dashboard.window.salesCount,
          lowStockCount: dashboard.counts.lowStock,
          expiringCount: dashboard.counts.expiring,
          deadStockValue,
        },
        suggestions: suggestions.slice(0, 40).map((s) => ({
          type: s.type,
          name: s.name,
          reason: s.reason,
          priority: s.priority,
          suggestedQty: s.payload.suggestedQty,
          capitalTied: s.payload.capitalTied,
          velocityPerDay: s.payload.velocityPerDay,
          coverageDays: s.payload.coverageDays,
        })),
        topProducts: dashboard.topProducts.map((p) => ({
          name: p.name,
          unitsSold: p.units,
          revenue: Math.round(p.revenue),
          marginRate: p.revenue > 0 ? Math.round((p.profit / p.revenue) * 100) : null,
        })),
      });
    } catch (error) {
      console.error('[suggestions] explication IA indisponible', error);
    }
  }

  return {
    period: periodKey(),
    params: { periodDays, horizonDays },
    suggestions,
    byType,
    orderBySupplier,
    advice,
  };
}

/**
 * Persiste l'état des recommandations pour la période courante.
 * Idempotent : on remplace les recommandations non traitées de la période.
 */
export async function persistSuggestions(
  user: SessionUser,
  suggestions: Suggestion[],
  period = periodKey(),
  limit = 200,
): Promise<number> {
  const ctx = toTenantContext(user);
  const top = suggestions.slice(0, limit);

  return withTenant(ctx, async (tx) => {
    await tx.recommendation.deleteMany({
      where: { pharmacyId: ctx.pharmacyId, period, actedOn: false },
    });
    if (top.length === 0) return 0;

    const created = await tx.recommendation.createMany({
      data: top.map((s) => ({
        pharmacyId: ctx.pharmacyId,
        type: s.type,
        productId: s.productId,
        period,
        priority: s.priority,
        payload: { ...s.payload, name: s.name, reason: s.reason, supplierName: s.supplierName },
      })),
    });
    return created.count;
  });
}

/** Texte prêt à envoyer au fournisseur (WhatsApp / PDF). */
export function formatPurchaseOrder(
  pharmacyName: string,
  supplier: string,
  lines: Suggestion[],
): string {
  const body = lines
    .map((line, index) => `${index + 1}. ${line.name} — ${line.payload.suggestedQty ?? 0}`)
    .join('\n');
  return `Bon de commande — ${pharmacyName}\nFournisseur : ${supplier}\n\n${body}\n\nMerci de confirmer la disponibilité et le délai.`;
}
