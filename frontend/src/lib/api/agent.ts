import { apiClient } from './client';

export type AgentCtaAction =
  | 'ack' | 'open_map' | 'join_session' | 'request_change' | 'open_chat'
  | 'call_counselor' | 'open_report' | 'feedback_choice';

export interface AgentCta {
  id: string;
  action: AgentCtaAction;
  label: string;
  payload?: {
    url?: string;
    session_id?: string;
    room_id?: string;
    tel?: string;
    choice?: 'helpful' | 'neutral' | 'disappointed';
  };
  done?: boolean;
}

export interface AgentMessage {
  id: string;
  sender: 'agent' | 'user' | 'system';
  kind: 'reminder_3h' | 'reminder_1h' | 'schedule_changed'
    | 'report_ready' | 'report_chat' | 'feedback_thanks' | 'free';
  content: string;
  cta: AgentCta[];
  ref_type: 'session' | 'report' | null;
  ref_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface AgentConsent { agreed: boolean; version: string }
export interface AgentMessageList { items: AgentMessage[]; has_more: boolean }
export interface AgentCtaResult { cta: AgentCta; agent_message?: AgentMessage }

// 공통 클라이언트가 인증 갱신과 !res.ok 검사 후 JSON 파싱을 담당한다.
export const getConsent = () => apiClient.get<AgentConsent>('/agent/consent');
export const agree = () => apiClient.post<AgentConsent>('/agent/consent', { agreed: true });
export const listMessages = (before?: string, limit = 30) => {
  const query = new URLSearchParams({ limit: String(limit) });
  if (before) query.set('before', before);
  return apiClient.get<AgentMessageList>(`/agent/messages?${query}`);
};
export const sendMessage = (content: string) => apiClient.post<{
  user_message: AgentMessage; agent_message: AgentMessage;
}>('/agent/messages', { content });
export const markRead = (upTo?: string) => apiClient.post<{ unread: number }>(
  '/agent/messages/read', upTo ? { up_to: upTo } : {},
);
export const getUnreadCount = () => apiClient.get<{ unread: number }>('/agent/unread-count');
export const runCta = (messageId: string, ctaId: string, body: { reason?: string; text?: string } = {}) =>
  apiClient.post<AgentCtaResult>(`/agent/messages/${encodeURIComponent(messageId)}/cta/${encodeURIComponent(ctaId)}`, body);
