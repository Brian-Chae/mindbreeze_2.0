// SDD-318 F-E — 회원 리포트 상세 v3e 순수 로직(렌더 없음). 단위 시험 대상.
// 레거시 narrative.ts·resolve-narrative.ts 는 읽기 전용으로 import 만 하고 수정하지 않는다.
// 방침: 평가어(좋아졌어요·주의가 필요해요·불안정하게·안정적으로·산만했지만·긴장이 남 등)는 방향+변화량 서술로 바꾼다.
import {
  closingSentence, journeySentence, resolveBodyTrend, resolveMindTrend,
  type BodyTrend, type MetricId, type MetricNarrative, type MindTrend,
} from '../../lib/report/narrative';
import type { TimelineLikePoint } from '../../lib/report/resolve-narrative';

export type MetricKey = MetricId;

// ---- 축·단위·색 ----

export const METRIC_UNIT: Record<MetricKey, string> = {
  respiratory_rate: '회/분', heart_rate: '회/분', hrv: '밀리초', focus: '', relaxation: '', emotional_stability: '',
};
/** 0 기준 기본 축(시안 v3e). 범위를 넘는 값이 있으면 resolveAxis 가 확장한다. */
export const DEFAULT_AXIS: Record<MetricKey, readonly [number, number]> = {
  respiratory_rate: [0, 24], heart_rate: [0, 120], hrv: [0, 200], focus: [0, 100], relaxation: [0, 100], emotional_stability: [0, 100],
};
/** 낮음 → 높음 보라 6단계. 색은 수치 크기만 나타낸다(좋고 나쁨 아님). */
export const STEP_COLORS = ['#E5D3EE', '#C9A7DB', '#AD7CC5', '#8D50AB', '#692C87', '#3A1650'] as const;

/** 값 목록이 기본 축을 넘으면 실제 극값을 포함하도록 확장한다. */
export function resolveAxis(id: MetricKey, values: Array<number | null | undefined>): [number, number] {
  let [lo, hi] = DEFAULT_AXIS[id];
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    if (v > hi) hi = Math.ceil(v);
    if (v < lo) lo = Math.floor(v);
  }
  return [lo, hi];
}

/** 색 단계 0~5 = min(5, max(0, floor(r*6))), r=(value-min)/(max-min). 경계는 [0,1/6),…,[5/6,1]. */
export function colorStep(value: number, axisMin: number, axisMax: number): number {
  const span = axisMax - axisMin;
  if (!(span > 0)) return 0;
  const r = (value - axisMin) / span;
  // 부동소수 오차(예: 1/6*6) 보정 후 내림.
  return Math.min(5, Math.max(0, Math.floor(r * 6 + 1e-9)));
}
export function stepColor(value: number, axisMin: number, axisMax: number): string {
  return STEP_COLORS[colorStep(value, axisMin, axisMax)];
}

// ---- 시계열 ----

export function timelineSeriesValue(point: TimelineLikePoint, id: MetricKey): number | null {
  let v: number | null | undefined;
  if (id === 'emotional_stability') {
    if (point.emotional_stability != null) v = point.emotional_stability;
    else if (point.stress != null) v = point.stress <= 1 ? 1 - point.stress : 100 - point.stress; // 레거시 stress 역변환 경로 그대로
  } else if (id === 'hrv') v = point.sdnn ?? point.hrv;
  else if (id === 'focus') v = point.concentration;
  else v = point[id];
  return v != null && Number.isFinite(v) ? v : null;
}

/**
 * min(분) 기준 1분 고정 슬롯 평균. 슬롯 i = [i, i+1)분. 값이 없는 분은 null 로 남긴다(0·보간 금지).
 * 슬롯 수 = floor(마지막 min)+1 (또는 minSlots 가 더 크면 그 값 — 세션 길이를 알 때 끝 빈 구간 유지).
 */
export function bucketByMinute(points: TimelineLikePoint[], id: MetricKey, minSlots = 0): Array<number | null> {
  const valid = points.filter((p) => p.min != null && Number.isFinite(p.min) && (p.min as number) >= 0);
  if (valid.length === 0) return [];
  const lastMin = Math.max(...valid.map((p) => p.min as number));
  const n = Math.max(Math.floor(lastMin) + 1, Math.floor(minSlots));
  const sum = new Array<number>(n).fill(0);
  const cnt = new Array<number>(n).fill(0);
  for (const p of valid) {
    const v = timelineSeriesValue(p, id);
    if (v === null) continue;
    const i = Math.min(n - 1, Math.floor(p.min as number));
    sum[i] += v; cnt[i] += 1;
  }
  return sum.map((s, i) => (cnt[i] > 0 ? s / cnt[i] : null));
}

/** 5분 눈금(0,5,10,… ≤ 슬롯 수). left% 는 슬롯 수 기준. */
export function fiveMinuteTicks(slots: number): Array<{ minute: number; leftPct: number }> {
  if (slots <= 0) return [];
  const out: Array<{ minute: number; leftPct: number }> = [];
  for (let m = 0; m <= slots; m += 5) out.push({ minute: m, leftPct: (m / slots) * 100 });
  return out;
}

/** 슬롯 간격(px): max(1,min(8,160/n)); 그 간격에서 막대 폭이 4px 미만이면 1px. */
export function plotGap(slots: number, widthPx: number): number {
  if (slots <= 0) return 1;
  let gap = Math.max(1, Math.min(8, 160 / slots));
  if ((widthPx - gap * (slots - 1)) / slots < 4) gap = 1;
  return gap;
}

// ---- 변화 박스·캡션 ----

export type ChangeLevel = 'similar' | 'slight' | 'clear';
export type ChangeDir = 'up' | 'down' | 'stable';

const SLIGHT_RATIO = 0.05; // 축 범위 대비 5% 미만 = 비슷
const CLEAR_RATIO = 0.2; // 20% 이상 = 뚜렷하게
const EPS = 1e-9; // 1.2/24 같은 경계의 부동소수 오차 보정

/** 변화 정도 — 축 범위 대비 |delta| 비율. 5%·20% 경계값은 윗단계. */
export function changeLevel(delta: number, axisMin: number, axisMax: number): { level: ChangeLevel; dir: ChangeDir } {
  const span = axisMax - axisMin;
  const r = span > 0 ? Math.abs(delta) / span : 0;
  let level: ChangeLevel = 'similar';
  if (r >= CLEAR_RATIO - EPS) level = 'clear';
  else if (r >= SLIGHT_RATIO - EPS) level = 'slight';
  const dir: ChangeDir = level === 'similar' ? 'stable' : delta > 0 ? 'up' : 'down';
  return { level, dir };
}

/** 변화 박스 숫자 — 부호 포함 소수 1자리(예: +21.0, -3.0, 0.0). 작은 변화도 숫자 그대로. */
export function changeBoxText(delta: number): string {
  const rounded = Math.round(delta * 10) / 10;
  if (rounded === 0) return '0.0';
  return `${rounded > 0 ? '+' : '-'}${Math.abs(rounded).toFixed(1)}`;
}

const MAG_LABEL = { slight: '조금', clear: '뚜렷하게' } as const;

function dirVerb(id: MetricKey, dir: ChangeDir): string {
  if (id === 'respiratory_rate') return dir === 'down' ? '느려졌어요' : '빨라졌어요';
  return dir === 'up' ? '올라갔어요' : '내려갔어요';
}

/** 비교 아래 한 줄 캡션 — 숫자 반복 없음. 지표명은 모두 받침 없음 → '가'(호흡은 '호흡이'). */
export function changeCaption(id: MetricKey, label: string, delta: number, axisMin: number, axisMax: number): string {
  const { level, dir } = changeLevel(delta, axisMin, axisMax);
  if (level === 'similar') return '전반과 후반이 비슷했어요';
  const subject = id === 'respiratory_rate' ? '호흡이' : `${label}가`;
  return `후반에 ${subject} ${MAG_LABEL[level]} ${dirVerb(id, dir)}`;
}

/** 왼쪽 열 해석 한 줄 — 방향 기호 + 전반 대비 방향. 가치 판단(좋아졌어요 등) 없음. */
export function changeInterpretation(id: MetricKey, delta: number, axisMin: number, axisMax: number): string {
  const { dir } = changeLevel(delta, axisMin, axisMax);
  if (dir === 'stable') return '→ 전반 대비 비슷했어요';
  return `${dir === 'up' ? '↑' : '↓'} 전반 대비 ${dirVerb(id, dir)}`;
}

// ---- 평가어 치환 ----

/** 화면에 남으면 안 되는 평가·가치 표현. 치환 후에도 걸리면 숫자 기반 문장으로 대체한다. */
export const EVALUATIVE_PATTERN = /좋아졌|좋아지|나빠졌|나빠지|좋은 신호|나쁜 신호|주의가 필요|불안정|안정적|산만|긴장이 남|흔들|차분해|차분하게|차분한|각성|낮아지는 쪽|높아지는 쪽|깊어졌|깊게|좋음|나쁨|점수|보증/;

function fmt(n: number): string {
  return String(Math.round(n * 10) / 10);
}
function withUnit(id: MetricKey, n: number): string {
  return `${fmt(n)}${METRIC_UNIT[id]}`;
}

/** 규칙 기반 마음 지표 3단계 서사("전체적으로는 … 상태였고, 전반부에는 …") 형태 판별. */
const RULE_MIND_SENTENCE = /^전체적으로는 .+ 상태였고, 전반부에는 .+, 후반부에는 .+만큼 (상승했습니다|하락했습니다|유지됐습니다)\.$/;

/** 숫자 기반 지표 서술(평가어 없음). */
export function numericMetricSentence(metric: Pick<MetricNarrative, 'id' | 'overall' | 'early' | 'late' | 'delta'>, axis: readonly [number, number]): string {
  const { id } = metric;
  const { level, dir } = changeLevel(metric.delta, axis[0], axis[1]);
  const span = `전반 ${withUnit(id, metric.early)}에서 후반 ${withUnit(id, metric.late)}까지`;
  if (level === 'similar') return `${span} 큰 차이 없이 비슷했어요.`;
  return `${span} ${fmt(Math.abs(metric.delta))}${METRIC_UNIT[id]}만큼 ${dirVerb(id, dir)}.`;
}

/** 규칙 기반 몸 지표 문장 중 가치 뉘앙스가 있는 것(정확히 일치하는 문장만 치환). */
const BODY_RULE_REWRITE: Record<string, string> = {
  '심장이 차분해졌어요': '심박수가 내려갔어요',
  '호흡이 고르게 유지됐어요': '호흡수가 비슷했어요',
  '심박이 일정했어요': '심박수가 비슷했어요',
};

/** 자유 문장(LLM 포함)의 평가어를 방향 표현으로 치환. 남는 평가어는 호출부가 폴백한다. */
export function neutralizeEvaluative(text: string, dir: ChangeDir = 'stable'): string {
  const verb = dir === 'up' ? '올라갔어요' : dir === 'down' ? '내려갔어요' : '비슷했어요';
  return text
    .replace(/좋아졌(어요|습니다)/g, verb)
    .replace(/나빠졌(어요|습니다)/g, verb)
    .replace(/주의가 필요(해요|합니다)/g, verb)
    .replace(/(안정적으로|불안정하게|차분하게|더욱 깊게|깊게)\s*/g, '')
    .replace(/산만했/g, '달랐')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * 지표별 회차 서술(metric.sentence) → 평가어 없는 문장.
 * 순서: 규칙 마음 서사/방향 불일치 → 숫자 서술 / 규칙 몸 문장 정확 치환 / 자유 문장 치환 후 평가어가 남으면 숫자 서술.
 */
export function neutralMetricSentence(metric: MetricNarrative, axis: readonly [number, number]): string {
  const levelDir = changeLevel(metric.delta, axis[0], axis[1]).dir;
  const numeric = numericMetricSentence(metric, axis);
  const raw = metric.sentence;
  if (RULE_MIND_SENTENCE.test(raw)) return numeric;
  // 레거시 방향 판정(절대 임계)과 시안 정도 판정(축 비율)이 다르면 문장이 화면 캡션과 어긋나지 않게 숫자 서술을 쓴다.
  if (metric.direction !== levelDir) return numeric;
  const rewritten = BODY_RULE_REWRITE[raw] ?? neutralizeEvaluative(raw, levelDir);
  return EVALUATIVE_PATTERN.test(rewritten) ? numeric : rewritten;
}

// ---- 종합 여정·마무리 ----

const BODY_PHRASE: Record<BodyTrend, string> = {
  relax: '호흡수·심박수가 내려가고 심박변이가 올라가는 쪽으로 움직였고',
  arouse: '호흡수·심박수가 올라가고 심박변이가 내려가는 쪽으로 움직였고',
  stable: '큰 변화 없이 이어졌고',
};
const MIND_PHRASE: Record<MindTrend, string> = {
  calm: '집중도·이완도·감정안정도는 대체로 올라가는 쪽으로 움직였어요.',
  scatter: '집중도·이완도·감정안정도는 대체로 내려가는 쪽으로 움직였어요.',
  stable: '큰 변화 없이 이어졌어요.',
};
export function neutralJourney(body: BodyTrend, mind: MindTrend): string {
  return `몸의 신호는 ${BODY_PHRASE[body]}, 마음의 신호는 ${MIND_PHRASE[mind]}`;
}

const NEUTRAL_CLOSING: Record<BodyTrend, Record<MindTrend, string>> = {
  relax: {
    calm: '오늘의 작은 쉼을 마음에 담고, 내일의 나에게도 같은 시간을 건네 보세요.',
    scatter: '호흡수와 심박수가 내려간 감각을 기억하며, 다음 시간에도 호흡으로 돌아와 보세요.',
    stable: '몸의 신호가 달라진 흐름을 기억하며, 일상에서도 짧은 멈춤을 이어가 보세요.',
  },
  arouse: {
    calm: '마음의 신호가 올라간 감각을 붙잡고, 몸의 리듬도 천천히 맞춰 보세요.',
    scatter: '오늘의 흐름을 있는 그대로 두고, 다음엔 호흡에 조금 더 머물러 보세요.',
    stable: '호흡의 속도에 관심을 두며, 다음 시간의 흐름과 비교해 보세요.',
  },
  stable: {
    calm: '마음의 신호가 올라간 감각을 내일에도 이어가며, 짧은 호흡 명상을 이어가 보세요.',
    scatter: '몸의 리듬은 비슷했으니, 다음에는 마음의 신호가 어떻게 흐르는지 살펴보세요.',
    stable: '오늘의 흐름을 기억하며, 짧은 쉼을 일상에 남겨 두세요.',
  },
};
export function neutralClosing(body: BodyTrend, mind: MindTrend): string {
  return NEUTRAL_CLOSING[body][mind];
}

const BODY_TRENDS: BodyTrend[] = ['relax', 'arouse', 'stable'];
const MIND_TRENDS: MindTrend[] = ['calm', 'scatter', 'stable'];

function matchTrendPair(text: string, make: (b: BodyTrend, m: MindTrend) => string): [BodyTrend, MindTrend] | null {
  // simplifyReportTerms 가 '전반'→'명상 시작(전반)' 등으로 바꿨을 수 있어 공백·괄호 표기를 제거해 비교한다.
  const norm = (s: string) => s.replace(/명상 시작\(전반\)/g, '전반').replace(/마무리\(후반\)/g, '후반').replace(/\s+/g, '');
  for (const b of BODY_TRENDS) for (const m of MIND_TRENDS) if (norm(make(b, m)) === norm(text)) return [b, m];
  return null;
}

export interface NeutralNarrativeInput {
  journey: string; bodyText: string | null; mindText: string | null; closing: string;
  body: MetricNarrative[]; mind: MetricNarrative[];
}
export interface NeutralNarrative { journey: string; bodyText: string | null; mindText: string | null; closing: string }

/** 종합 여정·몸/마음 도입·마무리를 평가어 없는 문장으로. 규칙 템플릿은 중립 템플릿으로, 자유 문장은 치환 후 평가어가 남으면 폴백/제거. */
export function neutralizeNarrative(n: NeutralNarrativeInput): NeutralNarrative {
  const bodyTrend = resolveBodyTrend(n.body);
  const mindTrend = resolveMindTrend(n.mind);
  const journeyPair = matchTrendPair(n.journey, journeySentence);
  const closingPair = matchTrendPair(n.closing, closingSentence);
  const journey = journeyPair ? neutralJourney(...journeyPair) : (() => {
    const t = neutralizeEvaluative(n.journey);
    return EVALUATIVE_PATTERN.test(t) ? neutralJourney(bodyTrend, mindTrend) : t;
  })();
  const closing = closingPair ? neutralClosing(...closingPair) : (() => {
    const t = neutralizeEvaluative(n.closing);
    return EVALUATIVE_PATTERN.test(t) ? neutralClosing(bodyTrend, mindTrend) : t;
  })();
  const clean = (text: string | null): string | null => {
    if (!text) return null;
    const t = neutralizeEvaluative(text);
    return EVALUATIVE_PATTERN.test(t) ? null : t;
  };
  return { journey, closing, bodyText: clean(n.bodyText), mindText: clean(n.mindText) };
}

/** 종합 여정 칩 한 줄(지표 · 변화 부호 소수). */
export function chipLine(metric: Pick<MetricNarrative, 'id' | 'label' | 'delta'>): { label: string; value: string; unit: string } {
  return { label: metric.label, value: changeBoxText(metric.delta), unit: METRIC_UNIT[metric.id] };
}
