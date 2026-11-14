import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { handleRoute, jsonOk, parseBody } from '@/lib/http';
import { acceptInvitation } from '@/lib/services/onboarding';
import { assertRateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z
  .object({
    token: z.string().min(10).max(200),
    password: z.string().min(8).max(200),
    fullName: z.string().trim().min(2).max(120).optional(),
  })
  .strict();

/** Acceptation d'une invitation : crée le compte et active l'employé. */
export const POST = handleRoute(async (request: NextRequest) => {
  // Freine la recherche d'un jeton d'invitation par essais successifs.
  assertRateLimit(request, 'accept-invite', { limit: 10, windowMs: 600_000 });
  const input = await parseBody(request, schema);
  const result = await acceptInvitation(input);
  return jsonOk(result);
});
