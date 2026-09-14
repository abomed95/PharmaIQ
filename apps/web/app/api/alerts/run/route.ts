import type { NextRequest } from 'next/server';
import { assertCronAuthorized, handleRoute, jsonOk } from '@/lib/http';
import { runStockAlerts } from '@/lib/services/alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Job d'alertes — déclenché par Vercel Cron (GET) ou manuellement (POST).
 * Protégé par `Authorization: Bearer $CRON_SECRET`.
 *
 * `?force=1` ignore le créneau horaire et l'anti-doublon quotidien (tests).
 * `?pharmacyId=…` limite l'exécution à une pharmacie.
 */
async function run(request: NextRequest) {
  assertCronAuthorized(request);
  const url = new URL(request.url);

  const result = await runStockAlerts({
    force: url.searchParams.get('force') === '1',
    pharmacyId: url.searchParams.get('pharmacyId') ?? undefined,
  });

  return jsonOk(result);
}

export const GET = handleRoute(run);
export const POST = handleRoute(run);
