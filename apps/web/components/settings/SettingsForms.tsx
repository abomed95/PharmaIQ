'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AlertConfig } from '@pharmaiq/core';

/** Formulaires de paramétrage : pharmacie, alertes WhatsApp, invitation. */

export function PharmacySettingsForm({
  initial,
}: {
  initial: {
    name: string;
    city: string;
    invoicePrefix: string;
    taxRate: number;
    phoneWhatsapp: string;
    locale: string;
  };
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setState('saving');
    setError(null);

    const response = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        city: form.city || null,
        invoicePrefix: form.invoicePrefix,
        taxRate: form.taxRate,
        phoneWhatsapp: form.phoneWhatsapp || null,
        locale: form.locale as 'fr' | 'so' | 'ar' | 'en',
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? 'Enregistrement impossible');
      setState('idle');
      return;
    }

    setState('saved');
    router.refresh();
  }

  return (
    <form onSubmit={save} className="card space-y-3">
      <h2 className="font-semibold">Pharmacie</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="name">
            Nom
          </label>
          <input
            id="name"
            className="input"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="city">
            Ville
          </label>
          <input
            id="city"
            className="input"
            value={form.city}
            onChange={(event) => setForm({ ...form, city: event.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="invoicePrefix">
            Préfixe des factures
          </label>
          <input
            id="invoicePrefix"
            className="input"
            maxLength={8}
            value={form.invoicePrefix}
            onChange={(event) => setForm({ ...form, invoicePrefix: event.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="taxRate">
            Taxe par défaut (%)
          </label>
          <input
            id="taxRate"
            type="number"
            min={0}
            max={100}
            step="0.01"
            className="input"
            value={form.taxRate}
            onChange={(event) => setForm({ ...form, taxRate: Number(event.target.value) || 0 })}
          />
        </div>
        <div>
          <label className="label" htmlFor="phoneWhatsapp">
            Numéro WhatsApp des alertes
          </label>
          <input
            id="phoneWhatsapp"
            inputMode="tel"
            className="input"
            value={form.phoneWhatsapp}
            onChange={(event) => setForm({ ...form, phoneWhatsapp: event.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="locale">
            Langue
          </label>
          <select
            id="locale"
            className="input"
            value={form.locale}
            onChange={(event) => setForm({ ...form, locale: event.target.value })}
          >
            <option value="fr">Français</option>
            <option value="so">Soomaali</option>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button type="submit" className="btn-primary" disabled={state === 'saving'}>
        {state === 'saving' ? 'Enregistrement…' : state === 'saved' ? 'Enregistré ✓' : 'Enregistrer'}
      </button>
    </form>
  );
}

export function AlertSettingsForm({ initial }: { initial: AlertConfig }) {
  const router = useRouter();
  const [config, setConfig] = useState(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setState('saving');

    const response = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alertConfig: config }),
    });

    setState(response.ok ? 'saved' : 'idle');
    router.refresh();
  }

  /** Seuls les réglages booléens sont basculables. */
  type BooleanKey = 'enabled' | 'whatsapp' | 'inApp' | 'lowStock' | 'outOfStock' | 'expiry';

  function toggle(field: BooleanKey) {
    setConfig((current) => ({ ...current, [field]: !current[field] }) as AlertConfig);
  }

  return (
    <form onSubmit={save} className="card space-y-3">
      <div>
        <h2 className="font-semibold">Alertes WhatsApp</h2>
        <p className="text-sm text-slate-500">
          Un seul message récapitulatif par jour, à l’heure choisie.
        </p>
      </div>

      <div className="space-y-2">
        {(
          [
            ['enabled', 'Alertes activées'],
            ['whatsapp', 'Envoyer sur WhatsApp'],
            ['outOfStock', 'Signaler les ruptures'],
            ['lowStock', 'Signaler les stocks bas'],
            ['expiry', 'Signaler les péremptions proches'],
          ] as Array<[BooleanKey, string]>
        ).map(([field, label]) => (
          <label key={field} className="flex min-h-touch items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={Boolean(config[field])}
              onChange={() => toggle(field)}
            />
            {label}
          </label>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="sendHour">
            Heure d’envoi (heure locale)
          </label>
          <input
            id="sendHour"
            type="number"
            min={0}
            max={23}
            className="input"
            value={config.sendHour}
            onChange={(event) =>
              setConfig({ ...config, sendHour: Math.min(23, Math.max(0, Number(event.target.value) || 0)) })
            }
          />
        </div>
        <div>
          <label className="label" htmlFor="expiryDays">
            Paliers de péremption (jours, séparés par une virgule)
          </label>
          <input
            id="expiryDays"
            className="input"
            value={config.expiryDays.join(', ')}
            onChange={(event) =>
              setConfig({
                ...config,
                expiryDays: event.target.value
                  .split(',')
                  .map((value) => Number(value.trim()))
                  .filter((value) => Number.isFinite(value) && value > 0),
              })
            }
          />
        </div>
      </div>

      <button type="submit" className="btn-primary" disabled={state === 'saving'}>
        {state === 'saving' ? 'Enregistrement…' : state === 'saved' ? 'Enregistré ✓' : 'Enregistrer'}
      </button>
    </form>
  );
}

export function InviteForm() {
  const router = useRouter();
  const [form, setForm] = useState({ fullName: '', email: '', role: 'cashier' });
  const [result, setResult] = useState<{ inviteUrl: string; emailSent: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setResult(null);

    const response = await fetch('/api/auth/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error ?? 'Invitation impossible');
      setPending(false);
      return;
    }

    setResult({ inviteUrl: payload.data.inviteUrl, emailSent: payload.data.emailSent });
    setForm({ fullName: '', email: '', role: 'cashier' });
    setPending(false);
    router.refresh();
  }

  return (
    <form onSubmit={invite} className="card space-y-3">
      <h2 className="font-semibold">Inviter un employé</h2>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="fullName">
            Nom
          </label>
          <input
            id="fullName"
            required
            className="input"
            value={form.fullName}
            onChange={(event) => setForm({ ...form, fullName: event.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="inviteEmail">
            E-mail
          </label>
          <input
            id="inviteEmail"
            type="email"
            required
            className="input"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="role">
            Rôle
          </label>
          <select
            id="role"
            className="input"
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value })}
          >
            <option value="admin">Administrateur</option>
            <option value="pharmacist">Pharmacien</option>
            <option value="cashier">Caissier</option>
            <option value="stock_manager">Gestionnaire de stock</option>
          </select>
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {result ? (
        <div className="rounded-lg bg-brand-50 p-3 text-sm text-brand-900">
          <p className="font-medium">
            {result.emailSent ? 'Invitation envoyée par e-mail.' : 'Partage ce lien à l’employé :'}
          </p>
          <p className="mt-1 break-all font-mono text-xs">{result.inviteUrl}</p>
        </div>
      ) : null}

      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? 'Envoi…' : 'Inviter'}
      </button>
    </form>
  );
}
