'use client';

import { useEffect } from 'react';

/** Enregistre le service worker (PWA installable sur téléphone). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('[pwa] enregistrement du service worker impossible', error);
    });
  }, []);

  return null;
}
