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
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="revenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 11 }}
            tickFormatter={(value: string) => value.slice(5)}
            stroke="#94a3b8"
          />
          <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" width={56} />
          <Tooltip
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
            stroke="#059669"
            strokeWidth={2}
            fill="url(#revenue)"
          />
          <Area
            type="monotone"
            dataKey="profit"
            stroke="#0ea5e9"
            strokeWidth={2}
            fillOpacity={0}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
