import { NextResponse } from 'next/server';
import { logger } from '@pharmaiq/core';
import { prisma } from '@pharmaiq/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sonde de santé (Cloud Run : démarrage et vivacité).
 *
 * - `GET /api/health` : le processus répond. Aucune dépendance externe, pour
 *   qu'une panne de base ne fasse pas redémarrer les instances en boucle.
 * - `GET /api/health?deep=1` : vérifie en plus la connexion à la base. À
 *   utiliser pour la surveillance, pas pour la sonde de vivacité.
 *
 * Aucune donnée métier, aucun détail de configuration : la route est publique.
 */
export async function GET(request: Request) {
  const deep = new URL(request.url).searchParams.get('deep') === '1';
  if (!deep) return NextResponse.json({ status: 'ok' });

  try {
    await prisma.$queryRaw`select 1`;
    return NextResponse.json({ status: 'ok', database: 'ok' });
  } catch (error) {
    logger.error('santé : base injoignable', { error });
    return NextResponse.json({ status: 'degraded', database: 'unreachable' }, { status: 503 });
  }
}
