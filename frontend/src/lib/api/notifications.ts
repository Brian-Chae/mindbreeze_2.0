// 알림 API 클라이언트

import { apiClient } from './client';

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string | null;
  is_read: boolean;
  extra: NotificationExtra | null;
  created_at: string;
}

export interface NotificationListResponse {
  notifications: NotificationDto[];
  total: number;
  unread: number;
}

export interface UnreadCountResponse {
  unread: number;
}

export interface NotificationPreferencesResponse {
  email: Record<string, boolean>;
  in_app: Record<string, boolean>;
}

export type NotificationPreferencesRequest = NotificationPreferencesResponse;

export const listNotifications = (
  onlyUnread?: boolean,
  limit?: number,
  offset?: number,
): Promise<NotificationListResponse> => {
  const params = new URLSearchParams();
  if (onlyUnread) params.set('only_unread', 'true');
  if (limit) params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  const qs = params.toString();
  return apiClient.get<NotificationListResponse>(`/notifications${qs ? `?${qs}` : ''}`);
};

export const getUnreadCount = (): Promise<UnreadCountResponse> =>
  apiClient.get<UnreadCountResponse>('/notifications/unread-count');

export const markRead = (id: string): Promise<void> =>
  apiClient.put<void>(`/notifications/${id}/read`);

export const markAllRead = (): Promise<{ count: number }> =>
  apiClient.put<{ count: number }>('/notifications/read-all');

export const getPreferences = (): Promise<NotificationPreferencesResponse> =>
  apiClient.get<NotificationPreferencesResponse>('/notifications/preferences');

export const updatePreferences = (
  prefs: NotificationPreferencesRequest,
): Promise<NotificationPreferencesResponse> =>
  apiClient.put<NotificationPreferencesResponse>('/notifications/preferences', prefs);

// ── SDD-093: 딥링크 후속 행위 ──────────────────────────────────────────────

/**
 * 표준 extra 계약 (백엔드 notification_service.build_standard_extra 와 1:1 대응).
 * schema_version / event_type / target_type / target_id / params (+ 레거시 루트 키).
 */
export interface NotificationExtra {
  schema_version?: number;
  event_type?: string;
  target_type?: string;
  target_id?: string | null;
  params?: Record<string, unknown>;
  // 레거시 루트 키 (표준 도입 전 알림 호환)
  room_id?: string;
  report_id?: string;
  session_id?: string;
  sender_id?: string;
  [key: string]: unknown;
}

/**
 * 알림 extra 를 실제 라우트 경로로 해석한다.
 * 화이트리스트(target_type)만 허용 — 임의 경로/URL 실행 금지.
 * 레거시 알림(target_type 없음)은 루트 키(room_id 등)로 폴백한다.
 * 이동 불가(notice·알 수 없는 타입·target_id 누락) 시 null 반환.
 */
export function resolveNotificationTarget(
  extra: NotificationExtra | null | undefined,
  role?: string,
): { path: string } | null {
  if (!extra || typeof extra !== 'object') return null;

  const messageId =
    typeof extra.params?.message_id === 'string' ? extra.params.message_id : undefined;

  let targetType = typeof extra.target_type === 'string' ? extra.target_type : '';
  let targetId = typeof extra.target_id === 'string' ? extra.target_id : '';

  // 레거시 폴백: 표준 target_type 이 없으면 루트 키로 유추
  if (!targetType) {
    if (extra.room_id) {
      targetType = 'chat_room';
      targetId = extra.room_id;
    } else if (extra.report_id) {
      targetType = 'report';
      targetId = extra.report_id;
    } else if (extra.session_id) {
      targetType = 'session';
      targetId = extra.session_id;
    }
  }
  if (!targetType) return null;

  const isClient = role === 'client';

  switch (targetType) {
    case 'chat_room':
      if (!targetId) return null;
      return {
        path: `${isClient ? '/app' : ''}/chat/${targetId}${
          messageId ? `?message=${encodeURIComponent(messageId)}` : ''
        }`,
      };
    case 'session':
      if (!targetId) return null;
      return { path: `${isClient ? '/app' : ''}/sessions/${targetId}` };
    case 'report':
      if (!targetId) return null;
      return { path: isClient ? `/app/reports/${targetId}` : `/reports/${targetId}` };
    case 'credentials':
      return { path: '/credentials' };
    case 'self_profile':
      return { path: isClient ? '/app/profile' : '/settings' };
    case 'organization':
      if (!targetId) return null;
      return { path: `/org/${targetId}` };
    case 'notice':
      return null; // 이동 없음 — 알림 센터에서만 열람
    default:
      return null; // 알 수 없는 타입 → 이동 금지
  }
}
