import { ar, en, fr, so, type Dictionary } from './dictionaries';

export type Locale = 'fr' | 'so' | 'ar' | 'en';

export const LOCALES: Array<{ code: Locale; label: string; rtl: boolean }> = [
  { code: 'fr', label: 'Français', rtl: false },
  { code: 'so', label: 'Soomaali', rtl: false },
  { code: 'ar', label: 'العربية', rtl: true },
  { code: 'en', label: 'English', rtl: false },
];

export const DEFAULT_LOCALE: Locale =
  (process.env.NEXT_PUBLIC_DEFAULT_LOCALE as Locale | undefined) ?? 'fr';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && LOCALES.some((l) => l.code === value);
}

export function isRtl(locale: string): boolean {
  return LOCALES.find((l) => l.code === locale)?.rtl ?? false;
}

const OVERRIDES: Record<Locale, unknown> = { fr, so, ar, en };

/**
 * Fusionne la traduction demandée par-dessus le français.
 * Une clé absente reste lisible (en FR) au lieu d'afficher un identifiant brut.
 */
export function getDictionary(locale: string): Dictionary {
  if (!isLocale(locale) || locale === 'fr') return fr;
  const override = OVERRIDES[locale] as Record<string, Record<string, string>>;

  const merged = {} as Record<string, Record<string, string>>;
  for (const [section, values] of Object.entries(fr)) {
    merged[section] = { ...(values as Record<string, string>), ...(override[section] ?? {}) };
  }
  return merged as unknown as Dictionary;
}

export type { Dictionary };
