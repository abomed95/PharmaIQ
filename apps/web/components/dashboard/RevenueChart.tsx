'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface SeriesPoint {
  day: string;
  revenue: number;
  profit: number;
}

/** Courbe CA / bénéfice sur la fenêtre choisie. */
export function RevenueChart({ data, currency }: { data: SeriesPoint[]; currency: string }) {
  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-slate-400">
        Pas encore de ventes à afficher
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-2 flex gap-4 text-xs text-slate-600" aria-hidden>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: 'var(--chart-revenue)' }} />Ventes</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: 'var(--chart-profit)' }} />Bénéfice</span>
      </div>
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="revenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-revenue)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--chart-revenue)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 11, fill: 'var(--chart-axis)' }}
            tickFormatter={(value: string) => value.slice(5)}
            stroke="var(--chart-grid)"
            tickLine={false}
          />
          <YAxis tick={{ fontSize: 11, fill: 'var(--chart-axis)' }} axisLine={false} tickLine={false} width={56} />
          <Tooltip
            contentStyle={{ background: 'var(--chart-tooltip-bg)', color: 'var(--chart-tooltip-text)', border: '1px solid var(--chart-grid)', borderRadius: 10, fontSize: 12 }}
            labelStyle={{ color: 'var(--chart-tooltip-text)', fontWeight: 600 }}
            // Types laissés à l'inférence : recharts attend des signatures larges.
            formatter={(value, name) => [
              `${Math.round(Number(value))} ${currency}`,
              name === 'revenue' ? 'Ventes' : 'Bénéfice',
            ]}
            labelFormatter={(label) => `Jour ${String(label)}`}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="var(--chart-revenue)"
            strokeWidth={2}
            fill="url(#revenue)"
          />
          <Area
            type="monotone"
            dataKey="profit"
            stroke="var(--chart-profit)"
            strokeWidth={2}
            fillOpacity={0}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
    </div>
  );
}
