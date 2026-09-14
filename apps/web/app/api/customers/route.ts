import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { withTenant } from '@pharmaiq/db';
import { handleRoute, jsonOk, parseBody, parseQuery } from '@/lib/http';
import { requirePermission, toTenantContext } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const createSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(30).optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .strict();

export const GET = handleRoute(async (request: NextRequest) => {
  const user = await requirePermission('customers.manage');
  const query = parseQuery(request, querySchema);
  const ctx = toTenantContext(user);

  const customers = await withTenant(ctx, (tx) =>
    tx.customer.findMany({
      where: {
        pharmacyId: ctx.pharmacyId,
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' as const } },
                { phone: { contains: query.q } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      take: query.limit,
      select: { id: true, name: true, phone: true, loyaltyPoints: true },
    }),
  );

  return jsonOk(customers);
});

export const POST = handleRoute(async (request: NextRequest) => {
  const user = await requirePermission('customers.manage');
  const input = await parseBody(request, createSchema);
  const ctx = toTenantContext(user);

  const customer = await withTenant(ctx, (tx) =>
    tx.customer.create({
      data: {
        pharmacyId: ctx.pharmacyId,
        name: input.name,
        phone: input.phone ?? null,
        notes: input.notes ?? null,
      },
      select: { id: true, name: true, phone: true, loyaltyPoints: true },
    }),
  );

  return jsonOk(customer, { status: 201 });
});
