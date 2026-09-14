import { getAnthropic, MODELS, toolInputOf } from './client';
import { RECEIPT_TOOL_SCHEMA, ReceiptSchema, type Receipt } from './schemas';

/**
 * Photo de reçu → lignes d'achat structurées (§6.2).
 *
 * La sortie est CONTRAINTE par un outil (schéma JSON imposé) puis re-validée par
 * zod. Rien n'est écrit en base ici : le résultat alimente l'écran de
 * vérification humaine (`/purchases/new`).
 */

/** Prompt d'extraction — repris du cahier des charges, adapté à la sortie outil. */
export const RECEIPT_SYSTEM_PROMPT = `Tu es un assistant qui lit des reçus/factures d'achat de pharmacie
(français, arabe ou anglais, imprimés ou manuscrits). Extrais UNIQUEMENT ce que tu vois, sans inventer.

Règles :
- Si un champ est illisible ou absent, mets null. N'invente JAMAIS un prix, un lot ou une date.
- quantity et purchase_price sont des nombres sans séparateur de milliers (ex. 1200, pas 1 200).
- purchase_price est le prix UNITAIRE d'achat. Si seul un total de ligne est visible, divise par la
  quantité uniquement si le calcul est évident ; sinon mets null.
- Les dates sont au format YYYY-MM-DD. Une péremption écrite « 04/2028 » devient « 2028-04-01 ».
- N'inclus pas les lignes de total, TVA, remise ou frais de livraison dans "items".
- confidence reflète ta confiance globale : 0 si l'image est illisible, 1 si tout est net.

Appelle l'outil enregistrer_recu avec le résultat. Ne réponds rien d'autre.`;

export type SupportedMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // limite API Anthropic

export interface ExtractReceiptInput {
  image: { base64: string; mediaType: SupportedMediaType };
  /** Contexte utile : devise de la pharmacie, fournisseur habituel, langue attendue. */
  hint?: string;
}

export interface ExtractReceiptResult {
  receipt: Receipt;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  /** Sortie brute du modèle, conservée dans `Purchase.aiRaw` pour audit. */
  raw: unknown;
}

export class ReceiptExtractionError extends Error {
  readonly raw: unknown;
  readonly issues: string[];
  constructor(message: string, options: { raw?: unknown; issues?: string[] } = {}) {
    super(message);
    this.name = 'ReceiptExtractionError';
    this.raw = options.raw ?? null;
    this.issues = options.issues ?? [];
  }
}

export function assertImageSize(base64: string): void {
  // 4 caractères base64 ≈ 3 octets
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) {
    throw new ReceiptExtractionError(
      `Image trop lourde (${Math.round(bytes / 1024 / 1024)} Mo). Maximum ${MAX_IMAGE_BYTES / 1024 / 1024} Mo — réduis la résolution avant l'envoi.`,
    );
  }
}

export async function extractReceipt(input: ExtractReceiptInput): Promise<ExtractReceiptResult> {
  assertImageSize(input.image.base64);
  const client = getAnthropic();

  const message = await client.messages.create({
    model: MODELS.vision,
    max_tokens: 4096,
    temperature: 0,
    system: RECEIPT_SYSTEM_PROMPT,
    tools: [
      {
        name: 'enregistrer_recu',
        description: "Enregistre les données lues sur le reçu d'achat.",
        input_schema: RECEIPT_TOOL_SCHEMA,
      },
    ],
    tool_choice: { type: 'tool', name: 'enregistrer_recu' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: input.image.mediaType,
              data: input.image.base64,
            },
          },
          {
            type: 'text',
            text: input.hint
              ? `Lis ce reçu d'achat. Contexte : ${input.hint}`
              : "Lis ce reçu d'achat.",
          },
        ],
      },
    ],
  });

  const raw = toolInputOf(message, 'enregistrer_recu');
  if (raw == null) {
    throw new ReceiptExtractionError(
      "Le modèle n'a renvoyé aucune donnée structurée. Réessaie avec une photo plus nette.",
      { raw: message.content },
    );
  }

  const parsed = ReceiptSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ReceiptExtractionError('Données extraites invalides.', {
      raw,
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  }

  return {
    receipt: parsed.data,
    model: message.model,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    },
    raw,
  };
}

/**
 * Seuil en dessous duquel l'interface insiste sur la relecture ligne à ligne.
 * L'écran de validation reste OBLIGATOIRE quelle que soit la confiance.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;
