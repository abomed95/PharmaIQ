import type { NextRequest } from 'next/server';
import { askAssistant, isAiConfigured } from '@pharmaiq/ai';
import { handleRoute, jsonError, jsonOk, parseBody } from '@/lib/http';
import { requirePermission, toTenantContext } from '@/lib/auth';
import { assistantSchema } from '@/lib/validation';
import { buildAssistantSnapshot } from '@/lib/analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Assistant conversationnel sur les données de LA pharmacie connectée.
 * L'instantané envoyé au modèle est construit sous `withTenant()` : aucune
 * donnée d'un autre tenant ne peut y entrer.
 */
export const POST = handleRoute(async (request: NextRequest) => {
  const user = await requirePermission('assistant.use');

  if (!isAiConfigured()) {
    return jsonError("Assistant indisponible : ANTHROPIC_API_KEY n'est pas configurée.", 503);
  }

  const input = await parseBody(request, assistantSchema);
  const snapshot = await buildAssistantSnapshot(toTenantContext(user), { windowDays: 30 });

  const result = await askAssistant({
    context: {
      pharmacyName: user.pharmacyName,
      currency: user.currency,
      locale: user.locale,
      snapshot,
      today: new Date().toISOString().slice(0, 10),
    },
    history: input.history,
    question: input.question,
  });

  return jsonOk(result);
});
