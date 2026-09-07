// EEG 3채널 타임라인 — concentration / relaxation / stress
// Recharts 계약 유지, Y축 0–100, inline style 금지(범례는 Tailwind)

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { EegTimelinePoint } from '../../lib/api/report';

interface EegTimelineProps {
  data: EegTimelinePoint[];
  /** 상담사만 부가 카피 노출 */
  dense?: boolean;
}

const CHANNELS = [
  { key: 'concentration' as const, label: '집중도', stroke: '#22D3EE', legendBg: 'bg-cyan-400' },
  { key: 'relaxation' as const, label: '이완도', stroke: '#34D399', legendBg: 'bg-emerald-400' },
  { key: 'stress' as const, label: '스트레스', stroke: '#F87171', legendBg: 'bg-red-400' },
];

export default function EegTimeline({ data, dense = false }: EegTimelineProps) {
  if (!data || data.length === 0) return null;

  return (
    <section className="rounded-2xl border border-cyan-400/20 bg-slate-950 p-5 text-slate-100">
      <div className="mb-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-cyan-400/80">
          eeg timeline
        </p>
        <h3 className="mt-1 text-[15px] font-bold text-slate-100">뇌파 트렌드</h3>
        {!dense && (
          <p className="mt-1 text-[12px] text-slate-400">
            세션 중 집중·이완·스트레스 추이 (0–100)
          </p>
        )}
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
          <XAxis
            dataKey="min"
            tick={{ fontSize: 11, fill: '#94A3B8' }}
            axisLine={{ stroke: '#334155' }}
            tickLine={false}
            label={{
              value: '분',
              position: 'insideBottomRight',
              offset: -5,
              fontSize: 11,
              fill: '#64748B',
            }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#94A3B8' }}
            axisLine={false}
            tickLine={false}
            domain={[0, 100]}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: '1px solid rgba(34,211,238,0.25)',
              background: '#020617',
              fontSize: 12,
              color: '#E2E8F0',
            }}
          />
          {CHANNELS.map((ch) => (
            <Line
              key={ch.key}
              type="monotone"
              dataKey={ch.key}
              stroke={ch.stroke}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
              name={ch.label}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      <div className="mt-4 flex items-center justify-center gap-5">
        {CHANNELS.map((ch) => (
          <div key={ch.key} className="flex items-center gap-1.5 text-[12px] text-slate-300">
            <span className={`h-0.5 w-3 ${ch.legendBg}`} />
            {ch.label}
          </div>
        ))}
      </div>
    </section>
  );
}
