// SDD-209 M0 — 로그인 없는 4자리 코드 입장 + 입장 자격 기반 참가자 API 어댑터.
// session.ts 는 수정하지 않고, 구 by-code 경로는 폴백으로도 호출하지 않는다.
// 코드는 입장 요청에만 쓰고 이후 요청의 인증 수단은 입장 자격(X-Entry-Credential)이다.
import { apiClient, refreshAccessToken, tokenStorage } from './client';
import { isAccessTokenExpiring } from './token-expiry';
import type { SessionDto } from './session';

export const ENTRY_HEADER = 'X-Entry-Credential';

export type EntryGender = 'male' | 'female' | 'other';

export interface EntryVerifyResult {
  title: string | null;
  scheduled_at: string | null;
  host_name: string | null;
}

export interface EnterPayload {
  code: string;
  name?: string;
  gender?: EntryGender;
  /** YYYY-MM-DD — 서버가 연·월만 보관한다 */
  birth_date?: string;
  email?: string;
}

export type EntrySessionDto = SessionDto & { host_name?: string | null };

export interface EnterResult {
  entry_credential: string | null;
  expires_at: string | null;
  participant_id: string | null;
  is_guest: boolean;
  is_waitlisted: boolean;
  session: EntrySessionDto;
}

export interface EntryStateDto {
  session_id: string;
  status: SessionDto['status'];
  guest_state: 'waiting' | 'meditation' | 'complete' | 'cancelled';
  in_progress: boolean;
  ended: boolean;
  participant_id: string;
  is_waitlisted: boolean;
  /** 본인의 리포트 반영 선택(기본 제외) */
  report_included: boolean;
  chat_enabled: boolean;
  band_connected: boolean;
}

export interface ReportChoiceResult {
  participant_id: string;
  report_included: boolean;
  changed: boolean;
}

export interface ResearchConsentResult {
  participant_id: string;
  consented: boolean;
  changed: boolean;
}

export interface WaitlistCancelResult {
  participant_id: string;
  cancelled: boolean;
  changed: boolean;
}

export interface EntryLiveKitToken {
  livekit_token: string;
  webrtc_room_id: string;
  can_publish: boolean;
}

export interface EntryRequestOptions {
  skipAuth: boolean;
  headers: Record<string, string>;
}

/**
 * 요청 옵션. 로그인하지 않은 참가자는 skipAuth 로 보내 401 시 로그인 화면 이동·세션 폐기 경로를 타지 않게 한다.
 * 로그인 회원은 Authorization 이 함께 가서 서버가 계정과 참여자를 연결한다.
 */
export function entryRequestOptions(credential: string | null): EntryRequestOptions {
  return {
    skipAuth: !tokenStorage.getAccess(),
    headers: credential ? { [ENTRY_HEADER]: credential } : {},
  };
}

/** 만료 임박 토큰만 1회 선제 갱신한다(실패해도 던지지 않는다 — 이어지는 요청의 401 경로가 처리) */
async function prepareMemberToken(): Promise<void> {
  const accessToken = tokenStorage.getAccess();
  if (accessToken && isAccessTokenExpiring(accessToken)) await refreshAccessToken();
}

export async function verifyEntryCode(code: string): Promise<EntryVerifyResult> {
  return apiClient.post<EntryVerifyResult>('/sessions/enter/verify', { code }, { skipAuth: true });
}

export async function enterByCode(payload: EnterPayload): Promise<EnterResult> {
  await prepareMemberToken();
  return apiClient.post<EnterResult>('/sessions/enter', payload, entryRequestOptions(null));
}

/** 초대받은 로그인 회원의 편의 입장 — 코드 없이 초대 행으로 같은 자격을 받는다 */
export async function enterInvitedSession(sessionId: string): Promise<EnterResult> {
  await prepareMemberToken();
  return apiClient.post<EnterResult>(`/sessions/${encodeURIComponent(sessionId)}/enter`, undefined, { skipAuth: false });
}

export async function getEntryState(sessionId: string, credential: string | null): Promise<EntryStateDto> {
  await prepareMemberToken();
  return apiClient.get<EntryStateDto>(`/sessions/${encodeURIComponent(sessionId)}/entry-state`, entryRequestOptions(credential));
}

export async function setReportChoice(
  sessionId: string,
  credential: string | null,
  body: { participantId: string; reportIncluded: boolean; noticeAcknowledged: boolean; noticeVersion?: string },
): Promise<ReportChoiceResult> {
  await prepareMemberToken();
  return apiClient.put<ReportChoiceResult>(
    `/sessions/${encodeURIComponent(sessionId)}/report-choice`,
    {
      participant_id: body.participantId,
      report_included: body.reportIncluded,
      notice_acknowledged: body.noticeAcknowledged,
      notice_version: body.noticeVersion ?? null,
    },
    entryRequestOptions(credential),
  );
}

export async function setResearchConsent(
  sessionId: string,
  credential: string | null,
  body: { participantId: string; consented: boolean; noticeVersion?: string },
): Promise<ResearchConsentResult> {
  await prepareMemberToken();
  return apiClient.put<ResearchConsentResult>(
    `/sessions/${encodeURIComponent(sessionId)}/research-consent`,
    { consented: body.consented, notice_version: body.noticeVersion ?? null, participant_id: body.participantId },
    entryRequestOptions(credential),
  );
}

export async function cancelWaitlist(sessionId: string, credential: string | null): Promise<WaitlistCancelResult> {
  await prepareMemberToken();
  return apiClient.post<WaitlistCancelResult>(
    `/sessions/${encodeURIComponent(sessionId)}/waitlist/cancel`,
    undefined,
    entryRequestOptions(credential),
  );
}

export async function getEntryLiveKitToken(sessionId: string, credential: string | null): Promise<EntryLiveKitToken> {
  await prepareMemberToken();
  return apiClient.post<EntryLiveKitToken>(
    `/sessions/${encodeURIComponent(sessionId)}/entry/livekit-token`,
    undefined,
    entryRequestOptions(credential),
  );
}

export interface EntryCheckinPayload {
  phase: 'before' | 'after';
  arousal: number | null;
  valence: number | null;
  emotion: number | null;
  note: string | null;
  participant_id: string;
}

/** 입장 전·후 오늘의 상태 저장 — 참여자 토큰이 아니라 입장 자격으로 소유권을 증명한다 */
export async function submitEntryCheckin(sessionId: string, credential: string | null, payload: EntryCheckinPayload): Promise<void> {
  await prepareMemberToken();
  await apiClient.post<unknown>(`/sessions/${encodeURIComponent(sessionId)}/checkin`, payload, entryRequestOptions(credential));
}

/* ───────────────────────── 입장 자격 저장 (탭 단위) ───────────────────────── */

/** 새로고침 뒤 화면을 다시 그리기 위한 클래스 요약 — 개인정보가 아니다(제목·시각·방식 설정) */
export interface EntryClassInfo {
  title: string | null;
  hostName: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  durationMin: number;
  locationType: 'online' | 'offline';
  locationAddress: string | null;
  participantMode: 'one_on_one' | 'group';
  linkbandMode: SessionDto['linkband_mode'];
  maxParticipants: number;
  recordAudio: boolean;
  recordVideo: boolean;
}

export interface StoredEntry {
  sessionId: string;
  credential: string;
  expiresAt: string | null;
  participantId: string | null;
  isGuest: boolean;
  classInfo?: EntryClassInfo;
}

const ENTRY_KEY_PREFIX = 'mb_entry_';

function entryKey(sessionId: string): string {
  return `${ENTRY_KEY_PREFIX}${sessionId}`;
}

function isStoredEntry(value: unknown): value is StoredEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.sessionId === 'string' &&
    typeof v.credential === 'string' &&
    (v.expiresAt === null || typeof v.expiresAt === 'string') &&
    (v.participantId === null || typeof v.participantId === 'string') &&
    typeof v.isGuest === 'boolean' &&
    (v.classInfo === undefined || (typeof v.classInfo === 'object' && v.classInfo !== null))
  );
}

/** sessionStorage 에만 저장한다. 코드·이름·성별·생년월일·이메일은 어디에도 저장하지 않는다 */
export function saveEntry(entry: StoredEntry): void {
  try {
    window.sessionStorage.setItem(entryKey(entry.sessionId), JSON.stringify(entry));
  } catch {
    // 저장소를 쓸 수 없으면 메모리 상태만으로 진행한다(새로고침 복원만 포기)
  }
}

export function loadEntry(sessionId: string, now: number = Date.now()): StoredEntry | null {
  try {
    const raw = window.sessionStorage.getItem(entryKey(sessionId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredEntry(parsed)) return null;
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() <= now) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearEntry(sessionId: string): void {
  try {
    window.sessionStorage.removeItem(entryKey(sessionId));
  } catch {
    // 무시
  }
}

export function classInfoFromSession(session: EntrySessionDto): EntryClassInfo {
  return {
    title: session.title,
    hostName: session.host_name ?? null,
    scheduledAt: session.scheduled_at,
    startedAt: session.started_at,
    durationMin: session.duration_min,
    locationType: session.location_type,
    locationAddress: session.location_address,
    participantMode: session.participant_mode,
    linkbandMode: session.linkband_mode,
    maxParticipants: session.max_participants,
    recordAudio: session.record_audio,
    recordVideo: session.record_video,
  };
}

/** 입장 응답 → 저장 레코드. 자격이 없는 응답(로그인 회원 편의 경로 등)은 null */
export function entryFromResult(result: EnterResult): StoredEntry | null {
  if (!result.entry_credential) return null;
  return {
    classInfo: classInfoFromSession(result.session),
    sessionId: result.session.id,
    credential: result.entry_credential,
    expiresAt: result.expires_at,
    participantId: result.participant_id,
    isGuest: result.is_guest,
  };
}
