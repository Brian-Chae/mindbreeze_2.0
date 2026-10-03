// SDD-096 — 세션 직후 1탭 셀프 체크인(주관 상태) API + 파생 헬퍼
//
// 종료 화면의 SAM 2축(각성·정서) 5단계 + 선택형 한 줄 소감을 저장하고,
// 기록지·리포트가 같은 계약(subjective_state)을 공유한다.
// 미입력은 null 로 보존한다(0/빈 문자열 치환 금지).

import { ApiError, apiClient, refreshAccessToken, tokenStorage } from './client';

/** 체크인 시점 — after(세션 직후, 기본) / before(수업 전 예상) */
export type CheckinPhase = 'before' | 'after';

/** SAM 5단계 — 1~5 (null 은 미선택) */
export type SamValue = 1 | 2 | 3 | 4 | 5;

export interface SubjectiveSlotDto {
  arousal: number | null;
  valence: number | null;
  note: string | null;
  recorded_at: string | null;
}

export interface SubjectiveStateDto {
  scope: 'participant' | 'session';
  before: SubjectiveSlotDto | null;
  after: SubjectiveSlotDto | null;
  /** scope=session 일 때 참여자별 슬롯 */
  participants?: Record<string, { before: SubjectiveSlotDto | null; after: SubjectiveSlotDto | null }>;
}

export interface CheckinPayload {
  phase?: CheckinPhase;
  arousal?: number | null;
  valence?: number | null;
  note?: string | null;
  participant_id?: string | null;
  participant_token?: string | null;
}

export interface CheckinResponse {
  session_id: string;
  participant_id: string | null;
  phase: CheckinPhase;
  subjective_state: SubjectiveStateDto;
}

/** SAM 축 정의 — 화면·리포트가 동일 라벨을 쓴다 */
export interface SamAxisDef {
  key: 'arousal' | 'valence';
  label: string;
  /** 1단계(낮음) → 5단계(높음) 라벨 */
  steps: Record<SamValue, string>;
}

export const SAM_AXES: readonly SamAxisDef[] = [
  {
    key: 'arousal',
    label: '각성',
    steps: {
      1: '아주 차분해요',
      2: '조용해요',
      3: '보통이에요',
      4: '조금 긴장돼요',
      5: '아주 각성돼요',
    },
  },
  {
    key: 'valence',
    label: '정서',
    steps: {
      1: '아주 불편해요',
      2: '불편해요',
      3: '보통이에요',
      4: '좋아요',
      5: '아주 좋아요',
    },
  },
] as const;

export const SAM_VALUES: readonly SamValue[] = [1, 2, 3, 4, 5] as const;

/** SAM 값(1~5) → 단계 라벨(예: 각성 4 → '조금 긴장돼요'). null/무효면 null. */
export function samStepLabel(key: 'arousal' | 'valence', value: number | null): string | null {
  if (value === null || value === undefined) return null;
  const axis = SAM_AXES.find((a) => a.key === key);
  if (!axis) return null;
  return axis.steps[value as SamValue] ?? null;
}

export const CHECKIN_SKIP_STORAGE_KEY = 'mb_checkin_skipped';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asSamValue(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= 1 && value <= 5 ? value : null;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** 저장/응답 슬롯 → UI 슬롯. 값이 없으면 null. */
export function parseSubjectiveSlot(raw: unknown): SubjectiveSlotDto | null {
  if (!isRecord(raw)) return null;
  const slot: SubjectiveSlotDto = {
    arousal: asSamValue(raw.arousal),
    valence: asSamValue(raw.valence),
    note: asStringOrNull(raw.note),
    recorded_at: asStringOrNull(raw.recorded_at),
  };
  if (slot.arousal === null && slot.valence === null && slot.note === null) return null;
  return slot;
}

/**
 * BE subjective_state(알 수 없는 JSON) → UI 계약.
 * 참여자 스코프는 before/after 를, 세션 스코프는 participants 맵을 파싱한다.
 */
export function parseSubjectiveState(raw: unknown): SubjectiveStateDto | null {
  if (!isRecord(raw)) return null;
  const scope = raw.scope === 'session' ? 'session' : 'participant';
  if (scope === 'session') {
    const participantsRaw = isRecord(raw.participants) ? raw.participants : {};
    const participants: SubjectiveStateDto['participants'] = {};
    for (const [pid, entry] of Object.entries(participantsRaw)) {
      if (!isRecord(entry)) continue;
      participants[pid] = {
        before: parseSubjectiveSlot(entry.before),
        after: parseSubjectiveSlot(entry.after),
      };
    }
    if (Object.keys(participants).length === 0) return null;
    return { scope: 'session', before: null, after: null, participants };
  }
  const before = parseSubjectiveSlot(raw.before);
  const after = parseSubjectiveSlot(raw.after);
  if (before === null && after === null) return null;
  return { scope: 'participant', before, after };
}

/**
 * 체크인 저장 — 로그인 회원은 액세스 토큰으로, 비로그인 게스트는
 * participant_token 소유 증명으로 호출한다(손들기·LiveKit 토큰과 동일한 인증 분기).
 */
export async function submitCheckin(
  sessionId: string,
  payload: CheckinPayload,
  options?: { skipAuth?: boolean },
): Promise<CheckinResponse> {
  const path = `/sessions/${encodeURIComponent(sessionId)}/checkin`;
  const body = {
    phase: payload.phase ?? 'after',
    arousal: payload.arousal ?? null,
    valence: payload.valence ?? null,
    note: payload.note ?? null,
    participant_id: payload.participant_id ?? null,
    participant_token: payload.participant_token ?? null,
  };
  if (options?.skipAuth) {
    return apiClient.post<CheckinResponse>(path, body, { skipAuth: true });
  }
  if (tokenStorage.getAccess()) {
    const refreshedToken = await refreshAccessToken();
    if (!refreshedToken) {
      throw new ApiError(401, '로그인이 만료되었습니다. 다시 로그인해주세요.', null);
    }
    return apiClient.post<CheckinResponse>(path, body);
  }
  return apiClient.post<CheckinResponse>(path, body, { skipAuth: true });
}

export interface SubjectiveComparison {
  /** before 값이 있어 대비가 성립하는지 */
  hasBefore: boolean;
  arousalDelta: number | null;
  valenceDelta: number | null;
  /** "각성 4 → 2 (−2) · 정서 2 → 5 (+3)" 형태의 요약. 값이 없으면 null */
  summary: string | null;
}

function deltaText(label: string, before: number | null, after: number | null): string | null {
  if (before === null || after === null) return null;
  const diff = after - before;
  const sign = diff > 0 ? `+${diff}` : `${diff}`;
  return `${label} ${before} → ${after} (${sign})`;
}

/**
 * 수업 전 예상 ↔ 수업 후 대비 — 리포트 카드/종료 화면이 공유한다.
 * 두 시점 중 한쪽 값이 없으면 그 축은 대비에서 제외한다(허수 대비 금지).
 */
export function buildSubjectiveComparison(
  before: SubjectiveSlotDto | null,
  after: SubjectiveSlotDto | null,
): SubjectiveComparison {
  const parts = [
    deltaText('각성', before?.arousal ?? null, after?.arousal ?? null),
    deltaText('정서', before?.valence ?? null, after?.valence ?? null),
  ].filter((part): part is string => part !== null);

  const arousalDelta =
    before?.arousal !== null && before?.arousal !== undefined && after?.arousal !== null && after?.arousal !== undefined
      ? after.arousal - before.arousal
      : null;
  const valenceDelta =
    before?.valence !== null && before?.valence !== undefined && after?.valence !== null && after?.valence !== undefined
      ? after.valence - before.valence
      : null;

  return {
    hasBefore: parts.length > 0,
    arousalDelta,
    valenceDelta,
    summary: parts.length > 0 ? parts.join(' · ') : null,
  };
}
