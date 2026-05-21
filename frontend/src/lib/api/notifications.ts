// 알림 API 클라이언트

import { apiClient } from './client';

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string | null;
  is_read: boolean;
  extra: Record<string, unknown> | null;
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
