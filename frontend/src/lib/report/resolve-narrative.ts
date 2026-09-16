/**
 * LLM 서사(content.eeg.narrative) + 규칙 기반 폴백(narrative.ts) 해석.
 * LLM 실패·미생성 시에도 변화량이 있으면 규칙 서사로 표시한다.
 */

import {
  buildReportNarrative,
  metricChangeInterpretation,
  simplifyReportTerms,
  type Direction,
  type MetricChangeInput,
  type MetricId,
  type MetricNarrative,
  type ReportNarrative,
} from './narrative';

/** 백엔드 LLM / 규칙 폴백이 content.eeg.narrative 에 넣는 계약 */
export interface LlmNarrativePayload {
  journey?: string | null;
  body?: string | null;
  mind?: string | null;
  closing?: string | null;
  /** 선택: 전반/후반 평균 (규칙 폴백·변화량 표시용) */
  changes?: MetricChangeInput[] | null;
}

export interface DisplayNarrative {
  journey: string;
  /** LLM 몸 문단(있으면 섹션 상단 표시) */
  bodyText: string | null;
  mindText: string | null;
  closing: string;
  body: MetricNarrative[];
  mind: MetricNarrative[];
  source: 'llm' | 'rule';
  /** 실제 측정 시계열. 구형 호출자는 생략할 수 있다. */
  timeline?: TimelineLikePoint[];
}

export interface TimelineLikePoint {
  /** 세션 시작 후 경과 시간(분) */
  min?: number;
  concentration?: number | null;
  relaxation?: number | null;
  stress?: number | null;
  heart_rate?: number | null;
  respiratory_rate?: number | null;
  sdnn?: number | null;
  hrv?: number | null;
}

const BODY_IDS: MetricId[] = ['respiratory_rate', 'heart_rate', 'hrv'];
const MIND_IDS: MetricId[] = ['focus', 'relaxation', 'emotional_stability'];
const ALL_IDS: MetricId[] = [...BODY_IDS, ...MIND_IDS];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return value;
}

function asMetricId(value: unknown): MetricId | null {
  if (typeof value !== 'string') return null;
  return ALL_IDS.includes(value as MetricId) ? (value as MetricId) : null;
}

/** content.eeg.narrative 파싱 — 필드 일부만 있어도 허용 */
export function parseLlmNarrative(raw: unknown): LlmNarrativePayload | null {
  if (!isRecord(raw)) return null;

  const journey = asString(raw.journey);
  const body = asString(raw.body) ?? asString(raw.body_text);
  const mind = asString(raw.mind) ?? asString(raw.mind_text);
  const closing = asString(raw.closing) ?? asString(raw.closing_text);
  const changes = parseMetricChanges(raw.changes);

  if (!journey && !body && !mind && !closing && (!changes || changes.length === 0)) {
    return null;
  }

  return { journey, body, mind, closing, changes };
}

export function parseMetricChanges(raw: unknown): MetricChangeInput[] | null {
  if (!Array.isArray(raw)) return null;
  const out: MetricChangeInput[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = asMetricId(item.id);
    const early = asNumber(item.early);
    const late = asNumber(item.late);
    if (!id || early === null || late === null) continue;
    out.push({ id, early, late });
  }
  return out.length > 0 ? out : null;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function halfSeries(
  points: TimelineLikePoint[],
  pick: (p: TimelineLikePoint) => number | null | undefined,
): { early: number; late: number } | null {
  if (points.length < 2) return null;
  const mid = Math.floor(points.length / 2);
  const earlyVals: number[] = [];
  const lateVals: number[] = [];
  points.forEach((p, i) => {
    const v = pick(p);
    if (v === null || v === undefined || Number.isNaN(v)) return;
    if (i < mid) earlyVals.push(v);
    else lateVals.push(v);
  });
  const early = avg(earlyVals);
  const late = avg(lateVals);
  if (early === null || late === null) return null;
  return { early, late };
}

/**
 * 타임라인에서 전반/후반 평균 유도.
 * emotional_stability 시계열이 없으면 stress 역수(100−)로 근사.
 */
export function deriveChangesFromTimeline(
  timeline: TimelineLikePoint[],
): MetricChangeInput[] | null {
  if (!timeline || timeline.length < 2) return null;

  const pairs: Array<{ id: MetricId; half: { early: number; late: number } | null }> = [
    { id: 'respiratory_rate', half: halfSeries(timeline, (p) => p.respiratory_rate) },
    { id: 'heart_rate', half: halfSeries(timeline, (p) => p.heart_rate) },
    {
      id: 'hrv',
      half: halfSeries(timeline, (p) => p.sdnn ?? p.hrv ?? null),
    },
    { id: 'focus', half: halfSeries(timeline, (p) => p.concentration) },
    { id: 'relaxation', half: halfSeries(timeline, (p) => p.relaxation) },
    {
      id: 'emotional_stability',
      half: halfSeries(timeline, (p) => {
        if (p.stress === null || p.stress === undefined) return null;
        // stress 가 0~1 이면 역수, 0~100 이면 100−
        return p.stress <= 1 ? 1 - p.stress : 100 - p.stress;
      }),
    },
  ];

  const changes: MetricChangeInput[] = [];
  for (const { id, half } of pairs) {
    if (!half) return null; // 6지표 모두 필요 (규칙 빌더 계약)
    changes.push({ id, early: half.early, late: half.late });
  }
  return changes;
}

function tryBuildRuleNarrative(changes: MetricChangeInput[]): ReportNarrative | null {
  const byId = new Map(changes.map((c) => [c.id, c]));
  for (const id of ALL_IDS) {
    if (!byId.has(id)) return null;
  }
  try {
    return buildReportNarrative(ALL_IDS.map((id) => byId.get(id)!));
  } catch {
    return null;
  }
}

function emptyMetricsFromChanges(changes: MetricChangeInput[]): {
  body: MetricNarrative[];
  mind: MetricNarrative[];
} | null {
  const built = tryBuildRuleNarrative(changes);
  if (!built) return null;
  return { body: built.body, mind: built.mind };
}

/**
 * LLM 서사 우선, 없으면 규칙 폴백.
 * 서사 텍스트·변화량 모두 없으면 null (섹션 미노출).
 */
export function resolveDisplayNarrative(input: {
  narrative: LlmNarrativePayload | null;
  /** eeg.changes 등 별도 변화량 */
  changes?: MetricChangeInput[] | null;
  timeline?: TimelineLikePoint[] | null;
}): DisplayNarrative | null {
  const llm = input.narrative;
  const changes =
    llm?.changes ??
    input.changes ??
    (input.timeline ? deriveChangesFromTimeline(input.timeline) : null);

  const rule = changes ? tryBuildRuleNarrative(changes) : null;
  const metrics = rule
    ? { body: rule.body, mind: rule.mind }
    : changes
      ? emptyMetricsFromChanges(changes)
      : null;

  const journey = llm?.journey ?? rule?.journey ?? null;
  const bodyText = llm?.body ?? null;
  const mindText = llm?.mind ?? null;
  const closing = llm?.closing ?? rule?.closing ?? null;

  const hasText = Boolean(journey || bodyText || mindText || closing);
  const hasMetrics = Boolean(metrics && (metrics.body.length > 0 || metrics.mind.length > 0));

  if (!hasText && !hasMetrics) return null;

  const source: 'llm' | 'rule' =
    llm && (llm.journey || llm.body || llm.mind || llm.closing) ? 'llm' : 'rule';

  return {
    journey: simplifyReportTerms(journey ?? '오늘의 몸과 마음 흐름을 살펴보세요.'),
    bodyText: bodyText ? simplifyReportTerms(bodyText) : null,
    mindText: mindText ? simplifyReportTerms(mindText) : null,
    closing: simplifyReportTerms(closing ?? '오늘의 작은 쉼을 마음에 담아 보세요.'),
    body: metrics?.body ?? [],
    mind: metrics?.mind ?? [],
    source,
    timeline: input.timeline ? input.timeline.map((point) => ({ ...point })) : [],
  };
}

export function chipLabel(metrics: MetricNarrative[]): string {
  return metrics
    .map((m) => `${m.id === 'hrv' ? '심박변이' : m.label.replace('안정도', '안정')} ${m.arrow} ${metricChangeInterpretation(m.id, m.direction)}`)
    .join(' · ');
}

export function directionLabel(direction: Direction): string {
  if (direction === 'up') return '상승';
  if (direction === 'down') return '하락';
  return '유지';
}
