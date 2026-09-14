import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { withTenant } from '@pharmaiq/db';
import { handleRoute, jsonOk, parseBody, parseQuery } from '@/lib/http';
import { requirePermission, toTenantContext } from '@/lib/auth';
import { productCreateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  inStock: z.enum(['0', '1']).optional(),
});

/** Catalogue de la pharmacie, avec stock agrégé. */
export const GET = handleRoute(async (request: NextRequest) => {
  const user = await requirePermission('products.view');
  const query = parseQuery(request, querySchema);
  const ctx = toTenantContext(user);

  const where = {
    pharmacyId: ctx.pharmacyId,
    isActive: true,
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' as const } },
            { dci: { contains: query.q, mode: 'insensitive' as const } },
            { barcode: { equals: query.q } },
          ],
        }
      : {}),
    ...(query.category ? { category: { name: query.category } } : {}),
  };

  const result = await withTenant(ctx, async (tx) => {
    const [items, total] = await Promise.all([
      tx.product.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          name: true,
          barcode: true,
          dci: true,
          unit: true,
          purchasePrice: true,
          sellingPrice: true,
          reorderLevel: true,
          category: { select: { name: true } },
          stock: { select: { quantity: true, expiryDate: true } },
        },
      }),
      tx.product.count({ where }),
    ]);

    return {
      items: items.map((product) => {
        const quantity = product.stock.reduce((sum, lot) => sum + lot.quantity, 0);
        const expiries = product.stock
          .filter((lot) => lot.quantity > 0 && lot.expiryDate)
          .map((lot) => lot.expiryDate as Date)
          .sort((a, b) => a.getTime() - b.getTime());
        return {
          id: product.id,
          name: product.name,
          barcode: product.barcode,
          dci: product.dci,
          unit: product.unit,
          purchasePrice: Number(product.purchasePrice),
          sellingPrice: Number(product.sellingPrice),
          reorderLevel: product.reorderLevel,
          category: product.category?.name ?? null,
          quantity,
          nearestExpiry: expiries[0] ?? null,
          lowStock: quantity <= product.reorderLevel,
        };
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  });

  const items = query.inStock === '1' ? result.items.filter((p) => p.quantity > 0) : result.items;
  return jsonOk({ ...result, items });
});

/** Création d'un produit. La catégorie est créée à la volée si besoin. */
export const POST = handleRoute(async (request: NextRequest) => {
  const user = await requirePermission('products.manage');
  const input = await parseBody(request, productCreateSchema);
  const ctx = toTenantContext(user);

  const product = await withTenant(ctx, async (tx) => {
    let categoryId: string | null = null;
    if (input.categoryName) {
      const category = await tx.category.upsert({
        where: { pharmacyId_name: { pharmacyId: ctx.pharmacyId, name: input.categoryName } },
        create: { pharmacyId: ctx.pharmacyId, name: input.categoryName },
        update: {},
        select: { id: true },
      });
      categoryId = category.id;
    }

    return tx.product.create({
      data: {
        pharmacyId: ctx.pharmacyId,
        name: input.name,
        categoryId,
        barcode: input.barcode ?? null,
        dci: input.dci ?? null,
        brand: input.brand ?? null,
        supplierName: input.supplierName ?? null,
        purchasePrice: input.purchasePrice,
        sellingPrice: input.sellingPrice,
        unit: input.unit,
        reorderLevel: input.reorderLevel,
        isActive: input.isActive,
      },
      select: { id: true, name: true },
    });
  });

  return jsonOk(product, { status: 201 });
});
