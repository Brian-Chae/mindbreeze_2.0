// SDD-318 F-D — 측정 본문(D안 전용). 레거시 NarrativeSections 를 쓰지 않고 같은 데이터(DisplayNarrative·타임라인)를 새 위계로 렌더한다.
// 레거시 규칙 문장(metric.sentence)은 상태 판단 표현이 섞여 있어 쓰지 않고, 방향+값만 새 문구로 만든다.
// 방침: 수치 환원·종합 지표·평가어 없이 서사와 변화량(방향+사실)만 보여 준다.
import { useId } from 'react';
import type { MetricNarrative } from '../../lib/report/narrative';
import type { DisplayNarrative, TimelineLikePoint } from '../../lib/report/resolve-narrative';
import {
  MEASURE_HINTS, MEASURE_LABELS, MEASURE_METHOD_NOTE, MEASURE_SECTION_TITLES,
  metricChangeSentence, metricDeltaLabel, metricRangeLabel,
} from './ui-v2-report-copy';

type MetricKey = MetricNarrative['id'];

function seriesValue(point: TimelineLikePoint, id: MetricKey): number | null {
  let v: number | null | undefined;
  if (id === 'emotional_stability') {
    if (point.emotional_stability != null) v = point.emotional_stability;
    else if (point.stress != null) v = point.stress <= 1 ? 1 - point.stress : 100 - point.stress;
  } else if (id === 'hrv') v = point.sdnn ?? point.hrv;
  else if (id === 'focus') v = point.concentration;
  else v = point[id];
  return v != null && Number.isFinite(v) ? v : null;
}

/** 얇은 추이선 — 축·눈금·권장범위 없이 흐름만. 유효 2점 미만이면 그리지 않는다. */
function TrendLine({ metric, timeline }: { metric: MetricNarrative; timeline: TimelineLikePoint[] }) {
  const titleId = useId();
  const pts = timeline.map((p) => ({ x: p.min as number, y: seriesValue(p, metric.id) })).filter((p): p is { x: number; y: number } => p.y !== null);
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs); const x1 = Math.max(...xs);
  const y0 = Math.min(...ys); const y1 = Math.max(...ys);
  const W = 300; const H = 56; const PAD = 4;
  const sx = (x: number) => PAD + (x1 === x0 ? 0 : ((x - x0) / (x1 - x0)) * (W - 2 * PAD));
  const sy = (y: number) => (y1 === y0 ? H / 2 : H - PAD - ((y - y0) / (y1 - y0)) * (H - 2 * PAD));
  // 표시 점 수를 줄여 가볍게 한다(최대 60점 균등 추출).
  const step = Math.max(1, Math.ceil(pts.length / 60));
  const shown = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const d = shown.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join('');
  return (
    <svg className="u2-rp-trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={titleId} preserveAspectRatio="none">
      <title id={titleId}>{`${metric.label} 흐름`}</title>
      <line x1={W / 2} y1={0} x2={W / 2} y2={H} className="u2-rp-trend-mid" />
      <path d={d} fill="none" className="u2-rp-trend-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function MetricRow({ metric, timeline }: { metric: MetricNarrative; timeline: TimelineLikePoint[] }) {
  return (
    <article className="u2-rp-metric" data-metric={metric.id}>
      <div className="u2-rp-metric-head">
        <h4>{MEASURE_LABELS[metric.id]}</h4>
        <span className="u2-rp-delta">{metricDeltaLabel(metric.id, metric.direction, metric.delta)}</span>
      </div>
      <p className="u2-rp-metric-text">{metricChangeSentence(metric.id, metric.direction)}</p>
      <p className="u2-rp-metric-sub">{metricRangeLabel(metric.id, metric.early, metric.late)}</p>
      <TrendLine metric={metric} timeline={timeline} />
      <p className="u2-rp-hint">{MEASURE_HINTS[metric.id]}</p>
    </article>
  );
}

export function UiV2ReportMeasure({ narrative }: { narrative: DisplayNarrative }) {
  const timeline = (narrative.timeline ?? []).filter((p) => p.min != null && Number.isFinite(p.min) && p.min >= 0).sort((a, b) => (a.min as number) - (b.min as number));
  return (
    <div className="u2-rp-measure" data-testid="ui-v2-report-measure">
      {narrative.journey && (
        <section>
          <h3 className="u2-rp-h">{MEASURE_SECTION_TITLES.journey}</h3>
          <p className="u2-rp-text">{narrative.journey}</p>
        </section>
      )}
      {(narrative.body.length > 0 || narrative.bodyText) && (
        <section>
          <h3 className="u2-rp-h">{MEASURE_SECTION_TITLES.body}</h3>
          {narrative.bodyText && <p className="u2-rp-text">{narrative.bodyText}</p>}
          {narrative.body.map((m) => <MetricRow key={m.id} metric={m} timeline={timeline} />)}
        </section>
      )}
      {(narrative.mind.length > 0 || narrative.mindText) && (
        <section>
          <h3 className="u2-rp-h">{MEASURE_SECTION_TITLES.mind}</h3>
          {narrative.mindText && <p className="u2-rp-text">{narrative.mindText}</p>}
          {narrative.mind.map((m) => <MetricRow key={m.id} metric={m} timeline={timeline} />)}
        </section>
      )}
      <p className="u2-footnote u2-rp-note">{MEASURE_METHOD_NOTE}</p>
      {narrative.closing && (
        <section>
          <h3 className="u2-rp-h">{MEASURE_SECTION_TITLES.closing}</h3>
          <p className="u2-rp-text">{narrative.closing}</p>
        </section>
      )}
    </div>
  );
}
