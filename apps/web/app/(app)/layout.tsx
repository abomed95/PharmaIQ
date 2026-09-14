import { redirect } from 'next/navigation';
import { can } from '@pharmaiq/core';
import { getSessionUser } from '@/lib/auth';
import { getDictionary } from '@/lib/i18n';
import { AppNav, type NavItem } from '@/components/AppNav';

/**
 * Coquille de l'espace connecté.
 *
 * La navigation est filtrée par permission, mais ce filtrage n'est QUE du
 * confort : chaque page et chaque route refont le contrôle côté serveur.
 */
const ALL_ITEMS: Array<NavItem & { permission: Parameters<typeof can>[1] }> = [
  { href: '/dashboard', key: 'dashboard', icon: 'dashboard', permission: 'dashboard.view_limited' },
  { href: '/pos', key: 'pos', icon: 'pos', permission: 'sales.create' },
  { href: '/products', key: 'products', icon: 'products', permission: 'products.view' },
  { href: '/stock', key: 'stock', icon: 'stock', permission: 'stock.view' },
  { href: '/purchases', key: 'purchases', icon: 'purchases', permission: 'receipts.scan' },
  { href: '/suggestions', key: 'suggestions', icon: 'suggestions', permission: 'suggestions.view' },
  { href: '/sales', key: 'sales', icon: 'sales', permission: 'sales.view' },
  { href: '/customers', key: 'customers', icon: 'customers', permission: 'customers.manage' },
  { href: '/assistant', key: 'assistant', icon: 'assistant', permission: 'assistant.use' },
  { href: '/settings', key: 'settings', icon: 'settings', permission: 'settings.manage' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const dict = getDictionary(user.locale);
  const items = ALL_ITEMS.filter(
    (item) =>
      can(user.role, item.permission) ||
      (item.permission === 'dashboard.view_limited' && can(user.role, 'dashboard.view')),
  ).map(({ href, key, icon }) => ({ href, key, icon }));

  return (
    <div className="flex min-h-screen">
      <AppNav
        items={items}
        labels={dict.nav}
        pharmacyName={user.pharmacyName}
        userName={`${user.fullName} · ${user.role}`}
        logoutLabel={dict.common.logout}
      />
      {/* pb-20 : place pour la barre d'onglets mobile. */}
      <main className="min-w-0 flex-1 px-4 py-6 pb-20 md:px-8 md:pb-8">{children}</main>
    </div>
  );
}
