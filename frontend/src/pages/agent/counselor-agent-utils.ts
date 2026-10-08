import type { BriefingSettings, CounselorCta, CounselorMessage, RelayEvent } from '../../lib/api/agent-counselor';
import { safeAgentUrl } from '../../lib/agent/actions';

export function resolveCounselorCta(cta: CounselorCta): string | null {
  const payload = cta.payload;
  let target: string | undefined;
  let allowed: RegExp;
  switch (cta.action) {
    case 'open_schedule': target = '/sessions'; allowed = /^\/sessions$/; break;
    case 'open_change_requests': target = '/agent?tab=relay'; allowed = /^\/agent\?tab=relay$/; break;
    case 'open_client': target = payload?.client_id ? `/clients/${encodeURIComponent(payload.client_id)}` : payload?.url; allowed = /^\/clients\/[^/?#]+$/; break;
    case 'open_record': target = payload?.session_id ? `/sessions/${encodeURIComponent(payload.session_id)}/record` : payload?.url; allowed = /^\/sessions\/[^/?#]+\/record$/; break;
    case 'open_report': target = payload?.report_id ? `/reports/${encodeURIComponent(payload.report_id)}` : payload?.url; allowed = /^\/reports\/[^/?#]+$/; break;
    default: return null;
  }
  const safe = safeAgentUrl(target);
  return safe && allowed.test(safe) ? safe : null;
}
export function serializeSettings(settings: BriefingSettings): BriefingSettings {
  const valid = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!valid.test(settings.morning_time) || !valid.test(settings.evening_time)) throw new Error('시각을 HH:MM 형식으로 입력해 주세요.');
  return { ...settings };
}
export function feedbackLabel(choice: RelayEvent['payload']['choice']): string {
  return choice ? { helpful: '도움이 됐어요', neutral: '보통이었어요', disappointed: '아쉬웠어요' }[choice] : '피드백';
}
export function sortRelayEvents(items: RelayEvent[]): RelayEvent[] {
  return [...items].sort((a, b) => Number(Boolean(a.handled_at)) - Number(Boolean(b.handled_at)) || b.created_at.localeCompare(a.created_at));
}
export function mergeMessages(current: CounselorMessage[], incoming: CounselorMessage[]): CounselorMessage[] {
  return [...new Map([...current, ...incoming].map((message) => [message.id, message])).values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}
