// SDD-318 F-B — 리포트 시트 문구·커버 계산(순수 함수). 컴포넌트 파일과 분리해 단위 시험한다.
import type { ReportDto } from '../../lib/api/reports';
import type { Direction, MetricId } from '../../lib/report/narrative';

/** 세션 유형 영문 내부값 → 회원용 한글 라벨. 알 수 없는 값은 노출하지 않고 일반 라벨로 대체한다. */
const SESSION_TYPE_LABELS: Record<string, string> = {
  meditation: '명상수업',
  clinical: '임상심리상담',
  hypnosis: '최면심리상담',
  custom: '수업',
};
export function sessionTypeLabel(type: string | null | undefined): string {
  return (type && SESSION_TYPE_LABELS[type]) || '리포트';
}

export const NO_BAND_NOTICE = '이번 시간에는 밴드를 착용하지 않았어요. 측정 기록 없이도 함께 나눈 이야기와 코치의 기록을 볼 수 있어요.';

export interface UiV2ReportCover { eyebrow: string; title: string }

/** 커버 문구 — 같은 문구가 eyebrow·제목·본문에 반복되지 않도록 헤드라인 유무로 분기한다(B4). */
export function buildReportCover(report: ReportDto, headline: string | null): UiV2ReportCover {
  const sessionTitle = report.session_title?.trim() || '';
  const head = headline?.trim() || '';
  if (head && head !== sessionTitle) return { eyebrow: sessionTitle || sessionTypeLabel(report.session_type), title: head };
  return { eyebrow: sessionTypeLabel(report.session_type), title: sessionTitle || head || '리포트 상세' };
}

// ---- SDD-318 F-D — 측정 본문 문구(평가어 없이 방향+사실만) ----

export const MEASURE_LABELS: Record<MetricId, string> = {
  respiratory_rate: '호흡수', heart_rate: '심박수', hrv: '심박변이',
  focus: '집중도', relaxation: '이완도', emotional_stability: '감정안정도',
};
export const MEASURE_UNITS: Record<MetricId, string> = {
  respiratory_rate: '회/분', heart_rate: '회/분', hrv: '밀리초', focus: '', relaxation: '', emotional_stability: '',
};
/** 지표 한 줄 설명(읽는 법). 가치 판단을 하지 않는다. */
export const MEASURE_HINTS: Record<MetricId, string> = {
  respiratory_rate: '1분 동안 숨을 쉬는 횟수예요.',
  heart_rate: '1분 동안 심장이 뛰는 횟수예요.',
  hrv: '심장 박동 사이 간격이 얼마나 달라지는지 보여줘요.',
  focus: '주의를 기울이는 상태와 관련된 뇌파 신호예요.',
  relaxation: '편안한 상태와 관련된 뇌파 신호예요.',
  emotional_stability: '스트레스 신호를 반대로 읽은 추정값이에요. 실제 감정을 직접 측정하지 않아요.',
};
export const MEASURE_SECTION_TITLES = { journey: '이번 시간의 흐름', body: '몸의 변화', mind: '마음의 변화', closing: '마무리' } as const;
export const MEASURE_METHOD_NOTE = '변화량은 시작 쪽(전반) 평균과 마무리 쪽(후반) 평균의 차이예요. 오르내림만으로 상태를 판단하지 않고, 이번 시간 안의 흐름을 살펴보는 참고예요.';

function round1(v: number): string { return String(Number(v.toFixed(1))); }

/** 방향 문장 — 평가어 없이 전반 대비 후반의 방향만 말한다(지표명은 모두 받침 없음 → '는'). */
export function metricChangeSentence(id: MetricId, direction: Direction): string {
  const label = MEASURE_LABELS[id];
  if (direction === 'up') return `${label}는 전반보다 후반에 올라갔어요.`;
  if (direction === 'down') return `${label}는 전반보다 후반에 내려갔어요.`;
  return `${label}는 전반과 후반이 비슷했어요.`;
}

/** 전반→후반 평균값 한 줄(예: 전반 44.8밀리초 → 후반 54.8밀리초). */
export function metricRangeLabel(id: MetricId, early: number, late: number): string {
  const unit = MEASURE_UNITS[id];
  return `전반 ${round1(early)}${unit} → 후반 ${round1(late)}${unit}`;
}

/** 부호 있는 변화량 라벨(예: +10밀리초, −1회/분, 변화 없음). */
export function metricDeltaLabel(id: MetricId, direction: Direction, delta: number): string {
  if (direction === 'stable') return '거의 같아요';
  const sign = delta > 0 ? '+' : '−';
  return `${sign}${round1(Math.abs(delta))}${MEASURE_UNITS[id]}`;
}

/** content.quote 읽기 — 문자열이 아니거나 비어 있으면 null(숨김). */
export function readReportQuote(content: Record<string, unknown> | null | undefined): string | null {
  const v = content?.quote;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}
