import { maskPhone, normalizePhone } from './phone';

/**
 * Client WhatsApp Business Cloud API (Meta).
 *
 * Deux modes :
 *  - `template` : obligatoire pour initier une conversation hors fenêtre de 24 h
 *    (le template doit être approuvé par Meta) — c'est le cas des alertes cron ;
 *  - `text` : possible uniquement si la pharmacie a écrit dans les 24 h.
 *
 * `WHATSAPP_DRY_RUN=true` (défaut en dev) : rien n'est envoyé, l'appel est
 * journalisé et considéré comme réussi. Cela permet de développer et de tester
 * le cron sans compte Meta.
 */

export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  apiVersion: string;
  dryRun: boolean;
}

export interface SendResult {
  ok: boolean;
  dryRun: boolean;
  messageId?: string;
  error?: string;
  /** Code d'erreur Meta, utile pour distinguer template non approuvé / numéro invalide. */
  errorCode?: number;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): WhatsAppConfig {
  const dryRun =
    env.WHATSAPP_DRY_RUN === 'true' || !env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID;
  return {
    token: env.WHATSAPP_TOKEN ?? '',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    apiVersion: env.WHATSAPP_API_VERSION ?? 'v21.0',
    dryRun,
  };
}

function endpoint(config: WhatsAppConfig): string {
  return `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;
}

async function post(config: WhatsAppConfig, payload: unknown, to: string): Promise<SendResult> {
  if (config.dryRun) {
    console.info('[whatsapp:dry-run] →', maskPhone(to), JSON.stringify(payload).slice(0, 500));
    return { ok: true, dryRun: true, messageId: `dry-${Date.now()}` };
  }

  try {
    const response = await fetch(endpoint(config), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const body = (await response.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>;
      error?: { message?: string; code?: number };
    };

    if (!response.ok) {
      return {
        ok: false,
        dryRun: false,
        error: body.error?.message ?? `HTTP ${response.status}`,
        errorCode: body.error?.code,
      };
    }

    return { ok: true, dryRun: false, messageId: body.messages?.[0]?.id };
  } catch (error) {
    return {
      ok: false,
      dryRun: false,
      error: error instanceof Error ? error.message : 'Erreur réseau inconnue',
    };
  }
}

/**
 * Envoie un template approuvé. `params` remplit {{1}}, {{2}}… du corps, dans
 * l'ordre — voir `buildDigest().templateParams` dans @pharmaiq/core.
 */
export async function sendTemplate(
  to: string,
  templateName: string,
  params: string[],
  options: { languageCode?: string; config?: WhatsAppConfig } = {},
): Promise<SendResult> {
  const config = options.config ?? readConfig();
  const normalized = normalizePhone(to);
  if (!normalized) return { ok: false, dryRun: config.dryRun, error: 'Numéro WhatsApp invalide' };

  return post(
    config,
    {
      messaging_product: 'whatsapp',
      to: normalized,
      type: 'template',
      template: {
        name: templateName,
        language: { code: options.languageCode ?? 'fr' },
        components: params.length
          ? [
              {
                type: 'body',
                parameters: params.map((text) => ({
                  type: 'text',
                  // Meta refuse les sauts de ligne dans les paramètres.
                  text: text.replace(/\s*\n\s*/g, ' ').slice(0, 1024) || '-',
                })),
              },
            ]
          : [],
      },
    },
    normalized,
  );
}

/** Message libre — uniquement dans la fenêtre de 24 h après un message entrant. */
export async function sendText(
  to: string,
  body: string,
  options: { config?: WhatsAppConfig } = {},
): Promise<SendResult> {
  const config = options.config ?? readConfig();
  const normalized = normalizePhone(to);
  if (!normalized) return { ok: false, dryRun: config.dryRun, error: 'Numéro WhatsApp invalide' };

  return post(
    config,
    {
      messaging_product: 'whatsapp',
      to: normalized,
      type: 'text',
      text: { preview_url: true, body: body.slice(0, 4096) },
    },
    normalized,
  );
}
