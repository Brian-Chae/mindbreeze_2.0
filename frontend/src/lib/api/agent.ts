import { apiClient, tokenStorage, ApiError, BASE_URL } from './client';

export type AgentCtaAction =
  | 'ack' | 'open_map' | 'join_session' | 'request_change' | 'open_chat'
  | 'talk_to_counselor' | 'open_risk_signals'
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
    | 'checkin' | 'checkin_closing' | 'risk_alert'
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

// SDD-201: 응답 토큰 스트리밍(SSE) — 에이전트 답변을 토큰 단위로 yield 한다.
// 완료 시점에 에이전트 메시지가 저장되므로, 호출부는 종료 후 목록을 다시 받아 확정본을 표시한다.
export async function* streamMessage(content: string): AsyncGenerator<string> {
  const token = tokenStorage.getAccess();
  const res = await fetch(`${BASE_URL}/agent/messages/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ content }),
    credentials: 'include',
  });
  if (!res.ok) {
    let data: unknown = null;
    try { data = await res.json(); } catch { /* ignore */ }
    const payload = data && typeof data === 'object' ? (data as { detail?: unknown }) : null;
    const message = typeof payload?.detail === 'string' && payload.detail.trim()
      ? payload.detail
      : `API 요청 실패 (${res.status})`;
    throw new ApiError(res.status, message, data);
  }
  if (!res.body) throw new ApiError(502, '스트리밍 응답을 받지 못했습니다.', null);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload) as { token?: unknown };
        if (typeof parsed.token === 'string') yield parsed.token;
      } catch { /* 잘못된 청크는 무시 */ }
    }
  }
}
export const markRead = (upTo?: string) => apiClient.post<{ unread: number }>(
  '/agent/messages/read', upTo ? { up_to: upTo } : {},
);
export const getUnreadCount = () => apiClient.get<{ unread: number }>('/agent/unread-count');
export const runCta = (messageId: string, ctaId: string, body: { reason?: string; text?: string } = {}) =>
  apiClient.post<AgentCtaResult>(`/agent/messages/${encodeURIComponent(messageId)}/cta/${encodeURIComponent(ctaId)}`, body);
