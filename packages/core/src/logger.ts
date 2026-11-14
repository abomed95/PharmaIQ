/**
 * Journalisation structurée : une ligne JSON par événement.
 *
 * Les champs `severity`, `message` et `time` sont ceux que Google Cloud Logging
 * (et la plupart des collecteurs) reconnaissent sans configuration : un filtre
 * sur la gravité ou sur `pharmacyId` devient possible, ce qu'un texte libre ne
 * permet pas.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

const SEVERITY: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
};

/** Une `Error` sérialisée par JSON.stringify donne `{}` : on l'aplatit. */
function serializeError(error: Error): LogFields {
  return { name: error.name, message: error.message, stack: error.stack };
}

function normalize(value: unknown): unknown {
  if (value instanceof Error) return serializeError(value);
  // Les montants Prisma (Decimal) et les BigInt feraient échouer la sérialisation.
  if (typeof value === 'bigint') return value.toString();
  return value;
}

/** Construit la ligne de journal. Pure — c'est elle que les tests vérifient. */
export function formatLogEntry(
  level: LogLevel,
  message: string,
  fields: LogFields = {},
  now: Date = new Date(),
): string {
  const entry: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    entry[key] = normalize(value);
  }
  // Posés en dernier : un champ métier ne peut pas écraser la gravité.
  entry.severity = SEVERITY[level];
  entry.message = message;
  entry.time = now.toISOString();

  try {
    return JSON.stringify(entry);
  } catch {
    // Référence circulaire : on garde au moins le message.
    return JSON.stringify({ severity: SEVERITY[level], message, time: entry.time });
  }
}

function write(level: LogLevel, message: string, fields?: LogFields): void {
  const line = formatLogEntry(level, message, fields);
  // stderr pour les erreurs et avertissements, stdout pour le reste.
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, fields?: LogFields) => write('debug', message, fields),
  info: (message: string, fields?: LogFields) => write('info', message, fields),
  warn: (message: string, fields?: LogFields) => write('warn', message, fields),
  error: (message: string, fields?: LogFields) => write('error', message, fields),
};
