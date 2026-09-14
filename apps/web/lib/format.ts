import { formatMoney } from '@pharmaiq/core';

const LOCALE_TAGS: Record<string, string> = {
  fr: 'fr-DJ',
  so: 'so-DJ',
  ar: 'ar-DJ',
  en: 'en-DJ',
};

export function money(value: number, currency = 'DJF', locale = 'fr'): string {
  return formatMoney(value, currency, LOCALE_TAGS[locale] ?? 'fr-DJ');
}

export function shortDate(value: Date | string | null, locale = 'fr'): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale] ?? 'fr-DJ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function dateTime(value: Date | string | null, locale = 'fr'): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale] ?? 'fr-DJ', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

export function number(value: number, locale = 'fr'): string {
  return new Intl.NumberFormat(LOCALE_TAGS[locale] ?? 'fr-DJ').format(value);
}

/** Classe CSS de badge selon l'urgence d'une péremption. */
export function expiryTone(daysToExpiry: number | null): string {
  if (daysToExpiry === null) return 'bg-slate-100 text-slate-600';
  if (daysToExpiry < 0) return 'bg-red-100 text-red-800';
  if (daysToExpiry <= 7) return 'bg-red-50 text-red-700';
  if (daysToExpiry <= 30) return 'bg-amber-50 text-amber-700';
  return 'bg-emerald-50 text-emerald-700';
}
