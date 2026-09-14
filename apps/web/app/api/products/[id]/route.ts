import type { NextRequest } from 'next/server';
import { withTenant } from '@pharmaiq/db';
import { NotFoundError, handleRoute, jsonOk, parseBody } from '@/lib/http';
import { requirePermission, toTenantContext } from '@/lib/auth';
import { productCreateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const updateSchema = productCreateSchema.partial();

/** Mise à jour d'un produit. Les changements de prix sont audités. */
export const PATCH = handleRoute(async (request: NextRequest, context) => {
  const user = await requirePermission('products.manage');
  const input = await parseBody(request, updateSchema);
  const ctx = toTenantContext(user);
  const productId = context.params.id;

  const updated = await withTenant(ctx, async (tx) => {
    const existing = await tx.product.findFirst({
      where: { id: productId, pharmacyId: ctx.pharmacyId },
      select: { id: true, sellingPrice: true, purchasePrice: true },
    });
    if (!existing) throw new NotFoundError('Produit introuvable');

    let categoryId: string | undefined;
    if (input.categoryName) {
      const category = await tx.category.upsert({
        where: { pharmacyId_name: { pharmacyId: ctx.pharmacyId, name: input.categoryName } },
        create: { pharmacyId: ctx.pharmacyId, name: input.categoryName },
        update: {},
        select: { id: true },
      });
      categoryId = category.id;
    }

    const product = await tx.product.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(categoryId !== undefined ? { categoryId } : {}),
        ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
        ...(input.dci !== undefined ? { dci: input.dci } : {}),
        ...(input.brand !== undefined ? { brand: input.brand } : {}),
        ...(input.supplierName !== undefined ? { supplierName: input.supplierName } : {}),
        ...(input.purchasePrice !== undefined ? { purchasePrice: input.purchasePrice } : {}),
        ...(input.sellingPrice !== undefined ? { sellingPrice: input.sellingPrice } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.reorderLevel !== undefined ? { reorderLevel: input.reorderLevel } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      select: { id: true, name: true, purchasePrice: true, sellingPrice: true },
    });

    const priceChanged =
      (input.sellingPrice !== undefined && Number(existing.sellingPrice) !== input.sellingPrice) ||
      (input.purchasePrice !== undefined && Number(existing.purchasePrice) !== input.purchasePrice);

    if (priceChanged) {
      await tx.auditLog.create({
        data: {
          pharmacyId: ctx.pharmacyId,
          userId: ctx.userId,
          action: 'product.price_changed',
          entity: 'Product',
          entityId: product.id,
          meta: {
            before: {
              purchasePrice: Number(existing.purchasePrice),
              sellingPrice: Number(existing.sellingPrice),
            },
            after: {
              purchasePrice: Number(product.purchasePrice),
              sellingPrice: Number(product.sellingPrice),
            },
          },
        },
      });
    }

    return product;
  });

  return jsonOk({
    id: updated.id,
    name: updated.name,
    purchasePrice: Number(updated.purchasePrice),
    sellingPrice: Number(updated.sellingPrice),
  });
});
