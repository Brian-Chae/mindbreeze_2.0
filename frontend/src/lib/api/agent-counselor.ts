import { apiClient } from './client';
import type { AgentCta, AgentMessage } from './agent';

export interface CounselorCta extends Omit<AgentCta, 'action' | 'payload'> {
  action: AgentCta['action'] | 'open_schedule' | 'open_client' | 'open_record' | 'open_change_requests';
  payload?: AgentCta['payload'] & { client_id?: string; record_id?: string; report_id?: string };
}
export interface CounselorMessage extends Omit<AgentMessage, 'kind' | 'cta'> {
  kind: AgentMessage['kind'] | 'briefing_morning' | 'briefing_evening';
  cta: CounselorCta[];
}
export interface BriefingSettings {
  morning_enabled: boolean;
  morning_time: string;
  evening_enabled: boolean;
  evening_time: string;
  skip_no_session_days: boolean;
}
export interface RelayEvent {
  id: string;
  kind: 'feedback' | 'schedule_change_request' | 'ack';
  client_id: string;
  client_name: string;
  session_id: string | null;
  session_title: string | null;
  scheduled_at: string | null;
  payload: { choice?: 'helpful' | 'neutral' | 'disappointed' | null; texts?: string[]; reason?: string | null; message_id?: string | null; report_id?: string | null };
  handled_at: string | null;
  created_at: string;
}
const prefix = '/agent/counselor';
// 공통 클라이언트가 !res.ok를 먼저 검사한 후 성공 응답을 파싱한다.
export const getSettings = () => apiClient.get<BriefingSettings>(`${prefix}/settings`);
export const putSettings = (settings: BriefingSettings) => apiClient.put<BriefingSettings>(`${prefix}/settings`, settings);
export const listMessages = (before?: string, limit = 30) => {
  const query = new URLSearchParams({ limit: String(limit) });
  if (before) query.set('before', before);
  return apiClient.get<{ items: CounselorMessage[]; has_more: boolean }>(`${prefix}/messages?${query}`);
};
export const sendMessage = (content: string) => apiClient.post<{ user_message: CounselorMessage; agent_message: CounselorMessage }>(`${prefix}/messages`, { content });
export const markRead = (upTo?: string) => apiClient.post<{ unread: number }>(`${prefix}/messages/read`, upTo ? { up_to: upTo } : {});
export const getUnreadCount = () => apiClient.get<{ unread: number }>(`${prefix}/unread-count`);
export const listRelayEvents = (status: 'open' | 'all' = 'all', limit = 50) => apiClient.get<{ items: RelayEvent[] }>(`${prefix}/relay-events?${new URLSearchParams({ status, limit: String(limit) })}`);
export const markHandled = (id: string) => apiClient.post<RelayEvent>(`${prefix}/relay-events/${encodeURIComponent(id)}/handled`);
export const runCta = (messageId: string, ctaId: string) => apiClient.post<{ cta: CounselorCta }>(`${prefix}/messages/${encodeURIComponent(messageId)}/cta/${encodeURIComponent(ctaId)}`, {});
