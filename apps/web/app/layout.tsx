import type { Metadata, Viewport } from 'next';
import { getSessionUser } from '@/lib/auth';
import { DEFAULT_LOCALE, isRtl } from '@/lib/i18n';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import './globals.css';

export const metadata: Metadata = {
  title: 'PharmaIQ — gestion intelligente de pharmacie',
  description:
    "Stock, caisse et conseils d'achat pour les pharmacies : mise à jour du stock par photo de reçu, alertes WhatsApp, recommandations basées sur vos ventes réelles.",
  manifest: '/manifest.webmanifest',
  applicationName: 'PharmaIQ',
  appleWebApp: { capable: true, title: 'PharmaIQ', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#059669',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // La langue suit l'utilisateur connecté, sinon la langue par défaut.
  const user = await getSessionUser().catch(() => null);
  const locale = user?.locale ?? DEFAULT_LOCALE;

  return (
    <html lang={locale} dir={isRtl(locale) ? 'rtl' : 'ltr'}>
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
