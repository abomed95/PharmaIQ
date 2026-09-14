import type { NextRequest } from 'next/server';
import { Prisma, withTenant, type TenantTx } from '@pharmaiq/db';
import { isPlausibleReceiptLine, matchProduct, type MatchCandidate } from '@pharmaiq/core';
import {
  LOW_CONFIDENCE_THRESHOLD,
  ReceiptExtractionError,
  extractReceipt,
  isAiConfigured,
} from '@pharmaiq/ai';
import { handleRoute, jsonError, jsonOk, parseBody } from '@/lib/http';
import { requirePermission, toTenantContext } from '@/lib/auth';
import { receiptAnalyzeSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Photo de reçu → lignes pré-remplies (§6.2, étapes 2 et 3).
 *
 * ⚠️ Cette route N'ÉCRIT RIEN en base. Elle prépare l'écran de vérification ;
 * seule `/api/purchases/confirm`, déclenchée par un humain, met à jour le stock.
 */

/** Candidats du catalogue pour un nom lu sur le reçu (index trigramme). */
async function findCandidates(
  tx: TenantTx,
  pharmacyId: string,
  rawName: string,
  fallback: MatchCandidate[] | null,
): Promise<{ candidates: MatchCandidate[]; fallback: MatchCandidate[] | null }> {
  if (fallback) return { candidates: fallback, fallback };

  try {
    const rows = await tx.$queryRaw<Array<{ id: string; name: string; dci: string | null; barcode: string | null }>>(
      Prisma.sql`
        select id, name, dci, barcode
        from "Product"
        where "pharmacyId" = ${pharmacyId}::uuid
          and "isActive" = true
          and (name % ${rawName} or coalesce(dci, '') % ${rawName})
        order by similarity(name, ${rawName}) desc
        limit 10
      `,
    );
    if (rows.length > 0) {
      return {
        candidates: rows.map((r) => ({
          productId: r.id,
          name: r.name,
          dci: r.dci,
          barcode: r.barcode,
        })),
        fallback: null,
      };
    }
  } catch {
    // pg_trgm absent : on bascule sur un chargement complet du catalogue.
  }

  const all = await tx.product.findMany({
    where: { pharmacyId, isActive: true },
    select: { id: true, name: true, dci: true, barcode: true },
    take: 5000,
  });
  const candidates = all.map((p) => ({
    productId: p.id,
    name: p.name,
    dci: p.dci,
    barcode: p.barcode,
  }));
  return { candidates, fallback: candidates };
}

export const POST = handleRoute(async (request: NextRequest) => {
  const user = await requirePermission('receipts.scan');

  if (!isAiConfigured()) {
    return jsonError(
      "Lecture automatique indisponible : ANTHROPIC_API_KEY n'est pas configurée. Saisis l'achat manuellement.",
      503,
    );
  }

  const input = await parseBody(request, receiptAnalyzeSchema);

  let extraction;
  try {
    extraction = await extractReceipt({
      image: { base64: input.imageBase64, mediaType: input.mediaType },
      hint: input.hint ?? `Devise probable : ${user.currency}. Pharmacie : ${user.pharmacyName}.`,
    });
  } catch (error) {
    if (error instanceof ReceiptExtractionError) {
      return jsonError(error.message, 422, { issues: error.issues });
    }
    throw error;
  }

  const ctx = toTenantContext(user);

  const lines = await withTenant(ctx, async (tx) => {
    let fallback: MatchCandidate[] | null = null;
    const out = [];

    for (const item of extraction.receipt.items) {
      const found = await findCandidates(tx, ctx.pharmacyId, item.name, fallback);
      fallback = found.fallback;

      const match = matchProduct(item.name, found.candidates);

      // Prix habituel : sert à signaler un écart suspect à l'employé.
      let knownPurchasePrice: number | null = null;
      if (match.candidate) {
        const product = await tx.product.findFirst({
          where: { id: match.candidate.productId, pharmacyId: ctx.pharmacyId },
          select: { purchasePrice: true },
        });
        knownPurchasePrice = product ? Number(product.purchasePrice) : null;
      }

      const plausibility = isPlausibleReceiptLine({
        quantity: item.quantity,
        purchasePrice: item.purchase_price,
        knownPurchasePrice,
      });

      out.push({
        rawName: item.name,
        quantity: item.quantity,
        purchasePrice: item.purchase_price,
        expiryDate: item.expiry_date,
        batchNo: item.batch_no ?? null,
        knownPurchasePrice,
        match: match.candidate
          ? {
              productId: match.candidate.productId,
              name: match.candidate.name,
              score: match.score,
              decision: match.decision,
            }
          : null,
        decision: match.decision,
        alternatives: match.alternatives.map((alt) => ({
          productId: alt.candidate.productId,
          name: alt.candidate.name,
          score: alt.score,
        })),
        ok: plausibility.ok,
        warning: plausibility.warning ?? null,
      });
    }

    return out;
  });

  return jsonOk({
    supplier: extraction.receipt.supplier,
    invoiceRef: extraction.receipt.invoice_ref,
    date: extraction.receipt.date,
    currency: extraction.receipt.currency,
    confidence: extraction.receipt.confidence,
    lowConfidence: extraction.receipt.confidence < LOW_CONFIDENCE_THRESHOLD,
    model: extraction.model,
    usage: extraction.usage,
    imageUrl: input.imageUrl ?? null,
    raw: extraction.raw,
    lines,
    // Rappel affiché par l'interface : rien n'est encore écrit en base.
    requiresHumanValidation: true,
  });
});
