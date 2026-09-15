// EEG 3채널 타임라인 — concentration / relaxation / stress
// mindbreeze 라이트 토큰 (haru 다크 테마 금지)

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
  { key: 'concentration' as const, label: '집중도', stroke: '#5F0080', legendBg: 'bg-[#5F0080]' },
  { key: 'relaxation' as const, label: '이완도', stroke: '#59CE90', legendBg: 'bg-[#59CE90]' },
  { key: 'stress' as const, label: '스트레스', stroke: '#F9746B', legendBg: 'bg-[#F9746B]' },
];

export default function EegTimeline({ data, dense = false }: EegTimelineProps) {
  if (!data || data.length === 0) return null;

  return (
    <section className="rounded-2xl border border-[#EFEFEF] bg-white p-5">
      <div className="mb-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[#5F0080]/70">
          eeg timeline
        </p>
        <h3 className="mt-1 text-[14px] font-bold text-[#1F1F1F]">뇌파 트렌드</h3>
        {!dense && (
          <p className="mt-1 text-[12px] text-[#6F6F6F]">
            세션 중 집중·이완·스트레스 추이 (참고)
          </p>
        )}
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#EFEFEF" />
          <XAxis
            dataKey="min"
            tick={{ fontSize: 11, fill: '#6F6F6F' }}
            axisLine={{ stroke: '#EFEFEF' }}
            tickLine={false}
            label={{
              value: '분',
              position: 'insideBottomRight',
              offset: -5,
              fontSize: 11,
              fill: '#9B9B9B',
            }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#6F6F6F' }}
            axisLine={false}
            tickLine={false}
            domain={[0, 100]}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: '1px solid #EFEFEF',
              background: '#FFFFFF',
              fontSize: 12,
              color: '#1F1F1F',
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
          <div key={ch.key} className="flex items-center gap-1.5 text-[12px] text-[#5A5A5A]">
            <span className={`h-0.5 w-3 ${ch.legendBg}`} />
            {ch.label}
          </div>
        ))}
      </div>
    </section>
  );
}
