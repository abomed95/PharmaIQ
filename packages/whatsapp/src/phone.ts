/**
 * Normalisation des numéros au format attendu par l'API Meta (E.164 sans « + »).
 *
 * Contexte Djibouti : indicatif 253, mobiles à 8 chiffres commençant par 77.
 * Les pharmacies saisissent indifféremment « 77 12 34 56 », « 0077123456 »,
 * « +253 77 12 34 56 ».
 */

export const DEFAULT_COUNTRY_CODE = '253';

export function normalizePhone(input: string, countryCode = DEFAULT_COUNTRY_CODE): string | null {
  const digits = input.replace(/\D/g, '');
  if (!digits) return null;

  // Préfixe international explicite : 00...
  let value = digits.startsWith('00') ? digits.slice(2) : digits;

  // Numéro local (8 chiffres à Djibouti) → on préfixe l'indicatif pays.
  if (value.length <= 9 && !value.startsWith(countryCode)) {
    value = `${countryCode}${value.replace(/^0+/, '')}`;
  }

  if (value.length < 8 || value.length > 15) return null;
  return value;
}

export function isValidPhone(input: string | null | undefined, countryCode = DEFAULT_COUNTRY_CODE): boolean {
  if (!input) return false;
  return normalizePhone(input, countryCode) !== null;
}

/** Masque pour les journaux : `253771***56`. */
export function maskPhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length < 6) return '***';
  return `${digits.slice(0, 6)}***${digits.slice(-2)}`;
}
