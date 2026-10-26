// SDD-246 T06 — LiveState → 화면 모델. 순수 함수.
// - 지표는 LiveState 의 metrics 도메인에서만 읽는다. legacy(rich participant/REST 행)는 신원 표시 필드만 허용.
// - 종합점수 없음: 지표별 값·validity·신선도만 노출한다. null/무효를 0으로 바꾸지 않는다.
import { INTENT_TTL_MS, type LiveState } from './live-state';
import type { Contact, MetricValue } from './live-types';

export const FRESH_DELAY_MS = 3_000;
export const FRESH_STALE_MS = 10_000;

export type Freshness = 'fresh' | 'delayed' | 'stale' | 'time_uncertain' | 'none';

const SEVERITY: Record<'fresh' | 'delayed' | 'stale', number> = { fresh: 0, delayed: 1, stale: 2 };

/**
 * 신선도 — 서버 판정(`metrics.updated.freshness`, T05b)이 기준이다. 클라이언트는 fresh 를 스스로 만들지 않는다.
 * - 서버 판정이 없으면 'none', time_uncertain 이면 관측 시각과 무관하게 time_uncertain(observed_at_ms=null).
 * - 새 관측이 오지 않는 동안에만 경과 시간(nowMs=서버 시각 추정 − observed_at)으로 *낮출* 수 있다(3초 지연/10초 stale). 올리지는 않는다.
 */
export function freshnessOf(observedAtMs: number | null, nowMs: number, serverHint?: string): Freshness {
  if (serverHint === 'time_uncertain') return 'time_uncertain';
  if (serverHint !== 'fresh' && serverHint !== 'delayed' && serverHint !== 'stale') return 'none';
  if (observedAtMs == null) return serverHint;
  const age = nowMs - observedAtMs;
  const aged = age >= FRESH_STALE_MS ? 'stale' : age >= FRESH_DELAY_MS ? 'delayed' : 'fresh';
  return SEVERITY[aged] > SEVERITY[serverHint] ? aged : serverHint;
}

export const METRIC_KEYS = ['focus_display', 'relaxation_display', 'emotion_display', 'bpm', 'respiration', 'sdnn'] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

const EMPTY_METRIC = (unit: string): MetricValue => ({
  value: null, unit, validity: 'gap', reason: 'no_data', last_valid_sequence: null, last_valid_observed_at_ms: null,
});
const UNITS: Record<MetricKey, string> = {
  focus_display: 'score_0_100', relaxation_display: 'score_0_100', emotion_display: 'score_0_100',
  bpm: 'beats_per_min', respiration: 'breaths_per_min', sdnn: 'ms',
};

/** legacy 객체에서 읽어도 되는 신원 필드. 측정·손·장치 필드는 절대 가져오지 않는다. */
const LEGACY_IDENTITY_FIELDS = ['display_name', 'is_guest', 'member_id', 'canonical_member_id', 'user_id'] as const;

export interface MemberRow {
  participantId: string;
  displayName: string;
  isGuest: boolean;
  attendance: string | null;
  connected: boolean;
  handRaised: boolean;
  /** 낙관적 intent 가 표시 중인지(서버 확정 전) */
  handPending: boolean;
  canPublish: boolean;
  sequence: string | null;
  observedAtMs: number | null;
  freshness: Freshness;
  sqi: number | null;
  deviceContact: Contact | null;
  bandState: string | null;
  batteryPct: number | null;
  metrics: Record<MetricKey, MetricValue> & Record<string, MetricValue>;
}

export interface LegacyIdentity {
  participant_id: string;
}

export interface RowOptions {
  nowMs: number;
  legacy?: readonly LegacyIdentity[];
}

export function buildMemberRows(state: LiveState, opts: RowOptions): MemberRow[] {
  const legacyById = new Map((opts.legacy ?? []).map((p) => [p.participant_id, p]));
  const ids = new Set<string>([
    ...Object.keys(state.participation),
    ...Object.keys(state.speaking),
    ...Object.keys(state.metrics),
  ]);
  const rows: MemberRow[] = [];
  for (const id of ids) {
    if (state.removed[id] !== undefined && !state.participation[id]) continue;
    const part = state.participation[id]?.data;
    const spk = state.speaking[id]?.data;
    const met = state.metrics[id]?.data;
    const dev = state.devices[id]?.data;
    const legacy = legacyById.get(id);
    const ident: Record<string, unknown> = {};
    if (legacy) {
      const src = legacy as unknown as Record<string, unknown>;
      for (const f of LEGACY_IDENTITY_FIELDS) if (src[f] !== undefined) ident[f] = src[f];
    }

    const intent = state.intents[`hand:${id}`];
    const handPending = Boolean(intent);
    const handRaised = intent ? intent.value : (spk?.hand_raised ?? false);

    const metrics: Record<string, MetricValue> = {};
    for (const k of METRIC_KEYS) metrics[k] = met?.metrics[k] ?? EMPTY_METRIC(UNITS[k]);
    if (met) for (const [k, v] of Object.entries(met.metrics)) metrics[k] = v;

    rows.push({
      participantId: id,
      displayName: typeof ident.display_name === 'string' ? ident.display_name : '참가자',
      isGuest: ident.is_guest === true,
      attendance: part?.attendance ?? null,
      connected: part?.connected ?? false,
      handRaised,
      handPending,
      canPublish: spk?.can_publish ?? false,
      sequence: met?.sequence ?? null,
      observedAtMs: met?.observed_at_ms ?? null,
      freshness: freshnessOf(met?.observed_at_ms ?? null, opts.nowMs, met?.freshness),
      sqi: met?.sqi ?? dev?.sqi ?? null,
      deviceContact: met?.contact ?? dev?.contact ?? null,
      bandState: dev?.band_state ?? null,
      batteryPct: dev?.battery_pct ?? null,
      metrics: metrics as MemberRow['metrics'],
    });
  }
  return rows.sort((a, b) => a.participantId.localeCompare(b.participantId));
}

export interface DisplayCell {
  /** 화면에 보일 문자열. 값 없음/무효는 '-' 또는 상태 문구. 0 으로 위장하지 않는다. */
  text: string;
  status: 'value' | 'delayed' | 'stale' | 'warming_up' | 'invalid' | 'gap' | 'time_uncertain' | 'none';
  value: number | null;
}

/** 지표 한 칸의 표시 — 신선도와 validity 를 함께 반영(종합 없음). */
export function displayCell(row: MemberRow, key: string): DisplayCell {
  const m = row.metrics[key];
  if (!m || row.freshness === 'none') return { text: '-', status: 'none', value: null };
  if (row.freshness === 'time_uncertain') return { text: '-', status: 'time_uncertain', value: null };
  if (row.freshness === 'stale') return { text: '-', status: 'stale', value: null };
  if (m.validity === 'warming_up') return { text: '측정 중', status: 'warming_up', value: null };
  if (m.validity === 'invalid') return { text: '-', status: 'invalid', value: null };
  if (m.validity === 'gap' || m.value == null) return { text: '-', status: 'gap', value: null };
  const text = String(Math.round(m.value));
  return { text, status: row.freshness === 'delayed' ? 'delayed' : 'value', value: m.value };
}

export function pendingIntentCount(state: LiveState, nowMs: number): number {
  return Object.values(state.intents).filter((i) => nowMs - i.issuedAtMs < INTENT_TTL_MS).length;
}

// ── 5분 막대(데스크톱) / 현재값(모바일) ─────────────────────────

export const BAR_WINDOW_MS = 5 * 60 * 1000;

export interface Bar { startMs: number; mean: number | null; validCount: number }

/**
 * 1Hz 값을 5분 창으로 평균. 무효/지연/stale 값은 평균에 넣지 않고 validCount 로만 드러낸다(0 취급 금지).
 * 같은 sequence 는 한 번만 센다(재전송·늦은 backlog 중복 방지).
 */
export class BarAggregator {
  private bars = new Map<number, { sum: number; n: number; seqs: Set<string> }>();
  private readonly windowMs: number;
  constructor(windowMs: number = BAR_WINDOW_MS) {
    this.windowMs = windowMs;
  }

  add(key: string, sequence: string, observedAtMs: number, value: number | null, usable: boolean): void {
    const start = Math.floor(observedAtMs / this.windowMs) * this.windowMs;
    const b = this.bars.get(start) ?? { sum: 0, n: 0, seqs: new Set<string>() };
    const dedupe = `${key}:${sequence}`;
    if (b.seqs.has(dedupe)) return;
    b.seqs.add(dedupe);
    if (usable && value != null) { b.sum += value; b.n += 1; }
    this.bars.set(start, b);
  }

  series(): Bar[] {
    return [...this.bars.entries()]
      .sort((x, y) => x[0] - y[0])
      .map(([startMs, b]) => ({ startMs, mean: b.n > 0 ? b.sum / b.n : null, validCount: b.n }));
  }
}

export type ViewMode = 'desktop' | 'mobile';
/** 모바일은 현재값만, 데스크톱은 현재값 + 5분 막대. 두 경우 모두 종합점수 없음. */
export function metricPresentation(mode: ViewMode): { showBars: boolean; showCurrent: true; showComposite: false } {
  return { showBars: mode === 'desktop', showCurrent: true, showComposite: false };
}
