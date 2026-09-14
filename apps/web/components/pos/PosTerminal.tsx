'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Search, Trash2 } from 'lucide-react';
import { PAYMENT_METHODS, computeChange, computeTotals, round2 } from '@pharmaiq/core';
import { money } from '@/lib/format';
import type { Dictionary } from '@/lib/i18n';

/**
 * Caisse — objectif : moins de 10 secondes par vente.
 *
 * Recherche → tap → encaisser. Trois champs au maximum avant le bouton final.
 * Une `clientRef` est générée par vente : si le réseau coupe et que l'employé
 * réessaie, le serveur reconnaît le doublon et ne vend pas deux fois.
 */

interface ProductHit {
  id: string;
  name: string;
  sellingPrice: number;
  quantity: number;
  unit: string;
  lowStock: boolean;
}

interface CartLine {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  discount: number;
  stock: number;
}

interface Receipt {
  invoiceId: string;
  grandTotal: number;
  change: number;
  paymentMethod: string;
  items: Array<{ name: string; quantity: number; lineTotal: number }>;
}

export function PosTerminal({
  currency,
  locale,
  taxRate,
  labels,
  pharmacyName,
}: {
  currency: string;
  locale: string;
  taxRate: number;
  labels: Dictionary['pos'] & { common: Dictionary['common'] };
  pharmacyName: string;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState(0);
  const [paid, setPaid] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>(PAYMENT_METHODS[0]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Recherche différée : on ne matraque pas l'API à chaque frappe.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(
          `/api/products?q=${encodeURIComponent(term)}&inStock=1&pageSize=20`,
          { signal: controller.signal },
        );
        const payload = await response.json();
        setHits(response.ok ? (payload.data?.items ?? []) : []);
      } catch {
        /* requête annulée */
      } finally {
        setSearching(false);
      }
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const totals = useMemo(
    () =>
      computeTotals(
        cart.map((line) => ({
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: line.discount,
        })),
        { taxRate, globalDiscount: discount },
      ),
    [cart, discount, taxRate],
  );

  const paidValue = paid === '' ? totals.grandTotal : Number(paid) || 0;
  const { change, due } = computeChange(totals.grandTotal, paidValue);

  const addProduct = useCallback((product: ProductHit) => {
    setError(null);
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) {
        if (existing.quantity >= product.quantity) return current;
        return current.map((line) =>
          line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [
        ...current,
        {
          productId: product.id,
          name: product.name,
          unitPrice: product.sellingPrice,
          quantity: 1,
          discount: 0,
          stock: product.quantity,
        },
      ];
    });
    setQuery('');
    setHits([]);
    searchRef.current?.focus();
  }, []);

  function changeQuantity(productId: string, delta: number) {
    setCart((current) =>
      current
        .map((line) =>
          line.productId === productId
            ? { ...line, quantity: Math.min(line.stock, Math.max(0, line.quantity + delta)) }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  }

  function removeLine(productId: string) {
    setCart((current) => current.filter((line) => line.productId !== productId));
  }

  function reset() {
    setCart([]);
    setDiscount(0);
    setPaid('');
    setError(null);
  }

  async function checkout() {
    if (cart.length === 0) return;
    setPending(true);
    setError(null);

    const clientRef =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `pos-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      const response = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discount: line.discount,
          })),
          paymentMethod,
          discount,
          paid: paidValue,
          clientRef,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error ?? labels.common.error);
        return;
      }

      setReceipt({
        invoiceId: payload.data.invoiceId,
        grandTotal: payload.data.grandTotal,
        change: payload.data.change,
        paymentMethod: payload.data.paymentMethod,
        items: payload.data.items.map(
          (item: { name: string; quantity: number; lineTotal: number }) => ({
            name: item.name,
            quantity: item.quantity,
            lineTotal: item.lineTotal,
          }),
        ),
      });
      reset();
    } finally {
      setPending(false);
    }
  }

  async function shareReceipt() {
    if (!receipt) return;
    const text = [
      `${pharmacyName} — ${receipt.invoiceId}`,
      ...receipt.items.map(
        (item) => `${item.quantity} × ${item.name} = ${money(item.lineTotal, currency, locale)}`,
      ),
      `TOTAL : ${money(receipt.grandTotal, currency, locale)} (${receipt.paymentMethod})`,
    ].join('\n');

    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      await navigator.share({ title: receipt.invoiceId, text }).catch(() => undefined);
      return;
    }
    await navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      {/* Recherche + résultats */}
      <section className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchRef}
            className="input ps-10 text-lg"
            placeholder={labels.searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
            inputMode="search"
          />
        </div>

        {searching ? <p className="text-sm text-slate-400">{labels.common.loading}</p> : null}

        <ul className="space-y-2">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                onClick={() => addProduct(hit)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-start hover:border-brand-300 hover:bg-brand-50"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-900">{hit.name}</span>
                  <span className="text-xs text-slate-500">
                    {hit.quantity} {hit.unit} en stock
                    {hit.lowStock ? ' · stock bas' : ''}
                  </span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {money(hit.sellingPrice, currency, locale)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Panier */}
      <section className="space-y-3 lg:sticky lg:top-6 lg:self-start">
        <div className="card">
          <h2 className="mb-2 font-semibold">{labels.cart}</h2>

          {cart.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">{labels.emptyCart}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {cart.map((line) => (
                <li key={line.productId} className="py-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">{line.name}</p>
                    <button
                      type="button"
                      onClick={() => removeLine(line.productId)}
                      aria-label={`Retirer ${line.name}`}
                      className="p-1 text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => changeQuantity(line.productId, -1)}
                        className="btn-secondary min-h-touch min-w-touch px-2"
                        aria-label="Moins"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="w-10 text-center tabular-nums">{line.quantity}</span>
                      <button
                        type="button"
                        onClick={() => changeQuantity(line.productId, 1)}
                        className="btn-secondary min-h-touch min-w-touch px-2"
                        aria-label="Plus"
                        disabled={line.quantity >= line.stock}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <span className="font-semibold tabular-nums">
                      {money(round2(line.quantity * line.unitPrice - line.discount), currency, locale)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card space-y-3">
          <div>
            <label className="label" htmlFor="discount">
              {labels.discount}
            </label>
            <input
              id="discount"
              type="number"
              min={0}
              inputMode="numeric"
              className="input"
              value={discount || ''}
              onChange={(event) => setDiscount(Math.max(0, Number(event.target.value) || 0))}
            />
          </div>

          <div>
            <label className="label" htmlFor="paymentMethod">
              {labels.paymentMethod}
            </label>
            <select
              id="paymentMethod"
              className="input"
              value={paymentMethod}
              onChange={(event) => setPaymentMethod(event.target.value)}
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="paid">
              {labels.paid}
            </label>
            <input
              id="paid"
              type="number"
              min={0}
              inputMode="numeric"
              className="input"
              placeholder={String(Math.round(totals.grandTotal))}
              value={paid}
              onChange={(event) => setPaid(event.target.value)}
            />
          </div>

          <dl className="space-y-1 border-t border-slate-100 pt-3 text-sm">
            {taxRate > 0 ? (
              <div className="flex justify-between text-slate-500">
                <dt>
                  {labels.tax} ({taxRate} %)
                </dt>
                <dd className="tabular-nums">{money(totals.tax, currency, locale)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between text-base font-semibold">
              <dt>{labels.common.total}</dt>
              <dd className="tabular-nums">{money(totals.grandTotal, currency, locale)}</dd>
            </div>
            {change > 0 ? (
              <div className="flex justify-between text-brand-700">
                <dt>{labels.change}</dt>
                <dd className="tabular-nums">{money(change, currency, locale)}</dd>
              </div>
            ) : null}
            {due > 0 ? (
              <div className="flex justify-between text-amber-700">
                <dt>{labels.due}</dt>
                <dd className="tabular-nums">{money(due, currency, locale)}</dd>
              </div>
            ) : null}
          </dl>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <button
            type="button"
            onClick={checkout}
            disabled={cart.length === 0 || pending}
            className="btn-primary w-full py-3 text-base"
          >
            {pending ? labels.common.loading : labels.checkout}
          </button>
        </div>
      </section>

      {/* Ticket */}
      {receipt ? (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <div className="card w-full max-w-sm">
            <p className="text-center text-sm text-slate-500">{labels.saleDone}</p>
            <p className="mt-1 text-center text-lg font-semibold">{receipt.invoiceId}</p>

            <ul className="mt-4 space-y-1 text-sm">
              {receipt.items.map((item, index) => (
                <li key={`${item.name}-${index}`} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {item.quantity} × {item.name}
                  </span>
                  <span className="tabular-nums">{money(item.lineTotal, currency, locale)}</span>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex justify-between border-t border-slate-100 pt-3 font-semibold">
              <span>{labels.common.total}</span>
              <span className="tabular-nums">{money(receipt.grandTotal, currency, locale)}</span>
            </div>
            {receipt.change > 0 ? (
              <div className="flex justify-between text-brand-700">
                <span>{labels.change}</span>
                <span className="tabular-nums">{money(receipt.change, currency, locale)}</span>
              </div>
            ) : null}

            <div className="mt-4 flex gap-2">
              <button type="button" onClick={shareReceipt} className="btn-secondary flex-1">
                {labels.receipt}
              </button>
              <button
                type="button"
                onClick={() => {
                  setReceipt(null);
                  searchRef.current?.focus();
                }}
                className="btn-primary flex-1"
              >
                Vente suivante
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
