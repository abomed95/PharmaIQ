import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Client Supabase avec la clé `service_role` — SERVEUR UNIQUEMENT.
 *
 * Réservé à : création de comptes à l'inscription, pose du claim
 * `app_metadata.pharmacy_id`, invitations, upload de reçus.
 * Cette clé contourne la RLS : ne jamais l'exposer au navigateur.
 */
let cached: SupabaseClient | null = null;

export function createSupabaseAdminClient(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error('Le client admin Supabase ne doit jamais être utilisé côté navigateur.');
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquante.');
  }
  if (!cached) {
    cached = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return cached;
}
