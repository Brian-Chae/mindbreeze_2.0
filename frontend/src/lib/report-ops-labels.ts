// SDD-253 — 리포트 화면의 용어·상태 단일 소스(목록·분할 검토·승인 상태 공용)
// 점수·순위·좋고 나쁨 표현을 만들지 않는다. 상태는 색 + 아이콘 + 텍스트로 함께 표시한다.

import type { HierarchyDoc } from './api/report-hierarchy';

export type RowTone = 'failed' | 'pending' | 'generating' | 'done' | 'muted';

export interface RowState {
  tone: RowTone;
  /** 상태 아이콘 한 글자(색에 의존하지 않도록 텍스트 기호) */
  icon: string;
  label: string;
  /** 보조 한 줄(시점·사유) */
  hint: string;
  /** 행 끝 단일 주 버튼 라벨. null 이면 버튼 없음 */
  action: string | null;
  /** 정렬 순위: 발송 실패 → 검토 필요 → 생성 중 → 그 외 */
  rank: number;
}

export const DELIVERY_LABELS: Record<string, string> = {
  pending: '발송 대기',
  sending: '발송 중',
  sent: '발송 성공',
  failed: '발송 실패',
  not_requested: '메일 수신 미신청',
  unavailable: '발송 불가',
};

export const ROLE_LABELS: Record<string, string> = {
  counselor: '코치',
  org_admin: '기관관리자',
  platform_admin: '운영자',
};

export const FAILURE_LABELS: Record<string, string> = {
  enqueue_failed: '발송 예약에 실패했습니다',
  send_failed: '메일 서비스가 발송을 받지 않았습니다',
  send_exception: '메일 발송 중 오류가 발생했습니다',
  excluded: '리포트에 반영되지 않은 참가자입니다',
  pii_scrubbed: '개인정보 보관 기간이 지난 참가자입니다',
};

export const GENDER_LABELS: Record<string, string> = { male: '남', female: '여', other: '기타' };

export const ACTIVITY_LABELS: Record<string, string> = {
  meditation: '명상',
  clinical: '상담',
  hypnosis: '상담',
  custom: '기타',
};

export function genderLabel(value: string | null | undefined): string {
  return value ? GENDER_LABELS[value] ?? value : '성별 미확인';
}

export function ageLabel(age: number | null | undefined): string {
  return typeof age === 'number' ? `만 ${age}세` : '나이 미확인';
}

export function approverLabel(doc: {
  approved_by_name?: string | null;
  approved_by_role?: string | null;
  approval_source?: string | null;
}): string {
  if (doc.approval_source === 'auto') return '자동 승인';
  if (!doc.approved_by_name) return '기존 기록 · 승인자 미확인';
  const role = doc.approved_by_role ? ROLE_LABELS[doc.approved_by_role] ?? doc.approved_by_role : '';
  return role ? `${doc.approved_by_name} · ${role}` : doc.approved_by_name;
}

export function formatKst(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('month')}월 ${get('day')}일 ${get('hour')}:${get('minute')}`;
}

/** 회원 행 한 줄 상태 — A안: 상태 하나를 크게, 행 끝에 주 버튼 하나. */
export function rowState(doc: HierarchyDoc | null): RowState {
  if (!doc) {
    return { tone: 'muted', icon: '·', label: '리포트 없음', hint: '이 회차에는 회원용 리포트가 없습니다', action: null, rank: 3 };
  }
  if (doc.status === 'completed' && doc.delivery_status === 'failed') {
    return { tone: 'failed', icon: '!', label: '발송 실패', hint: '승인은 완료되었습니다', action: '다시 발송', rank: 0 };
  }
  if (doc.status === 'pending_review' && doc.approval_required) {
    return { tone: 'pending', icon: '●', label: '검토 필요', hint: '회원용 리포트 승인 대기', action: '검토 시작', rank: 1 };
  }
  if (doc.status === 'error') {
    return { tone: 'failed', icon: '!', label: '생성 실패', hint: '원인을 확인해 주세요', action: '실패 확인', rank: 0 };
  }
  if (doc.generation_status === 'pending' || doc.generation_status === 'processing' || doc.status === 'pending_analysis') {
    return { tone: 'generating', icon: '…', label: '생성 중', hint: '리포트를 만들고 있습니다', action: '진행 보기', rank: 2 };
  }
  if (doc.status === 'completed') {
    const when = formatKst(doc.approved_at);
    const delivery = doc.delivery_status ? DELIVERY_LABELS[doc.delivery_status] ?? '' : '';
    const hint = [when && `${when} 승인`, delivery].filter(Boolean).join(' · ');
    return { tone: 'done', icon: '✓', label: '승인 완료', hint, action: '열기', rank: 3 };
  }
  return { tone: 'muted', icon: '·', label: '확인 필요', hint: '', action: '열기', rank: 3 };
}

// 회원 화면(읽음 상태) 용어
export const MEMBER_UNREAD_LABEL = '아직 읽지 않음';
export const MEMBER_READ_LABEL = '읽음';
