import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { withTenant } from '@pharmaiq/db';
import { parseAlertConfig } from '@pharmaiq/core';
import { isValidPhone } from '@pharmaiq/whatsapp';
import { ValidationError, handleRoute, jsonOk, parseBody } from '@/lib/http';
import { requirePermission, toTenantContext } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    city: z.string().trim().max(80).nullable().optional(),
    currency: z.string().trim().min(2).max(5).optional(),
    locale: z.enum(['fr', 'so', 'ar', 'en']).optional(),
    timezone: z.string().trim().max(60).optional(),
    invoicePrefix: z.string().trim().min(1).max(8).optional(),
    taxRate: z.coerce.number().min(0).max(100).optional(),
    phoneWhatsapp: z.string().trim().max(30).nullable().optional(),
    alertConfig: z
      .object({
        enabled: z.boolean().optional(),
        whatsapp: z.boolean().optional(),
        inApp: z.boolean().optional(),
        sendHour: z.coerce.number().int().min(0).max(23).optional(),
        lowStock: z.boolean().optional(),
        outOfStock: z.boolean().optional(),
        expiry: z.boolean().optional(),
        expiryDays: z.array(z.coerce.number().int().min(1).max(365)).min(1).max(5).optional(),
        maxLines: z.coerce.number().int().min(1).max(30).optional(),
      })
      .optional(),
  })
  .strict();

/** Paramètres de la pharmacie + configuration des alertes. */
export const PATCH = handleRoute(async (request: NextRequest) => {
  const user = await requirePermission('settings.manage');
  const input = await parseBody(request, schema);
  const ctx = toTenantContext(user);

  if (input.phoneWhatsapp && !isValidPhone(input.phoneWhatsapp)) {
    throw new ValidationError(['Numéro WhatsApp invalide']);
  }

  const updated = await withTenant(ctx, async (tx) => {
    const current = await tx.pharmacy.findFirstOrThrow({
      where: { id: ctx.pharmacyId },
      select: { alertConfig: true },
    });

    // Fusion : on ne perd pas les réglages absents du formulaire.
    const alertConfig = input.alertConfig
      ? parseAlertConfig({ ...parseAlertConfig(current.alertConfig), ...input.alertConfig })
      : undefined;

    return tx.pharmacy.update({
      where: { id: ctx.pharmacyId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.locale !== undefined ? { locale: input.locale } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.invoicePrefix !== undefined ? { invoicePrefix: input.invoicePrefix } : {}),
        ...(input.taxRate !== undefined ? { taxRate: input.taxRate } : {}),
        ...(input.phoneWhatsapp !== undefined ? { phoneWhatsapp: input.phoneWhatsapp } : {}),
        ...(alertConfig ? { alertConfig } : {}),
      },
      select: {
        name: true,
        currency: true,
        locale: true,
        invoicePrefix: true,
        taxRate: true,
        phoneWhatsapp: true,
        alertConfig: true,
      },
    });
  });

  await withTenant(ctx, (tx) =>
    tx.auditLog.create({
      data: {
        pharmacyId: ctx.pharmacyId,
        userId: ctx.userId,
        action: 'settings.updated',
        entity: 'Pharmacy',
        entityId: ctx.pharmacyId,
        meta: { fields: Object.keys(input) },
      },
    }),
  );

  return jsonOk({ ...updated, taxRate: Number(updated.taxRate) });
});
