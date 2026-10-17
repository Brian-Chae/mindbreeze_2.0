// SDD-209 SH5 — 상담사 목록(FH01) 화면 데이터. 열린 클래스를 상단에 고정하고 나머지를 예정/지난으로 나눈다.
import type { LinkbandMode, LocationType, ParticipantMode, SessionDto, SessionType } from '../../../../lib/api/session';
import { hostChipKey, placeLabel, sizeLabel, type ClassChipKey } from '../../../../lib/class/class-labels';
import { formatClassWhen, formatElapsed, formatStartsIn } from '../../../../lib/class/class-when';

export type HostListTab = 'upcoming' | 'past';
export type HostItemIcon = 'heart' | 'moon' | 'leaf' | 'sparkles';

export interface HostFeatured {
  kind: 'live' | 'next';
  id: string;
  chip: ClassChipKey;
  title: string;
  place: LocationType;
  mode: ParticipantMode;
  band: LinkbandMode;
  /** 초대 N명 / 12분째 · 초대 N명 */
  waitLabel: string;
  /** 한 줄 안내(`초대한 회원이 입장할 수 있어요` · `다음 클래스 · 2시간 뒤 시작해요`) */
  hint: string;
  /** 다음 클래스의 일정 줄(`오늘 오후 3:00 · 50분`) */
  whenLabel: string;
  inviteCount: number;
}

export interface HostListItem {
  id: string;
  title: string;
  /** `오늘 오후 3:00 · 온라인 1:1` */
  sub: string;
  chip: ClassChipKey;
  icon: HostItemIcon;
  /** 목록에서 바로 클래스를 열 수 있는가(준비·예정) */
  canOpen: boolean;
}

export interface HostListGroup {
  label: string;
  items: HostListItem[];
}

export interface HostListModel {
  featured: HostFeatured | null;
  groups: HostListGroup[];
  counts: { upcoming: number; past: number };
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

function dayOf(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** 묶음 라벨: 오늘·내일·어제, 그 밖은 `10월 19일 (월)`, 일정이 없으면 `일정 없음` */
function groupLabel(iso: string | null, now: Date): string {
  if (!iso) return '일정 없음';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '일정 없음';
  const diff = Math.round((dayOf(date) - dayOf(now)) / 86_400_000);
  if (diff === 0) return '오늘';
  if (diff === 1) return '내일';
  if (diff === -1) return '어제';
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAYS[date.getDay()]})`;
}

function iconOf(type: SessionType): HostItemIcon {
  if (type === 'clinical') return 'heart';
  if (type === 'hypnosis') return 'moon';
  if (type === 'meditation') return 'leaf';
  return 'sparkles';
}

function timeOf(session: SessionDto, missing: number): number {
  if (!session.scheduled_at) return missing;
  const t = new Date(session.scheduled_at).getTime();
  return Number.isNaN(t) ? missing : t;
}

function toItem(session: SessionDto, now: Date): HostListItem {
  const method = `${placeLabel(session.location_type)} ${sizeLabel(session.participant_mode)}`;
  const when = session.scheduled_at ? formatClassWhen(session.scheduled_at, now) : '일정 없음';
  return {
    id: session.id,
    title: session.title || '제목 없는 클래스',
    sub: `${when} · ${method}`,
    chip: hostChipKey(session.status),
    icon: iconOf(session.type),
    canOpen: session.status === 'ready' || session.status === 'scheduled',
  };
}

function groupItems(sessions: SessionDto[], now: Date): HostListGroup[] {
  const groups: HostListGroup[] = [];
  for (const session of sessions) {
    const label = groupLabel(session.scheduled_at, now);
    const last = groups[groups.length - 1];
    const item = toItem(session, now);
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

function pickFeatured(sessions: SessionDto[], now: Date): HostFeatured | null {
  const live = [...sessions.filter((s) => s.status === 'in_progress'), ...sessions.filter((s) => s.status === 'open')]
    .sort((a, b) => (a.status === b.status ? timeOf(a, Infinity) - timeOf(b, Infinity) : a.status === 'in_progress' ? -1 : 1))[0];
  const invite = (s: SessionDto): number => s.participants.length;
  if (live) {
    const elapsed = live.status === 'in_progress' ? formatElapsed(live.started_at ?? live.scheduled_at, now) : '';
    const inviteLabel = `초대 ${invite(live)}명`;
    return {
      kind: 'live',
      id: live.id,
      chip: hostChipKey(live.status),
      title: live.title || '제목 없는 클래스',
      place: live.location_type,
      mode: live.participant_mode,
      band: live.linkband_mode,
      waitLabel: elapsed ? `${elapsed} · ${inviteLabel}` : inviteLabel,
      hint: live.status === 'open' ? '초대한 회원이 입장할 수 있어요' : '지금 진행되고 있어요',
      whenLabel: '',
      inviteCount: invite(live),
    };
  }
  const next = sessions
    .filter((s) => s.status === 'scheduled' && s.scheduled_at)
    .sort((a, b) => timeOf(a, Infinity) - timeOf(b, Infinity))[0];
  if (!next) return null;
  const startsIn = formatStartsIn(next.scheduled_at, now);
  return {
    kind: 'next',
    id: next.id,
    chip: hostChipKey(next.status),
    title: next.title || '제목 없는 클래스',
    place: next.location_type,
    mode: next.participant_mode,
    band: next.linkband_mode,
    waitLabel: `초대 ${invite(next)}명`,
    hint: startsIn ? `다음 클래스 · ${startsIn} 뒤 시작해요` : '다음 클래스 · 곧 시작해요',
    whenLabel: `${formatClassWhen(next.scheduled_at, now)} · ${next.duration_min}분`,
    inviteCount: invite(next),
  };
}

/** 목록 모델. 상단 고정 카드(열린 클래스 > 다음 예약)는 아래 목록에서 뺀다 */
export function buildHostListModel(sessions: SessionDto[], tab: HostListTab, now: Date = new Date()): HostListModel {
  const featured = pickFeatured(sessions, now);
  const rest = sessions.filter((s) => s.id !== featured?.id);
  const upcoming = rest
    .filter((s) => s.status === 'ready' || s.status === 'scheduled' || s.status === 'open' || s.status === 'in_progress')
    .sort((a, b) => timeOf(a, Infinity) - timeOf(b, Infinity));
  const past = rest
    .filter((s) => s.status === 'completed' || s.status === 'cancelled')
    .sort((a, b) => timeOf(b, -Infinity) - timeOf(a, -Infinity));
  return {
    featured,
    groups: groupItems(tab === 'upcoming' ? upcoming : past, now),
    counts: { upcoming: upcoming.length, past: past.length },
  };
}
