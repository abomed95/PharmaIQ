import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type TypeOf, type ZodTypeAny } from 'zod';
import { ForbiddenError, isSameOrigin, logger } from '@pharmaiq/core';
import { Prisma, TenantError } from '@pharmaiq/db';
import { UnauthorizedError } from './session';

/** Réponses JSON homogènes + traduction des erreurs métier en codes HTTP. */

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data }, init);
}

export function jsonError(
  message: string,
  status: number,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

export class ValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super('Données invalides');
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Introuvable') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Trop de requêtes, ou quota journalier atteint → HTTP 429. */
export class TooManyRequestsError extends Error {
  readonly retryAfterSeconds: number | null;
  constructor(message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'TooManyRequestsError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Corps de requête au-delà de la taille admise → HTTP 413. */
export class PayloadTooLargeError extends Error {
  constructor(message = 'Requête trop volumineuse') {
    super(message);
    this.name = 'PayloadTooLargeError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/**
 * Valide le corps JSON. Rejette tout champ inconnu si le schéma est strict.
 *
 * Le type de retour est le type de SORTIE du schéma (`TypeOf`) : un champ avec
 * `.default()` est optionnel à l'entrée mais garanti à la sortie.
 */
export async function parseBody<S extends ZodTypeAny>(
  request: NextRequest,
  schema: S,
): Promise<TypeOf<S>> {
  assertBodySize(request);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError(['Corps JSON illisible']);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  return parsed.data;
}

/**
 * Plus grande requête légitime : une photo de reçu de 5 Mo encodée en base64
 * (~6,7 Mo). Au-delà, on refuse AVANT de lire et de valider le corps, pour ne
 * pas laisser un envoi géant occuper la mémoire du serveur.
 */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

function assertBodySize(request: NextRequest): void {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new PayloadTooLargeError();
}

/**
 * Refuse une écriture émise depuis un autre site (CSRF). La session repose sur
 * des cookies : sans ce contrôle, une page tierce pourrait déclencher une
 * vente ou un ajustement de stock au nom de l'utilisateur connecté.
 */
function assertSameOrigin(request: NextRequest): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  let appHost: string | null = null;
  try {
    appHost = process.env.NEXT_PUBLIC_APP_URL ? new URL(process.env.NEXT_PUBLIC_APP_URL).host : null;
  } catch {
    appHost = null;
  }
  const allowed = [request.headers.get('x-forwarded-host'), request.headers.get('host'), appHost];
  if (!isSameOrigin(request.headers.get('origin'), allowed)) {
    throw new ForbiddenOriginError();
  }
}

class ForbiddenOriginError extends Error {
  constructor() {
    super('Origine de la requête refusée');
    this.name = 'ForbiddenOriginError';
  }
}

export function parseQuery<S extends ZodTypeAny>(request: NextRequest, schema: S): TypeOf<S> {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  return parsed.data;
}

/**
 * Erreurs Prisma qui traduisent une faute de l'appelant, pas une panne : sans
 * cette traduction, un doublon de nom ou un identifiant mal formé sortait en
 * 500 et polluait les journaux d'erreurs.
 */
function prismaErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // Contrainte d'unicité (nom de produit, clé d'idempotence…).
    if (error.code === 'P2002') return jsonError('Cet élément existe déjà', 409);
    // Enregistrement visé absent (ou invisible pour ce tenant).
    if (error.code === 'P2025') return jsonError('Introuvable', 404);
    // Référence vers un enregistrement inexistant.
    if (error.code === 'P2003') return jsonError('Référence invalide', 400);
    // Identifiant mal formé (UUID attendu).
    if (error.code === 'P2023') return jsonError('Identifiant invalide', 400);
  }
  return null;
}

/**
 * `params` est une promesse depuis Next 15. Son contenu est volontairement laissé souple : Next génère un type de contexte
 * différent pour une route statique et pour une route dynamique, et l'enveloppe
 * doit convenir aux deux.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteHandler = (request: NextRequest, context: { params: Promise<any> }) => Promise<Response>;

/**
 * Enveloppe chaque route : une erreur métier devient un code HTTP propre, et
 * une erreur inattendue ne fuit jamais de détail technique au client.
 */
export function handleRoute(handler: RouteHandler): RouteHandler {
  return async (request, context) => {
    try {
      assertSameOrigin(request);
      return await handler(request, context);
    } catch (error) {
      if (error instanceof ForbiddenOriginError) return jsonError(error.message, 403);
      if (error instanceof PayloadTooLargeError) return jsonError(error.message, 413);
      if (error instanceof TooManyRequestsError) {
        const response = jsonError(error.message, 429);
        if (error.retryAfterSeconds) response.headers.set('Retry-After', String(error.retryAfterSeconds));
        return response;
      }
      if (error instanceof UnauthorizedError) return jsonError(error.message, 401);
      if (error instanceof ForbiddenError) return jsonError(error.message, 403);
      if (error instanceof NotFoundError) return jsonError(error.message, 404);
      if (error instanceof ConflictError) return jsonError(error.message, 409);
      if (error instanceof ValidationError) {
        return jsonError(error.message, 422, { issues: error.issues });
      }
      if (error instanceof ZodError) {
        return jsonError('Données invalides', 422, {
          issues: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }
      if (error instanceof TenantError) return jsonError(error.message, 400);

      const known = prismaErrorResponse(error);
      if (known) return known;

      logger.error('api : erreur non gérée', {
        method: request.method,
        path: new URL(request.url).pathname,
        error,
      });
      return jsonError('Erreur interne', 500);
    }
  };
}

/** Comparaison à durée constante — évite de révéler le secret octet par octet. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Protège les routes cron (`Authorization: Bearer $CRON_SECRET`). */
export function assertCronAuthorized(request: NextRequest): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new UnauthorizedError('CRON_SECRET non configuré');
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!safeEqual(token, secret)) throw new UnauthorizedError('Jeton cron invalide');
}
