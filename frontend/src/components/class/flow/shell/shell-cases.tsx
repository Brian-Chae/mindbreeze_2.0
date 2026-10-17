// SDD-209 SH — 셸형 케이스 렌더(하니스 픽스처 전용). 시안(member-a.html / host-a.html)의 고정 시연값을 그대로 쓴다.
// 서버·시계에 의존하지 않도록 모든 문구는 미리 만들어 둔 값이다(측정이 결정적이어야 한다).
import type { ReactNode } from 'react';
import { Bell, Mail } from 'lucide-react';
import { deriveHeroAction } from '../../../../lib/class/enter-action';
import type { ClassChipKey } from '../../../../lib/class/class-labels';
import type { LinkbandMode, LocationType, ParticipantMode } from '../../../../lib/api/session';
import { type ClassHeroData } from './ClassHero';
import { MemberHomeView, type HomeSection } from './MemberHomeView';
import type { ClassRowData } from './ClassRow';
import { ShellFrame, ShellHeadTitle } from './ShellFrame';
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

/** 화면 ID + 케이스 키 → 렌더. 등록되지 않은 조합은 null */
export function renderShellCase(screen: string, key: string): ReactNode {
  switch (screen) {
    case 'FM01': return renderMemberHomeCase(key);
    default: return null;
  }
}
