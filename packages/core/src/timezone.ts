/**
 * Fuseaux horaires des pharmacies.
 *
 * « Aujourd'hui » dépend de la pharmacie, pas du serveur : à Djibouti (UTC+3),
 * la journée commence trois heures avant celle de la base en UTC.
 */

export const DEFAULT_TIME_ZONE = 'Africa/Djibouti';

/** Vrai si `value` est un fuseau IANA connu de l'environnement d'exécution. */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fuseau à passer à la base. Un nom invalide ferait échouer la requête SQL :
 * on retombe sur UTC plutôt que de casser le tableau de bord.
 */
export function safeTimeZone(value: unknown): string {
  return isValidTimeZone(value) ? value : 'UTC';
}
