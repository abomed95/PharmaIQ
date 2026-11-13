import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { assertUuid } from '@pharmaiq/db';
import { handleRoute, jsonOk, parseBody } from '@/lib/http';
import { requirePermission } from '@/lib/auth';
import { cancelSale } from '@/lib/services/sales';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ reason: z.string().trim().min(3).max(200) }).strict();

/** Annulation d'une vente : le stock retourne dans ses lots d'origine. */
export const POST = handleRoute(async (request: NextRequest, context) => {
  const user = await requirePermission('sales.cancel');
  const saleId = assertUuid(context.params.id, 'Identifiant de vente');
  const input = await parseBody(request, schema);
  await cancelSale(user, saleId, input.reason);
  return jsonOk({ id: saleId, status: 'cancelled' });
});
