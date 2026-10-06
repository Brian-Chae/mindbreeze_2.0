// 사전(입장 전)·사후(수업 후) 설문(주관 상태) API + 파생 헬퍼
//
// 집중·편안함·감정 3축 5단계 + 선택형 한 줄 소감을 저장하고,
// 기록지·리포트가 같은 계약(subjective_state)을 공유한다.
// 미입력은 null 로 보존한다(0/빈 문자열 치환 금지).

import { apiClient, refreshAccessToken, tokenStorage } from './client';
import { isAccessTokenExpiring } from './token-expiry';

/** 체크인 시점 — after(세션 직후 사후 설문, 기본) / before(입장 전 체크인) */
export type CheckinPhase = 'before' | 'after';

/** SAM 5단계 — 1~5 (null 은 미선택) */
export type SamValue = 1 | 2 | 3 | 4 | 5;

export interface SubjectiveSlotDto {
  arousal: number | null;
  valence: number | null;
  emotion: number | null;
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
  emotion?: number | null;
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
  key: 'arousal' | 'valence' | 'emotion';
  label: string;
  /** 1단계(낮음) → 5단계(높음) 라벨 */
  steps: Record<SamValue, string>;
}

/**
 * 체크인 3축 정의 — 사전(입장 전)·사후(수업 후) 설문이 동일 라벨을 쓴다.
 * 집중(arousal)·편안함(valence)·감정(emotion)으로, 리포트의 뇌파 지표(집중·휴식·정서)와 같은 축이다.
 */
export const SAM_AXES: readonly SamAxisDef[] = [
  {
    key: 'arousal',
    label: '집중',
    steps: {
      1: '매우 산만',
      2: '산만',
      3: '보통',
      4: '집중',
      5: '매우 집중',
    },
  },
  {
    key: 'valence',
    label: '편안함',
    steps: {
      1: '매우 불편',
      2: '불편',
      3: '보통',
      4: '편안',
      5: '매우 편안',
    },
  },
  {
    key: 'emotion',
    label: '감정',
    steps: {
      1: '매우 부정적',
      2: '부정적',
      3: '보통',
      4: '긍정적',
      5: '매우 긍정적',
    },
  },
] as const;

export const SAM_VALUES: readonly SamValue[] = [1, 2, 3, 4, 5] as const;

/** SAM 축 키 — 집중(arousal)·편안함(valence)·감정(emotion) */
export type AxisKey = 'arousal' | 'valence' | 'emotion';

/** 설문 3축 선택 상태 — 각 축 1~5 또는 미선택(null) */
export type MoodState = Record<AxisKey, SamValue | null>;

/** 설문 UI 단계 — 입력 / 저장 완료 / 건너뛰기 */
export type CheckinDraftPhase = 'input' | 'done' | 'skipped';

/** 설문 초안 — 대기 화면↔준비 재확인 왕복에도 선택·입력 값을 유지하기 위해 부모가 보존한다 */
export interface CheckinDraft {
  mood: MoodState;
  note: string;
  phase: CheckinDraftPhase;
}

export const EMPTY_CHECKIN_DRAFT: CheckinDraft = {
  mood: { arousal: null, valence: null, emotion: null },
  note: '',
  phase: 'input',
};

/** SAM 값(1~5) → 단계 라벨(예: 집중 4 → '집중'). null/무효면 null. */
export function samStepLabel(key: 'arousal' | 'valence' | 'emotion', value: number | null): string | null {
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
    emotion: asSamValue(raw.emotion),
    note: asStringOrNull(raw.note),
    recorded_at: asStringOrNull(raw.recorded_at),
  };
  if (slot.arousal === null && slot.valence === null && slot.emotion === null && slot.note === null) return null;
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
    emotion: payload.emotion ?? null,
    note: payload.note ?? null,
    participant_id: payload.participant_id ?? null,
    participant_token: payload.participant_token ?? null,
  };
  if (options?.skipAuth) {
    return apiClient.post<CheckinResponse>(path, body, { skipAuth: true });
  }
  const accessToken = tokenStorage.getAccess();
  if (accessToken) {
    // API7-04: 유효한 access token 은 그대로 사용한다. 만료 임박/만료 토큰만 1회 선제 갱신하고,
    // 갱신 실패(네트워크·서버)를 '로그인 만료'로 단정하지 않는다 — apiClient 의 401 경로가
    // invalid/ network / server 를 구분해 처리한다.
    if (isAccessTokenExpiring(accessToken)) {
      await refreshAccessToken();
    }
    return apiClient.post<CheckinResponse>(path, body);
  }
  return apiClient.post<CheckinResponse>(path, body, { skipAuth: true });
}
