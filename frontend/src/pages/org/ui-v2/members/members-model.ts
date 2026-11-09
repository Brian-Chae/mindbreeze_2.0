// SDD-323 — 구성원 화면 순수 로직. 버튼 노출은 서버가 내려준 allowed_actions 만 본다(역할 문자열 분기 금지).
import type { CounselorItem, MemberAction, OrgJoinRequest } from '../../../../lib/api/org';

export type MemberTab = 'coaches' | 'admins' | 'invites' | 'requests';
export const MEMBER_TABS: ReadonlyArray<{ id: MemberTab; label: string }> = [
  { id: 'coaches', label: '코치' },
  { id: 'admins', label: '기관 관리자' },
  { id: 'invites', label: '초대·가입 현황' },
  { id: 'requests', label: '가입 요청' },
];

export type MemberGroup = '' | 'status' | 'office';
export type InviteState = 'pending' | 'expired' | 'joined';

export const parseTab = (v: string | null): MemberTab => (MEMBER_TABS.some((t) => t.id === v) ? (v as MemberTab) : 'coaches');
export const parseGroup = (v: string | null): MemberGroup => (v === 'status' || v === 'office' ? v : '');

/** 이 행에서 요청자가 할 수 있는 행동인지. allowed_actions 가 없으면(서버 미배포) 어떤 변경 버튼도 보이지 않는다. */
export const can = (c: CounselorItem, action: MemberAction): boolean => c.allowed_actions?.includes(action) ?? false;

const isInvited = (c: CounselorItem): boolean => (c.membership_status ?? (c.status === 'pending' ? 'invited' : 'active')) === 'invited';

/** 탭별 소속 구분. 코치/관리자 탭은 활성 소속만, 초대 탭은 초대 대기/만료 + 가입됨(초대 경로로 들어온 활성 소속). */
export const coachesOf = (items: CounselorItem[]): CounselorItem[] => items.filter((c) => c.role === 'counselor' && !isInvited(c));
export const adminsOf = (items: CounselorItem[]): CounselorItem[] => items.filter((c) => c.role === 'org_admin' && !isInvited(c));

export function inviteStateOf(c: CounselorItem, now = Date.now()): InviteState {
  if (!isInvited(c)) return 'joined';
  if (c.invite_expires_at && new Date(c.invite_expires_at).getTime() < now) return 'expired';
  return 'pending';
}
export const invitesOf = (items: CounselorItem[]): CounselorItem[] =>
  items.filter((c) => isInvited(c) || c.invite_type != null || c.invited_at != null);

export type AccountChip = 'active' | 'limited';
/** 계정 상태 칩 — 구성원 화면에는 정지·재활성 문구를 쓰지 않는다(플랫폼 관리자 영역). */
export const accountChipOf = (c: CounselorItem): AccountChip => ((c.account_status ?? c.status) === 'suspended' ? 'limited' : 'active');
export const ACCOUNT_LABEL: Record<AccountChip, string> = { active: '활성', limited: '이용 제한' };
export const INVITE_LABEL: Record<InviteState, string> = { pending: '대기', expired: '만료', joined: '가입됨' };

export function matchQuery(c: { name?: string | null; email?: string | null; counselor_code?: string | null }, q: string): boolean {
  const key = q.trim().toLowerCase();
  if (!key) return true;
  return [c.name, c.email, c.counselor_code].some((v) => (v ?? '').toLowerCase().includes(key));
}

export interface Grouped<T> { key: string; label: string; rows: T[] }
export function groupRows<T>(rows: T[], keyOf: (row: T) => string): Grouped<T>[] {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = keyOf(row);
    map.set(k, [...(map.get(k) ?? []), row]);
  }
  return [...map.entries()].map(([key, list]) => ({ key, label: key, rows: list }));
}

export const filterRequests = (rows: OrgJoinRequest[], q: string, status: string): OrgJoinRequest[] =>
  rows.filter((r) => matchQuery({ name: r.applicant_name, email: r.applicant_email }, q) && (!status || r.status === status));

/** 재발송 쿨다운 남은 초 -> '1분 20초' */
export function remainText(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return s >= 60 ? `${Math.floor(s / 60)}분${s % 60 ? ` ${s % 60}초` : ''}` : `${s}초`;
}

/** 대시보드 요약 4종 — 합산 숫자는 만들지 않는다. */
export interface MemberSummary { coaches: number; admins: number; invitesPending: number; requestsPending: number }
export function summaryOf(items: CounselorItem[], requests: OrgJoinRequest[]): MemberSummary {
  return {
    coaches: coachesOf(items).filter((c) => accountChipOf(c) === 'active').length,
    admins: adminsOf(items).filter((c) => accountChipOf(c) === 'active').length,
    invitesPending: invitesOf(items).filter((c) => inviteStateOf(c) !== 'joined').length,
    requestsPending: requests.filter((r) => r.status === 'pending').length,
  };
}

export type ActionKind = 'promote' | 'revoke_admin' | 'remove' | 'transfer_primary' | 'reject_request';

export interface ActionCopy { title: string; impact: string; confirm: string; danger?: boolean }

export function actionCopy(kind: ActionKind, name: string): ActionCopy {
  switch (kind) {
    case 'promote':
      return { title: '기관 관리자 지정', impact: `${name} 코치를 기관 관리자로 지정합니다. 구성원 초대·권한 관리·가입 요청 처리 권한을 갖게 됩니다.`, confirm: '관리자로 지정' };
    case 'revoke_admin':
      return { title: '관리자 권한 회수', impact: `${name} 관리자를 코치로 변경합니다. 기관 운영 권한이 해제되며 코치 소속과 담당 클래스는 유지됩니다.`, confirm: '권한 회수' };
    case 'remove':
      return { title: '소속 해지', impact: `${name} 님의 이 기관 소속을 해지합니다. 진행·예정 세션과 활성 회원 연결이 남아 있으면 먼저 정리해야 하고, 남은 기관 소속이 없으면 개인 상담소로 돌아갑니다.`, confirm: '소속 해지', danger: true };
    case 'transfer_primary':
      return { title: '대표 관리자 넘기기', impact: `${name} 관리자를 대표로 지정합니다. 현재 대표는 일반 관리자로 남고, 대표만 할 수 있는 작업은 더 이상 할 수 없습니다.`, confirm: '대표 넘기기' };
    case 'reject_request':
      return { title: '가입 요청 거절', impact: `${name} 님의 가입 요청을 거절합니다. 거절 사유는 신청자에게 안내됩니다.`, confirm: '거절하기', danger: true };
  }
}


export function roleText(c: CounselorItem): string {
  if (c.is_primary_admin) return c.is_self ? '대표 관리자 · 본인' : '대표 관리자';
  if (c.is_self) return '기관 관리자 · 본인';
  return c.role === 'org_admin' ? '기관 관리자' : '코치';
}

