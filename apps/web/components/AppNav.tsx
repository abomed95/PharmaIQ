'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import {
  BarChart3,
  Bot,
  Box,
  ClipboardList,
  LogOut,
  Receipt,
  ShoppingCart,
  Sparkles,
  Store,
  Users,
} from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { Dictionary } from '@/lib/i18n';

export interface NavItem {
  href: string;
  key: keyof Dictionary['nav'];
  icon: keyof typeof ICONS;
}

const ICONS = {
  dashboard: BarChart3,
  pos: ShoppingCart,
  products: Box,
  stock: ClipboardList,
  purchases: Receipt,
  sales: Store,
  customers: Users,
  suggestions: Sparkles,
  assistant: Bot,
  settings: ClipboardList,
} as const;

export function AppNav({
  items,
  labels,
  pharmacyName,
  userName,
  logoutLabel,
}: {
  items: NavItem[];
  labels: Dictionary['nav'];
  pharmacyName: string;
  userName: string;
  logoutLabel: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  // Sur mobile : barre d'onglets fixe en bas (les 5 usages les plus fréquents).
  const mobileItems = items.slice(0, 5);

  return (
    <>
      <aside className="hidden w-60 shrink-0 border-e border-slate-200 bg-white p-4 md:block">
        <div className="mb-6">
          <p className="text-lg font-bold text-brand-700">PharmaIQ</p>
          <p className="truncate text-sm text-slate-500">{pharmacyName}</p>
        </div>

        <nav className="space-y-1">
          {items.map((item) => {
            const Icon = ICONS[item.icon];
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  'flex min-h-touch items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
                  active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50',
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
                {labels[item.key]}
              </Link>
            );
          })}
        </nav>

        <div className="mt-6 border-t border-slate-200 pt-4">
          <p className="truncate px-3 text-sm text-slate-500">{userName}</p>
          <button type="button" onClick={logout} className="btn-secondary mt-2 w-full">
            <LogOut className="h-4 w-4" aria-hidden />
            {logoutLabel}
          </button>
        </div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-slate-200 bg-white md:hidden">
        {mobileItems.map((item) => {
          const Icon = ICONS[item.icon];
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'flex flex-1 flex-col items-center gap-1 py-2 text-[11px]',
                active ? 'text-brand-700' : 'text-slate-500',
              )}
            >
              <Icon className="h-5 w-5" aria-hidden />
              {labels[item.key]}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
