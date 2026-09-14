import { z } from 'zod';

/**
 * Schémas de validation des sorties IA.
 *
 * RÈGLE : aucune sortie de modèle n'entre en base sans passer par un de ces
 * schémas ET par une validation humaine à l'écran.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date attendue au format YYYY-MM-DD')
  .nullable();

export const ReceiptItemSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z.number().finite().positive().max(100_000),
  purchase_price: z.number().finite().nonnegative().max(10_000_000).nullable(),
  expiry_date: isoDate,
  batch_no: z.string().max(60).nullable().optional(),
});

export const ReceiptSchema = z.object({
  supplier: z.string().max(200).nullable(),
  invoice_ref: z.string().max(100).nullable(),
  date: isoDate,
  currency: z.string().max(10).nullable(),
  items: z.array(ReceiptItemSchema).max(300),
  confidence: z.number().min(0).max(1),
});

export type ReceiptItem = z.infer<typeof ReceiptItemSchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;

/** Schéma JSON équivalent, passé au modèle comme outil (sortie structurée). */
export const RECEIPT_TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    supplier: { type: ['string', 'null'], description: 'Nom du fournisseur tel qu\'écrit' },
    invoice_ref: { type: ['string', 'null'], description: 'Numéro de facture / bon de livraison' },
    date: { type: ['string', 'null'], description: 'Date du document, format YYYY-MM-DD' },
    currency: { type: ['string', 'null'], description: 'Devise si visible (ex. DJF)' },
    items: {
      type: 'array',
      description: 'Une entrée par ligne de produit du reçu',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nom du produit tel qu\'écrit sur le reçu' },
          quantity: { type: 'number', description: 'Quantité, sans séparateur de milliers' },
          purchase_price: {
            type: ['number', 'null'],
            description: "Prix d'achat UNITAIRE, sans séparateur de milliers. null si illisible.",
          },
          expiry_date: { type: ['string', 'null'], description: 'Péremption YYYY-MM-DD, sinon null' },
          batch_no: { type: ['string', 'null'], description: 'Numéro de lot si présent' },
        },
        required: ['name', 'quantity', 'purchase_price', 'expiry_date'],
      },
    },
    confidence: { type: 'number', description: 'Confiance globale entre 0 et 1' },
  },
  required: ['supplier', 'invoice_ref', 'date', 'currency', 'items', 'confidence'],
};

/** Mapping de colonnes assisté par IA pour l'import de catalogue (§8). */
export const ColumnMappingSchema = z.object({
  name: z.string().nullable(),
  category: z.string().nullable(),
  purchase_price: z.string().nullable(),
  selling_price: z.string().nullable(),
  quantity: z.string().nullable(),
  expiry_date: z.string().nullable(),
  barcode: z.string().nullable(),
  external_ref: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;

export const COLUMN_MAPPING_TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    name: { type: ['string', 'null'], description: 'Colonne contenant le nom du produit' },
    category: { type: ['string', 'null'] },
    purchase_price: { type: ['string', 'null'] },
    selling_price: { type: ['string', 'null'] },
    quantity: { type: ['string', 'null'] },
    expiry_date: { type: ['string', 'null'] },
    barcode: { type: ['string', 'null'] },
    external_ref: { type: ['string', 'null'], description: 'Identifiant produit du système source' },
    confidence: { type: 'number' },
  },
  required: [
    'name',
    'category',
    'purchase_price',
    'selling_price',
    'quantity',
    'expiry_date',
    'barcode',
    'external_ref',
    'confidence',
  ],
};
