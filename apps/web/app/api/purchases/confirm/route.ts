import type { NextRequest } from 'next/server';
import { handleRoute, jsonOk, parseBody } from '@/lib/http';
import { requirePermission } from '@/lib/auth';
import { purchaseConfirmSchema } from '@/lib/validation';
import { confirmPurchase } from '@/lib/services/purchases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Validation humaine d'un achat → écriture du stock.
 * C'est le seul chemin qui transforme une lecture de reçu en mouvement de stock.
 */
export const POST = handleRoute(async (request: NextRequest) => {
  const user = await requirePermission('purchases.manage');
  const input = await parseBody(request, purchaseConfirmSchema);
  const result = await confirmPurchase(user, input);
  return jsonOk(result, { status: 201 });
});
