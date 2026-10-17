// SDD-209 SH — 셸형 케이스 렌더(하니스 픽스처 전용). 시안(member-a.html / host-a.html)의 고정 시연값을 그대로 쓴다.
// 서버·시계에 의존하지 않도록 모든 문구는 미리 만들어 둔 값이다(측정이 결정적이어야 한다).
import type { ReactNode } from 'react';
import { Bell, Mail, Plus } from 'lucide-react';
import { deriveDetailAction, deriveHeroAction } from '../../../../lib/class/enter-action';
import type { SessionDto, SessionStatus, SessionType } from '../../../../lib/api/session';
import type { ClassChipKey } from '../../../../lib/class/class-labels';
import type { LinkbandMode, LocationType, ParticipantMode } from '../../../../lib/api/session';
import { ApplySheet } from './ApplySheet';
import type { ClassCardData } from './ClassCard';
import { type ClassHeroData } from './ClassHero';
import { MemberClassListView } from './MemberClassListView';
import { MemberHomeView, type HomeSection } from './MemberHomeView';
import type { ClassRowData } from './ClassRow';
import { ClassDetailBody, ClassDetailFoot } from './ClassDetailView';
import { HostClassListView } from './HostClassListView';
import { buildHostListModel, type HostListTab } from './host-shell-data';
import { ShellFrame, ShellHeadBack, ShellHeadTitle } from './ShellFrame';
import { toDetailData, type ClassListEntry, type ClassListSection, type SessionWithHost } from './shell-data';
import './shell-kit.css';

const noop = (): void => {};

interface DemoClass { type: string; title: string; host: string; dur: string }
const DEMO = {
  med: { type: '명상 클래스', title: '마음챙김 명상 · 4회차', host: '김하늘 상담사', dur: '50분' },
  clin: { type: '임상심리상담', title: '불안 다루기 · 개인 상담', host: '김하늘 상담사', dur: '50분' },
  hyp: { type: '최면심리상담', title: '깊은 이완 · 최면 상담', host: '박서연 상담사', dur: '60분' },
} satisfies Record<string, DemoClass>;

interface Method { place: LocationType; mode: ParticipantMode; band: LinkbandMode }
const ONLINE_GROUP_OPT: Method = { place: 'online', mode: 'group', band: 'optional' };
const OFFLINE_ONE_NONE: Method = { place: 'offline', mode: 'one_on_one', band: 'none' };
const ONLINE_ONE_REQ: Method = { place: 'online', mode: 'one_on_one', band: 'required' };

const bg = (n: number): string => `/images/background${n}.webp`;
const row = (c: DemoClass, when: string, chip: ClassChipKey, id: string): ClassRowData => ({ id, title: c.title, sub: `${when} · ${c.host}`, chip });

interface HomeCase { chip: ClassChipKey; countdown: string; c: DemoClass; m: Method; bg: number; meta: string; box: ClassHeroData['box']; rows: ClassRowData[] }
const HOME_ROWS: ClassRowData[] = [
  row(DEMO.clin, '내일 오전 10:00', 'scheduled', 'r1'),
  row(DEMO.hyp, '10월 22일 (목) 오후 7:00', 'scheduled', 'r2'),
];
const HOME_CASES: Readonly<Record<string, HomeCase>> = {
  upcoming: { chip: 'scheduled', countdown: 'D-3', c: DEMO.med, m: ONLINE_GROUP_OPT, bg: 5, meta: '화요일 오후 3:00 · 50분', box: { icon: 'bell', title: '클래스가 열리면 알려드려요', sub: '열리기 전에 한 번 더 알림을 보내요' }, rows: HOME_ROWS },
  soon: { chip: 'soon', countdown: '30분 뒤', c: DEMO.clin, m: OFFLINE_ONE_NONE, bg: 1, meta: '오늘 오후 3:00 · 50분', box: { icon: 'clock', title: '30분 뒤에 클래스가 열려요', sub: '미리 입장해서 기다릴 수 있어요' }, rows: HOME_ROWS },
  open: { chip: 'open', countdown: '오늘 오후 3:00', c: DEMO.med, m: ONLINE_GROUP_OPT, bg: 8, meta: '오늘 오후 3:00 · 50분', box: { icon: 'check', title: '지금 입장할 수 있어요', sub: '입장하면 간단한 준비를 먼저 해요' }, rows: HOME_ROWS },
  live: { chip: 'live', countdown: '12분째', c: DEMO.clin, m: ONLINE_ONE_REQ, bg: 4, meta: '오늘 오후 2:48 시작 · 50분', box: { icon: 'activity', title: '12분째 진행 중이에요', sub: '지금 들어가도 괜찮아요' }, rows: HOME_ROWS },
};

function homeHead(): ReactNode {
  return (
    <ShellHeadTitle
      title="안녕하세요, 지은님"
      right={
        <button type="button" className="sh-iconbtn" aria-label="알림">
          <Bell size={20} aria-hidden="true" /><i className="sh-iconbtn__dot" />
        </button>
      }
    />
  );
}

export function renderMemberHomeCase(key: string): ReactNode {
  const home = HOME_CASES[key];
  const handlers = { onHeroAction: noop, onEnterByCode: noop, onApply: noop, onOpenClass: noop };
  if (!home) {
    const sections: HomeSection[] = [{
      title: '받은 초대', rows: [],
      empty: { icon: <Mail size={20} aria-hidden="true" />, title: '받은 초대가 없어요', sub: '상담사가 초대하면 알림으로 알려드려요' },
    }];
    return (
      <ShellFrame role="member" active="home" head={homeHead()}>
        <MemberHomeView hero={null} heroAction={deriveHeroAction('scheduled')} emptyBackdrop={bg(8)} sections={sections} {...handlers} />
      </ShellFrame>
    );
  }
  const hero: ClassHeroData = {
    chip: home.chip, countdown: home.countdown, title: home.c.title, meta: home.meta, hostName: home.c.host,
    place: home.m.place, mode: home.m.mode, band: home.m.band, box: home.box, backdropSrc: bg(home.bg),
  };
  const sections: HomeSection[] = [{ title: '이번 주 클래스', rows: home.rows }];
  return (
    <ShellFrame role="member" active="home" head={homeHead()}>
      <MemberHomeView hero={hero} heroAction={deriveHeroAction(home.chip)} sections={sections} {...handlers} />
    </ShellFrame>
  );
}

/* ───────── FM02 목록 + 신청 시트 ───────── */
function card(c: DemoClass, m: Method, when: string, id: string, sub?: string): ClassCardData {
  return { id, typeLabel: c.type, title: c.title, whenLabel: when, place: m.place, mode: m.mode, band: m.band, subLine: sub };
}
const entry = (data: ClassCardData, chip: ClassChipKey, extra: Partial<ClassListEntry> = {}): ClassListEntry => ({ data, chip, highlight: false, ...extra });

function listSections(withInvite: boolean): ClassListSection[] {
  const sections: ClassListSection[] = [{
    key: 'enterable', title: '지금 입장할 수 있어요',
    entries: [entry(card(DEMO.med, ONLINE_GROUP_OPT, '오늘 오후 3:00', 'a1'), 'open', { highlight: true, action: { label: '입장하기', kind: 'enter' } })],
  }];
  if (withInvite) {
    sections.push({
      key: 'invited', title: '초대받은 클래스',
      entries: [entry(card({ type: '명상 클래스', title: '집단 명상 · 오리엔테이션', host: '박서연 상담사', dur: '50분' }, ONLINE_GROUP_OPT, '10월 23일 (금) 오후 2:00', 'a2', '박서연 상담사가 초대했어요'), 'invited', { action: { label: '클래스 확인', kind: 'confirm' } })],
    });
  }
  sections.push({
    key: 'upcoming', title: '예정된 클래스',
    entries: [
      entry(card(DEMO.clin, OFFLINE_ONE_NONE, '내일 오전 10:00', 'a3'), 'scheduled'),
      entry(card(DEMO.hyp, ONLINE_ONE_REQ, '10월 22일 (목) 오후 7:00', 'a4'), 'scheduled'),
      ...(withInvite ? [] : [entry(card({ type: '명상 클래스', title: '수면 준비 명상', host: '박서연 상담사', dur: '40분' }, ONLINE_GROUP_OPT, '10월 24일 (토) 오후 8:00', 'a5'), 'scheduled')]),
    ],
  });
  sections.push({
    key: 'past', title: '지난 클래스',
    entries: [entry(card({ ...DEMO.med, title: '마음챙김 명상 · 3회차' }, ONLINE_GROUP_OPT, '어제 오후 3:00', 'a6'), 'done')],
  });
  return sections;
}

export function renderMemberListCase(key: string): ReactNode {
  const head = (
    <ShellHeadTitle
      title="클래스"
      right={<button type="button" className="sh-btn"><Plus size={20} aria-hidden="true" />클래스 신청</button>}
    />
  );
  const over = key === 'apply' ? (
    <ApplySheet
      open
      options={[{ id: 'r1', name: '김하늘 상담사', sub: '임상·최면심리상담' }, { id: 'r2', name: '박서연 상담사', sub: '명상 클래스' }]}
      selectedId="r1"
      onSelect={noop}
      onSend={noop}
      onClose={noop}
    />
  ) : null;
  return (
    <ShellFrame role="member" active="class" head={head} over={over}>
      <MemberClassListView sections={listSections(key === 'invited')} onOpen={noop} onEnter={noop} onConfirmInvite={noop} />
    </ShellFrame>
  );
}

/* ───────── FM03 클래스 상세 ───────── */
/** 하니스 고정 시각: 2026-10-17(토) 12:00. 실제 변환 함수(toDetailData)를 거쳐 문구가 만들어진다 */
const DETAIL_NOW = new Date(2026, 9, 17, 12, 0);
const ADDRESS = '서울 강남구 테헤란로 123 · 4층';
const at = (day: number, hour: number): string => new Date(2026, 9, day, hour, 0).toISOString();

interface DetailCase { id: string; status: SessionStatus; type: SessionType; title: string; host: string; dur: number; when: string | null; m: Method }
const DETAIL_CASES: Readonly<Record<string, DetailCase>> = {
  scheduled: { id: 'd-sch', status: 'scheduled', type: 'meditation', title: '마음챙김 명상 · 4회차', host: '김하늘', dur: 50, when: at(20, 14), m: ONLINE_GROUP_OPT },
  'scheduled-offline': { id: 'd-sch-off', status: 'scheduled', type: 'clinical', title: '불안 다루기 · 개인 상담', host: '김하늘', dur: 50, when: at(18, 7), m: OFFLINE_ONE_NONE },
  open: { id: 'd-open', status: 'open', type: 'meditation', title: '마음챙김 명상 · 4회차', host: '김하늘', dur: 50, when: at(17, 15), m: ONLINE_GROUP_OPT },
  'open-offline': { id: 'd-open-off', status: 'open', type: 'meditation', title: '소그룹 명상 · 현장 클래스', host: '김하늘', dur: 50, when: at(17, 15), m: { place: 'offline', mode: 'group', band: 'required' } },
  'open-1on1': { id: 'd-open-1', status: 'open', type: 'hypnosis', title: '깊은 이완 · 최면 상담', host: '박서연', dur: 60, when: at(17, 15), m: ONLINE_ONE_REQ },
  done: { id: 'd-done', status: 'completed', type: 'meditation', title: '마음챙김 명상 · 3회차', host: '김하늘', dur: 50, when: at(16, 15), m: ONLINE_GROUP_OPT },
  cancelled: { id: 'd-canc', status: 'cancelled', type: 'meditation', title: '마음챙김 명상 · 4회차', host: '김하늘', dur: 50, when: at(20, 15), m: ONLINE_GROUP_OPT },
};

function demoSession(c: DetailCase): SessionWithHost {
  return {
    id: c.id, type: c.type, custom_type_name: null, status: c.status, host_id: 'h1', host_name: c.host, scheduled_at: c.when, access_code: null,
    started_at: null, ended_at: null, duration_min: c.dur, title: c.title, notes: null, max_participants: 10,
    location_type: c.m.place, location_address: c.m.place === 'offline' ? ADDRESS : null, participant_mode: c.m.mode, linkband_mode: c.m.band,
    webrtc_room_id: null, sfu_enabled: false, record_audio: true, record_video: true, created_at: at(1, 9),
    participants: c.status === 'completed' ? Array.from({ length: 8 }, (_, i) => ({ user_id: `u${i}`, guest_name: null, is_guest: false, band_connected: false, linkband_device_id: null, webrtc_peer_id: null, consent_audio: false, consent_eeg: false, is_waitlisted: false, waitlist_position: null })) : [],
    waitlist_count: 0,
  };
}

export function renderMemberDetailCase(key: string): ReactNode {
  const c = DETAIL_CASES[key];
  if (!c) return null;
  const data = toDetailData(demoSession(c), DETAIL_NOW, key === 'open-offline' ? { box: { icon: 'check', title: '지금 입장할 수 있어요', sub: '현장에 도착했다면 입장해 주세요' } } : key === 'open-1on1' ? { box: { icon: 'check', title: '지금 입장할 수 있어요', sub: '1:1 클래스예요' } } : {});
  const action = deriveDetailAction(data.chip);
  return (
    <ShellFrame
      role="member"
      active="class"
      head={<ShellHeadBack title="클래스 상세" />}
      foot={<ClassDetailFoot note={action.note} action={action} onAction={noop} />}
    >
      <ClassDetailBody data={data} />
    </ShellFrame>
  );
}

/* ───────── FH01 상담사 목록 ───────── */
interface HostDemo { id: string; title: string; status: SessionStatus; type: SessionType; day: number | null; hour: number; minute?: number; m: Method; invited: number; startedAgoMin?: number }

function hostDemoSession(d: HostDemo): SessionDto {
  const when = d.day === null ? null : new Date(2026, 9, d.day, d.hour, d.minute ?? 0).toISOString();
  return {
    id: d.id, type: d.type, custom_type_name: null, status: d.status, host_id: 'h1', scheduled_at: when, access_code: null,
    started_at: d.startedAgoMin === undefined ? null : new Date(DETAIL_NOW.getTime() - d.startedAgoMin * 60_000).toISOString(), ended_at: null,
    duration_min: 50, title: d.title, notes: null, max_participants: 10, location_type: d.m.place, location_address: null,
    participant_mode: d.m.mode, linkband_mode: d.m.band, webrtc_room_id: null, sfu_enabled: false, record_audio: true, record_video: true, created_at: at(1, 9),
    participants: Array.from({ length: d.invited }, (_, i) => ({ user_id: `${d.id}-${i}`, guest_name: null, is_guest: false, band_connected: false, linkband_device_id: null, webrtc_peer_id: null, consent_audio: false, consent_eeg: false, is_waitlisted: false, waitlist_position: null })),
    waitlist_count: 0,
  };
}

const ONLINE_ONE_OPT: Method = { place: 'online', mode: 'one_on_one', band: 'optional' };
const OFFLINE_GROUP_OPT: Method = { place: 'offline', mode: 'group', band: 'optional' };
const OFFLINE_ONE_OPT: Method = { place: 'offline', mode: 'one_on_one', band: 'optional' };
const HOST_UPCOMING: HostDemo[] = [
  { id: 'h-a', title: '박지우 님 1차 상담', status: 'scheduled', type: 'clinical', day: 17, hour: 15, m: ONLINE_ONE_OPT, invited: 1 },
  { id: 'h-b', title: '최면 이완 2회차', status: 'scheduled', type: 'hypnosis', day: 17, hour: 17, minute: 30, m: OFFLINE_GROUP_OPT, invited: 6 },
  { id: 'h-c', title: '이완 명상 입문', status: 'ready', type: 'meditation', day: null, hour: 0, m: ONLINE_GROUP_OPT, invited: 3 },
  { id: 'h-d', title: '직장인 명상 1회차', status: 'scheduled', type: 'meditation', day: 18, hour: 10, m: ONLINE_GROUP_OPT, invited: 8 },
  { id: 'h-e', title: '정서아 님 2차 상담', status: 'scheduled', type: 'clinical', day: 18, hour: 14, m: OFFLINE_ONE_OPT, invited: 1 },
];
const HOST_PAST: HostDemo[] = [
  { id: 'h-p1', title: '마음챙김 명상 3회차', status: 'completed', type: 'meditation', day: 16, hour: 19, m: ONLINE_GROUP_OPT, invited: 8 },
  { id: 'h-p2', title: '이민준 님 2차 상담', status: 'cancelled', type: 'clinical', day: 15, hour: 16, m: OFFLINE_ONE_OPT, invited: 1 },
  { id: 'h-p3', title: '최면 이완 1회차', status: 'completed', type: 'hypnosis', day: 10, hour: 10, m: ONLINE_GROUP_OPT, invited: 6 },
  { id: 'h-p4', title: '김서연 님 2차 상담', status: 'completed', type: 'clinical', day: 8, hour: 14, m: OFFLINE_ONE_OPT, invited: 1 },
];
const HOST_LIVE: Readonly<Record<string, HostDemo>> = {
  open: { id: 'h-live', title: '마음챙김 명상 4회차', status: 'open', type: 'meditation', day: 17, hour: 15, m: ONLINE_GROUP_OPT, invited: 8 },
  'open-offline': { id: 'h-live', title: '김서연 님 3차 상담', status: 'open', type: 'clinical', day: 17, hour: 15, m: { place: 'offline', mode: 'one_on_one', band: 'none' }, invited: 1 },
  progress: { id: 'h-live', title: '마음챙김 명상 4회차', status: 'in_progress', type: 'meditation', day: 17, hour: 11, minute: 48, m: ONLINE_GROUP_OPT, invited: 8, startedAgoMin: 12 },
  past: { id: 'h-live', title: '마음챙김 명상 4회차', status: 'open', type: 'meditation', day: 17, hour: 15, m: ONLINE_GROUP_OPT, invited: 8 },
  net: { id: 'h-live', title: '마음챙김 명상 4회차', status: 'open', type: 'meditation', day: 17, hour: 15, m: ONLINE_GROUP_OPT, invited: 8 },
};

export function renderHostListCase(key: string): ReactNode {
  const live = HOST_LIVE[key];
  const demos = key === 'empty' ? [] : [...(live ? [live] : []), ...HOST_UPCOMING, ...HOST_PAST];
  const tab: HostListTab = key === 'past' ? 'past' : 'upcoming';
  const model = buildHostListModel(demos.map(hostDemoSession), tab, DETAIL_NOW);
  const head = (
    <ShellHeadTitle
      title="클래스"
      right={key === 'empty' ? undefined : <button type="button" className="sh-btn"><Plus size={20} aria-hidden="true" />클래스 만들기</button>}
    />
  );
  return (
    <ShellFrame role="host" active="class" head={head}>
      <HostClassListView
        model={model}
        tab={tab}
        onTab={noop}
        onCreate={noop}
        onDetail={noop}
        onEnterPlayer={noop}
        onRequestClose={noop}
        notice={key === 'net' ? '연결이 끊겼어요. 다시 연결되면 자동으로 새로 고쳐요.' : null}
      />
    </ShellFrame>
  );
}

/** 화면 ID + 케이스 키 → 렌더. 등록되지 않은 조합은 null */
export function renderShellCase(screen: string, key: string): ReactNode {
  switch (screen) {
    case 'FM01': return renderMemberHomeCase(key);
    case 'FM02': return renderMemberListCase(key);
    case 'FM03': return renderMemberDetailCase(key);
    case 'FH01': return renderHostListCase(key);
    default: return null;
  }
}
