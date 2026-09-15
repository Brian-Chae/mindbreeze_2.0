// 서사형 리포트 섹션 — 종합 여정 → 몸의 변화 → 마음의 변화 → 마무리
// SDD-043/045: 보라/그린 크림, 점수 최소화

import type { Direction, MetricNarrative } from '../../lib/report/narrative';
import {
  chipLabel,
  directionLabel,
  type DisplayNarrative,
} from '../../lib/report/resolve-narrative';

const COLOR_IMPROVE = '#1F8A5B';
const COLOR_NEUTRAL = '#6F6F6F';

function directionTone(direction: Direction): string {
  if (direction === 'stable') return COLOR_NEUTRAL;
  return COLOR_IMPROVE;
}

function DirectionBadge({ direction }: { direction: Direction }) {
  const color = directionTone(direction);
  return (
    <span
      className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[14px] font-bold"
      style={{ backgroundColor: `${color}18`, color }}
      aria-label={directionLabel(direction)}
    >
      {direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→'}
    </span>
  );
}

function MetricChangeCard({ metric }: { metric: MetricNarrative }) {
  const tone = directionTone(metric.direction);
  return (
    <article className="rounded-xl border border-[#EFEFEF] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
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
      <p className="mt-3 text-[11px] text-[#9B9B9B]">전반 대비 후반 변화</p>
    </article>
  );
}

interface NarrativeSectionsProps {
  narrative: DisplayNarrative;
}

export default function NarrativeSections({ narrative }: NarrativeSectionsProps) {
  return (
    <div className="space-y-6" data-testid="narrative-sections">
      {/* 종합 여정 */}
      <section className="rounded-2xl border border-[#EFEFEF] bg-[#F5EDFC] p-6">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[#5F0080]/80">
          02 · journey
        </p>
        <h2 className="mt-1 text-[18px] font-bold text-[#1F1F1F]">종합 여정</h2>
        <p className="mt-4 rounded-xl border-l-[3px] border-[#59CE90] bg-[#F0F9F5] px-5 py-4 text-[15px] leading-relaxed text-[#1F1F1F]">
          {narrative.journey}
        </p>
        {(narrative.body.length > 0 || narrative.mind.length > 0) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {narrative.body.length > 0 && (
              <span className="inline-flex items-center gap-2 rounded-xl bg-[#F0F9F5] px-3.5 py-2 text-[12px] text-[#26724B]">
                <strong className="font-bold">몸</strong>
                <span>{chipLabel(narrative.body)}</span>
              </span>
            )}
            {narrative.mind.length > 0 && (
              <span className="inline-flex items-center gap-2 rounded-xl bg-white/70 px-3.5 py-2 text-[12px] text-[#5F0080]">
                <strong className="font-bold">마음</strong>
                <span>{chipLabel(narrative.mind)}</span>
              </span>
            )}
          </div>
        )}
        <p className="mt-4 text-[11px] leading-relaxed text-[#6F6F6F]">
          아래 변화량은 세션의 전반 평균과 후반 평균을 비교한 값입니다.
          {narrative.source === 'rule' ? ' (규칙 기반 서사)' : ''}
        </p>
      </section>

      {/* 몸의 변화 */}
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
        {narrative.bodyText && (
          <p className="rounded-xl bg-white/80 border border-[#E7ECE9] px-4 py-3 text-[14px] leading-relaxed text-[#1F1F1F]">
            {narrative.bodyText}
          </p>
        )}
        {narrative.body.length > 0 ? (
          <div className="grid grid-cols-1 gap-4">
            {narrative.body.map((m) => (
              <MetricChangeCard key={m.id} metric={m} />
            ))}
          </div>
        ) : (
          !narrative.bodyText && (
            <p className="text-[13px] text-[#6F6F6F]">몸 지표 변화량이 아직 없어요.</p>
          )
        )}
      </section>

      {/* 마음의 변화 */}
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
        {narrative.mindText && (
          <p className="rounded-xl bg-white/80 border border-[#E8D9F5] px-4 py-3 text-[14px] leading-relaxed text-[#1F1F1F]">
            {narrative.mindText}
          </p>
        )}
        {narrative.mind.length > 0 ? (
          <div className="grid grid-cols-1 gap-4">
            {narrative.mind.map((m) => (
              <MetricChangeCard key={m.id} metric={m} />
            ))}
          </div>
        ) : (
          !narrative.mindText && (
            <p className="text-[13px] text-[#6F6F6F]">마음 지표 변화량이 아직 없어요.</p>
          )
        )}
      </section>

      {/* 마무리 */}
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
  );
}
