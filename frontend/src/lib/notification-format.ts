// 알림 유형·이벤트의 표시 라벨과 시간 포맷 — NotificationCard와 알림 센터가 공유한다.

export const TYPE_ICONS: Record<string, string> = {
  session: '📅',
  chat: '💬',
  report: '📄',
  verification: '✅',
  system: '🔔',
};

export const TYPE_LABELS: Record<string, string> = {
  session: '세션',
  chat: '채팅',
  report: '리포트',
  verification: '검증',
  system: '시스템',
};

export const EVENT_LABELS: Record<string, string> = {
  // 세션
  session_booked: '세션 예약',
  session_updated: '세션 변경',
  session_cancelled: '세션 취소',
  session_ready: '세션 준비 완료',
  session_opened: '세션 오픈',
  session_started: '세션 진행 시작',
  session_completed: '세션 완료',
  session_invited: '세션 초대',
  session_waitlist_promoted: '대기자 승격',
  session_participant_removed: '참여자 제외',
  session_deleted: '세션 삭제',
  // 채팅
  chat_message: '채팅 메시지',
  chat_room_created: '채팅방 개설',
  chat_room_invited: '채팅방 초대',
  chat_room_removed: '채팅방 제외',
  // 리포트
  report_review_requested: '리포트 검토 요청',
  report_ready: '리포트 발행',
  report_generation_failed: '리포트 생성 실패',
  report_low_confidence: '리포트 신뢰도 낮음',
  report_email_failed: '리포트 메일 발송 실패',
  // 검증
  verification_result: '검증 결과',
  organization_verification_result: '기관 검증 결과',
  verification_requested: '검증 요청',
  // 기관
  organization_join_requested: '기관 가입 신청',
  organization_join_result: '기관 가입 결과',
  organization_updated: '기관 정보 변경',
  organization_deactivated: '기관 비활성화',
  organization_reactivated: '기관 재활성화',
  organization_role_changed: '기관 역할 변경',
  organization_removed: '기관 제외',
  // 계정·프로필
  counselor_profile_updated: '상담사 프로필 변경',
  primary_admin_profile_updated: '대표 관리자 프로필 변경',
  account_suspended: '계정 정지',
  account_reactivated: '계정 재활성화',
  personal_office_opened: '개인상담소 개설',
};

/**
 * 이벤트 키 → 사람이 읽을 수 있는 라벨.
 * 백엔드 EVENT_CATALOG(35종) 밖의 신규 키가 와도 원시 snake_case 대신
 * 공백 치환 형태로 노출해 UI-01(원시 키 노출)을 방지한다.
 */
export function eventLabel(event: string): string {
  return EVENT_LABELS[event] ?? event.replace(/_/g, ' ');
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '방금';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}
