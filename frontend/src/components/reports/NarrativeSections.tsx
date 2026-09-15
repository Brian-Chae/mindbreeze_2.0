// SDD-045: 디자인 정본의 레이아웃과 SVG에 실제 측정 시계열을 연결한다.
import { useId, type MouseEvent } from 'react';
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

export interface ReportSessionInfo {
  participantName?: string;
  dateLabel?: string;
  shortDate?: string;
  className?: string;
  timeLabel?: string;
  durationMinutes?: number;
  recordedSignals?: string;
  qualityLabel?: string;
}

interface NarrativeSectionsProps {
  narrative: DisplayNarrative;
  session?: ReportSessionInfo;
  /** 정본의 분포 예시는 샘플에서만 표시한다. */
  isSample?: boolean;
}

export default function NarrativeSections({ narrative, session, isSample = false }: NarrativeSectionsProps) {
  const id = useId();
  const timeline = (narrative.timeline ?? []).filter((point) => point.min != null && Number.isFinite(point.min) && point.min >= 0).sort((a, b) => a.min! - b.min!);
  const duration = timeline.at(-1)?.min ?? 0;
  const sessionDuration = session?.durationMinutes;
  const durationLabel = sessionDuration != null && sessionDuration > 0 ? timeLabel(sessionDuration) : '시간';
  const navigateSection = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const target = event.currentTarget.hash.slice(1);
    const section = event.currentTarget.closest('.narrative-report')?.querySelector<HTMLElement>(`[data-section="${target}"]`);
    section?.scrollIntoView({ block: 'start', behavior: 'instant' });
    section?.focus({ preventScroll: true });
  };
  return <div className="narrative-report" data-testid="narrative-sections">
    <header className="topbar"><a className="brand" href="#cover" onClick={navigateSection}>mind breeze<span style={{ fontWeight: 400 }}> / 몸·마음 리포트</span></a>{isSample && <span className="sample-tag">디자인 미리보기 · 예시 데이터</span>}</header>
    <div className="layout">
    <aside className="sidebar" aria-label="리포트 탐색">
      <p className="eyebrow">오늘의 명상 기록</p>
      <nav>{[['cover', '나의 명상'], ['journey', '종합 여정'], ['body', '몸의 변화'], ['mind', '마음의 변화'], ['closing', '마무리']].map(([target, label], index) => <a key={target} href={`#${target}`} onClick={navigateSection}><span>0{index + 1}</span>{label}</a>)}</nav>
      <div className="side-note">나를 알아가는 시간,<br />그 작은 변화를 기록해요.<br /><br />{session?.shortDate ?? '날짜 정보 없음'}<br />{sessionDuration != null ? `${timeLabel(sessionDuration)} 호흡 명상` : '명상 기록'}</div>
    </aside>
    <div className="report-main">
    <section id="cover" data-section="cover" tabIndex={-1} className="cover" aria-labelledby={`${id}-cover`}>
      <div className="eyebrow">MIND BREEZE · 명상 여정</div>
      <h1 id={`${id}-cover`}>나에게 돌아온 {durationLabel},<br />몸과 마음의 이야기</h1>
      <p className="cover-lead">분주했던 하루에서 한 걸음 물러나,<br />오늘 나에게 일어난 작은 변화를 만나보세요.</p>
      <svg className="cover-art" viewBox="0 0 240 240" aria-hidden="true"><g fill="none" stroke="#5F0080" strokeWidth="1"><ellipse cx="120" cy="120" rx="95" ry="44" transform="rotate(-32 120 120)" opacity=".16" /><ellipse cx="120" cy="120" rx="84" ry="57" transform="rotate(-32 120 120)" opacity=".23" /><ellipse cx="120" cy="120" rx="70" ry="70" opacity=".25" /><ellipse cx="120" cy="120" rx="54" ry="84" transform="rotate(-32 120 120)" opacity=".18" /></g><circle cx="187" cy="76" r="9" fill="#59CE90" /><circle cx="71" cy="159" r="4" fill="#5F0080" opacity=".4" /></svg>
      <div className="cover-info"><div className="avatar" aria-hidden="true">{session?.participantName?.slice(0, 1) ?? '나'}</div><div><strong>{session?.participantName ? `${session.participantName}님을 위한 명상 기록` : '나를 위한 명상 기록'}</strong><p className="caption">{session?.dateLabel ?? '날짜 정보 없음'}</p></div></div>
      <div className="session"><dl>
        <div><dt>클래스</dt><dd>{session?.className ?? '클래스 정보 없음'}</dd></div>
        <div><dt>진행 시간</dt><dd>{session?.timeLabel ?? '진행 시간 정보 없음'}</dd></div>
        <div><dt>기록된 신호</dt><dd>{session?.recordedSignals ?? '신호 정보 없음'}</dd></div>
        <div><dt>비교 구간</dt><dd>{duration > 0 ? `전반 ${timeLabel(duration / 2)} ↔ 후반 ${timeLabel(duration / 2)}` : '비교 구간 정보 없음'}</dd></div>
      </dl><div className="quality"><span><span className="dot" />데이터 품질 안내</span><span>{session?.qualityLabel ?? '측정 품질 정보가 제공되지 않았어요.'}</span></div></div>
    </section>
    <section id="journey" data-section="journey" tabIndex={-1} aria-labelledby={`${id}-journey`}>
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
    <section id="body" data-section="body" tabIndex={-1} className="body-section" aria-labelledby={`${id}-body`}>
      <div className="section-head"><p className="eyebrow section-number">03 · 몸의 변화</p><h2 id={`${id}-body`}>몸이 들려주는<br />느긋해진 리듬</h2><p>호흡과 심장의 움직임에서 오늘의 변화를 살펴보세요.</p></div>
      {narrative.bodyText && <p className="narrative-copy">{narrative.bodyText}</p>}
      {narrative.body.map((metric) => <MetricChangeCard key={metric.id} metric={metric} timeline={timeline} duration={duration} />)}
      {narrative.body.length === 0 && <p className="section-note">몸 지표 변화량이 아직 없어요.</p>}
      <p className="section-note">HRV는 심장 박동 간격의 변동성을 뜻합니다. 지표의 상승·하강만으로 건강 상태나 명상의 효과를 판단하지 않아요.</p>
    </section>
    <section id="mind" data-section="mind" tabIndex={-1} className="mind-section" aria-labelledby={`${id}-mind`}>
      <div className="section-head"><p className="eyebrow">04 · 마음의 변화</p><h2 id={`${id}-mind`}>지금 이 순간에<br />조금 더 가까이</h2><p>마음의 지표가 어떻게 흘렀는지, 나의 느낌과 함께 읽어보세요.</p></div>
      {narrative.mindText && <p className="narrative-copy">{narrative.mindText}</p>}
      {narrative.mind.map((metric) => <MetricChangeCard key={metric.id} metric={metric} timeline={timeline} duration={duration} />)}
      {narrative.mind.length === 0 && <p className="section-note">마음 지표 변화량이 아직 없어요.</p>}
      <p className="section-note">%는 전반 평균 대비 후반 평균의 상대 변화율입니다. 감정안정도 흐름은 스트레스 지표의 역방향 근사이며, 실제로 느낀 감정을 직접 측정한 값은 아닙니다.</p>
      {isSample && (<div className="distribution"><div><h3>집중도가 머문 구간</h3><p>각 높낮이 구간에 머문 유효 측정 시간의 비중입니다. 전반·후반 변화율과는 다른 값이에요.</p><p>구간 분류와 시간 비중 모두 예시입니다.</p></div><figure><svg className="bar-chart" viewBox="0 0 350 188" role="img" aria-labelledby="distribution-title distribution-desc"><title id="distribution-title">집중도 5구간 시간 분포 예시</title><desc id="distribution-desc">매우낮음 5%, 낮음 10%, 보통 25%, 높음 40%, 매우높음 20%.</desc><rect x="22" y="131" width="40" height="15" rx="5" fill="#F9746B"/><text x="42" y="121" textAnchor="middle">5%</text><text x="42" y="170" textAnchor="middle">매우낮음</text><rect x="88" y="116" width="40" height="30" rx="5" fill="#FFC9C7"/><text x="108" y="106" textAnchor="middle">10%</text><text x="108" y="170" textAnchor="middle">낮음</text><rect x="154" y="71" width="40" height="75" rx="5" fill="#E8E8E8"/><text x="174" y="61" textAnchor="middle">25%</text><text x="174" y="170" textAnchor="middle">보통</text><rect x="220" y="26" width="40" height="120" rx="5" fill="#93E5B9"/><text x="240" y="16" textAnchor="middle">40%</text><text x="240" y="170" textAnchor="middle">높음</text><rect x="286" y="86" width="40" height="60" rx="5" fill="#59CE90"/><text x="306" y="76" textAnchor="middle">20%</text><text x="306" y="170" textAnchor="middle">매우높음</text></svg><figcaption>유효 측정 시간 중 비중 · 예시</figcaption></figure></div>)}
      <details className="legend-panel"><summary>그래프와 색상은 이렇게 읽어요</summary><p>곡선은 시간에 따른 지표의 상대적 흐름입니다. 배경의 5구간은 높낮이를 구분하는 시각적 안내이며, ‘낮음·보통·높음’은 건강 상태의 판정이 아닙니다. 몸 지표도 각 지표 안의 흐름을 보여주므로 그래프 높이를 서로 비교하지 마세요.</p><div className="gradient" aria-hidden="true"></div><div className="legend-ends"><span><svg className="face" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="#b54840"/><circle cx="8" cy="9" r="1" fill="#b54840"/><circle cx="16" cy="9" r="1" fill="#b54840"/><path d="M7 17Q12 11 17 17" fill="none" stroke="#b54840"/></svg>낮은 구간</span><span>높은 구간<svg className="face" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="#26724b"/><circle cx="8" cy="9" r="1" fill="#26724b"/><circle cx="16" cy="9" r="1" fill="#26724b"/><path d="M7 14Q12 20 17 14" fill="none" stroke="#26724b"/></svg></span></div><p>표정과 색상은 1.0 리포트의 시각 언어를 계승한 범례입니다. 좋고 나쁨을 판정하거나 종합 상태를 표시하지 않습니다. 측정이 부족한 실제 리포트에서는 값을 채우지 않고 ‘분석할 데이터가 부족해요’로 안내합니다.</p></details>
    </section>
    <section id="closing" data-section="closing" tabIndex={-1} className="closing" aria-labelledby={`${id}-closing`}>
      <p className="eyebrow">05 · 마무리</p><h2 id={`${id}-closing`}>오늘의 작은 쉼을,<br />내일의 나에게도</h2>
      <p>명상마다 흐름은 달라질 수 있어요.<br />오늘 느꼈던 나의 감각 하나를 기억해 두면 어떨까요?</p>
      <div className="practice practice-body"><span className="practice-icon" aria-hidden="true">↘</span><div><span className="practice-label">몸을 위한 다음 제안</span><strong>시작할 때, 몸이 머무를 시간을 주세요</strong><p>다음에는 처음 1분을 편안히 자리 잡는 시간으로 가져보세요. 어깨의 힘을 내려놓고, 평소의 호흡이 오가는 감각을 느껴봐요.</p></div></div>
      <div className="practice"><span className="practice-icon" aria-hidden="true">↗</span><div><span className="practice-label">마음을 위한 다음 제안</span><strong>알아차린 순간, 다시 호흡으로 돌아와요</strong><p>5분만 나에게 머물러보세요. 생각이 다른 곳으로 향해도 괜찮아요. 알아차렸다면, 지금의 호흡에 부드럽게 주의를 돌려봐요.</p></div></div>
      <p className="closing-message">{narrative.closing}</p><p className="closing-note">이 기록은 자기 이해를 돕기 위한 참고 자료이며,<br />의학적 진단이나 치료를 대신하지 않습니다.</p>
    </section>
    <footer className="footer"><span className="brand">mind breeze</span><a href="#cover" onClick={navigateSection}>처음으로 돌아가기 ↑</a></footer>
    </div></div>
  </div>;
}
