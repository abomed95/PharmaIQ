import type { NextRequest } from 'next/server';
import { handleRoute, jsonOk, parseBody } from '@/lib/http';
import { requirePermission } from '@/lib/auth';
import { stockAdjustSchema } from '@/lib/validation';
import { adjustStock } from '@/lib/services/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ajustement manuel (inventaire, casse, péremption, retour). */
export const POST = handleRoute(async (request: NextRequest) => {
  const user = await requirePermission('stock.update');
  const input = await parseBody(request, stockAdjustSchema);
  const result = await adjustStock(user, input);
  return jsonOk(result);
});
