import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { withTenant } from '@pharmaiq/db';
import { handleRoute, jsonOk, parseBody, parseQuery } from '@/lib/http';
import { requirePermission, toTenantContext } from '@/lib/auth';
import { saleCreateSchema } from '@/lib/validation';
import { createSale } from '@/lib/services/sales';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  paymentMethod: z.string().max(30).optional(),
  soldById: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Historique des ventes, filtrable (§5.7). */
export const GET = handleRoute(async (request: NextRequest) => {
  const user = await requirePermission('sales.view');
  const query = parseQuery(request, querySchema);
  const ctx = toTenantContext(user);

  const where = {
    pharmacyId: ctx.pharmacyId,
    ...(query.from || query.to
      ? { date: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
    ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
    ...(query.soldById ? { soldById: query.soldById } : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
  };

  const data = await withTenant(ctx, async (tx) => {
    const [items, total, aggregate] = await Promise.all([
      tx.sale.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          invoiceId: true,
          date: true,
          grandTotal: true,
          costTotal: true,
          paymentMethod: true,
          status: true,
          soldBy: { select: { fullName: true } },
          customer: { select: { name: true } },
          _count: { select: { items: true } },
        },
      }),
      tx.sale.count({ where }),
      tx.sale.aggregate({ where, _sum: { grandTotal: true, costTotal: true } }),
    ]);

    return {
      items: items.map((sale) => ({
        id: sale.id,
        invoiceId: sale.invoiceId,
        date: sale.date,
        grandTotal: Number(sale.grandTotal),
        profit: Number(sale.grandTotal) - Number(sale.costTotal),
        paymentMethod: sale.paymentMethod,
        status: sale.status,
        soldBy: sale.soldBy?.fullName ?? null,
        customer: sale.customer?.name ?? null,
        lines: sale._count.items,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totals: {
        revenue: Number(aggregate._sum.grandTotal ?? 0),
        profit: Number(aggregate._sum.grandTotal ?? 0) - Number(aggregate._sum.costTotal ?? 0),
      },
    };
  });

  return jsonOk(data);
});

/** Encaissement d'une vente (détail ligne par ligne + FEFO). */
export const POST = handleRoute(async (request: NextRequest) => {
  const user = await requirePermission('sales.create');
  const input = await parseBody(request, saleCreateSchema);
  const sale = await createSale(user, input);
  return jsonOk(sale, { status: sale.replayed ? 200 : 201 });
});
