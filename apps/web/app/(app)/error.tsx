'use client';

import Link from 'next/link';

/**
 * Filet de sécurité de l'espace connecté : une permission refusée ou une
 * erreur serveur affiche un message lisible plutôt qu'une page blanche.
 */
export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  const forbidden = error.message.startsWith('Permission requise');

  return (
    <div className="card mx-auto mt-10 max-w-lg text-center">
      <p className="text-3xl">{forbidden ? '🔒' : '⚠️'}</p>
      <h1 className="mt-3 text-lg font-semibold">
        {forbidden ? 'Accès non autorisé' : 'Une erreur est survenue'}
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        {forbidden
          ? 'Ton rôle ne donne pas accès à cet écran. Demande à un administrateur de la pharmacie.'
          : "L'opération n'a pas pu aboutir. Réessaie ; si le problème persiste, contacte le support."}
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <button type="button" onClick={reset} className="btn-secondary">
          Réessayer
        </button>
        <Link href="/dashboard" className="btn-primary">
          Tableau de bord
        </Link>
      </div>
    </div>
  );
}
