import { z } from 'zod';
import { PAYMENT_METHODS } from '@pharmaiq/core';

/**
 * Schémas d'entrée des routes API.
 *
 * ⚠️ Aucun schéma n'accepte `pharmacyId` : le tenant vient TOUJOURS de la
 * session serveur. Un client qui tenterait de l'envoyer verrait son champ
 * ignoré (voire rejeté par `.strict()`).
 */

export const uuid = z.string().uuid();

/**
 * URL web uniquement. `z.string().url()` accepte aussi `javascript:` ou
 * `data:`, qui deviendraient exécutables le jour où l'URL est affichée en lien.
 */
export const httpUrl = z
  .string()
  .url()
  .max(2000)
  .refine((value) => /^https?:\/\//i.test(value), 'URL http(s) attendue');

/** 5 Mo d'image (limite de l'API) encodés en base64, avec un peu de marge. */
const MAX_IMAGE_BASE64_CHARS = 7_200_000;
/** La sortie brute du modèle est gardée pour audit, pas pour stocker n'importe quoi. */
const MAX_AI_RAW_CHARS = 200_000;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// --- Produits ----------------------------------------------------------------

export const productCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    categoryName: z.string().trim().max(100).optional().nullable(),
    barcode: z.string().trim().max(60).optional().nullable(),
    dci: z.string().trim().max(200).optional().nullable(),
    brand: z.string().trim().max(120).optional().nullable(),
    supplierName: z.string().trim().max(120).optional().nullable(),
    purchasePrice: z.coerce.number().min(0).max(10_000_000).default(0),
    sellingPrice: z.coerce.number().min(0).max(10_000_000).default(0),
    unit: z.string().trim().max(40).default('boîte'),
    reorderLevel: z.coerce.number().int().min(0).max(100_000).default(10),
    isActive: z.boolean().default(true),
  })
  .strict();

export const productUpdateSchema = productCreateSchema.partial().extend({ id: uuid }).strict();

// --- Stock -------------------------------------------------------------------

export const stockAdjustSchema = z
  .object({
    productId: uuid,
    branchId: uuid.optional(),
    /** Positif = entrée, négatif = sortie. */
    quantityDelta: z.coerce
      .number()
      .int()
      .min(-100_000)
      .max(100_000)
      .refine((n) => n !== 0, 'La quantité ne peut pas être nulle'),
    batchNo: z.string().trim().max(60).optional().nullable(),
    expiryDate: z.coerce.date().optional().nullable(),
    purchasePrice: z.coerce.number().min(0).max(10_000_000).optional(),
    reason: z.string().trim().max(200),
    type: z.enum(['adjustment', 'return', 'expiry', 'purchase']).default('adjustment'),
  })
  .strict();

// --- Caisse ------------------------------------------------------------------

export const saleItemSchema = z
  .object({
    productId: uuid,
    quantity: z.coerce.number().int().min(1).max(10_000),
    unitPrice: z.coerce.number().min(0).max(10_000_000),
    discount: z.coerce.number().min(0).max(10_000_000).default(0),
  })
  .strict();

export const saleCreateSchema = z
  .object({
    items: z.array(saleItemSchema).min(1).max(200),
    paymentMethod: z.enum(PAYMENT_METHODS),
    /** Remise globale en montant. */
    discount: z.coerce.number().min(0).max(1_000_000_000).default(0),
    paid: z.coerce.number().min(0).max(1_000_000_000).default(0),
    customerId: uuid.optional().nullable(),
    branchId: uuid.optional().nullable(),
    note: z.string().trim().max(300).optional().nullable(),
    /** Clé d'idempotence : évite la double vente si le réseau coupe. */
    clientRef: z.string().trim().min(6).max(80).optional(),
  })
  .strict();

// --- Reçus / achats ----------------------------------------------------------

export const receiptAnalyzeSchema = z
  .object({
    /** Image encodée en base64 (sans le préfixe data:). */
    imageBase64: z.string().min(100).max(MAX_IMAGE_BASE64_CHARS),
    mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    imageUrl: httpUrl.optional(),
    hint: z.string().trim().max(300).optional(),
  })
  .strict();

export const purchaseConfirmItemSchema = z
  .object({
    /** Produit existant… */
    productId: uuid.optional().nullable(),
    /** …ou création d'un nouveau produit à partir de la ligne du reçu. */
    newProductName: z.string().trim().min(2).max(200).optional().nullable(),
    rawName: z.string().trim().max(200).optional().nullable(),
    quantity: z.coerce.number().int().min(1).max(100_000),
    purchasePrice: z.coerce.number().min(0).max(10_000_000),
    sellingPrice: z.coerce.number().min(0).max(10_000_000).optional().nullable(),
    batchNo: z.string().trim().max(60).optional().nullable(),
    expiryDate: z.coerce.date().optional().nullable(),
  })
  .strict()
  .refine((item) => Boolean(item.productId || item.newProductName), {
    message: 'Chaque ligne doit viser un produit existant ou nommer un nouveau produit',
  });

export const purchaseConfirmSchema = z
  .object({
    supplierName: z.string().trim().max(200).optional().nullable(),
    invoiceRef: z.string().trim().max(100).optional().nullable(),
    date: z.coerce.date().optional().nullable(),
    branchId: uuid.optional().nullable(),
    receiptImageUrl: httpUrl.optional().nullable(),
    aiExtracted: z.boolean().default(false),
    aiConfidence: z.coerce.number().min(0).max(1).optional().nullable(),
    aiRaw: z
      .unknown()
      .optional()
      .refine(
        (value) => value === undefined || JSON.stringify(value).length <= MAX_AI_RAW_CHARS,
        'Sortie brute du modèle trop volumineuse',
      ),
    items: z.array(purchaseConfirmItemSchema).min(1).max(300),
    /** Clé d'idempotence : évite la double entrée en stock si le réseau coupe. */
    clientRef: z.string().trim().min(6).max(80).optional(),
  })
  .strict();

// --- Divers ------------------------------------------------------------------

export const assistantSchema = z
  .object({
    question: z.string().trim().min(2).max(1000),
    history: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string().max(4000),
        }),
      )
      .max(10)
      .optional(),
  })
  .strict();

export const suggestionsQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(90),
  horizon: z.coerce.number().int().min(7).max(180).default(30),
  explain: z.enum(['0', '1']).default('0'),
});

export const signupPharmacySchema = z
  .object({
    pharmacyName: z.string().trim().min(2).max(120),
    city: z.string().trim().max(80).optional().nullable(),
    phoneWhatsapp: z.string().trim().max(30).optional().nullable(),
    currency: z.string().trim().max(5).default('DJF'),
    locale: z.enum(['fr', 'so', 'ar', 'en']).default('fr'),
    ownerName: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(180),
    password: z.string().min(8).max(200),
  })
  .strict();

export const inviteSchema = z
  .object({
    email: z.string().trim().email().max(180),
    fullName: z.string().trim().min(2).max(120),
    role: z.enum(['admin', 'pharmacist', 'cashier', 'stock_manager']),
    branchId: uuid.optional().nullable(),
  })
  .strict();
