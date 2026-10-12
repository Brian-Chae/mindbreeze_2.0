import type { AgentConsent, AgentCta, AgentMessage } from '../api/agent';

/** 루트 상대경로 또는 HTTPS만 허용한다. 브라우저의 역슬래시·제어문자 URL 보정을 차단한다. */
export function safeAgentUrl(value?: string): string | null {
  // eslint-disable-next-line no-control-regex -- 제어문자·역슬래시는 브라우저 URL 보정에 악용될 수 있어 의도적으로 거른다.
  if (!value || value !== value.trim() || /[\\\u0000-\u0020\u007f]/.test(value)) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function canAccessAgent(consent: AgentConsent | null, declined = false): boolean {
  return consent?.agreed === true && !declined;
}

export type CtaEffect =
  | { type: 'submit' }
  | { type: 'reason' }
  | { type: 'map'; url: string }
  | { type: 'navigate'; url: string }
  | { type: 'join'; sessionId: string }
  | { type: 'phone'; url: string };

export function resolveCta(cta: AgentCta): CtaEffect | null {
  if (cta.done) return null;
  switch (cta.action) {
    case 'ack': case 'feedback_choice': return { type: 'submit' };
    case 'request_change': return { type: 'reason' };
    case 'open_map': case 'open_report': {
      const url = safeAgentUrl(cta.payload?.url);
      if (!url) return null;
      // 기존 내담자 리포트 상세는 목록의 report 쿼리로 연다.
      const reportPath = cta.action === 'open_report' ? url.match(/^\/app\/reports\/([^/?#]+)$/) : null;
      return { type: cta.action === 'open_map' ? 'map' : 'navigate',
        url: reportPath ? `/app/reports?report=${reportPath[1]}` : url };

    }
    case 'join_session': return cta.payload?.session_id ? { type: 'join', sessionId: cta.payload.session_id } : null;
    case 'talk_to_counselor': {
      const url = cta.payload?.room_id ? safeAgentUrl(`/app/chat/${encodeURIComponent(cta.payload.room_id)}`) : null;
      return url?.startsWith('/app/chat/') ? { type: 'navigate', url } : null;
    }
    case 'open_risk_signals': return null;
    case 'open_chat': return cta.payload?.room_id ? { type: 'navigate', url: `/app/chat/${encodeURIComponent(cta.payload.room_id)}` } : null;
    case 'call_counselor': {
      const tel = cta.payload?.tel?.trim();
      return tel && /^\+?[\d ()-]+$/.test(tel) && /\d/.test(tel) ? { type: 'phone', url: `tel:${tel.replace(/[ ()-]/g, '')}` } : null;
    }
  }
}

export function isCtaDisabled(cta: AgentCta, siblings: AgentCta[]): boolean {
  return Boolean(cta.done || (cta.action === 'feedback_choice' && siblings.some((item) => item.action === 'feedback_choice' && item.done)) || !resolveCta(cta));
}

export function mergeAgentMessages(current: AgentMessage[], incoming: AgentMessage[]): AgentMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => {
    const previous = byId.get(message.id);
    // CTA 실행 전에 시작한 조회가 늦게 도착해도 완료 상태를 되돌리지 않는다.
    const cta = message.cta.map((item) => previous?.cta.some((old) => old.id === item.id && old.done)
      ? { ...item, done: true } : item);
    byId.set(message.id, { ...message, cta });
  });
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}
