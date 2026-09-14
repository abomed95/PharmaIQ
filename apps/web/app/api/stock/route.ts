import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { handleRoute, jsonOk, parseQuery } from '@/lib/http';
import { requirePermission } from '@/lib/auth';
import { listStock } from '@/lib/services/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  expiring: z.enum(['0', '1']).default('0'),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

/** État du stock par lot, trié FEFO. */
export const GET = handleRoute(async (request: NextRequest) => {
  const user = await requirePermission('stock.view');
  const query = parseQuery(request, querySchema);

  const lots = await listStock(user, {
    search: query.q,
    onlyExpiring: query.expiring === '1',
    limit: query.limit,
  });

  return jsonOk(
    lots.map((lot) => ({
      id: lot.id,
      productId: lot.product.id,
      productName: lot.product.name,
      unit: lot.product.unit,
      reorderLevel: lot.product.reorderLevel,
      branch: lot.branch.name,
      quantity: lot.quantity,
      batchNo: lot.batchNo,
      expiryDate: lot.expiryDate,
      purchasePrice: Number(lot.purchasePrice),
    })),
  );
});
