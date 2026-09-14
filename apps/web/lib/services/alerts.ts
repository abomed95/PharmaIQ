import { prismaAdmin, withTenant, type TenantContext } from '@pharmaiq/db';
import { buildDigest, expiryTier, parseAlertConfig } from '@pharmaiq/core';
import { readConfig, sendTemplate } from '@pharmaiq/whatsapp';
import { getStockAlerts } from '../analytics';

/**
 * Job quotidien d'alertes (§6.1).
 *
 * Énumérer les pharmacies exige de contourner la RLS (`prismaAdmin`), mais tout
 * le travail par pharmacie repart dans `withTenant()` : les lectures de stock
 * restent filtrées par la base, jamais par la seule bonne volonté du code.
 */

export interface PharmacyAlertOutcome {
  pharmacyId: string;
  pharmacyName: string;
  status: 'sent' | 'skipped' | 'failed';
  reason?: string;
  counts?: { outOfStock: number; lowStock: number; expiring: number };
}

export interface AlertRunResult {
  pharmacies: number;
  sent: number;
  skipped: number;
  failed: number;
  dryRun: boolean;
  outcomes: PharmacyAlertOutcome[];
}

/** Heure locale de la pharmacie (le cron tourne en UTC). */
function localHour(date: Date, timeZone: string): number {
  try {
    const value = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone,
    }).format(date);
    return Number(value) % 24;
  } catch {
    return date.getUTCHours();
  }
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function runStockAlerts(
  options: { pharmacyId?: string; force?: boolean; now?: Date } = {},
): Promise<AlertRunResult> {
  const now = options.now ?? new Date();
  const whatsappConfig = readConfig();
  const templateName = process.env.WHATSAPP_ALERT_TEMPLATE ?? 'pharmaiq_stock_digest';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';

  const pharmacies = await prismaAdmin.pharmacy.findMany({
    where: options.pharmacyId ? { id: options.pharmacyId } : {},
    select: {
      id: true,
      name: true,
      phoneWhatsapp: true,
      locale: true,
      timezone: true,
      alertConfig: true,
    },
  });

  const outcomes: PharmacyAlertOutcome[] = [];

  for (const pharmacy of pharmacies) {
    const config = parseAlertConfig(pharmacy.alertConfig);

    if (!config.enabled) {
      outcomes.push({
        pharmacyId: pharmacy.id,
        pharmacyName: pharmacy.name,
        status: 'skipped',
        reason: 'alertes désactivées',
      });
      continue;
    }

    if (!options.force && localHour(now, pharmacy.timezone) !== config.sendHour) {
      outcomes.push({
        pharmacyId: pharmacy.id,
        pharmacyName: pharmacy.name,
        status: 'skipped',
        reason: `hors créneau (${config.sendHour} h locale)`,
      });
      continue;
    }

    const ctx: TenantContext = {
      pharmacyId: pharmacy.id,
      userId: null,
      role: 'owner',
      branchId: null,
    };

    try {
      // Un seul envoi par jour, même si le cron est rejoué.
      if (!options.force) {
        const already = await prismaAdmin.alert.count({
          where: {
            pharmacyId: pharmacy.id,
            channel: 'whatsapp',
            status: 'sent',
            sentAt: { gte: startOfDay(now) },
          },
        });
        if (already > 0) {
          outcomes.push({
            pharmacyId: pharmacy.id,
            pharmacyName: pharmacy.name,
            status: 'skipped',
            reason: 'récapitulatif déjà envoyé aujourd’hui',
          });
          continue;
        }
      }

      const horizon = Math.max(...config.expiryDays);
      const alerts = await getStockAlerts(ctx, { expiryHorizonDays: horizon });

      const expiring = config.expiry
        ? alerts.expiring.filter((item) => expiryTier(item.daysToExpiry, config.expiryDays) !== null)
        : [];

      const digest = buildDigest({
        pharmacyName: pharmacy.name,
        outOfStock: config.outOfStock ? alerts.outOfStock : [],
        lowStock: config.lowStock ? alerts.lowStock : [],
        expiring,
        link: appUrl ? `${appUrl}/suggestions` : undefined,
        maxLines: config.maxLines,
      });

      if (digest.empty) {
        outcomes.push({
          pharmacyId: pharmacy.id,
          pharmacyName: pharmacy.name,
          status: 'skipped',
          reason: 'rien à signaler',
          counts: digest.counts,
        });
        continue;
      }

      const type =
        digest.counts.outOfStock > 0
          ? 'out_of_stock'
          : digest.counts.lowStock > 0
            ? 'low_stock'
            : 'expiry';

      let status: 'sent' | 'failed' | 'skipped' = 'skipped';
      let error: string | undefined;

      if (config.whatsapp && pharmacy.phoneWhatsapp) {
        const result = await sendTemplate(
          pharmacy.phoneWhatsapp,
          templateName,
          digest.templateParams,
          { languageCode: pharmacy.locale, config: whatsappConfig },
        );
        status = result.ok ? 'sent' : 'failed';
        error = result.error;
      } else {
        error = config.whatsapp ? 'numéro WhatsApp absent' : 'canal WhatsApp désactivé';
      }

      // Journalisation dans le tenant (la RLS s'applique).
      await withTenant(ctx, (tx) =>
        tx.alert.create({
          data: {
            pharmacyId: pharmacy.id,
            type,
            channel: config.whatsapp && pharmacy.phoneWhatsapp ? 'whatsapp' : 'in_app',
            message: digest.text,
            payload: {
              counts: digest.counts,
              outOfStock: alerts.outOfStock.slice(0, 50),
              lowStock: alerts.lowStock.slice(0, 50),
              expiring: expiring.slice(0, 50),
            },
            status: status === 'sent' ? 'sent' : status === 'failed' ? 'failed' : 'pending',
            error: error ?? null,
          },
        }),
      );

      outcomes.push({
        pharmacyId: pharmacy.id,
        pharmacyName: pharmacy.name,
        status: status === 'sent' ? 'sent' : status === 'failed' ? 'failed' : 'skipped',
        reason: error,
        counts: digest.counts,
      });
    } catch (err) {
      console.error('[alerts] échec pour la pharmacie', pharmacy.id, err);
      outcomes.push({
        pharmacyId: pharmacy.id,
        pharmacyName: pharmacy.name,
        status: 'failed',
        reason: err instanceof Error ? err.message : 'erreur inconnue',
      });
    }
  }

  return {
    pharmacies: pharmacies.length,
    sent: outcomes.filter((o) => o.status === 'sent').length,
    skipped: outcomes.filter((o) => o.status === 'skipped').length,
    failed: outcomes.filter((o) => o.status === 'failed').length,
    dryRun: whatsappConfig.dryRun,
    outcomes,
  };
}
