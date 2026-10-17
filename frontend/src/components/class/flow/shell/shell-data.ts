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
