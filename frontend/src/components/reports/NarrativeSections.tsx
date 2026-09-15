// SDD-045: 디자인 정본의 레이아웃과 SVG에 실제 측정 시계열을 연결한다.
import { useId } from 'react';
import type { MetricId, MetricNarrative } from '../../lib/report/narrative';
import { chipLabel, type DisplayNarrative, type TimelineLikePoint } from '../../lib/report/resolve-narrative';
import './narrative-sections.css';

const BANDS = ['#59CE90', '#93E5B9', '#E8E8E8', '#FFC9C7', '#F9746B'];
const BODY_RANGES: Partial<Record<MetricId, readonly [number, number, string]>> = {
  respiratory_rate: [10, 20, '회/분'], heart_rate: [55, 90, 'bpm'], hrv: [20, 80, 'ms'],
};

function metricValue(point: TimelineLikePoint, id: MetricId): number | null {
  const value = id === 'hrv' ? point.sdnn ?? point.hrv
    : id === 'focus' ? point.concentration
    : id === 'emotional_stability' ? point.stress
    : point[id];
  if (value == null || !Number.isFinite(value)) return null;
  // 기존 서사 계산과 동일한 스트레스 역방향 근사이며 직접 감정 측정값이 아니다.
  return id === 'emotional_stability' ? (value <= 1 ? 1 : 100) - value : value;
}

function timeLabel(minutes: number): string {
  return `${Number(minutes.toFixed(1))}분`;
}

function TrendChart({ metric, timeline, duration }: {
  metric: MetricNarrative; timeline: TimelineLikePoint[]; duration: number;
}) {
  const id = useId();
  const values = timeline.map((point) => metricValue(point, metric.id));
  const valid = values.filter((value): value is number => value !== null);
  if (valid.length < 2 || duration <= 0) {
    return <p className="chart-empty">추이를 분석할 데이터가 부족해요.</p>;
  }
  const range = BODY_RANGES[metric.id];
  const low = Math.min(range?.[0] ?? Math.min(...valid), ...valid);
  const high = Math.max(range?.[1] ?? Math.max(...valid), ...valid);
  const span = high - low || 1;
  const segments: string[][] = [[]];
  let endpoint: { x: number; y: number } | null = null;
  timeline.forEach((point, index) => {
    const value = values[index];
    if (value === null) { segments.push([]); return; }
    const x = 16 + (point.min! / duration) * 284;
    const y = high === low ? 88 : 158 - ((value - low) / span) * 140;
    segments[segments.length - 1].push(`${x.toFixed(1)},${y.toFixed(1)}`);
    endpoint = { x, y };
  });
  // 결측 구간은 연결하지 않으며 마지막 유효 측정값에만 끝점을 표시한다.
  const lastPoint = endpoint as { x: number; y: number } | null;
  return <figure>
    <svg className="trend" viewBox="0 0 350 195" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
      <title id={`${id}-title`}>{`${metric.label}의 세션 중 변화`}</title>
      <desc id={`${id}-desc`}>실제 측정값의 흐름입니다. 배경은 상대적인 높낮이이며 임상 기준이 아닙니다. 결측 구간은 연결하지 않습니다.</desc>
      {BANDS.map((color, i) => <rect key={color} x="16" y={18 + 28 * i} width="284" height="28" fill={color} opacity=".24" />)}
      <path d="M158 18V158" stroke="#aaa" strokeDasharray="3 5" />
      {segments.filter((segment) => segment.length > 1).map((segment, i) => <polyline key={i} points={segment.join(' ')} fill="none" stroke="#5F0080" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />)}
      {lastPoint && <circle cx={lastPoint.x} cy={lastPoint.y} r="4" fill="#5F0080" stroke="white" strokeWidth="2" />}
      <g fill="#5A5A5A" fontSize="11">
        <text x="313" y="40">높음</text><text x="313" y="92">보통</text><text x="313" y="148">낮음</text>
        <text x="16" y="181">시작</text><text x="158" y="181" textAnchor="middle">{timeLabel(duration / 2)}</text><text x="300" y="181" textAnchor="end">{timeLabel(duration)}</text>
      </g>
    </svg>
    <figcaption>세션 중 {metric.label} 흐름<br />{range ? `${Number(low.toFixed(1))}~${Number(high.toFixed(1))}${range[2]} 범위` : '상대적 높낮이 (개인 기준)'}</figcaption>
  </figure>;
}

function MetricChangeCard({ metric, timeline, duration }: {
  metric: MetricNarrative; timeline: TimelineLikePoint[]; duration: number;
}) {
  const parts = metric.deltaLabel.match(/^([\d.,]+)(.*)$/);
  return <article className="metric">
    <div className="metric-copy">
      <div className="metric-title"><h3>{metric.label}</h3><span className="badge">{metric.direction === 'up' ? '증가' : metric.direction === 'down' ? '감소' : '유지'}</span></div>
      <p className="delta">{metric.arrow} {parts?.[1] ?? metric.deltaLabel}{parts?.[2] && <span>{parts[2]}</span>}</p>
      <p>{metric.sentence}</p><span className="caption">전반 평균 대비 후반 평균</span>
    </div>
    <TrendChart metric={metric} timeline={timeline} duration={duration} />
  </article>;
}

interface NarrativeSectionsProps { narrative: DisplayNarrative }

export default function NarrativeSections({ narrative }: NarrativeSectionsProps) {
  const id = useId();
  const timeline = (narrative.timeline ?? []).filter((point) => point.min != null && Number.isFinite(point.min) && point.min >= 0).sort((a, b) => a.min! - b.min!);
  const duration = timeline.at(-1)?.min ?? 0;
  return <div className="narrative-report" data-testid="narrative-sections">
    <section aria-labelledby={`${id}-journey`}>
      <div className="section-head"><p className="eyebrow">02 · 종합 여정</p><h2 id={`${id}-journey`}>서서히 느려진 호흡,<br />조금 더 머무른 마음</h2></div>
      <p className="journey-quote">{narrative.journey}</p>
      <div className="journey-summary" aria-label="전반 대비 후반의 몸과 마음 변화 요약">
        {narrative.body.length > 0 && <div className="summary-chip"><strong>몸</strong><span>{chipLabel(narrative.body)}</span></div>}
        {narrative.mind.length > 0 && <div className="summary-chip mind-chip"><strong>마음</strong><span>{chipLabel(narrative.mind)}</span></div>}
      </div>
      <div className="journey-stages">
        <div className="stage"><span className="caption">처음{duration > 0 && ' · 0분'}</span><strong>잠시 멈추기</strong><span className="caption">자리에 몸을 맡기고</span></div>
        <div className="stage"><span className="caption">중간{duration > 0 && ` · ${timeLabel(duration / 2)}`}</span><strong>호흡에 머물기</strong><span className="caption">지금의 감각을 따라</span></div>
        <div className="stage"><span className="caption">마지막{duration > 0 && ` · ${timeLabel(duration)}`}</span><strong>나에게 돌아오기</strong><span className="caption">몸과 마음을 살피며</span></div>
      </div>
      <p className="section-note">아래 변화량은 세션의 전반 평균과 후반 평균을 비교한 값입니다.</p>
    </section>
    <section className="body-section" aria-labelledby={`${id}-body`}>
      <div className="section-head"><p className="eyebrow section-number">03 · 몸의 변화</p><h2 id={`${id}-body`}>몸이 들려주는<br />느긋해진 리듬</h2><p>호흡과 심장의 움직임에서 오늘의 변화를 살펴보세요.</p></div>
      {narrative.bodyText && <p className="narrative-copy">{narrative.bodyText}</p>}
      {narrative.body.map((metric) => <MetricChangeCard key={metric.id} metric={metric} timeline={timeline} duration={duration} />)}
      {narrative.body.length === 0 && <p className="section-note">몸 지표 변화량이 아직 없어요.</p>}
      <p className="section-note">HRV는 심장 박동 간격의 변동성을 뜻합니다. 지표의 상승·하강만으로 건강 상태나 명상의 효과를 판단하지 않아요.</p>
    </section>
    <section className="mind-section" aria-labelledby={`${id}-mind`}>
      <div className="section-head"><p className="eyebrow">04 · 마음의 변화</p><h2 id={`${id}-mind`}>지금 이 순간에<br />조금 더 가까이</h2><p>마음의 지표가 어떻게 흘렀는지, 나의 느낌과 함께 읽어보세요.</p></div>
      {narrative.mindText && <p className="narrative-copy">{narrative.mindText}</p>}
      {narrative.mind.map((metric) => <MetricChangeCard key={metric.id} metric={metric} timeline={timeline} duration={duration} />)}
      {narrative.mind.length === 0 && <p className="section-note">마음 지표 변화량이 아직 없어요.</p>}
      <p className="section-note">%는 전반 평균 대비 후반 평균의 상대 변화율입니다. 감정안정도 흐름은 스트레스 지표의 역방향 근사이며, 실제로 느낀 감정을 직접 측정한 값은 아닙니다.</p>
      <details className="legend-panel"><summary>그래프와 색상은 이렇게 읽어요</summary><p>곡선은 시간에 따른 지표의 상대적 흐름입니다. 배경의 5구간은 높낮이를 구분하는 시각적 안내이며, ‘낮음·보통·높음’은 건강 상태의 판정이 아닙니다. 몸 지표도 각 지표 안의 흐름을 보여주므로 그래프 높이를 서로 비교하지 마세요.</p><div className="gradient" aria-hidden="true" /><div className="legend-ends"><span>낮은 구간</span><span>높은 구간</span></div></details>
    </section>
    <section className="closing" aria-labelledby={`${id}-closing`}>
      <p className="eyebrow">05 · 마무리</p><h2 id={`${id}-closing`}>오늘의 작은 쉼을,<br />내일의 나에게도</h2>
      <p>명상마다 흐름은 달라질 수 있어요.<br />오늘 느꼈던 나의 감각 하나를 기억해 두면 어떨까요?</p>
      <div className="practice practice-body"><span className="practice-icon" aria-hidden="true">↘</span><div><span className="practice-label">몸을 위한 다음 제안</span><strong>시작할 때, 몸이 머무를 시간을 주세요</strong><p>다음에는 처음 1분을 편안히 자리 잡는 시간으로 가져보세요. 어깨의 힘을 내려놓고, 평소의 호흡이 오가는 감각을 느껴봐요.</p></div></div>
      <div className="practice"><span className="practice-icon" aria-hidden="true">↗</span><div><span className="practice-label">마음을 위한 다음 제안</span><strong>알아차린 순간, 다시 호흡으로 돌아와요</strong><p>5분만 나에게 머물러보세요. 생각이 다른 곳으로 향해도 괜찮아요. 알아차렸다면, 지금의 호흡에 부드럽게 주의를 돌려봐요.</p></div></div>
      <p className="closing-message">{narrative.closing}</p><p className="closing-note">이 기록은 자기 이해를 돕기 위한 참고 자료이며,<br />의학적 진단이나 치료를 대신하지 않습니다.</p>
    </section>
  </div>;
}
