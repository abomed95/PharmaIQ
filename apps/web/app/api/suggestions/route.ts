import type { NextRequest } from 'next/server';
import { handleRoute, jsonOk, parseQuery } from '@/lib/http';
import { requirePermission } from '@/lib/auth';
import { suggestionsQuerySchema } from '@/lib/validation';
import { computeSuggestions, persistSuggestions } from '@/lib/services/suggestions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Conseils d'achat calculés sur l'historique réel de la pharmacie. */
export const GET = handleRoute(async (request: NextRequest) => {
  const user = await requirePermission('suggestions.view');
  const query = parseQuery(request, suggestionsQuerySchema);

  const result = await computeSuggestions(user, {
    periodDays: query.days,
    horizonDays: query.horizon,
    explain: query.explain === '1',
  });

  // Historiser l'état du jour : permet de mesurer plus tard ce qui a été suivi.
  await persistSuggestions(user, result.suggestions, result.period).catch((error) => {
    console.error('[suggestions] persistance impossible', error);
  });

  return jsonOk(result);
});
