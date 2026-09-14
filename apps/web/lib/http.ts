import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodSchema } from 'zod';
import { ForbiddenError } from '@pharmaiq/core';
import { TenantError } from '@pharmaiq/db';
import { UnauthorizedError } from './auth';

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

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** Valide le corps JSON. Rejette tout champ inconnu si le schéma est strict. */
export async function parseBody<T>(request: NextRequest, schema: ZodSchema<T>): Promise<T> {
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

export function parseQuery<T>(request: NextRequest, schema: ZodSchema<T>): T {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  return parsed.data;
}

type RouteHandler = (request: NextRequest, context: { params: Record<string, string> }) => Promise<Response>;

/**
 * Enveloppe chaque route : une erreur métier devient un code HTTP propre, et
 * une erreur inattendue ne fuit jamais de détail technique au client.
 */
export function handleRoute(handler: RouteHandler): RouteHandler {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
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

      console.error('[api] erreur non gérée', error);
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
