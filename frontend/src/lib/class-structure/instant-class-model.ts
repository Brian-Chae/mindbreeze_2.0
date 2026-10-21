import type { ScheduleInput } from '../api/class-scheduling';
import { defaultSchedule, scheduleProblems } from './scheduling-model';

export interface InstantSettings {
  duration_min: number;
  location_type: ScheduleInput['location_type'];
  location_address: string | null;
  capacity: number;
  linkband_mode: ScheduleInput['linkband_mode'];
  record_audio: boolean;
  record_video: boolean;
  chat_enabled: boolean;
  host_id?: string;
}

export function defaultInstantSettings(): InstantSettings {
  const value = defaultSchedule(null);
  return { duration_min: 30, location_type: value.location_type, location_address: value.location_address,
    capacity: value.capacity, linkband_mode: value.linkband_mode, record_audio: value.record_audio,
    record_video: value.record_video, chat_enabled: value.chat_enabled };
}

export function instantTitle(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)?.value ?? '';
  return `즉석 명상 · ${part('month')}월 ${part('day')}일 ${part('dayPeriod') === 'AM' ? '오전' : '오후'} ${part('hour')}:${part('minute')}`;
}

export function instantSchedule(settings: InstantSettings, hostId: string, title: string): ScheduleInput {
  const base = defaultSchedule(hostId || null);
  const { host_id: _storedHost, ...scheduleSettings } = persistedSettings(settings);
  return { ...base, ...scheduleSettings, title: title.trim() || instantTitle(),
    record_video: settings.location_type === 'online' && settings.record_video,
    schedule_mode: 'fixed', planned_session_count: 1, rows: [], ends_on: null,
    recurrence_rule: { ...base.recurrence_rule, start_now: true } };
}

// 명시한 설정만 남겨 이름과 초대 대상이 브라우저에 저장되지 않게 한다.
function persistedSettings(settings: InstantSettings): InstantSettings {
  return { duration_min: settings.duration_min, location_type: settings.location_type,
    location_address: settings.location_address, capacity: settings.capacity, linkband_mode: settings.linkband_mode,
    record_audio: settings.record_audio, record_video: settings.record_video, chat_enabled: settings.chat_enabled,
    ...(settings.host_id ? { host_id: settings.host_id } : {}) };
}

export function loadInstantSettings(userId: string): InstantSettings {
  const defaults = defaultInstantSettings();
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(`mb:instant-class:last:${userId}`) ?? 'null');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults;
    const value = raw as Record<string, unknown>;
    if (typeof value.duration_min !== 'number' || typeof value.capacity !== 'number'
      || !['online', 'offline'].includes(String(value.location_type))
      || !['none', 'optional'].includes(String(value.linkband_mode))
      || !(value.location_address === null || typeof value.location_address === 'string')
      || typeof value.record_audio !== 'boolean' || typeof value.record_video !== 'boolean' || typeof value.chat_enabled !== 'boolean'
      || (value.host_id !== undefined && typeof value.host_id !== 'string')) return defaults;
    const settings = persistedSettings(value as unknown as InstantSettings);
    if (scheduleProblems(instantSchedule(settings, settings.host_id || 'validation-host', '즉석 명상')).length) return defaults;
    return settings;
  } catch { return defaults; }
}

export function saveInstantSettings(userId: string, settings: InstantSettings): void {
  try { localStorage.setItem(`mb:instant-class:last:${userId}`, JSON.stringify(persistedSettings(settings))); }
  catch { /* 저장소가 차단되어도 이미 열린 클래스는 유지한다. */ }
}
