'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Camera, Check, Loader2 } from 'lucide-react';
import { money } from '@/lib/format';
import type { Dictionary } from '@/lib/i18n';

/**
 * Photo de reçu → stock (§6.2).
 *
 * L'écran de vérification est OBLIGATOIRE : la sortie du modèle n'est qu'un
 * pré-remplissage. Rien n'est écrit en base avant le clic de validation.
 */

interface AnalyzedLine {
  rawName: string;
  quantity: number;
  purchasePrice: number | null;
  expiryDate: string | null;
  batchNo: string | null;
  knownPurchasePrice: number | null;
  match: { productId: string; name: string; score: number; decision: string } | null;
  decision: 'auto' | 'review' | 'new';
  alternatives: Array<{ productId: string; name: string; score: number }>;
  ok: boolean;
  warning: string | null;
}

interface Analysis {
  supplier: string | null;
  invoiceRef: string | null;
  date: string | null;
  confidence: number;
  lowConfidence: boolean;
  raw: unknown;
  lines: AnalyzedLine[];
}

interface EditableLine {
  rawName: string;
  productId: string | null;
  newProductName: string;
  quantity: number;
  purchasePrice: number;
  expiryDate: string;
  batchNo: string;
  keep: boolean;
  options: Array<{ productId: string; name: string; score: number }>;
  warning: string | null;
}

/** Réduit l'image avant l'envoi : réseau mobile + limite de 5 Mo de l'API. */
async function prepareImage(file: File, maxDim = 1600): Promise<{ base64: string; mediaType: string }> {
  const fallback = async () => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const [, base64 = ''] = dataUrl.split(',');
    return { base64, mediaType: file.type || 'image/jpeg' };
  };

  if (typeof createImageBitmap !== 'function') return fallback();

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return fallback();
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const [, base64 = ''] = dataUrl.split(',');
    return { base64, mediaType: 'image/jpeg' };
  } catch {
    return fallback();
  }
}

export function ReceiptImport({
  currency,
  locale,
  labels,
}: {
  currency: string;
  locale: string;
  labels: Dictionary['receipts'] & { common: Dictionary['common'] };
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [supplier, setSupplier] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [date, setDate] = useState('');
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ lots: number; created: number; total: number } | null>(null);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setDone(null);
    setStatus('analyzing');
    setPreview(URL.createObjectURL(file));

    try {
      const image = await prepareImage(file);
      const response = await fetch('/api/receipts/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: image.base64,
          mediaType: image.mediaType === 'image/png' ? 'image/png' : 'image/jpeg',
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error ?? labels.common.error);
        return;
      }

      const data = payload.data as Analysis;
      setAnalysis(data);
      setSupplier(data.supplier ?? '');
      setInvoiceRef(data.invoiceRef ?? '');
      setDate(data.date ?? '');
      setLines(
        data.lines.map((line) => ({
          rawName: line.rawName,
          productId: line.match?.productId ?? null,
          newProductName: line.match ? '' : line.rawName,
          quantity: Math.max(1, Math.round(line.quantity)),
          purchasePrice: line.purchasePrice ?? line.knownPurchasePrice ?? 0,
          expiryDate: line.expiryDate ?? '',
          batchNo: line.batchNo ?? '',
          keep: line.ok,
          options: [
            ...(line.match
              ? [{ productId: line.match.productId, name: line.match.name, score: line.match.score }]
              : []),
            ...line.alternatives,
          ],
          warning: line.warning,
        })),
      );
    } finally {
      setStatus('idle');
    }
  }

  function updateLine(index: number, patch: Partial<EditableLine>) {
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );
  }

  const kept = lines.filter((line) => line.keep);
  const total = kept.reduce((sum, line) => sum + line.quantity * line.purchasePrice, 0);

  async function confirm() {
    if (kept.length === 0) return;
    setStatus('saving');
    setError(null);

    try {
      const response = await fetch('/api/purchases/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierName: supplier || null,
          invoiceRef: invoiceRef || null,
          date: date || null,
          aiExtracted: true,
          aiConfidence: analysis?.confidence ?? null,
          aiRaw: analysis?.raw,
          items: kept.map((line) => ({
            productId: line.productId,
            newProductName: line.productId ? null : line.newProductName || line.rawName,
            rawName: line.rawName,
            quantity: line.quantity,
            purchasePrice: line.purchasePrice,
            batchNo: line.batchNo || null,
            expiryDate: line.expiryDate || null,
          })),
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error ?? labels.common.error);
        return;
      }

      setDone({
        lots: payload.data.updatedLots,
        created: payload.data.createdProducts,
        total: payload.data.total,
      });
      setAnalysis(null);
      setLines([]);
      setPreview(null);
      router.refresh();
    } finally {
      setStatus('idle');
    }
  }

  return (
    <div className="space-y-4">
      {/* Prise de photo */}
      <div className="card">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onFile}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="btn-primary w-full py-4 text-base"
          disabled={status !== 'idle'}
        >
          {status === 'analyzing' ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" /> {labels.analyzing}
            </>
          ) : (
            <>
              <Camera className="h-5 w-5" /> {labels.takePhoto}
            </>
          )}
        </button>
        <p className="mt-2 text-center text-xs text-slate-500">
          Facture imprimée ou manuscrite · français, arabe ou anglais
        </p>
      </div>

      {error ? (
        <div className="card border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
      ) : null}

      {done ? (
        <div className="card border-brand-200 bg-brand-50 text-sm text-brand-800">
          <p className="font-medium">Stock mis à jour</p>
          <p>
            {done.lots} lot(s) enregistré(s), {done.created} nouveau(x) produit(s), total{' '}
            {money(done.total, currency, locale)}.
          </p>
        </div>
      ) : null}

      {analysis ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
          {/* Photo à gauche */}
          <div className="space-y-3">
            <div className="card">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="Reçu photographié" className="w-full rounded-lg" />
              ) : null}
            </div>

            <div className="card space-y-3">
              <div>
                <label className="label" htmlFor="supplier">
                  Fournisseur
                </label>
                <input
                  id="supplier"
                  className="input"
                  value={supplier}
                  onChange={(event) => setSupplier(event.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="invoiceRef">
                  N° de facture
                </label>
                <input
                  id="invoiceRef"
                  className="input"
                  value={invoiceRef}
                  onChange={(event) => setInvoiceRef(event.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="date">
                  Date
                </label>
                <input
                  id="date"
                  type="date"
                  className="input"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </div>
              <p className="text-xs text-slate-500">
                Confiance de lecture : {Math.round(analysis.confidence * 100)} %
              </p>
            </div>
          </div>

          {/* Données extraites, éditables */}
          <div className="space-y-3">
            {analysis.lowConfidence ? (
              <div className="card flex items-start gap-2 border-amber-200 bg-amber-50 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{labels.lowConfidence}</p>
              </div>
            ) : (
              <p className="text-sm text-slate-600">{labels.verify}</p>
            )}

            <ul className="space-y-3">
              {lines.map((line, index) => (
                <li key={`${line.rawName}-${index}`} className="card space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{line.rawName}</p>
                      <p className="text-xs text-slate-500">
                        {line.productId ? (
                          <span className="text-brand-700">{labels.recognized}</span>
                        ) : (
                          <span className="text-amber-700">{labels.newProduct}</span>
                        )}
                      </p>
                    </div>
                    <label className="flex shrink-0 items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        className="h-5 w-5"
                        checked={line.keep}
                        onChange={(event) => updateLine(index, { keep: event.target.checked })}
                      />
                      Inclure
                    </label>
                  </div>

                  {line.warning ? (
                    <p className="flex items-center gap-1 text-xs text-amber-700">
                      <AlertTriangle className="h-3 w-3" /> {line.warning}
                    </p>
                  ) : null}

                  <div>
                    <label className="label">Produit du catalogue</label>
                    <select
                      className="input"
                      value={line.productId ?? ''}
                      onChange={(event) =>
                        updateLine(index, {
                          productId: event.target.value || null,
                          newProductName: event.target.value ? '' : line.rawName,
                        })
                      }
                    >
                      <option value="">➕ Créer un nouveau produit</option>
                      {line.options.map((option) => (
                        <option key={option.productId} value={option.productId}>
                          {option.name} ({Math.round(option.score * 100)} %)
                        </option>
                      ))}
                    </select>
                  </div>

                  {!line.productId ? (
                    <div>
                      <label className="label">Nom du nouveau produit</label>
                      <input
                        className="input"
                        value={line.newProductName}
                        onChange={(event) =>
                          updateLine(index, { newProductName: event.target.value })
                        }
                      />
                    </div>
                  ) : null}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">{labels.common.quantity}</label>
                      <input
                        type="number"
                        min={1}
                        inputMode="numeric"
                        className="input"
                        value={line.quantity}
                        onChange={(event) =>
                          updateLine(index, {
                            quantity: Math.max(1, Number(event.target.value) || 1),
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="label">Prix d’achat</label>
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        className="input"
                        value={line.purchasePrice}
                        onChange={(event) =>
                          updateLine(index, {
                            purchasePrice: Math.max(0, Number(event.target.value) || 0),
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="label">Péremption</label>
                      <input
                        type="date"
                        className="input"
                        value={line.expiryDate}
                        onChange={(event) => updateLine(index, { expiryDate: event.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label">N° de lot</label>
                      <input
                        className="input"
                        value={line.batchNo}
                        onChange={(event) => updateLine(index, { batchNo: event.target.value })}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="card sticky bottom-20 flex flex-wrap items-center justify-between gap-3 md:bottom-4">
              <div>
                <p className="text-sm text-slate-500">
                  {kept.length} ligne(s) · total {money(total, currency, locale)}
                </p>
              </div>
              <button
                type="button"
                onClick={confirm}
                className="btn-primary"
                disabled={kept.length === 0 || status !== 'idle'}
              >
                {status === 'saving' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {labels.confirmStock}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
