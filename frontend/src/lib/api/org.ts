// 상담센터(Org) 관련 API 호출

import { apiClient, BASE_URL, tokenStorage } from './client';

export interface Org {
  id: string;
  name: string;
  ceo_name: string;
  biz_number: string;
  address: string;
  phone: string;
  verified: boolean;
  verified_at: string | null;
  created_at: string;
}

export interface OrgSearchItem {
  id: string;
  name: string;
  address: string;
  verified: boolean;
}

export type JoinRequestStatus = 'pending' | 'approved' | 'rejected';

export interface JoinRequest {
  id: string;
  org_id: string;
  org_name: string;
  status: JoinRequestStatus;
  reason: string | null;
  created_at: string;
}

export type CounselorRole = 'counselor' | 'org_admin';
// SDD-082: suspended — 기관 관리자가 비활성화한 계정 (로그인 차단)
export type CounselorAccountStatus = 'pending' | 'active' | 'suspended';

// SDD-079: 초대 유형 — 신규 가입 초대(new_account) / 소속 추가 초대(org_membership)
export type CounselorInviteType = 'new_account' | 'org_membership';

export interface CounselorItem {
  id: string;
  name: string;
  email: string;
  role: CounselorRole;
  status?: CounselorAccountStatus;
  invited_at?: string | null;
  invite_expires_at?: string | null;
  invite_type?: CounselorInviteType | null;
  // SDD-082: 상담사 코드 검색 + 개인 상담소(kind=individual) 소속 구분
  counselor_code?: string | null;
  has_personal_office?: boolean;
  // SDD-323: 서버가 내려주는 구성원 보강 필드(plan §2-3). 버튼 노출은 allowed_actions 만 본다.
  is_primary_admin?: boolean;
  membership_status?: MembershipStatus;
  account_status?: CounselorAccountStatus;
  is_self?: boolean;
  class_count?: number;
  last_activity_at?: string | null;
  allowed_actions?: MemberAction[];
  blocked_reasons?: Partial<Record<MemberAction, string>>;
}

export type MembershipStatus = 'active' | 'invited';
// 정지·재활성은 기관 화면에 없다(플랫폼 관리자 전용) — 타입에도 넣지 않는다.
export type MemberAction =
  | 'detail'
  | 'edit_profile'
  | 'resend_invite'
  | 'promote'
  | 'revoke_admin'
  | 'remove'
  | 'transfer_primary';

export interface InviteCounselorPayload {
  name: string;
  email: string;
  // SDD-258: 생략하면 상담사(코치) 초대, 'org_admin' 이면 기관관리자 초대
  role?: CounselorRole;
}

export interface InviteCounselorResponse {
  id: string;
  name: string;
  email: string;
  status: CounselorAccountStatus;
  invited_at: string;
  invite_expires_at: string;
  invite_sent: boolean;
}

export interface ResendCounselorInviteResponse {
  invite_sent: boolean;
  invite_expires_at: string;
}

// SDD-323: 기관이 받은 가입 요청 한 건(plan A9). 신청자 정보 필드는 서버가 채우면 표시한다.
export interface OrgJoinRequest extends JoinRequest {
  /** 서버 OrgJoinRequestDetail 필드 */
  user_id?: string;
  user_name?: string | null;
  user_email?: string | null;
  applicant_name?: string | null;
  applicant_email?: string | null;
  handled_at?: string | null;
}

export interface TransferPrimaryAdminPayload {
  target_user_id: string;
  expected_primary_admin_id: string;
  reason: string;
}

export interface TransferPrimaryAdminResponse {
  org_id: string;
  primary_admin_id: string;
  version: number;
}

export interface HandleRequestPayload {
  status: 'approved' | 'rejected';
  reason?: string;
}

const PREFIX = '/org';

export const searchOrgs = (q: string, region?: string): Promise<OrgSearchItem[]> => {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (region) params.set('region', region);
  const qs = params.toString();
  return apiClient.get<OrgSearchItem[]>(`${PREFIX}/search${qs ? `?${qs}` : ''}`, { skipAuth: true });
};

export const getOrg = (orgId: string): Promise<Org> =>
  apiClient.get<Org>(`${PREFIX}/${orgId}`, { skipAuth: true });

export const joinOrg = (orgId: string): Promise<JoinRequest> =>
  apiClient.post<JoinRequest>(`${PREFIX}/${orgId}/join`);

export const getMyRequests = (): Promise<JoinRequest[]> =>
  apiClient.get<JoinRequest[]>(`${PREFIX}/requests`);

export const handleRequest = (
  orgId: string,
  reqId: string,
  body: HandleRequestPayload,
): Promise<JoinRequest> => apiClient.put<JoinRequest>(`${PREFIX}/${orgId}/requests/${reqId}`, body);

export const listCounselors = (orgId: string): Promise<CounselorItem[]> =>
  apiClient.get<CounselorItem[]>(`${PREFIX}/${orgId}/counselors`);

/** 대표 넘기기 If-Match 값 — 목록 GET 응답의 ETag 헤더를 그대로 쓴다(별도 version API 없음, 서버 계약). */
export const getCounselorsEtag = async (orgId: string): Promise<string> => {
  const token = tokenStorage.getAccess();
  const res = await fetch(`${BASE_URL}${PREFIX}/${orgId}/counselors`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const etag = res.ok ? res.headers.get('ETag') : null;
  if (!etag) throw new Error('기관 정보를 다시 불러온 뒤 시도해 주세요.');
  return etag;
};

// SDD-323: 역할 변경(승격·회수)은 대표만, 사유 필수(plan A2).
export const updateCounselor = (
  orgId: string,
  userId: string,
  body: { role: CounselorRole; reason?: string },
): Promise<CounselorItem> =>
  apiClient.put<CounselorItem>(`${PREFIX}/${orgId}/counselors/${userId}`, body);

// SDD-323: 소속 해지는 사유 필수(DELETE + JSON body, plan A3).
export const removeCounselor = (orgId: string, userId: string, reason?: string): Promise<void> =>
  apiClient.delete<void>(`${PREFIX}/${orgId}/counselors/${userId}`, reason === undefined ? undefined : { body: { reason } });

// SDD-323: 대표 넘기기(plan A5). If-Match 에 기관 version 이 필요하다.
export const transferPrimaryAdmin = (
  orgId: string,
  body: TransferPrimaryAdminPayload,
  ifMatch: string,
): Promise<TransferPrimaryAdminResponse> =>
  apiClient.put<TransferPrimaryAdminResponse>(`${PREFIX}/${orgId}/primary-admin`, body, {
    headers: { 'If-Match': ifMatch },
  });

// SDD-323: 기관이 받은 가입 요청 목록(관리자). 본인 신청 내역(getMyRequests)과 별개.
export const listOrgJoinRequests = (orgId: string): Promise<OrgJoinRequest[]> =>
  apiClient.get<OrgJoinRequest[]>(`${PREFIX}/${orgId}/requests`);

export const inviteCounselor = (
  orgId: string,
  body: InviteCounselorPayload,
): Promise<InviteCounselorResponse> =>
  apiClient.post<InviteCounselorResponse>(`${PREFIX}/${orgId}/counselors/invite`, body);

export const resendCounselorInvite = (
  orgId: string,
  userId: string,
): Promise<ResendCounselorInviteResponse> =>
  apiClient.post<ResendCounselorInviteResponse>(
    `${PREFIX}/${orgId}/counselors/${userId}/resend-invite`,
    {},
  );

// SDD-082: 기관 관리자 — 소속 상담사 활성화/비활성화 + 최근 이력

export interface CounselorActivitySession {
  id: string;
  title: string | null;
  type: string;
  status: string;
  scheduled_at: string | null;
  started_at: string | null;
  participant_count: number;
}

export interface CounselorActivityReport {
  id: string;
  session_id: string;
  title: string | null;
  type: string;
  status: string;
  created_at: string | null;
}

export interface CounselorStatusResponse {
  id: string;
  status: CounselorAccountStatus;
}

export interface CounselorActivityClass {
  id: string;
  name: string;
  status: string;
  member_count: number;
}

export interface CounselorActivity {
  sessions: CounselorActivitySession[];
  reports: CounselorActivityReport[];
  // SDD-323: 이 기관 한정 담당 클래스·회원 수(plan §2-4). 서버 미배포 시 비어 있을 수 있다.
  classes?: CounselorActivityClass[];
  client_count?: number;
}

// 구 화면(VITE_UI_V2 꺼짐) 전용. SDD-323 구성원 화면에는 정지·재활성이 없다(서버는 기관 관리자에게 403).
export const suspendCounselor = (
  orgId: string,
  userId: string,
  reason: string,
): Promise<CounselorStatusResponse> =>
  apiClient.post<CounselorStatusResponse>(`${PREFIX}/${orgId}/counselors/${userId}/suspend`, { reason });

export const unsuspendCounselor = (
  orgId: string,
  userId: string,
  reason: string,
): Promise<CounselorStatusResponse> =>
  apiClient.post<CounselorStatusResponse>(`${PREFIX}/${orgId}/counselors/${userId}/unsuspend`, { reason });

export const getCounselorActivity = (
  orgId: string,
  userId: string,
): Promise<CounselorActivity> =>
  apiClient.get<CounselorActivity>(`${PREFIX}/${orgId}/counselors/${userId}/activity`);

// SDD-079: 기존 상담사 소속 추가 초대 수락 (이메일 링크의 일회용 토큰)
export interface MembershipInviteAcceptResponse {
  org_id: string;
  org_name: string;
}

export const acceptMembershipInvite = (token: string): Promise<MembershipInviteAcceptResponse> =>
  apiClient.post<MembershipInviteAcceptResponse>(
    `${PREFIX}/membership-invites/accept`,
    { token },
    { skipAuth: true },
  );

/** 서버 에러의 `code`(plan §2-2). `{code}` 또는 `{detail:{code}}` 둘 다 받는다. */
export function apiErrorCode(err: unknown): string | null {
  const data = (err as { data?: unknown } | null)?.data;
  if (!data || typeof data !== 'object') return null;
  const top = (data as { code?: unknown }).code;
  if (typeof top === 'string') return top;
  const detail = (data as { detail?: unknown }).detail;
  if (detail && typeof detail === 'object') {
    const inner = (detail as { code?: unknown }).code;
    if (typeof inner === 'string') return inner;
  }
  return null;
}

/** 재발송 쿨다운(429) 남은 초. 없으면 null. */
export function inviteRetryAfterSec(err: unknown): number | null {
  const data = (err as { data?: unknown } | null)?.data as { retry_after_sec?: unknown; detail?: { retry_after_sec?: unknown } } | null;
  const v = data?.retry_after_sec ?? data?.detail?.retry_after_sec;
  return typeof v === 'number' ? v : null;
}

const ERROR_CODE_MESSAGES: Record<string, string> = {
  ORG_ADMIN_REQUIRED: '이 기관의 관리자만 할 수 있습니다.',
  PRIMARY_ADMIN_REQUIRED: '대표 관리자만 할 수 있는 작업입니다.',
  MEMBER_NOT_FOUND: '이 기관의 구성원을 찾지 못했습니다. 목록을 새로 불러와 주세요.',
  CANNOT_TARGET_SELF: '본인에게는 적용할 수 없습니다.',
  CANNOT_TARGET_PRIMARY: '대표 관리자는 먼저 대표를 다른 관리자에게 넘긴 뒤에 변경할 수 있습니다.',
  LAST_ADMIN: '기관에는 활성 관리자가 한 명 이상 있어야 합니다.',
  MEMBER_HAS_ACTIVE_WORK: '진행·예정·대기 중인 세션이나 연결된 내담자가 있어 지금은 해지할 수 없습니다.',
  INDIVIDUAL_ORG_OWNER: '개인 상담소의 소유자는 변경할 수 없습니다.',
  INVALID_TRANSFER_TARGET: '대표를 넘길 수 없는 대상입니다. 활성 상태의 다른 관리자를 선택해 주세요.',
  PRIMARY_CHANGED: '그 사이 대표 관리자가 바뀌었습니다. 새로 불러온 뒤 다시 시도해 주세요.',
  VERSION_MISMATCH: '기관 정보가 그 사이 변경되었습니다. 새로 불러온 뒤 다시 시도해 주세요.',
  VERSION_REQUIRED: '기관 정보를 다시 불러온 뒤 시도해 주세요.',
  REASON_REQUIRED: '사유를 입력해 주세요.',
  INVITE_COOLDOWN: '잠시 후 다시 보낼 수 있습니다.',
};

/** 에러코드 -> 한글 문구(없으면 null). blocked_reasons 표시에도 쓴다. */
export const orgCodeMessage = (code: string | undefined): string | null => (code ? ERROR_CODE_MESSAGES[code] ?? null : null);

/** 에러코드별 한글 문구. 코드가 없거나 모르면 서버 문구, 그것도 없으면 fallback. */
export function orgErrorMessage(err: unknown, fallback: string): string {
  const code = apiErrorCode(err);
  if (code && ERROR_CODE_MESSAGES[code]) return ERROR_CODE_MESSAGES[code];
  return err instanceof Error && err.message ? err.message : fallback;
}
