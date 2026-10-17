// SDD-209 SH5 — 상담사 목록(FH01) 화면 데이터. 열린 클래스를 상단에 고정하고 나머지를 예정/지난으로 나눈다.
import type { LinkbandMode, LocationType, ParticipantMode, SessionDto, SessionParticipant, SessionType } from '../../../../lib/api/session';
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

/* ───────── FH04 상담사 상세 ───────── */
export type HostNextIcon = 'door-open' | 'clock' | 'users' | 'play' | 'file' | 'copy';
export type HostNextKind = 'player' | 'record' | 'duplicate';
export type CodeState = 'active' | 'wait' | 'closed' | 'none';

export interface PersonRow {
  key: string;
  name: string;
  initial: string;
  chip: 'invited' | 'waitlist';
  waitLabel: string;
  /** 제거 API 에 넘기는 회원 id. 회원이 아니면 null */
  userId: string | null;
  removable: boolean;
}

/** 서버가 내려주는 이메일 초대 요청 결과(BE-R4). 아직 목록 API 가 없으면 화면은 이 구역을 그리지 않는다 */
export interface MailInviteInput {
  id: string;
  /** 마스킹된 이메일. 스위프로 지워졌으면 null */
  maskedEmail: string | null;
  state: 'requested' | 'failed';
  /** 다시 보내기까지 남은 초 */
  cooldownSec: number;
}

export interface MailInviteRow {
  key: string;
  email: string;
  tone: 'ok' | 'warn' | 'mute';
  label: string;
  again: 'on' | 'wait' | 'gone';
  waitText: string;
}

export interface HostDetailData {
  chip: ClassChipKey;
  title: string;
  whenLabel: string;
  next: { icon: HostNextIcon; title: string; sub: string; cta: string; ctaKind: HostNextKind };
  code: { state: CodeState; value: string | null };
  inviteText: string;
  showLinkCopy: boolean;
  place: LocationType;
  mode: ParticipantMode;
  band: LinkbandMode;
  placeText: string;
  canEditPlace: boolean;
  recordText: string;
  cancelRow: { kind: 'cancel' | 'close'; label: string } | null;
  canDelete: boolean;
  people: { total: number; max: number; items: PersonRow[]; waitlist: PersonRow[]; canInvite: boolean; full: boolean };
  mailInvites: MailInviteRow[];
}

/** 이름이 없는 참가자는 id 앞자리 대신 `참가자`로 둔다(개인정보·UUID 노출 방지) */
function personName(p: SessionParticipant): string {
  return p.user_name || p.user_email || p.guest_name || '참가자';
}

function toPerson(p: SessionParticipant, index: number, closed: boolean): PersonRow {
  const name = personName(p);
  return {
    key: p.participant_id ?? p.user_id ?? `p-${index}`,
    name,
    initial: name.slice(0, 1),
    chip: p.is_waitlisted ? 'waitlist' : 'invited',
    waitLabel: p.is_waitlisted ? `대기 ${p.waitlist_position ?? '-'}순위` : '',
    userId: p.user_id,
    removable: Boolean(p.user_id) && !closed,
  };
}

function nextCopy(session: SessionDto, now: Date, whenLabel: string, activeCount: number): HostDetailData['next'] {
  const offline = session.location_type === 'offline';
  switch (session.status) {
    case 'ready':
      return {
        icon: 'door-open', title: '클래스를 열어 참가자를 맞이해요',
        sub: offline ? '대면 클래스도 열어야 참가자가 입장 코드로 들어와 대기실에서 준비해요.' : '열면 참가자가 입장 코드로 들어와 대기실에서 준비해요.',
        cta: '클래스 열기', ctaKind: 'player',
      };
    case 'scheduled':
      return { icon: 'clock', title: `${whenLabel}에 시작해요`, sub: '미리 열어 두면 참가자가 일찍 와서 준비해요.', cta: '클래스 열기', ctaKind: 'player' };
    case 'open':
      return { icon: 'users', title: '클래스가 열려 있어요', sub: activeCount > 0 ? `초대한 ${activeCount}명이 입장 코드로 들어올 수 있어요.` : '입장 코드를 전달하면 참가자가 들어올 수 있어요.', cta: '이어서 열기', ctaKind: 'player' };
    case 'in_progress': {
      const elapsed = formatElapsed(session.started_at ?? session.scheduled_at, now);
      return { icon: 'play', title: `${elapsed || '지금'} 진행 중이에요`, sub: '이어서 열면 진행 화면이 나와요.', cta: '이어서 열기', ctaKind: 'player' };
    }
    case 'completed':
      return { icon: 'file', title: '기록과 리포트를 확인해 보세요', sub: 'AI 요약과 리포트가 준비됐어요.', cta: '기록 보기', ctaKind: 'record' };
    default:
      return { icon: 'copy', title: '취소된 클래스예요', sub: '같은 설정으로 새 클래스를 만들 수 있어요.', cta: '복제해서 만들기', ctaKind: 'duplicate' };
  }
}

function recordText(session: SessionDto): string {
  const parts: string[] = [];
  if (session.record_audio) parts.push('음성 녹음');
  if (session.record_video && session.location_type === 'online') parts.push('영상 녹화');
  return parts.length > 0 ? `${parts.join(' · ')} · AI 분석` : '기록 없음';
}

function toMailRows(inputs: MailInviteInput[]): MailInviteRow[] {
  return inputs.map((m) => {
    const gone = m.maskedEmail === null;
    return {
      key: m.id,
      email: m.maskedEmail ?? '삭제된 정보',
      tone: gone ? 'mute' : m.state === 'failed' ? 'warn' : 'ok',
      label: m.state === 'failed' ? '발송하지 못했어요' : '발송 요청함',
      again: gone ? 'gone' : m.cooldownSec > 0 ? 'wait' : 'on',
      waitText: m.cooldownSec > 0 ? `${m.cooldownSec}초 뒤에 다시 보낼 수 있어요` : '',
    };
  });
}

interface HostDetailOptions {
  now?: Date;
  mailInvites?: MailInviteInput[];
}

export function toHostDetailData(session: SessionDto, { now = new Date(), mailInvites = [] }: HostDetailOptions = {}): HostDetailData {
  const status = session.status;
  const closed = status === 'completed' || status === 'cancelled';
  const active = session.participants.filter((p) => !p.is_waitlisted);
  const waitlisted = session.participants.filter((p) => p.is_waitlisted).sort((a, b) => (a.waitlist_position ?? 99) - (b.waitlist_position ?? 99));
  const whenLabel = session.scheduled_at
    ? `${formatClassWhen(session.scheduled_at, now)} · ${session.duration_min}분`
    : `일정 없이 바로 열 수 있어요 · ${session.duration_min}분`;
  const timeOnly = formatClassWhen(session.scheduled_at, now);

  const codeValue = session.access_code;
  const code: HostDetailData['code'] = closed
    ? { state: 'closed', value: null }
    : !codeValue ? { state: 'none', value: null }
      : status === 'open' || status === 'in_progress' ? { state: 'active', value: codeValue } : { state: 'wait', value: codeValue };

  const cancelRow: HostDetailData['cancelRow'] = status === 'ready' || status === 'scheduled'
    ? { kind: 'cancel', label: '클래스 취소' }
    : status === 'open' ? { kind: 'close', label: `클래스 닫기 (회원 ${active.length}명이 나가요)` } : null;

  const full = active.length >= session.max_participants;
  return {
    chip: hostChipKey(status),
    title: session.title || '제목 없는 클래스',
    whenLabel,
    next: nextCopy(session, now, timeOnly, active.length),
    code,
    inviteText: status === 'cancelled' ? `${session.participants.length}명에게 취소 안내를 보냈어요` : `초대 ${session.participants.length}명`,
    showLinkCopy: !closed,
    place: session.location_type,
    mode: session.participant_mode,
    band: session.linkband_mode,
    placeText: session.location_type === 'online' ? '온라인(원격)' : session.location_address || '오프라인 · 주소 미등록',
    canEditPlace: status === 'ready' || status === 'scheduled',
    recordText: recordText(session),
    cancelRow,
    canDelete: status === 'ready' || status === 'scheduled' || status === 'cancelled',
    people: {
      total: active.length,
      max: session.max_participants,
      items: active.map((p, i) => toPerson(p, i, closed)),
      waitlist: waitlisted.map((p, i) => toPerson(p, i, closed)),
      canInvite: !closed && !full,
      full,
    },
    mailInvites: toMailRows(mailInvites),
  };
}

/** 서버 이메일 초대 목록 한 건 → 화면 입력. requested/queued 는 `발송 요청함`, failed·큐 적체(stale)는 `발송하지 못했어요` */
export function toMailInviteInput(
  item: { invite_id: string; email: string | null; status: string; stale: boolean; queued_at: string | null },
  now: Date,
  cooldownSec: number,
  mask: (email: string) => string | null,
): MailInviteInput {
  const queuedMs = item.queued_at ? new Date(item.queued_at).getTime() : Number.NaN;
  const elapsed = Number.isNaN(queuedMs) ? cooldownSec : Math.floor((now.getTime() - queuedMs) / 1000);
  return {
    id: item.invite_id,
    maskedEmail: item.email === null ? null : mask(item.email) ?? '비공개 주소',
    state: item.status === 'failed' || item.stale ? 'failed' : 'requested',
    cooldownSec: Math.max(0, cooldownSec - elapsed),
  };
}
