// SDD-318 F-E — 측정 본문(확정 시안 v3e). 종합 여정 → 몸의 변화 → 마음의 변화 → 마무리 섹션을 렌더한다.
// 레거시 NarrativeSections 는 쓰지 않고, 같은 데이터(DisplayNarrative·타임라인)를 새 위계로 배치한다.
// 평가어·증감 배지·권장 범위 띠·색 평가는 없다. 방향+변화량만 말한다.
import { useEffect, useRef } from 'react';
import { METRIC_DEFINITIONS, type MetricNarrative } from '../../lib/report/narrative';
import type { DisplayNarrative, TimelineLikePoint } from '../../lib/report/resolve-narrative';
import {
  METRIC_UNIT, STEP_COLORS, bucketByMinute, changeBoxText, changeCaption, changeInterpretation, chipLine, colorStep,
  fiveMinuteTicks, neutralMetricSentence, neutralizeNarrative, plotGap, resolveAxis, stepColor, timelineSeriesValue,
} from './ui-v2-report-v3-logic';
import { MEASURE_METHOD_NOTE, MEASURE_SECTION_TITLES } from './ui-v2-report-copy';

function fmt(n: number): string { return String(Number(n.toFixed(1))); }

function Legend() {
  return (
    <div className="u2r3-legend">
      <div className="u2r3-legend-scale"><span>낮음</span>{STEP_COLORS.map((c) => <i key={c} className="u2r3-swatch" style={{ background: c }} />)}<span>높음</span></div>
      <span className="u2r3-missing">빈 칸 = 측정 없음</span>
    </div>
  );
}

/** 1분 고정 막대 그래프 — 숫자 라벨 없음, 0 기준 축, 보라 6단계, 빈 분은 점선 칸. */
function MinutePlot({ metric, axis, values }: { metric: MetricNarrative; axis: [number, number]; values: Array<number | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  const slots = values.length;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => el.style.setProperty('--gap', `${plotGap(slots, el.clientWidth)}px`);
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [slots]);
  const unit = METRIC_UNIT[metric.id];
  const [lo, hi] = axis;
  return (
    <figure className="u2r3-graph">
      <div className="u2r3-graph-meta"><span>{`축 ${lo}–${hi}${unit ? ` ${unit}` : ''}`}</span><span>1분 간격</span></div>
      <div ref={ref} className="u2r3-plot" data-minutes={slots} role="img" aria-label={`${metric.label} 1분 간격 막대 그래프`}>
        {values.map((v, i) => v === null
          ? <div key={i} className="u2r3-slot"><i className="u2r3-empty" data-empty="true" /></div>
          : <div key={i} className="u2r3-slot"><i className="u2r3-bar" data-step={colorStep(v, lo, hi)} style={{ height: `${Math.max(1, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%`, background: stepColor(v, lo, hi) }} /></div>)}
      </div>
      <div className="u2r3-ticks" aria-hidden="true">{fiveMinuteTicks(slots).map((t) => <span key={t.minute} style={{ left: `${t.leftPct}%` }}>{t.minute}분</span>)}</div>
      <Legend />
    </figure>
  );
}

function Compare({ metric, axis }: { metric: MetricNarrative; axis: [number, number] }) {
  const unit = METRIC_UNIT[metric.id];
  const [lo, hi] = axis;
  const span = hi - lo || 1;
  const rows: Array<[string, number]> = [['전반', metric.early], ['후반', metric.late]];
  return (
    <div className="u2r3-compare">
      <div className="u2r3-dual">
        {rows.map(([label, value]) => (
          <div className="u2r3-dual-row" key={label}>
            <span>{label}</span>
            <div className="u2r3-dual-measure">
              <i className="u2r3-dual-bar" style={{ width: `calc((100% - 66px) * ${Math.max(0, Math.min(1, (value - lo) / span))})`, background: stepColor(value, lo, hi) }} />
              <span className="u2r3-dual-value">{`${fmt(value)}${unit}`}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="u2r3-changebox" data-testid="change-box">
        <span className="u2r3-change-label">변화</span>
        <div className="u2r3-change-value">{changeBoxText(metric.delta)}{unit && <small>{unit}</small>}</div>
      </div>
      <p className="u2r3-caption">{changeCaption(metric.id, metric.label, metric.delta, lo, hi)}</p>
    </div>
  );
}

function MetricCard({ metric, timeline, durationMin }: { metric: MetricNarrative; timeline: TimelineLikePoint[]; durationMin: number }) {
  const series = timeline.map((p) => timelineSeriesValue(p, metric.id));
  const axis = resolveAxis(metric.id, [...series, metric.early, metric.late]);
  const values = bucketByMinute(timeline, metric.id, durationMin);
  const hasAny = values.some((v) => v !== null);
  const unit = METRIC_UNIT[metric.id];
  return (
    <article className="u2r3-metric" data-metric={metric.id} data-testid={`metric-${metric.id}`}>
      <div className="u2r3-metric-copy">
        <h4>{metric.label}</h4>
        <div className="u2r3-avg"><b>{fmt(metric.overall)}</b>{unit && <small>{unit}</small>}<small>전체 평균</small></div>
        <p className="u2r3-def">{METRIC_DEFINITIONS[metric.id]}</p>
        <p className="u2r3-sentence">{neutralMetricSentence(metric, axis)}</p>
        <p className="u2r3-interp">{changeInterpretation(metric.id, metric.delta, axis[0], axis[1])}</p>
        <p className="u2r3-def">명상 시작(전반) 평균 대비 마무리(후반) 평균이에요.</p>
      </div>
      <div className="u2r3-metric-chart">
        <Compare metric={metric} axis={axis} />
        {hasAny ? <MinutePlot metric={metric} axis={axis} values={values} /> : <p className="u2r3-nodata">시간별로 분석할 데이터가 부족해요.</p>}
      </div>
    </article>
  );
}

const STAGES = [
  { label: '처음', title: '잠시 멈추기', sub: '자리에 몸을 맡기고' },
  { label: '중간', title: '호흡에 머물기', sub: '지금의 감각을 따라' },
  { label: '마지막', title: '나에게 돌아오기', sub: '몸과 마음을 살피며' },
] as const;

export function UiV2ReportMeasure({ narrative, durationMinutes }: { narrative: DisplayNarrative; durationMinutes?: number }) {
  const timeline = (narrative.timeline ?? []).filter((p) => p.min != null && Number.isFinite(p.min) && (p.min as number) >= 0).sort((a, b) => (a.min as number) - (b.min as number));
  const lastMin = timeline.length > 0 ? (timeline[timeline.length - 1].min as number) : 0;
  const total = durationMinutes && durationMinutes > 0 ? durationMinutes : lastMin;
  const durationMin = total > 0 ? Math.ceil(total) : 0;
  const text = neutralizeNarrative(narrative);
  const stageTime = (i: number) => (total > 0 ? ` · ${fmt(total * (i / 2))}분` : '');
  return (
    <div className="u2r3-measure" data-testid="ui-v2-report-measure">
      <section id="u2r3-journey" className="u2r3-section" data-section="journey">
        <div className="u2r3-eyebrow">02 · {MEASURE_SECTION_TITLES.journey}</div>
        <h2>이번 시간의 몸과 마음 흐름</h2>
        <p className="u2r3-journey-copy">{text.journey}</p>
        {(narrative.body.length > 0 || narrative.mind.length > 0) && (
          <div className="u2r3-chips" aria-label="명상 시작(전반) 대비 마무리(후반)의 몸과 마음 변화 요약">
            {narrative.body.length > 0 && <div><strong>몸의 변화</strong>{narrative.body.map((m) => { const c = chipLine(m); return <p key={m.id}>{c.label} · 변화 {c.value}{c.unit && <small>{c.unit}</small>}</p>; })}</div>}
            {narrative.mind.length > 0 && <div><strong>마음의 변화</strong>{narrative.mind.map((m) => { const c = chipLine(m); return <p key={m.id}>{c.label} · 변화 {c.value}</p>; })}</div>}
          </div>
        )}
        <div className="u2r3-stages">{STAGES.map((s, i) => <div className="u2r3-stage" key={s.label}><small>{s.label}{i === 0 ? (total > 0 ? ' · 0분' : '') : stageTime(i)}</small><b>{s.title}</b><small>{s.sub}</small></div>)}</div>
        <p className="u2r3-def">아래 변화량은 명상 시작(전반) 평균과 마무리(후반) 평균을 비교한 값이에요.</p>
      </section>

      {(narrative.body.length > 0 || text.bodyText) && (
        <section id="u2r3-body" className="u2r3-section" data-section="body">
          <div className="u2r3-eyebrow">03 · {MEASURE_SECTION_TITLES.body}</div>
          <h2>호흡과 심장의 움직임</h2>
          <p className="u2r3-muted">호흡과 심장의 움직임에서 이번 시간의 변화를 살펴보세요.</p>
          {text.bodyText && <p className="u2r3-text">{text.bodyText}</p>}
          {narrative.body.map((m) => <MetricCard key={m.id} metric={m} timeline={timeline} durationMin={durationMin} />)}
          <p className="u2r3-def">{MEASURE_METHOD_NOTE}</p>
        </section>
      )}

      {(narrative.mind.length > 0 || text.mindText) && (
        <section id="u2r3-mind" className="u2r3-section" data-section="mind">
          <div className="u2r3-eyebrow">04 · {MEASURE_SECTION_TITLES.mind}</div>
          <h2>마음의 신호가 흐른 모양</h2>
          <p className="u2r3-muted">마음의 신호를 나의 느낌과 함께 읽어보세요.</p>
          {text.mindText && <p className="u2r3-text">{text.mindText}</p>}
          {narrative.mind.map((m) => <MetricCard key={m.id} metric={m} timeline={timeline} durationMin={durationMin} />)}
          <details className="u2r3-reading" open>
            <summary>그래프와 색상은 이렇게 읽어요</summary>
            <p className="u2r3-def">막대는 1분 동안의 평균이에요. 색이 짙을수록 해당 지표의 값이 커요. 지표마다 축이 다르므로 서로 다른 지표의 막대 높이를 비교하지 않아요. 측정이 없는 분은 옅은 점선 빈 칸으로 남기고 값을 채우지 않아요. 감정안정도는 스트레스 신호를 반대로 읽은 추정값이며, 실제로 느낀 감정을 직접 측정한 값은 아니에요.</p>
            <Legend />
          </details>
        </section>
      )}

      <section id="u2r3-closing" className="u2r3-section u2r3-closing" data-section="closing">
        <div className="u2r3-eyebrow">05 · {MEASURE_SECTION_TITLES.closing}</div>
        <h2>오늘의 작은 쉼을, 내일의 나에게도</h2>
        <p>명상마다 흐름은 달라질 수 있어요.<br />오늘 느꼈던 감각 하나를 기억해 두면 어떨까요?</p>
        <div className="u2r3-practice"><small>몸을 위한 다음 제안</small><strong>시작할 때, 몸이 머무를 시간을 주세요</strong><p>다음에는 처음 1분을 편안히 자리 잡는 시간으로 가져보세요. 어깨의 힘을 내려놓고, 평소의 호흡이 오가는 감각을 느껴봐요.</p></div>
        <div className="u2r3-practice"><small>마음을 위한 다음 제안</small><strong>알아차린 순간, 다시 호흡으로 돌아와요</strong><p>5분만 나에게 머물러보세요. 생각이 다른 곳으로 향해도 괜찮아요. 알아차렸다면, 지금의 호흡에 부드럽게 관심을 돌려봐요.</p></div>
        <p className="u2r3-closing-msg">{text.closing}</p>
      </section>
    </div>
  );
}
