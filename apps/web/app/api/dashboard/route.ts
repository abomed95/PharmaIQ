import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { can } from '@pharmaiq/core';
import { handleRoute, jsonOk, parseQuery } from '@/lib/http';
import { requireSession, toTenantContext } from '@/lib/auth';
import { getDashboard } from '@/lib/analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

/**
 * KPI du tableau de bord. Les rôles « limités » (caissier, gestionnaire de
 * stock) ne reçoivent ni bénéfice ni chiffre d'affaires cumulé.
 */
export const GET = handleRoute(async (request: NextRequest) => {
  const user = await requireSession();
  const query = parseQuery(request, querySchema);
  const data = await getDashboard(toTenantContext(user), { windowDays: query.days });

  if (can(user.role, 'dashboard.view')) return jsonOk(data);

  return jsonOk({
    today: { ...data.today, profit: 0 },
    window: { ...data.window, revenue: 0, profit: 0 },
    allTime: { revenue: 0, salesCount: data.allTime.salesCount },
    series: [],
    topProducts: data.topProducts.map((p) => ({ ...p, revenue: 0, profit: 0 })),
    counts: data.counts,
    stockValue: 0,
    limited: true,
  });
});
