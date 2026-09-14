// 몸·마음 서사형 리포트 샘플 (mock) — 종합 → 몸 → 마음

import { Link } from 'react-router-dom';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import AppShell from '../../components/layout/AppShell';

type Direction = 'up' | 'down';

interface MetricPoint {
  t: string;
  value: number;
}

interface BodyMetric {
  id: string;
  label: string;
  direction: Direction;
  deltaLabel: string;
  caption: string;
  color: string;
  series: MetricPoint[];
}

interface MindMetric {
  id: string;
  label: string;
  direction: Direction;
  deltaLabel: string;
  color: string;
  series: MetricPoint[];
}

const JOURNEY_NARRATIVE =
  '몸은 점차 안정으로, 마음은 산만함에서 차분한 집중으로 흘렀습니다.';

/** 개선 방향이면 그린, 악화면 레드 (샘플은 모두 개선) */
const COLOR_IMPROVE = '#1F8A5B';
const COLOR_WORSEN = '#F9746B';

const BODY_METRICS: BodyMetric[] = [
  {
    id: 'respiratory_rate',
    label: '호흡수',
    direction: 'down',
    deltaLabel: '2.4회/분',
    caption: '얕은 호흡 → 깊고 느린 호흡',
    color: '#5F0080',
    series: [
      { t: '0분', value: 16.8 },
      { t: '5분', value: 16.2 },
      { t: '10분', value: 15.5 },
      { t: '15분', value: 14.9 },
      { t: '20분', value: 14.4 },
    ],
  },
  {
    id: 'heart_rate',
    label: '심박수',
    direction: 'down',
    deltaLabel: '5bpm',
    caption: '긴장 → 안정',
    color: '#7B2D8E',
    series: [
      { t: '0분', value: 78 },
      { t: '5분', value: 76 },
      { t: '10분', value: 74 },
      { t: '15분', value: 73 },
      { t: '20분', value: 73 },
    ],
  },
  {
    id: 'hrv',
    label: 'HRV',
    direction: 'up',
    deltaLabel: '8ms',
    caption: '자율신경 회복 반응',
    color: '#2E7D5B',
    series: [
      { t: '0분', value: 32 },
      { t: '5분', value: 34 },
      { t: '10분', value: 36 },
      { t: '15분', value: 38 },
      { t: '20분', value: 40 },
    ],
  },
];

const MIND_METRICS: MindMetric[] = [
  {
    id: 'focus',
    label: '집중도',
    direction: 'up',
    deltaLabel: '18%',
    color: '#5F0080',
    series: [
      { t: '0분', value: 42 },
      { t: '5분', value: 48 },
      { t: '10분', value: 55 },
      { t: '15분', value: 58 },
      { t: '20분', value: 60 },
    ],
  },
  {
    id: 'relaxation',
    label: '이완도',
    direction: 'up',
    deltaLabel: '12%',
    color: '#2E7D5B',
    series: [
      { t: '0분', value: 38 },
      { t: '5분', value: 41 },
      { t: '10분', value: 44 },
      { t: '15분', value: 46 },
      { t: '20분', value: 48 },
    ],
  },
  {
    id: 'emotional_stability',
    label: '감정안정도',
    direction: 'up',
    deltaLabel: '9%',
    color: '#7B2D8E',
    series: [
      { t: '0분', value: 45 },
      { t: '5분', value: 47 },
      { t: '10분', value: 49 },
      { t: '15분', value: 51 },
      { t: '20분', value: 52 },
    ],
  },
];

function DirectionBadge({
  direction,
  improved = true,
}: {
  direction: Direction;
  improved?: boolean;
}) {
  const color = improved ? COLOR_IMPROVE : COLOR_WORSEN;
  return (
    <span
      className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[14px] font-bold"
      style={{ backgroundColor: `${color}18`, color }}
      aria-label={direction === 'up' ? '상승' : '하락'}
    >
      {direction === 'up' ? '↑' : '↓'}
    </span>
  );
}

function TrendChart({
  data,
  color,
}: {
  data: MetricPoint[];
  color: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={120}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#EFEFEF" vertical={false} />
        <XAxis
          dataKey="t"
          tick={{ fontSize: 10, fill: '#6F6F6F' }}
          axisLine={{ stroke: '#EFEFEF' }}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#6F6F6F' }}
          axisLine={false}
          tickLine={false}
          width={36}
          domain={['dataMin - 2', 'dataMax + 2']}
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
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export default function ReportSamplePage() {
  return (
    <AppShell
      title="샘플 리포트"
      sub="BODY · MIND SAMPLE"
      rightSlot={
        <Link
          to="/reports"
          className="text-[13px] font-semibold text-[#5F0080] hover:underline"
        >
          목록으로
        </Link>
      }
    >
      <div className="max-w-3xl mx-auto space-y-6">
        {/* 샘플 배지 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-bold bg-[#F5EDFC] text-[#5F0080] border border-[#E8D9F5]">
            샘플 리포트
          </span>
          <span className="text-[12px] text-[#6F6F6F]">
            실제 세션 데이터가 아닙니다. 몸·마음 서사형 리포트 미리보기입니다.
          </span>
        </div>

        {/* 1. 종합 여정 */}
        <section className="rounded-2xl border border-[#EFEFEF] bg-[#F5EDFC] p-6">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[#5F0080]/80">
            journey
          </p>
          <h2 className="mt-1 text-[18px] font-bold text-[#1F1F1F]">종합 여정</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-[#1F1F1F]">
            {JOURNEY_NARRATIVE}
          </p>
        </section>

        {/* 2. 몸의 변화 */}
        <section className="rounded-2xl border border-[#EFEFEF] bg-[#F0F9F5] p-6 space-y-5">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-widest text-[#1F8A5B]/90">
              body
            </p>
            <h2 className="mt-1 text-[18px] font-bold text-[#1F1F1F]">몸의 변화</h2>
            <p className="mt-1 text-[12px] text-[#6F6F6F]">
              방향성 + 절대 변화량 · 세션 전반→후반 추이
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {BODY_METRICS.map((m) => (
              <article
                key={m.id}
                className="rounded-xl border border-[#EFEFEF] bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <DirectionBadge direction={m.direction} improved />
                    <div className="min-w-0">
                      <div className="text-[14px] font-bold text-[#1F1F1F]">{m.label}</div>
                      <div className="text-[12px] text-[#6F6F6F] mt-0.5">{m.caption}</div>
                    </div>
                  </div>
                  <div
                    className="shrink-0 text-[15px] font-bold tabular-nums"
                    style={{ color: COLOR_IMPROVE }}
                  >
                    {m.direction === 'up' ? '↑' : '↓'} {m.deltaLabel}
                  </div>
                </div>
                <TrendChart data={m.series} color={m.color} />
              </article>
            ))}
          </div>
        </section>

        {/* 3. 마음의 변화 */}
        <section className="rounded-2xl border border-[#EFEFEF] bg-[#F5EDFC] p-6 space-y-5">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-widest text-[#5F0080]/80">
              mind
            </p>
            <h2 className="mt-1 text-[18px] font-bold text-[#1F1F1F]">마음의 변화</h2>
            <p className="mt-1 text-[12px] text-[#6F6F6F]">
              방향성 + 상대 변화율 · 세션 전반→후반 추이
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {MIND_METRICS.map((m) => (
              <article
                key={m.id}
                className="rounded-xl border border-[#EFEFEF] bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <DirectionBadge direction={m.direction} improved />
                    <div className="text-[14px] font-bold text-[#1F1F1F]">{m.label}</div>
                  </div>
                  <div
                    className="shrink-0 text-[15px] font-bold tabular-nums"
                    style={{ color: COLOR_IMPROVE }}
                  >
                    {m.direction === 'up' ? '↑' : '↓'} {m.deltaLabel}
                  </div>
                </div>
                <TrendChart data={m.series} color={m.color} />
              </article>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
