import { nextCounter, withTenant } from '@pharmaiq/db';
import { aiDailyLimit, aiQuotaKey, logger, type AiUsageKind } from '@pharmaiq/core';
import { TooManyRequestsError } from '../http';
import { toTenantContext, type SessionUser } from '../session';

/**
 * Plafond journalier d'appels IA par pharmacie.
 *
 * Chaque appel coûte de l'argent : sans plafond, un compte compromis ou un
 * script en boucle fait grimper la facture sans limite. Le compteur vit en base
 * (table `Counter`, incrément atomique) : il reste exact avec plusieurs
 * instances, contrairement à un compteur en mémoire.
 *
 * L'appel est compté AVANT d'être émis : un appel qui échoue consomme une
 * unité, ce qui évite qu'une boucle d'erreurs contourne le plafond.
 */
const ENV_BY_KIND: Record<AiUsageKind, string> = {
  assistant: 'AI_DAILY_LIMIT_ASSISTANT',
  receipt: 'AI_DAILY_LIMIT_RECEIPT',
  advice: 'AI_DAILY_LIMIT_ADVICE',
};

export async function consumeAiQuota(user: SessionUser, kind: AiUsageKind): Promise<void> {
  const ctx = toTenantContext(user);
  const limit = aiDailyLimit(kind, process.env[ENV_BY_KIND[kind]]);
  const used = await withTenant(ctx, (tx) => nextCounter(tx, ctx.pharmacyId, aiQuotaKey(kind)));

  if (used > limit) {
    logger.warn('quota IA journalier atteint', { pharmacyId: ctx.pharmacyId, kind, limit });
    throw new TooManyRequestsError(
      `Limite quotidienne atteinte pour cette fonction (${limit} par jour). Elle se réinitialise demain.`,
    );
  }
}
