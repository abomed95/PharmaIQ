import type { NextRequest } from 'next/server';
import { handleRoute, jsonOk, parseBody } from '@/lib/http';
import { requirePermission } from '@/lib/auth';
import { inviteSchema } from '@/lib/validation';
import { inviteEmployee } from '@/lib/services/onboarding';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Invitation d'un employé dans LA pharmacie de l'utilisateur connecté. */
export const POST = handleRoute(async (request: NextRequest) => {
  const user = await requirePermission('users.manage');
  const input = await parseBody(request, inviteSchema);
  const result = await inviteEmployee(user, input);
  return jsonOk(result, { status: 201 });
});
