// 개선 8: 그룹 익명 집계 상태 지표(적응형 페이싱) — 순수 로직 + 표시 메타.
//
// 1:N 수업에서 상담사가 개인 카드를 일일이 훑지 않아도 그룹 전반 상태를 판단할 수 있도록,
// 백엔드가 밴드 착용자의 이완도·집중도를 **익명 집계**(개인 baseline 대비 상대 평균 + 안정 비율)해
// `class:aggregate` 로 내려준다. 화면은 **단일 게이지**로 차분하게 보여준다.
//
// 계약 원칙 (백엔드 `app/services/group_aggregate.py` 와 동일)
//   1. 개인 점수·순위·식별자는 payload 에 존재하지 않는다 — 이 파일도 만들지 않는다.
//   2. 값 50 = 개인 기준선(baseline)과 동일. 100 = 최대 이완/집중.
//   3. 표본이 적으면(sample_status="insufficient") 점수가 null 이고 게이지는 흐리게 표시한다.
//   4. 점수 경쟁을 유도하는 표현(1등·등수·경고색)을 쓰지 않는다 — 페이스 조절 정보만 남긴다.

/** WS 이벤트명 — 백엔드 `/session-live` 네임스페이스와 동일 계약 */
export const CLASS_AGGREGATE_EVENT = 'class:aggregate';

/** 개인 기준선과 같은 상태를 뜻하는 게이지 값 — 게이지 가운데 눈금 */
export const BASELINE_SCORE = 50;

/** 게이지 좌우 끝 */
export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

/** 서버가 min_wearers 를 주지 않을 때의 폴백(백엔드 MIN_WEARERS 와 동일) */
export const DEFAULT_MIN_WEARERS = 3;

/** 표본 부족 판정의 단일 출처(백엔드 sample_status 와 교차 확인용) */
export type AggregateSampleStatus = 'ok' | 'insufficient';

/** 적응형 페이싱 제안 — 상담사가 안내 속도를 조절하는 근거 */
export type AggregatePace = 'insufficient' | 'slow_down' | 'hold' | 'deepen';

export interface GroupAggregateMetric {
  /** baseline 대비 상대값 0-100 (50 = 기준선). 표본 부족·산출 불가면 null */
  mean: number | null;
  /** 안정 참가자 비율 0-1. 산출 불가면 null */
  stability_ratio: number | null;
}

export interface ClassAggregateEvent {
  session_id?: string;
  /** 서버 산출 시각(ISO) */
  at?: string | null;
  /** EEG 윈도우를 가진 착용자 수 */
  wearer_count: number;
  /** 개인 baseline 캘리브레이션(첫 2분)까지 끝난 인원 */
  calibrated_count: number;
  min_wearers: number;
  /** baseline 캘리브레이션 길이(초) */
  calibration_sec?: number;
  /** 상대값 기준 여부 — 항상 true(절대값 집계가 아님을 계약으로 못박는다) */
  baseline_relative: boolean;
  sample_status: AggregateSampleStatus;
  relaxation: GroupAggregateMetric;
  focus: GroupAggregateMetric;
  pace: AggregatePace;
  pace_hint?: string | null;
}

export const EMPTY_METRIC: GroupAggregateMetric = { mean: null, stability_ratio: null };

const SAMPLE_STATUSES: readonly AggregateSampleStatus[] = ['ok', 'insufficient'] as const;
const PACES: readonly AggregatePace[] = ['insufficient', 'slow_down', 'hold', 'deepen'] as const;

/** 페이스 표시 메타 — 차분한 톤(경고색·강조색 금지) */
export interface PaceMeta {
  /** 칩 라벨 */
  label: string;
  /** 칩 색조 클래스 */
  chipClass: string;
}

export const PACE_META: Record<AggregatePace, PaceMeta> = {
  insufficient: {
    label: '표본 적음',
    chipClass: 'bg-[#F2F3F8] text-[#6F6F6F]',
  },
  slow_down: {
    label: '페이스 늦추기',
    chipClass: 'bg-[#EFE7F7] text-[#5F0080]',
  },
  hold: {
    label: '지금 페이스 유지',
    chipClass: 'bg-[#EAF6EF] text-[#2F9E68]',
  },
  deepen: {
    label: '한 단계 깊게',
    chipClass: 'bg-[#E7EFF9] text-[#2C5C8F]',
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asMetric = (value: unknown): GroupAggregateMetric => {
  if (!isRecord(value)) return { ...EMPTY_METRIC };
  const mean = typeof value.mean === 'number' && Number.isFinite(value.mean) ? value.mean : null;
  const ratio =
    typeof value.stability_ratio === 'number' && Number.isFinite(value.stability_ratio)
      ? value.stability_ratio
      : null;
  return { mean, stability_ratio: ratio };
};

/** 서버 payload 검증 — 미정의 값은 계약 밖이므로 null(조용히 무시) */
export function isClassAggregateEvent(value: unknown): value is ClassAggregateEvent {
  if (!isRecord(value)) return false;
  if (typeof value.sample_status !== 'string') return false;
  if (!(SAMPLE_STATUSES as readonly string[]).includes(value.sample_status)) return false;
  if (typeof value.pace !== 'string' || !(PACES as readonly string[]).includes(value.pace)) {
    return false;
  }
  return typeof value.wearer_count === 'number';
}

/** 수신 payload 정규화 — 누락 필드는 안전한 기본값으로 접는다(크래시 금지) */
export function normalizeAggregate(raw: unknown): ClassAggregateEvent | null {
  if (!isClassAggregateEvent(raw)) return null;
  const record = raw as unknown as Record<string, unknown>;
  const minWearers =
    typeof record.min_wearers === 'number' && record.min_wearers > 0
      ? record.min_wearers
      : DEFAULT_MIN_WEARERS;
  return {
    session_id: typeof record.session_id === 'string' ? record.session_id : undefined,
    at: typeof record.at === 'string' ? record.at : null,
    wearer_count: Math.max(0, Math.trunc(raw.wearer_count)),
    calibrated_count:
      typeof record.calibrated_count === 'number' ? Math.max(0, Math.trunc(record.calibrated_count)) : 0,
    min_wearers: minWearers,
    calibration_sec: typeof record.calibration_sec === 'number' ? record.calibration_sec : undefined,
    baseline_relative: record.baseline_relative !== false,
    sample_status: raw.sample_status,
    relaxation: asMetric(record.relaxation),
    focus: asMetric(record.focus),
    pace: raw.pace,
    pace_hint: typeof record.pace_hint === 'string' ? record.pace_hint : null,
  };
}

/** 표본이 충분한가 — 서버 판정 + 착용자 수 교차 확인(둘 중 하나라도 부족하면 흐리게) */
export function isSampleSufficient(event: ClassAggregateEvent): boolean {
  return event.sample_status === 'ok' && event.wearer_count >= event.min_wearers;
}

/** 게이지 값 클램프 — null 은 null(0 치환 금지) */
export function clampScore(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, value));
}

/** 기준선 대비 편차(정수) — "+12 / -4 / 0" */
export function metricOffset(value: number | null): number | null {
  const clamped = clampScore(value);
  return clamped === null ? null : Math.round(clamped - BASELINE_SCORE);
}

/** 게이지 좌표(%) — 값이 없으면 기준선(가운데)에 둔다(위치로 의미를 만들어내지 않는다) */
export function markerPercent(value: number | null): number {
  return clampScore(value) ?? BASELINE_SCORE;
}

const scoreLabelFor = (label: string, value: number | null, ratio: number | null): string => {
  if (value === null) return `${label} 산출 대기`;
  const offset = metricOffset(value) ?? 0;
  const relative = offset === 0 ? '기준선' : `기준선 ${offset > 0 ? '+' : ''}${offset}`;
  const stability = ratio === null ? null : `안정 ${Math.round(ratio * 100)}%`;
  return stability ? `${label} ${relative} · ${stability}` : `${label} ${relative}`;
};

export interface GaugeMarker {
  key: 'relaxation' | 'focus';
  label: string;
  /** 0-100 값 (산출 불가면 null) */
  value: number | null;
  /** 게이지 내 위치(%) */
  percent: number;
  /** 마커 점 색조 */
  dotClass: string;
  lineClass: string;
  /** 표시 문구 — "이완 기준선 +12 · 안정 67%" */
  text: string;
}

export interface GroupGaugeModel {
  /** 표본 부족/대기 → 흐리게 표시 */
  dimmed: boolean;
  sampleLabel: string;
  markers: GaugeMarker[];
  pace: AggregatePace;
  paceLabel: string;
  paceChipClass: string;
  hint: string;
  ariaLabel: string;
}

const WAITING_HINT = '실시간 집계를 기다리는 중입니다.';

/**
 * 수신 집계 → 단일 게이지 표시 모델.
 * aggregate 가 null(아직 수신 전)이면 "대기" 상태의 흐린 게이지를 만든다.
 */
export function buildGaugeModel(aggregate: ClassAggregateEvent | null): GroupGaugeModel {
  if (!aggregate) {
    return {
      dimmed: true,
      sampleLabel: '집계 대기',
      markers: [
        {
          key: 'relaxation',
          label: '이완',
          value: null,
          percent: BASELINE_SCORE,
          dotClass: 'bg-[#B9A5CE]',
          lineClass: 'bg-[#D9CEE6]',
          text: scoreLabelFor('이완', null, null),
        },
        {
          key: 'focus',
          label: '집중',
          value: null,
          percent: BASELINE_SCORE,
          dotClass: 'bg-[#A8CBB7]',
          lineClass: 'bg-[#CFE4D8]',
          text: scoreLabelFor('집중', null, null),
        },
      ],
      pace: 'insufficient',
      paceLabel: '집계 대기',
      paceChipClass: 'bg-[#F2F3F8] text-[#9B9B9B]',
      hint: WAITING_HINT,
      ariaLabel: '그룹 익명 집계 — 집계 대기 중',
    };
  }

  const sufficient = isSampleSufficient(aggregate);
  const relaxation = sufficient ? clampScore(aggregate.relaxation.mean) : null;
  const focus = sufficient ? clampScore(aggregate.focus.mean) : null;
  const relaxationRatio = sufficient ? aggregate.relaxation.stability_ratio : null;
  const focusRatio = sufficient ? aggregate.focus.stability_ratio : null;

  const markers: GaugeMarker[] = [
    {
      key: 'relaxation',
      label: '이완',
      value: relaxation,
      percent: markerPercent(relaxation),
      dotClass: 'bg-[#5F0080]',
      lineClass: 'bg-[#5F0080]',
      text: scoreLabelFor('이완', relaxation, relaxationRatio),
    },
    {
      key: 'focus',
      label: '집중',
      value: focus,
      percent: markerPercent(focus),
      dotClass: 'bg-[#2F9E68]',
      lineClass: 'bg-[#2F9E68]',
      text: scoreLabelFor('집중', focus, focusRatio),
    },
  ];

  const pace: AggregatePace = sufficient ? aggregate.pace : 'insufficient';
  const meta = PACE_META[pace];
  const sampleLabel = sufficient
    ? `착용 ${aggregate.wearer_count}명`
    : `표본 적음 · 착용 ${aggregate.wearer_count}명`;

  return {
    dimmed: !sufficient,
    sampleLabel,
    markers,
    pace,
    paceLabel: sufficient ? meta.label : PACE_META.insufficient.label,
    paceChipClass: sufficient ? meta.chipClass : PACE_META.insufficient.chipClass,
    hint: sufficient ? aggregate.pace_hint ?? '' : aggregate.pace_hint ?? WAITING_HINT,
    ariaLabel: sufficient
      ? `그룹 익명 집계 — ${markers.map((m) => m.text).join(', ')}`
      : `그룹 익명 집계 — ${sampleLabel}`,
  };
}
