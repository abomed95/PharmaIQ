import Anthropic from '@anthropic-ai/sdk';

/**
 * Client Anthropic — SERVEUR UNIQUEMENT.
 * `ANTHROPIC_API_KEY` ne doit jamais atteindre le navigateur.
 */

export const MODELS = {
  /** Lecture des reçus photographiés : gros volume, latence basse. */
  vision: process.env.ANTHROPIC_MODEL_VISION ?? 'claude-sonnet-5',
  /** Conseils d'achat et assistant : raisonnement sur les chiffres. */
  text: process.env.ANTHROPIC_MODEL_TEXT ?? 'claude-opus-5',
} as const;

let cached: Anthropic | null = null;

export class AiNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY absente — les fonctions IA sont désactivées.");
    this.name = 'AiNotConfiguredError';
  }
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function getAnthropic(): Anthropic {
  if (typeof window !== 'undefined') {
    throw new Error('@pharmaiq/ai ne doit pas être importé côté client.');
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AiNotConfiguredError();
  if (!cached) cached = new Anthropic({ apiKey, maxRetries: 2 });
  return cached;
}

/** Concatène les blocs texte d'une réponse. */
export function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/** Récupère l'entrée d'un appel d'outil forcé (sortie structurée). */
export function toolInputOf(message: Anthropic.Message, toolName: string): unknown | null {
  const block = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === toolName,
  );
  return block ? block.input : null;
}
