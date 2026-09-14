import { getAnthropic, MODELS, textOf } from './client';

/**
 * Assistant conversationnel (§7.5).
 *
 * « Quel est mon médicament le plus rentable ce mois-ci ? »
 * « Combien de Doliprane commander ? »
 *
 * ISOLATION : le contexte est construit côté serveur à partir des données de LA
 * pharmacie authentifiée. Aucune donnée d'un autre tenant ne peut y entrer.
 */

export interface AssistantTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantContext {
  pharmacyName: string;
  currency: string;
  locale: string;
  /** Instantané chiffré (texte compact) — construit par apps/web/lib/analytics.ts. */
  snapshot: string;
  /** Date du jour, pour que le modèle raisonne sur « ce mois-ci ». */
  today: string;
}

export interface AssistantAnswer {
  answer: string;
  usage: { inputTokens: number; outputTokens: number };
}

const LANGUAGES: Record<string, string> = {
  fr: 'français',
  so: 'somali',
  ar: 'arabe',
  en: 'anglais',
};

export const MAX_HISTORY_TURNS = 10;

function systemPrompt(ctx: AssistantContext): string {
  const language = LANGUAGES[ctx.locale] ?? 'français';
  return `Tu es l'assistant de gestion de la pharmacie « ${ctx.pharmacyName} ».
Date du jour : ${ctx.today}. Devise : ${ctx.currency}. Réponds en ${language}
(ou dans la langue de la question si l'utilisateur en change).

Tu ne connais QUE les données ci-dessous, qui appartiennent à cette seule pharmacie.

Règles :
- Réponds à partir de ces données uniquement. Ne devine aucun chiffre.
- Si l'information manque, dis précisément ce qui manque et où le trouver dans PharmaIQ.
- Réponse courte et actionnable : 1 à 5 phrases, ou une courte liste. Pas de tableau.
- Donne toujours le chiffre exact quand il existe, avec son unité ou sa devise.
- Tu ne donnes pas de conseil médical au patient : tu parles gestion, stock et marge.

=== DONNÉES DE LA PHARMACIE ===
${ctx.snapshot}
=== FIN DES DONNÉES ===`;
}

export async function askAssistant(params: {
  context: AssistantContext;
  history?: AssistantTurn[];
  question: string;
}): Promise<AssistantAnswer> {
  const client = getAnthropic();
  const history = (params.history ?? []).slice(-MAX_HISTORY_TURNS);

  const message = await client.messages.create({
    model: MODELS.text,
    max_tokens: 900,
    temperature: 0.3,
    system: systemPrompt(params.context),
    messages: [
      ...history.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: 'user' as const, content: params.question },
    ],
  });

  return {
    answer: textOf(message),
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    },
  };
}
