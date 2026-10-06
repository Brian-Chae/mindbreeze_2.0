import type { NotificationDto } from '../../lib/api/notifications';

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

export function NotificationCard({
  notification,
  onClick,
}: {
  notification: NotificationDto;
  onClick: () => void;
}) {
  const icon = TYPE_ICONS[notification.type] ?? '🔔';
  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-white border border-[#EFEFEF] rounded-2xl p-4 hover:shadow-sm transition-all ${
        !notification.is_read ? 'border-l-[3px] border-l-[#5F0080]' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="text-[20px] mt-0.5 shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span
              className={`text-[14px] ${notification.is_read ? 'text-[#1F1F1F] font-medium' : 'text-[#1F1F1F] font-bold'}`}
            >
              {notification.title}
            </span>
            <span className="text-[11px] text-[#9B9B9B] font-mono shrink-0">
              {timeAgo(notification.created_at)}
            </span>
          </div>
          {notification.body && (
            <div className="text-[13px] text-[#6F6F6F] line-clamp-2">{notification.body}</div>
          )}
          <div className="mt-1.5">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#F5EDFC] text-[#5F0080]">
              {TYPE_LABELS[notification.type] ?? notification.type}
            </span>
          </div>
        </div>
        {!notification.is_read && (
          <div className="w-2 h-2 rounded-full bg-[#5F0080] shrink-0 mt-1.5" />
        )}
      </div>
    </button>
  );
}

