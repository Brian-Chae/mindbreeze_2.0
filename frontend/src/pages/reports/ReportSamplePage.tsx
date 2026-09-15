// 몸·마음 서사형 리포트 샘플 — 규칙 기반 narrative + SDD-043 디자인

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
import {
  buildReportNarrative,
  type Direction,
  type MetricId,
  type MetricNarrative,
} from '../../lib/report/narrative';

interface MetricPoint {
  t: string;
  value: number;
}

interface SampleSeries {
  id: MetricId;
  color: string;
  series: MetricPoint[];
}

const COLOR_IMPROVE = '#1F8A5B';
const COLOR_NEUTRAL = '#6F6F6F';

/** 샘플 mock: 전반/후반 평균 (디자인 시안 변화량과 정합) */
const SAMPLE_CHANGES = [
  { id: 'respiratory_rate' as const, early: 16.8, late: 14.4 },
  { id: 'heart_rate' as const, early: 78, late: 73 },
  { id: 'hrv' as const, early: 32, late: 40 },
  { id: 'focus' as const, early: 50, late: 59 }, // ≈18%
  { id: 'relaxation' as const, early: 42, late: 47 }, // ≈12%
  { id: 'emotional_stability' as const, early: 45, late: 49 }, // ≈9%
];

const SAMPLE_SERIES: SampleSeries[] = [
  {
    id: 'respiratory_rate',
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
    color: '#2E7D5B',
    series: [
      { t: '0분', value: 32 },
      { t: '5분', value: 34 },
      { t: '10분', value: 36 },
      { t: '15분', value: 38 },
      { t: '20분', value: 40 },
    ],
  },
  {
    id: 'focus',
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

const SERIES_BY_ID = new Map(SAMPLE_SERIES.map((s) => [s.id, s]));

const narrative = buildReportNarrative(SAMPLE_CHANGES);

function directionTone(direction: Direction): string {
  if (direction === 'stable') return COLOR_NEUTRAL;
  // 샘플은 몸 이완·마음 안정 방향이 개선으로 읽힘
  if (direction === 'up') return COLOR_IMPROVE;
  return COLOR_IMPROVE;
}

function DirectionBadge({ direction }: { direction: Direction }) {
  const color = directionTone(direction);
  const label =
    direction === 'up' ? '상승' : direction === 'down' ? '하락' : '유지';
  return (
    <span
      className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[14px] font-bold"
      style={{ backgroundColor: `${color}18`, color }}
      aria-label={label}
    >
      {direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→'}
    </span>
  );
}

function TrendChart({ data, color }: { data: MetricPoint[]; color: string }) {
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

function MetricCard({ metric }: { metric: MetricNarrative }) {
  const series = SERIES_BY_ID.get(metric.id);
  const tone = directionTone(metric.direction);

  return (
    <article className="rounded-xl border border-[#EFEFEF] bg-white p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <DirectionBadge direction={metric.direction} />
          <div className="min-w-0">
            <div className="text-[14px] font-bold text-[#1F1F1F]">{metric.label}</div>
            <div className="text-[12px] text-[#6F6F6F] mt-0.5">{metric.sentence}</div>
          </div>
        </div>
        <div
          className="shrink-0 text-[15px] font-bold tabular-nums"
          style={{ color: tone }}
        >
          {metric.arrow} {metric.deltaLabel}
        </div>
      </div>
      {series ? <TrendChart data={series.series} color={series.color} /> : null}
    </article>
  );
}

function chipLabel(metrics: MetricNarrative[]): string {
  return metrics.map((m) => `${m.label.replace('안정도', '안정')} ${m.arrow}`).join(' · ');
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
            실제 세션 데이터가 아닙니다. 규칙 기반 서사 미리보기입니다.
          </span>
        </div>

        {/* 1. 종합 여정 */}
        <section className="rounded-2xl border border-[#EFEFEF] bg-[#F5EDFC] p-6">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[#5F0080]/80">
            02 · journey
          </p>
          <h2 className="mt-1 text-[18px] font-bold text-[#1F1F1F]">종합 여정</h2>
          <p className="mt-4 rounded-xl border-l-[3px] border-[#59CE90] bg-[#F0F9F5] px-5 py-4 text-[15px] leading-relaxed text-[#1F1F1F]">
            {narrative.journey}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-2 rounded-xl bg-[#F0F9F5] px-3.5 py-2 text-[12px] text-[#26724B]">
              <strong className="font-bold">몸</strong>
              <span>{chipLabel(narrative.body)}</span>
            </span>
            <span className="inline-flex items-center gap-2 rounded-xl bg-[#F5EDFC] px-3.5 py-2 text-[12px] text-[#5F0080]">
              <strong className="font-bold">마음</strong>
              <span>{chipLabel(narrative.mind)}</span>
            </span>
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-[#6F6F6F]">
            아래 변화량은 세션의 전반 평균과 후반 평균을 비교한 값입니다. 점수(0~100)는
            표시하지 않습니다.
          </p>
        </section>

        {/* 2. 몸의 변화 */}
        <section className="rounded-2xl border border-[#EFEFEF] bg-[#F0F9F5] p-6 space-y-5">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-widest text-[#1F8A5B]/90">
              03 · body
            </p>
            <h2 className="mt-1 text-[18px] font-bold text-[#1F1F1F]">몸의 변화</h2>
            <p className="mt-1 text-[13px] text-[#5A5A5A]">
              호흡과 심장의 움직임에서 오늘의 변화를 살펴보세요.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {narrative.body.map((m) => (
              <MetricCard key={m.id} metric={m} />
            ))}
          </div>
        </section>

        {/* 3. 마음의 변화 */}
        <section className="rounded-2xl border border-[#EFEFEF] bg-[#F5EDFC] p-6 space-y-5">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-widest text-[#5F0080]/80">
              04 · mind
            </p>
            <h2 className="mt-1 text-[18px] font-bold text-[#1F1F1F]">마음의 변화</h2>
            <p className="mt-1 text-[13px] text-[#5A5A5A]">
              마음의 지표가 어떻게 흘렀는지, 나의 느낌과 함께 읽어보세요.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {narrative.mind.map((m) => (
              <MetricCard key={m.id} metric={m} />
            ))}
          </div>
        </section>

        {/* 4. 마무리 */}
        <section className="rounded-2xl border border-[#EFEFEF] bg-[#F5EDFC] p-6 text-center">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[#5F0080]/80">
            05 · closing
          </p>
          <h2 className="mt-1 text-[18px] font-bold text-[#5F0080]">마무리</h2>
          <p className="mt-4 mx-auto max-w-md text-[14px] leading-relaxed text-[#6D547A]">
            {narrative.closing}
          </p>
          <p className="mt-5 text-[11px] leading-relaxed text-[#6F6F6F]">
            이 기록은 자기 이해를 돕기 위한 참고 자료이며, 의학적 진단이나 치료를 대신하지
            않습니다.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
