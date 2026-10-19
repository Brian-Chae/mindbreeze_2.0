import { ApiError } from '../api/client';
import type { ScheduleInput } from '../api/class-scheduling';

export const koreanToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
export function defaultSchedule(userId: string | null, today = koreanToday()): ScheduleInput {
  const weekday = new Date(`${today}T12:00:00+09:00`).getUTCDay() || 7;
  return {
    title: '', location_type: 'online', location_address: null, capacity: 10, linkband_mode: 'optional',
    record_audio: true, record_video: false, chat_enabled: false, schedule_mode: 'fixed', planned_session_count: 8, duration_min: 60,
    recurrence_rule: { version: 1, start_date: today, weekdays: [weekday], time: '19:00', interval_weeks: 1, skip_dates: [] },
    assignment_rule: { version: 1, mode: 'all_one', host_ids: userId ? [userId] : [], weekday_hosts: {} },
    instructors: userId ? [{ user_id: userId, role: 'lead' }] : [], rows: [], reminder_offsets: [1440], ends_on: null, member_ids: [],
  };
}
export function scheduleProblems(value: ScheduleInput, today = koreanToday(), step?: number): string[] {
  const problems: string[] = [];
  if (step === undefined || step === 0) {
    if (!value.title.trim() || value.title.trim().length > 200) problems.push('클래스 이름은 1~200자로 입력해 주세요.');
    const max = value.location_type === 'online' ? 50 : 100;
    if (!Number.isInteger(value.capacity) || value.capacity < 2 || value.capacity > max) problems.push(`정원은 2~${max}명으로 입력해 주세요.`);
    if (value.location_type === 'offline' && !value.location_address?.trim()) problems.push('오프라인 장소를 입력해 주세요.');
  }
  if (step === undefined || step === 1) {
    if (!value.recurrence_rule.start_date || value.recurrence_rule.start_date < today) problems.push('시작 날짜는 오늘 이후로 정해 주세요.');
    if (!value.recurrence_rule.weekdays.length) problems.push('요일을 하나 이상 골라 주세요.');
    const time = value.recurrence_rule.time.slice(0, 5);
    if (time < '07:00' || time > '22:00' || Number(time.slice(3)) % 5) problems.push('시작 시각은 07:00~22:00의 5분 단위로 입력해 주세요.');
    if (!Number.isInteger(value.planned_session_count) || value.planned_session_count < 2 || value.planned_session_count > 52) problems.push('횟수는 2~52회로 입력해 주세요.');
    if (value.duration_min < 5 || value.duration_min > 480 || value.duration_min % 5) problems.push('소요 시간은 5~480분의 5분 단위로 입력해 주세요.');
    if (value.ends_on && value.ends_on < value.recurrence_rule.start_date) problems.push('종료일은 시작일 이후로 정해 주세요.');
  }
  return problems;
}
/** 연결 끊김 후 같은 입력 재시도에는 같은 키를 사용한다. */
export function operationKeys(create = () => crypto.randomUUID()): (payload: unknown) => string {
  let previous = ''; let key = '';
  return (payload) => { const next = JSON.stringify(payload); if (next !== previous) { previous = next; key = create(); } return key; };
}
export function parseInviteEmails(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map(value => value.trim().toLowerCase()).filter(Boolean))];
}
const messages: Record<string, string> = {
  class_scheduling_disabled: '아직 클래스 편성을 사용할 수 없어요. 잠시 후 다시 확인해 주세요.',
  stale_class: '다른 변경이 먼저 저장됐어요. 최신 내용을 불러온 뒤 다시 확인해 주세요.',
  stale_session: '회차가 변경됐어요. 최신 내용을 불러온 뒤 다시 확인해 주세요.',
  operation_key_reused: '저장할 내용이 변경됐어요. 다시 확인해 주세요.',
  schedule_conflict: '겹치는 일정을 확인한 뒤 다시 저장해 주세요.',
};
export function schedulingError(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = (error.data as { detail?: { code?: string } } | null)?.detail;
    if (typeof detail?.code === 'string' && messages[detail.code]) return messages[detail.code];
    if (error.status === 403) return '이 작업을 할 권한이 없어요. 현재 강사와 센터 권한을 확인해 주세요.';
    if (error.status === 404) return '편성 기능이나 클래스를 사용할 수 없어요. 목록에서 다시 확인해 주세요.';
    if (error.status === 409) return '일정 또는 상태가 변경됐어요. 다시 불러와 확인해 주세요.';
    if (error.status === 422) return '입력 내용을 확인해 주세요. 강사 배정과 일정 규칙이 맞아야 해요.';
    if (error.status === 503) return '지금은 저장할 수 없어요. 입력을 유지한 채 다시 시도해 주세요.';
  }
  return '요청을 완료하지 못했어요. 입력을 유지했으니 연결을 확인하고 다시 시도해 주세요.';
}

/** CSV는 이메일 열만 사용한다. 이름·전화 등 다른 열은 저장하지 않는다. */
export function parseInviteCsv(source: string): string[] {
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const rows: string[][] = []; let cells: string[] = []; let cell = ''; let quoted = false;
  for (let index = 0; index <= text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; } else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n' || char === undefined)) {
      cells.push(cell.trim()); cell = '';
      if (char !== ',') { if (cells.some(value => value)) rows.push(cells); cells = []; }
    } else if (char !== undefined) cell += char;
  }
  if (quoted) throw new Error('CSV 인용부호가 닫히지 않았어요.');
  if (!rows.length) throw new Error('CSV 이메일을 찾을 수 없어요.');
  const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const headerIndex = rows[0].findIndex(value => ['email', 'e-mail', '이메일'].includes(value.toLowerCase()));
  const withoutHeader = headerIndex < 0 && rows[0].length === 1 && emailPattern.test(rows[0][0]);
  if (headerIndex < 0 && !withoutHeader) throw new Error('CSV에 email 또는 이메일 열이 필요해요.');
  const start = withoutHeader ? 0 : 1; const column = withoutHeader ? 0 : headerIndex; const emails: string[] = [];
  for (let index = start; index < rows.length; index += 1) {
    const email = rows[index][column]?.trim().toLowerCase();
    if (!email || !emailPattern.test(email)) throw new Error(`CSV ${index + 1}행 이메일 주소를 확인해 주세요.`);
    emails.push(email);
  }
  const unique = [...new Set(emails)];
  if (!unique.length || unique.length > 100) throw new Error('CSV 이메일은 1~100개로 입력해 주세요.');
  return unique;
}
