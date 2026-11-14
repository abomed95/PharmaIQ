import type { NextRequest } from 'next/server';
import { handleRoute, jsonOk, parseBody } from '@/lib/http';
import { signupPharmacySchema } from '@/lib/validation';
import { signupPharmacy } from '@/lib/services/onboarding';
import { assertRateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Création d'une pharmacie (tenant) et de son compte propriétaire. */
export const POST = handleRoute(async (request: NextRequest) => {
  // Route publique qui crée un tenant : 5 inscriptions par heure et par adresse.
  assertRateLimit(request, 'signup', { limit: 5, windowMs: 3_600_000 });
  const input = await parseBody(request, signupPharmacySchema);
  const result = await signupPharmacy(input);
  return jsonOk(result, { status: 201 });
});
