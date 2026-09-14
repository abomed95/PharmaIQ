import { getAnthropic, MODELS, toolInputOf } from './client';
import { z } from 'zod';

/**
 * Mise en récit des conseils d'achat (§6.3 / §7).
 *
 * Les CHIFFRES sont calculés en amont par `@pharmaiq/core` (vitesse de vente,
 * couverture, capital dormant). Le modèle ne calcule rien : il priorise et
 * explique dans la langue du pharmacien. Ainsi les recommandations restent
 * vérifiables et reproductibles.
 */

export interface AdviceKpis {
  revenue: number;
  profit: number;
  salesCount: number;
  lowStockCount: number;
  expiringCount: number;
  deadStockValue: number;
}

export interface AdviceSuggestionInput {
  type: string;
  name: string;
  reason: string;
  priority: number;
  suggestedQty?: number;
  capitalTied?: number;
  velocityPerDay?: number;
  coverageDays?: number | null;
}

export interface AdviceContext {
  pharmacyName: string;
  currency: string;
  /** fr | so | ar | en — langue de la réponse. */
  locale: string;
  periodDays: number;
  kpis: AdviceKpis;
  suggestions: AdviceSuggestionInput[];
  topProducts: Array<{ name: string; unitsSold: number; revenue: number; marginRate: number | null }>;
}

const AdviceSchema = z.object({
  summary: z.string().min(1).max(1200),
  actions: z.array(z.string().min(1).max(300)).max(8),
  watchouts: z.array(z.string().min(1).max(300)).max(6),
});

export type Advice = z.infer<typeof AdviceSchema>;

const ADVICE_TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    summary: {
      type: 'string',
      description: '2 à 4 phrases : état commercial de la pharmacie sur la période.',
    },
    actions: {
      type: 'array',
      description: 'Actions concrètes classées par impact. Cite produits et quantités.',
      items: { type: 'string' },
    },
    watchouts: {
      type: 'array',
      description: 'Risques à surveiller : péremptions, marges négatives, capital dormant.',
      items: { type: 'string' },
    },
  },
  required: ['summary', 'actions', 'watchouts'],
};

const LANGUAGES: Record<string, string> = {
  fr: 'français',
  so: 'somali',
  ar: 'arabe',
  en: 'anglais',
};

const SYSTEM_PROMPT = `Tu conseilles le gérant d'UNE pharmacie sur ses achats.

Contraintes absolues :
- Utilise EXCLUSIVEMENT les chiffres fournis. N'invente aucun chiffre, aucun produit.
- Ne compare jamais avec une autre pharmacie : tu ne vois que celle-ci.
- Sois concret et court : un pharmacien lit ça sur son téléphone entre deux clients.
- Cite les noms de produits exactement comme fournis, avec les quantités suggérées.
- Si les données sont trop maigres pour conclure, dis-le franchement.`;

export async function explainPurchaseAdvice(ctx: AdviceContext): Promise<Advice> {
  const client = getAnthropic();
  const language = LANGUAGES[ctx.locale] ?? 'français';

  // Compact : on n'envoie que le haut de la liste, déjà priorisé par le calcul.
  const lines = ctx.suggestions.slice(0, 40).map((s) => {
    const parts = [
      `[${s.type}]`,
      s.name,
      s.suggestedQty != null ? `commander ${s.suggestedQty}` : null,
      s.velocityPerDay != null ? `vitesse ${s.velocityPerDay}/j` : null,
      s.coverageDays != null ? `couverture ${Math.floor(s.coverageDays)} j` : null,
      s.capitalTied != null ? `capital ${s.capitalTied} ${ctx.currency}` : null,
      `— ${s.reason}`,
    ].filter(Boolean);
    return parts.join(' · ');
  });

  const top = ctx.topProducts
    .slice(0, 15)
    .map(
      (p) =>
        `${p.name} : ${p.unitsSold} unités, ${p.revenue} ${ctx.currency}, marge ${p.marginRate ?? '?'} %`,
    );

  const userContent = `Pharmacie : ${ctx.pharmacyName}
Période analysée : ${ctx.periodDays} derniers jours
Devise : ${ctx.currency}
Réponds en ${language}.

INDICATEURS
- Chiffre d'affaires : ${ctx.kpis.revenue}
- Bénéfice estimé : ${ctx.kpis.profit}
- Nombre de ventes : ${ctx.kpis.salesCount}
- Produits en stock bas : ${ctx.kpis.lowStockCount}
- Produits qui périment bientôt : ${ctx.kpis.expiringCount}
- Capital en stock dormant : ${ctx.kpis.deadStockValue}

MEILLEURES VENTES
${top.join('\n') || '(aucune vente sur la période)'}

SUGGESTIONS CALCULÉES (déjà triées par priorité)
${lines.join('\n') || '(aucune suggestion)'}`;

  const message = await client.messages.create({
    model: MODELS.text,
    max_tokens: 1500,
    temperature: 0.2,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: 'rendre_conseils',
        description: "Rend les conseils d'achat structurés.",
        input_schema: ADVICE_TOOL_SCHEMA,
      },
    ],
    tool_choice: { type: 'tool', name: 'rendre_conseils' },
    messages: [{ role: 'user', content: userContent }],
  });

  const raw = toolInputOf(message, 'rendre_conseils');
  const parsed = AdviceSchema.safeParse(raw);
  if (!parsed.success) {
    // L'IA n'est qu'une couche d'explication : on ne casse pas l'écran pour ça.
    return {
      summary: '',
      actions: [],
      watchouts: [],
    };
  }
  return parsed.data;
}
