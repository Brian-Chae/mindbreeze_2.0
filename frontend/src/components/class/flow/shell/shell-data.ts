// SDD-209 SH2 — 세션 DTO → 셸형 화면 데이터 변환(순수 함수). 화면 컴포넌트는 이 결과만 받는다.
import type { SessionDto } from '../../../../lib/api/session';
import { classTypeLabel, memberChipKey, type ClassChipKey } from '../../../../lib/class/class-labels';
import { formatClassWhen, formatDDay, formatElapsed, formatStartsIn } from '../../../../lib/class/class-when';
import { deriveHeroCopy } from '../../../../lib/class/enter-action';
import type { ClassHeroData } from './ClassHero';
import type { ClassCardData } from './ClassCard';
import type { ClassRowData } from './ClassRow';

const BACKDROPS = [1, 4, 5, 8, 10] as const;

/** 클래스 id 로 고정한 배경 사진(새로고침해도 같은 사진) */
export function heroBackdrop(id: string): string {
  let sum = 0;
  for (const ch of id) sum = (sum + ch.charCodeAt(0)) % 997;
  return `/images/background${BACKDROPS[sum % BACKDROPS.length]}.webp`;
}

/** 백엔드가 진행자 이름(host_name)을 내려준다. 프론트 공용 타입은 이 트랙 밖이라 여기서 확장해 읽는다 */
export type SessionWithHost = SessionDto & { host_name?: string | null };

/** `김하늘 상담사`. 이름이 없으면 null */
export function hostLabel(session: SessionWithHost): string | null {
  const name = session.host_name?.trim();
  return name ? `${name} 상담사` : null;
}

export function toClassCardData(session: SessionWithHost, now: Date = new Date()): ClassCardData {
  return {
    id: session.id,
    typeLabel: classTypeLabel(session.type, session.custom_type_name),
    title: session.title || '제목 없는 클래스',
    whenLabel: formatClassWhen(session.scheduled_at, now),
    place: session.location_type,
    mode: session.participant_mode,
    band: session.linkband_mode,
  };
}

export function toClassRowData(session: SessionWithHost, now: Date = new Date(), chip?: ClassChipKey): ClassRowData {
  const host = hostLabel(session);
  const when = formatClassWhen(session.scheduled_at, now);
  return {
    id: session.id,
    title: session.title || '제목 없는 클래스',
    sub: host ? `${when} · ${host}` : when,
    chip: chip ?? memberChipKey(session.status, session.scheduled_at, now),
  };
}

function countdownLabel(chip: ClassChipKey, session: SessionWithHost, now: Date): string {
  const startsIn = formatStartsIn(session.scheduled_at, now);
  if (chip === 'live') return formatElapsed(session.started_at ?? session.scheduled_at, now);
  if (chip === 'soon') return startsIn ? `${startsIn} 뒤` : formatClassWhen(session.scheduled_at, now);
  if (chip === 'scheduled') return formatDDay(session.scheduled_at, now) || (startsIn ? `${startsIn} 뒤` : formatClassWhen(session.scheduled_at, now));
  return formatClassWhen(session.scheduled_at, now);
}

export function toHeroData(session: SessionWithHost, now: Date = new Date()): ClassHeroData {
  const chip = memberChipKey(session.status, session.scheduled_at, now);
  const startsIn = formatStartsIn(session.scheduled_at, now);
  const elapsed = formatElapsed(session.started_at ?? session.scheduled_at, now);
  const when = chip === 'live' && session.started_at
    ? `${formatClassWhen(session.started_at, now)} 시작`
    : formatClassWhen(session.scheduled_at, now);
  return {
    chip,
    countdown: countdownLabel(chip, session, now),
    title: session.title || '제목 없는 클래스',
    meta: `${when} · ${session.duration_min}분`,
    hostName: hostLabel(session),
    place: session.location_type,
    mode: session.participant_mode,
    band: session.linkband_mode,
    box: deriveHeroCopy(chip, { startsInLabel: startsIn, elapsedLabel: elapsed }),
    backdropSrc: heroBackdrop(session.id),
  };
}

export type ListSectionKey = 'enterable' | 'invited' | 'upcoming' | 'past';

export interface ClassListEntry {
  data: ClassCardData;
  chip: ClassChipKey;
  highlight: boolean;
  action?: { label: string; kind: 'enter' | 'confirm' };
}

export interface ClassListSection {
  key: ListSectionKey;
  title: string;
  entries: ClassListEntry[];
}

const SECTION_TITLES: Readonly<Record<ListSectionKey, string>> = {
  enterable: '지금 입장할 수 있어요',
  invited: '초대받은 클래스',
  upcoming: '예정된 클래스',
  past: '지난 클래스',
};

function timeOf(session: { scheduled_at: string | null }, missing: number): number {
  if (!session.scheduled_at) return missing;
  const time = new Date(session.scheduled_at).getTime();
  return Number.isNaN(time) ? missing : time;
}

/**
 * 회원 클래스 목록을 4구역으로 나눈다. 같은 클래스는 한 구역에만 나온다(이중 렌더 제거).
 * 입장 가능(진행 중 먼저) → 초대받은(아직 열리기 전) → 예정(일정 없는 것은 맨 뒤) → 지난(최근 순)
 */
export function buildClassSections(sessions: SessionWithHost[], invitedIds: ReadonlySet<string>, now: Date = new Date()): ClassListSection[] {
  const enterable: SessionWithHost[] = [];
  const invited: SessionWithHost[] = [];
  const upcoming: SessionWithHost[] = [];
  const past: SessionWithHost[] = [];
  for (const s of sessions) {
    if (s.status === 'in_progress' || s.status === 'open') enterable.push(s);
    else if (s.status === 'completed' || s.status === 'cancelled') past.push(s);
    else if (invitedIds.has(s.id)) invited.push(s);
    else upcoming.push(s);
  }
  enterable.sort((a, b) => (a.status === b.status ? timeOf(a, Infinity) - timeOf(b, Infinity) : a.status === 'in_progress' ? -1 : 1));
  invited.sort((a, b) => timeOf(a, Infinity) - timeOf(b, Infinity));
  upcoming.sort((a, b) => timeOf(a, Infinity) - timeOf(b, Infinity));
  past.sort((a, b) => timeOf(b, -Infinity) - timeOf(a, -Infinity));

  const entry = (s: SessionWithHost, kind: ListSectionKey): ClassListEntry => {
    const chip: ClassChipKey = kind === 'invited' ? 'invited' : memberChipKey(s.status, s.scheduled_at, now);
    const data = toClassCardData(s, now);
    if (kind === 'invited') {
      const host = hostLabel(s);
      data.subLine = host ? `${host}가 초대했어요` : '상담사가 초대했어요';
    }
    return {
      data,
      chip,
      highlight: kind === 'enterable',
      action: kind === 'enterable' ? { label: '입장하기', kind: 'enter' } : kind === 'invited' ? { label: '클래스 확인', kind: 'confirm' } : undefined,
    };
  };
  const groups: [ListSectionKey, SessionWithHost[]][] = [['enterable', enterable], ['invited', invited], ['upcoming', upcoming], ['past', past]];
  return groups
    .filter(([, list]) => list.length > 0)
    .map(([key, list]) => ({ key, title: SECTION_TITLES[key], entries: list.map((s) => entry(s, key)) }));
}
