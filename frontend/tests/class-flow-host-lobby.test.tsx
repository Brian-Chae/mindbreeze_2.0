// @vitest-environment jsdom
// SDD-209 H5 — 로비 모델(초대 명단 ⊕ presence)과 FH06 화면
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LobbyFixture } from '../src/components/class/flow/host/LobbyFixture';
import {
  canStartLobby, deriveLobby, inviteStatusLine, lobbyDockItems, lobbyEmptyHint, lobbyStatusLine,
  type LobbyContext, type LobbyPresenceEntry, type LobbyRosterEntry,
} from '../src/lib/class/flow/host-lobby-model';
import { LOBBY_CASES, buildLobbyFixture } from '../src/lib/class/flow/host-lobby-fixtures';

const roster = (n: number): LobbyRosterEntry[] => Array.from({ length: n }, (_, i) => ({ participantId: `p${i}`, name: `회원${i}` }));
const present = (i: number, patch: Partial<LobbyPresenceEntry> = {}): LobbyPresenceEntry => ({
  participantId: `p${i}`, nickname: `닉${i}`, readiness: { surveyDone: true, bandDone: true, deviceDone: true }, ...patch,
});
const ONLINE_GROUP: LobbyContext = { place: 'online', size: 'group', band: 'optional' };

describe('deriveLobby — 초대 명단 기준 ⊕ presence', () => {
  it('초대 N · 대기실 M · 입장 전 N−M, 이름은 초대 명단이 정본', () => {
    const m = deriveLobby(roster(6), [present(0), present(1, { readiness: { surveyDone: false, bandDone: false, deviceDone: false } })], ONLINE_GROUP);
    expect(m.stats).toEqual({ invited: 6, inRoom: 2, away: 4, ready: 1, waiting: 1 });
    expect(m.rows.map((r) => r.name)).toEqual(['회원0', '회원1']);
    expect(m.awayNames).toEqual(['회원2', '회원3', '회원4', '회원5']);
  });

  it('presence 가 사라져도 초대 N 은 그대로이고 그 사람은 아직 입장하지 않은 쪽으로 강등된다', () => {
    const before = deriveLobby(roster(3), [present(0), present(1), present(2)], ONLINE_GROUP);
    const after = deriveLobby(roster(3), [present(0), present(2)], ONLINE_GROUP);
    expect(before.stats.invited).toBe(3);
    expect(after.stats).toMatchObject({ invited: 3, inRoom: 2, away: 1 });
    expect(after.awayNames).toEqual(['회원1']);
  });

  it('초대 명단에 없는 입장자(코드로 입장)는 닉네임으로 보이고 초대 N 에 보정된다', () => {
    const m = deriveLobby(roster(1), [present(0), { participantId: 'x', nickname: '코드입장', readiness: { surveyDone: true, bandDone: true, deviceDone: true } }], ONLINE_GROUP);
    expect(m.rows[1].name).toBe('코드입장');
    expect(m.stats.invited).toBe(2);
    expect(m.stats.away).toBe(0);
  });

  it('같은 participantId 의 중복 presence 는 한 번만 센다', () => {
    expect(deriveLobby(roster(2), [present(0), present(0)], ONLINE_GROUP).stats.inRoom).toBe(1);
  });

  it('오프라인은 기기, 밴드 사용 안 함은 밴드 단계가 na(숨김)이고 준비 판정에서 빠진다', () => {
    const waitingOnly = { surveyDone: true, bandDone: false, deviceDone: false };
    const off = deriveLobby(roster(1), [present(0, { readiness: waitingOnly })], { place: 'offline', size: 'solo', band: 'none' });
    expect(off.rows[0]).toMatchObject({ survey: 'ok', band: 'na', device: 'na', ready: true });
    const on = deriveLobby(roster(1), [present(0, { readiness: waitingOnly })], ONLINE_GROUP);
    expect(on.rows[0]).toMatchObject({ band: 'wait', device: 'wait', ready: false });
  });

  it('건너뜀은 완료로 본다, 접촉 불량은 준비 중으로 본다', () => {
    const skipped = deriveLobby(roster(1), [present(0, { readiness: { surveyDone: true, bandDone: true, deviceDone: true, bandSkipped: true } })], ONLINE_GROUP);
    expect(skipped.rows[0]).toMatchObject({ band: 'skip', ready: true });
    const bad = deriveLobby(roster(1), [present(0, { leadOff: { ch1: true, ch2: false } })], ONLINE_GROUP);
    expect(bad.rows[0]).toMatchObject({ band: 'bad', ready: false });
    expect(bad.rows[0].electrodes).toEqual({ left: 'bad', ref: 'bad', right: 'good' });
    const both = deriveLobby(roster(1), [present(0, { leadOff: { ch1: true, ch2: true } })], ONLINE_GROUP);
    expect(both.rows[0].electrodes).toEqual({ left: 'bad', ref: 'bad', right: 'bad' });
  });

  it('접촉 정보가 없으면(BE-10 미수신) 거짓 불량을 만들지 않는다', () => {
    const m = deriveLobby(roster(1), [present(0, { leadOff: null })], ONLINE_GROUP);
    expect(m.rows[0].band).toBe('ok');
    expect(m.rows[0].electrodes).toBeNull();
  });
});

describe('상태줄·초대 줄·도크', () => {
  it('상태줄 5가지', () => {
    expect(lobbyStatusLine({ inRoom: 0, ready: 0, waiting: 0 })).toBe('대기실이 비어 있어요 · 초대한 회원은 시작 후에도 입장할 수 있어요');
    expect(lobbyStatusLine({ inRoom: 3, ready: 1, waiting: 2 })).toBe('1명 준비 완료 · 2명 준비 중');
    expect(lobbyStatusLine({ inRoom: 3, ready: 0, waiting: 3 })).toBe('0명 준비 완료 · 3명 준비 중');
    expect(lobbyStatusLine({ inRoom: 8, ready: 8, waiting: 0 })).toBe('8명 모두 준비 완료');
    expect(lobbyStatusLine({ inRoom: 1, ready: 1, waiting: 0 })).toBe('회원이 준비 완료');
  });

  it('초대 현황 줄과 빈 목록 안내', () => {
    expect(inviteStatusLine({ invited: 0, away: 0 })).toBe('아직 초대한 회원이 없어요');
    expect(inviteStatusLine({ invited: 6, away: 3 })).toBe('3명이 아직 입장하지 않았어요');
    expect(inviteStatusLine({ invited: 8, away: 0 })).toBe('초대한 회원이 모두 입장했어요');
    expect(lobbyEmptyHint(0, 'online')).toBe('초대 추가로 회원을 초대할 수 있어요');
    expect(lobbyEmptyHint(6, 'online')).toBe('초대한 회원이 입장하면 여기에 나타나요');
    expect(lobbyEmptyHint(6, 'offline')).toBe('초대한 회원이 도착해 입장하면 여기에 나타나요');
  });

  it('도크: 온라인 그룹 4개 / 오프라인 내 밴드·채팅 / 밴드 사용 안 함은 내 밴드 없음 / 1:1 은 발언권 없음', () => {
    expect(lobbyDockItems(ONLINE_GROUP).map((d) => d.label)).toEqual(['BGM', '내 밴드', '발언권', '채팅']);
    expect(lobbyDockItems({ place: 'offline', size: 'group', band: 'optional' }).map((d) => d.label)).toEqual(['내 밴드', '채팅']);
    expect(lobbyDockItems({ place: 'online', size: 'group', band: 'none' }).map((d) => d.label)).toEqual(['BGM', '발언권', '채팅']);
    expect(lobbyDockItems({ place: 'online', size: 'solo', band: 'optional' }).map((d) => d.label)).toEqual(['BGM', '내 밴드', '채팅']);
  });

  it('시작하기는 항상 활성(그룹 0명 포함, F7)', () => {
    expect(canStartLobby()).toBe(true);
  });
});

describe('시안 입력 → 모델', () => {
  it('25개 키가 모두 모델로 만들어지고, 대기 인원이 시안과 같다', () => {
    const keys = Object.keys(LOBBY_CASES);
    expect(keys).toHaveLength(25);
    expect(buildLobbyFixture('g-on-3').model.stats).toMatchObject({ invited: 6, inRoom: 3, ready: 1, waiting: 2 });
    expect(buildLobbyFixture('g-on-8').model.stats).toMatchObject({ invited: 8, inRoom: 8, away: 0, waiting: 0 });
    expect(buildLobbyFixture('g-on-3-wait').model.stats).toMatchObject({ ready: 0, waiting: 3 });
    expect(buildLobbyFixture('g-on-12-many').model.stats).toMatchObject({ inRoom: 12, ready: 4, waiting: 8 });
    expect(buildLobbyFixture('g-on-0-inv0').model.stats).toMatchObject({ invited: 0, inRoom: 0 });
  });

  it('FH06 g-off-0-inv0: 키 접두는 그룹이지만 시안은 1:1 이다 — 시안을 따른다', () => {
    expect(buildLobbyFixture('g-off-0-inv0').ctx).toMatchObject({ place: 'offline', size: 'solo' });
  });

  it('접촉 불량 3종은 L만 / R만 / 둘 다', () => {
    const rows = buildLobbyFixture('g-on-3-contact').model.rows;
    expect(rows.map((r) => r.electrodes && [r.electrodes.left, r.electrodes.right])).toEqual([['bad', 'good'], ['good', 'bad'], ['bad', 'bad']]);
  });
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(window, { matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }) });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const text = (): string => container.textContent ?? '';
const show = async (caseKey: string, n?: number): Promise<void> => { await act(async () => root.render(createElement(LobbyFixture, { caseKey, n, backdropSrc: '' }))); };
const startButton = (): HTMLButtonElement => container.querySelector('[data-pz="flow-cta"]') as HTMLButtonElement;

describe('FH06 화면', () => {
  it('대기 3명: 초대 현황·행 칩·상태줄·시작하기 활성, 코드는 본문에 없다', async () => {
    await show('g-on-3');
    expect(text()).toContain('로비 · 온라인 · 그룹');
    expect(text()).toContain('초대 6명 · 대기실 3명');
    expect(text()).toContain('3명이 아직 입장하지 않았어요');
    expect(text()).toContain('1명 준비 완료 · 2명 준비 중');
    expect(text()).toContain('대기실 3명');
    expect(container.querySelectorAll('.fhb-mrow')).toHaveLength(3);
    expect(startButton().disabled).toBe(false);
    expect(text()).toContain('시작하기');
    expect(text()).not.toContain('4829');
    expect(text()).not.toContain('입장 코드');
    for (const label of ['BGM', '내 밴드', '발언권', '채팅']) expect(text()).toContain(label);
  });

  it('대기 0명: 비어 있음 안내, 그래도 시작하기 활성', async () => {
    await show('g-on-0');
    expect(text()).toContain('아직 대기 중인 회원이 없어요');
    expect(text()).toContain('초대한 회원이 입장하면 여기에 나타나요');
    expect(text()).toContain('대기실이 비어 있어요 · 초대한 회원은 시작 후에도 입장할 수 있어요');
    expect(startButton().disabled).toBe(false);
  });

  it('초대 0명: 안내와 다시 알림 비활성', async () => {
    await show('g-on-0-inv0');
    expect(text()).toContain('초대 0명 · 대기실 0명');
    expect(text()).toContain('아직 초대한 회원이 없어요');
    expect(text()).toContain('초대 추가로 회원을 초대할 수 있어요');
    expect((container.querySelectorAll('.fhb-invite button')[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it('전원 입장: 모두 입장했어요, 다시 알림 비활성', async () => {
    await show('g-on-8');
    expect(text()).toContain('초대한 회원이 모두 입장했어요');
    expect(text()).toContain('8명 모두 준비 완료');
  });

  it('오프라인: 장소 줄, 도크는 내 밴드·채팅, 오프라인 문구', async () => {
    await show('g-off-0');
    expect(text()).toContain('서울 강남구 테헤란로 123 · 4층 명상실');
    expect(text()).toContain('오늘 오후 3:00 시작 예정');
    expect(text()).toContain('초대한 회원이 도착해 입장하면 여기에 나타나요');
    expect([...container.querySelectorAll('.fhb-dk')].map((b) => b.textContent)).toEqual(['내 밴드', '채팅']);
  });

  it('오프라인 행은 기기 칩이 없고, 밴드 사용 안 함은 밴드 칩과 내 밴드 도크가 없다', async () => {
    await show('g-off-3-none');
    const row = container.querySelector('.fhb-mrow') as HTMLElement;
    expect(row.textContent).toContain('설문');
    expect(row.textContent).not.toContain('기기');
    expect(row.textContent).not.toContain('밴드');
    expect(text()).toContain('LINK BAND 사용 안 함');
    expect([...container.querySelectorAll('.fhb-dk')].map((b) => b.textContent)).toEqual(['채팅']);
  });

  it('필수 모드 헤더 칩, 참가 조건 아님', async () => {
    await show('g-on-3-req');
    expect(text()).toContain('LINK BAND 필수');
    expect(startButton().disabled).toBe(false);
  });

  it('접촉 불량 행: 전극 LED 3개 + 라벨(색 + 글자), 체크·엑스 글리프 없음', async () => {
    await show('g-on-3-contact');
    const leads = container.querySelectorAll('[data-pz="flow-lead-row"]');
    expect(leads).toHaveLength(3);
    expect(leads[0].textContent).toBe('왼쪽 실패기준 실패오른쪽 양호');
    expect(leads[2].textContent).toBe('왼쪽 실패기준 실패오른쪽 실패');
    expect(leads[0].querySelectorAll('.fhb-led')).toHaveLength(3);
    expect(text()).not.toMatch(/[✓✕✗×]/u);
  });

  it('12명도 행이 모두 렌더되고(목록 내부 스크롤), n 쿼리로 20명 변형', async () => {
    await show('g-on-12-many');
    expect(container.querySelectorAll('.fhb-mrow')).toHaveLength(12);
    await show('g-on-12-many', 20);
    expect(container.querySelectorAll('.fhb-mrow')).toHaveLength(20);
    expect(text()).toContain('대기실 20명');
  });

  it('초대 알림은 요청이라고만 말한다', async () => {
    await show('g-on-3');
    expect(text()).not.toMatch(/전달됐|받았|수신/);
  });
});
