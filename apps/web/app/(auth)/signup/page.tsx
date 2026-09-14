'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const LOCALES = [
  { code: 'fr', label: 'Français' },
  { code: 'so', label: 'Soomaali' },
  { code: 'ar', label: 'العربية' },
  { code: 'en', label: 'English' },
];

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    pharmacyName: '',
    city: '',
    phoneWhatsapp: '',
    locale: 'fr',
    ownerName: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function update(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const response = await fetch('/api/auth/signup-pharmacy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        city: form.city || null,
        phoneWhatsapp: form.phoneWhatsapp || null,
        currency: 'DJF',
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error ?? 'Création impossible.');
      setPending(false);
      return;
    }

    // Connexion immédiate avec les identifiants qui viennent d'être créés.
    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: form.email,
      password: form.password,
    });
    if (signInError) {
      router.push('/login');
      return;
    }

    router.push('/settings?onboarding=1');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Créer ma pharmacie</h1>
        <p className="mt-1 text-sm text-slate-500">
          Ton espace est privé : aucune autre pharmacie ne verra tes données.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="pharmacyName">
          Nom de la pharmacie
        </label>
        <input
          id="pharmacyName"
          required
          minLength={2}
          className="input"
          value={form.pharmacyName}
          onChange={(e) => update('pharmacyName', e.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="city">
            Ville
          </label>
          <input
            id="city"
            className="input"
            value={form.city}
            onChange={(e) => update('city', e.target.value)}
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
            onChange={(e) => update('locale', e.target.value)}
          >
            {LOCALES.map((locale) => (
              <option key={locale.code} value={locale.code}>
                {locale.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="phoneWhatsapp">
          Numéro WhatsApp pour les alertes
        </label>
        <input
          id="phoneWhatsapp"
          inputMode="tel"
          placeholder="77 12 34 56"
          className="input"
          value={form.phoneWhatsapp}
          onChange={(e) => update('phoneWhatsapp', e.target.value)}
        />
      </div>

      <hr className="border-slate-200" />

      <div>
        <label className="label" htmlFor="ownerName">
          Ton nom
        </label>
        <input
          id="ownerName"
          required
          minLength={2}
          className="input"
          value={form.ownerName}
          onChange={(e) => update('ownerName', e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="email">
          E-mail
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          className="input"
          value={form.email}
          onChange={(e) => update('email', e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="password">
          Mot de passe (8 caractères minimum)
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="input"
          value={form.password}
          onChange={(e) => update('password', e.target.value)}
        />
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? 'Création…' : 'Créer ma pharmacie'}
      </button>

      <p className="text-center text-sm text-slate-500">
        Déjà inscrit ?{' '}
        <Link href="/login" className="font-medium text-brand-700">
          Se connecter
        </Link>
      </p>
    </form>
  );
}
