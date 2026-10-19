// SDD-209 H1~H2 — 상담사 클래스 만들기 마법사(5단계) 상태·검증·페이로드. 순수 함수만 둔다(뷰·훅이 조립).
// 근거: plan §1.2 FH02a~e, designs/class-flow-redesign/host-a.html (stepA~stepE).
import type { CreateSessionPayload, LinkbandMode, LocationType, ParticipantMode, SessionType } from '../api/session';
import type { FlowPlace, FlowSize } from './flow/types';
import { isCounselingEnabled } from '../feature-flags';

export const WIZARD_STEP_COUNT = 5;
export type WizardStep = 1 | 2 | 3 | 4 | 5;

/** 화면용 유형 키. 서버 `custom` 은 화면에서 `other`(기타) */
export type WizardType = 'clinical' | 'hypnosis' | 'meditation' | 'other';
export type WizardWhen = 'now' | 'later';
export type WizardRemind = 'off' | 'day' | 'hour';
export type InviteTab = 'member' | 'email';

export interface WizardMember {
  id: string;
  name: string;
  email: string;
}

export interface WizardDraft {
  type: WizardType;
  customName: string;
  place: FlowPlace;
  size: FlowSize;
  /** 그룹 정원(1:1 은 항상 1명). 기본 10, 온라인 그룹 최대 50·오프라인 그룹 최대 100 */
  capacity: number;
  band: LinkbandMode;
  /** 음성 녹음 */
  voice: boolean;
  /** 영상 녹화(온라인만 의미 있음) */
  video: boolean;
  address: string;
  when: WizardWhen;
  /** 오늘 기준 며칠 뒤(0~13) */
  dayOffset: number;
  /** 자정부터의 분(5분 단위) */
  timeMin: number;
  durationMin: number;
  remind: WizardRemind;
  title: string;
  members: WizardMember[];
  /** 비회원 이메일 초대(정원에 포함하지 않는다) */
  emails: string[];
}

export interface WizardUi {
  inviteTab: InviteTab;
  memberQuery: string;
  mailInput: string;
  mailError: boolean;
  leaveOpen: boolean;
}

export interface WizardState {
  step: WizardStep;
  draft: WizardDraft;
  ui: WizardUi;
}

export const DEFAULT_CAPACITY = 10;
export const MIN_CAPACITY = 2;
export const ONLINE_GROUP_MAX = 50;
export const OFFLINE_GROUP_MAX = 100;

/** 정원 상한: 1:1 은 1명 고정, 그룹은 장소별(서버 검증 `le=100` 안) */
export function capacityMax(place: FlowPlace, size: FlowSize): number {
  if (size === 'solo') return 1;
  return place === 'offline' ? OFFLINE_GROUP_MAX : ONLINE_GROUP_MAX;
}

export function clampCapacity(value: number, place: FlowPlace, size: FlowSize): number {
  if (size === 'solo') return 1;
  return Math.max(MIN_CAPACITY, Math.min(capacityMax(place, size), value));
}

export const MAX_DURATION_MIN = 480;
export const MIN_DURATION_MIN = 5;
export const MAX_DAY_OFFSET = 13;
/** 예약 시각 최소·최대(07:00 ~ 22:00) */
export const MIN_TIME_MIN = 7 * 60;
export const MAX_TIME_MIN = 22 * 60;

export const WIZARD_TYPES: ReadonlyArray<{ id: WizardType; label: string }> = [
  { id: 'clinical', label: '임상심리상담' },
  { id: 'hypnosis', label: '최면심리상담' },
  { id: 'meditation', label: '명상' },
  { id: 'other', label: '기타' },
];

/** SDD-219: 상담 비공개 시 임상·최면 유형을 선택지에서 제외한다(라벨 조회용 WIZARD_TYPES 는 유지). */
export function wizardTypeOptions(): ReadonlyArray<{ id: WizardType; label: string }> {
  return isCounselingEnabled() ? WIZARD_TYPES : WIZARD_TYPES.filter((t) => t.id !== 'clinical' && t.id !== 'hypnosis');
}

export const BAND_LABEL: Readonly<Record<LinkbandMode, string>> = {
  none: 'LINK BAND 사용 안 함',
  optional: 'LINK BAND 선택',
  required: 'LINK BAND 필수',
};

export function createInitialDraft(): WizardDraft {
  return {
    type: 'meditation',
    customName: '',
    place: 'online',
    size: 'group',
    capacity: DEFAULT_CAPACITY,
    band: 'optional',
    voice: true,
    video: true,
    address: '',
    when: 'later',
    dayOffset: 1,
    timeMin: 15 * 60,
    durationMin: 50,
    remind: 'day',
    title: '',
    members: [],
    emails: [],
  };
}

export function createInitialState(draft: WizardDraft = createInitialDraft()): WizardState {
  return {
    step: 1,
    draft,
    ui: { inviteTab: 'member', memberQuery: '', mailInput: '', mailError: false, leaveOpen: false },
  };
}

// ───────── 표시 문자열 ─────────

export function fmtDuration(min: number): string {
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

export function fmtClock(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}`;
}

export function fmtHour(min: number): string {
  const h = Math.floor(min / 60);
  return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}시`;
}

export function fmtMinute(min: number): string {
  return `${String(min % 60).padStart(2, '0')}분`;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

export function addDays(base: Date, days: number): Date {
  const next = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

/** `내일 · 10월 18일 일` / `오늘` / `N일 뒤` */
export function fmtDay(base: Date, offset: number): string {
  const d = addDays(base, offset);
  const rel = offset === 0 ? '오늘' : offset === 1 ? '내일' : `${offset}일 뒤`;
  return `${rel} · ${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}`;
}

/** 요약·완료 화면용 `내일 오후 3:15` / `10월 20일 오전 9:00` */
export function fmtWhen(draft: WizardDraft, base: Date): string {
  if (draft.when === 'now') return '지금 바로';
  const d = addDays(base, draft.dayOffset);
  const rel = draft.dayOffset === 0 ? '오늘' : draft.dayOffset === 1 ? '내일' : `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return `${rel} ${fmtClock(draft.timeMin)}`;
}

export function typeLabel(draft: WizardDraft): string {
  if (draft.type === 'other') return draft.customName.trim() || '기타';
  return WIZARD_TYPES.find((t) => t.id === draft.type)?.label ?? '';
}

/** 이메일 마스킹: 앞 2자 + `***@…` (전체 주소를 화면에 두지 않는다) */
export function maskEmail(email: string): string {
  return `${email.slice(0, 2)}***@…`;
}

// ───────── 이메일 ─────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** CSV 본문에서 `email` 열을 찾아 주소 목록을 돌려준다. 헤더가 없거나 email 열이 없으면 null */
export function parseCsvEmails(text: string): string[] | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const col = header.indexOf('email');
  if (col < 0) return null;
  const seen = new Set<string>();
  for (const line of lines.slice(1)) {
    const value = line.split(',')[col]?.trim().toLowerCase();
    if (value && isValidEmail(value)) seen.add(value);
  }
  return [...seen];
}

// ───────── 상태 전이 ─────────

export type WizardAction =
  | { type: 'goto'; step: WizardStep }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'patch'; patch: Partial<WizardDraft> }
  | { type: 'setPlace'; place: FlowPlace }
  | { type: 'setSize'; size: FlowSize }
  | { type: 'setWhen'; when: WizardWhen }
  | { type: 'stepCapacity'; delta: number }
  | { type: 'stepDuration'; delta: number }
  | { type: 'stepDay'; delta: number }
  | { type: 'stepTime'; delta: number }
  | { type: 'stepMinute'; delta: number }
  | { type: 'toggleMember'; member: WizardMember }
  | { type: 'pickMembers'; members: readonly WizardMember[] }
  | { type: 'setInviteTab'; tab: InviteTab }
  | { type: 'setMemberQuery'; query: string }
  | { type: 'setMailInput'; value: string }
  | { type: 'addEmail' }
  | { type: 'removeEmail'; email: string }
  | { type: 'openLeave' }
  | { type: 'closeLeave' };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** 1:1 은 참여자 1명 고정, 그룹은 정원까지 */
export function memberLimit(draft: WizardDraft): number {
  return draft.size === 'solo' ? 1 : draft.capacity;
}

function withDraft(state: WizardState, patch: Partial<WizardDraft>): WizardState {
  return { ...state, draft: { ...state.draft, ...patch } };
}

function withUi(state: WizardState, patch: Partial<WizardUi>): WizardState {
  return { ...state, ui: { ...state.ui, ...patch } };
}

function trimMembers(draft: WizardDraft): WizardMember[] {
  return draft.members.slice(0, memberLimit(draft));
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  const { draft } = state;
  switch (action.type) {
    case 'goto':
      return { ...state, step: action.step };
    case 'next':
      return state.step >= WIZARD_STEP_COUNT ? state : { ...state, step: (state.step + 1) as WizardStep };
    case 'prev':
      return state.step <= 1 ? state : { ...state, step: (state.step - 1) as WizardStep };
    case 'patch':
      return withDraft(state, action.patch);
    case 'setPlace': {
      const capacity = clampCapacity(draft.capacity, action.place, draft.size === 'solo' ? 'group' : draft.size);
      const next = { ...draft, place: action.place, capacity };
      return withDraft(state, { place: action.place, capacity, members: trimMembers(next) });
    }
    case 'stepCapacity': {
      const capacity = clampCapacity(draft.capacity + action.delta, draft.place, 'group');
      return withDraft(state, { capacity, members: trimMembers({ ...draft, capacity }) });
    }
    case 'setSize': {
      const next = { ...draft, size: action.size };
      return withDraft(state, { size: action.size, members: trimMembers(next) });
    }
    case 'setWhen':
      return withDraft(state, { when: action.when });
    case 'stepDuration':
      return withDraft(state, { durationMin: clamp(draft.durationMin + action.delta, MIN_DURATION_MIN, MAX_DURATION_MIN) });
    case 'stepDay':
      return withDraft(state, { dayOffset: clamp(draft.dayOffset + action.delta, 0, MAX_DAY_OFFSET) });
    case 'stepTime':
      return withDraft(state, { timeMin: clamp(draft.timeMin + action.delta, MIN_TIME_MIN, MAX_TIME_MIN) });
    case 'stepMinute': {
      const hour = Math.floor(draft.timeMin / 60);
      const minute = (((draft.timeMin % 60) + action.delta) % 60 + 60) % 60;
      return withDraft(state, { timeMin: clamp(hour * 60 + minute, MIN_TIME_MIN, MAX_TIME_MIN) });
    }
    case 'toggleMember': {
      const exists = draft.members.some((m) => m.id === action.member.id);
      if (exists) return withDraft(state, { members: draft.members.filter((m) => m.id !== action.member.id) });
      if (draft.members.length >= memberLimit(draft)) return state;
      return withDraft(state, { members: [...draft.members, action.member] });
    }
    case 'pickMembers': {
      const known = new Set(draft.members.map((m) => m.id));
      const merged = [...draft.members];
      for (const m of action.members) {
        if (merged.length >= memberLimit(draft)) break;
        if (!known.has(m.id)) {
          known.add(m.id);
          merged.push(m);
        }
      }
      return withDraft(state, { members: merged });
    }
    case 'setInviteTab':
      return withUi(state, { inviteTab: action.tab });
    case 'setMemberQuery':
      return withUi(state, { memberQuery: action.query });
    case 'setMailInput':
      return withUi(state, { mailInput: action.value, mailError: false });
    case 'addEmail': {
      const value = state.ui.mailInput.trim().toLowerCase();
      if (!isValidEmail(value)) return withUi(state, { mailError: true });
      if (draft.emails.includes(value)) return withUi(state, { mailInput: '', mailError: false });
      return { ...withDraft(state, { emails: [...draft.emails, value] }), ui: { ...state.ui, mailInput: '', mailError: false } };
    }
    case 'removeEmail':
      return withDraft(state, { emails: draft.emails.filter((e) => e !== action.email) });
    case 'openLeave':
      return withUi(state, { leaveOpen: true });
    case 'closeLeave':
      return withUi(state, { leaveOpen: false });
    default:
      return state;
  }
}

/** 변경이 있으면 이탈 가드가 필요하다. 주소는 기본 주소가 자동으로 채워지므로 비교에서 뺀다(오프라인 선택 자체가 변경으로 잡힌다) */
export function isDraftDirty(draft: WizardDraft): boolean {
  const base = createInitialDraft();
  return (Object.keys(base) as Array<keyof WizardDraft>).some((key) => key !== 'address' && JSON.stringify(base[key]) !== JSON.stringify(draft[key]));
}

// ───────── 일정 ─────────

export function scheduledStart(draft: WizardDraft, base: Date): Date | null {
  if (draft.when === 'now') return null;
  const day = addDays(base, draft.dayOffset);
  day.setHours(Math.floor(draft.timeMin / 60), draft.timeMin % 60, 0, 0);
  return day;
}

export interface ConflictCandidate {
  title: string | null;
  scheduledAt: string | null;
  durationMin: number;
}

/** 같은 시간대에 겹치는 기존 클래스(프론트 계산, 서버 `force` 로 생성은 허용) */
export function findScheduleConflict(draft: WizardDraft, base: Date, existing: readonly ConflictCandidate[]): ConflictCandidate | null {
  const start = scheduledStart(draft, base);
  if (!start) return null;
  const startMs = start.getTime();
  const endMs = startMs + draft.durationMin * 60_000;
  for (const item of existing) {
    if (!item.scheduledAt) continue;
    const itemStart = new Date(item.scheduledAt).getTime();
    if (Number.isNaN(itemStart)) continue;
    const itemEnd = itemStart + item.durationMin * 60_000;
    if (startMs < itemEnd && itemStart < endMs) return item;
  }
  return null;
}

// ───────── 서버 페이로드 ─────────

const REMIND_OFFSETS: Readonly<Record<WizardRemind, number[]>> = { off: [], day: [1440], hour: [60] };

export function buildCreatePayload(draft: WizardDraft, base: Date, force: boolean): CreateSessionPayload {
  const locationType: LocationType = draft.place;
  const participantMode: ParticipantMode = draft.size === 'solo' ? 'one_on_one' : 'group';
  const start = scheduledStart(draft, base);
  const type: SessionType = draft.type === 'other' ? 'custom' : draft.type;
  const address = locationType === 'offline' ? draft.address.trim() : '';
  return {
    type,
    custom_type_name: draft.type === 'other' ? draft.customName.trim() || undefined : undefined,
    scheduled_at: start ? start.toISOString() : undefined,
    duration_min: draft.durationMin,
    title: draft.title.trim() || undefined,
    max_participants: maxParticipantsOf(draft),
    location_type: locationType,
    location_address: address || undefined,
    participant_mode: participantMode,
    linkband_mode: draft.band,
    sfu_enabled: locationType === 'online' && draft.size === 'group',
    record_audio: draft.voice,
    record_video: locationType === 'online' && draft.voice && draft.video,
    reminder_offsets: start ? REMIND_OFFSETS[draft.remind] : [],
    force: force || undefined,
  };
}

/** 서버 `max_participants`. 1:1 은 1명 고정 */
export function maxParticipantsOf(draft: WizardDraft): number {
  return draft.size === 'solo' ? 1 : clampCapacity(draft.capacity, draft.place, 'group');
}
