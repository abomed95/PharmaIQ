'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError('E-mail ou mot de passe incorrect.');
      setPending(false);
      return;
    }

    router.push(searchParams.get('next') ?? '/dashboard');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <h1 className="text-lg font-semibold">Connexion</h1>

      <div>
        <label className="label" htmlFor="email">
          E-mail
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="password">
          Mot de passe
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? 'Connexion…' : 'Se connecter'}
      </button>

      <p className="text-center text-sm text-slate-500">
        Pas encore de compte ?{' '}
        <Link href="/signup" className="font-medium text-brand-700">
          Créer ma pharmacie
        </Link>
      </p>
    </form>
  );
}
