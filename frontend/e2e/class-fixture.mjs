// SDD-216: E2E 데이터도 제품과 같은 편성 API·시간대·멤버십 계약을 사용한다.
import { randomUUID } from 'node:crypto';

export async function createClassFixture({ api, token, hostId, title, memberIds = [], instant = false,
  scheduledAt = new Date(Date.now() + 2 * 86400000).toISOString(), fetcher = fetch }) {
  const kst = new Date(new Date(scheduledAt).getTime() + 9 * 3600000);
  const schedule = {
    title, location_type: 'online', capacity: 2, duration_min: 30,
    linkband_mode: 'optional', record_audio: true, record_video: false,
    schedule_mode: 'fixed', planned_session_count: instant ? 1 : 2,
    recurrence_rule: { start_now: instant, start_date: kst.toISOString().slice(0, 10),
      weekdays: [(kst.getUTCDay() + 6) % 7], time: kst.toISOString().slice(11, 16) },
    assignment_rule: { mode: 'all_one', host_ids: [hostId] },
    member_ids: memberIds, reminder_offsets: [],
  };
  const response = await fetcher(`${api}/classes`, { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation_key: randomUUID(), schedule }) });
  const body = await response.json();
  if (response.status !== 201) throw new Error(`클래스 생성 ${response.status}: ${JSON.stringify(body.detail)}`);
  if (!body.class_id || !body.session_ids?.length) throw new Error('클래스 생성 응답에 부모·회차 ID가 없음');
  return body;
}
