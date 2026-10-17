// @vitest-environment jsdom
// SDD-209 H6 — 로비 시트(FH06a): 재발송 결과 문구(전달 단정 금지) · 입장 코드 · 밴드/발언권/채팅
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LobbySheetFixture, type LobbySheetCase } from '../src/components/class/flow/host/LobbySheetFixture';
import { InviteSheetBody } from '../src/components/class/flow/host/LobbySheets';
import {
  buildAwayRows, cooldownText, isRemindRetryable, isRemindable, remindResultsById, remindStatusText, remindTargets, type AwayRow,
} from '../src/lib/class/flow/host-invite-remind';

describe('재발송 결과 문구', () => {
  it('등록 성공은 초대했어요, 요청 결과는 요청했어요, 쿨다운·실패를 구분한다', () => {
    expect(remindStatusText(null)).toBe('초대했어요');
    expect(remindStatusText('queued')).toBe('요청했어요 · 잠시 후 다시 할 수 있어요');
    expect(remindStatusText('skipped_cooldown')).toBe('잠시 후 다시 할 수 있어요');
    expect(remindStatusText('failed')).toBe('요청하지 못했어요');
    expect(remindStatusText('weird_unknown')).toBe('요청하지 못했어요');
    expect(remindStatusText('skipped_no_account')).toContain('요청할 수 없는');
  });

  it('어떤 상태 문구에도 수신·전달 완료를 단정하는 말이 없다', () => {
    for (const s of [null, 'queued', 'skipped_cooldown', 'skipped_no_account', 'skipped_notification_off', 'skipped_waitlisted', 'not_found', 'failed']) {
      expect(remindStatusText(s)).not.toMatch(/받았|전달됐|전달되|도착|수신 완료|읽었/);
    }
  });

  it('실패만 재시도·재알림 대상, 요청/쿨다운 중인 사람은 대상에서 빠진다', () => {
    expect(isRemindRetryable('failed')).toBe(true);
    expect(isRemindRetryable('queued')).toBe(false);
    expect(isRemindRetryable(null)).toBe(false);
    expect(isRemindable(null)).toBe(true);
    expect(isRemindable('queued')).toBe(false);
    const rows: AwayRow[] = [{ id: 'a', name: 'a', status: null }, { id: 'b', name: 'b', status: 'queued' }, { id: 'c', name: 'c', status: 'failed' }, { id: 'd', name: 'd', status: 'skipped_cooldown' }];
    expect(remindTargets(rows)).toEqual(['a', 'c']);
  });

  it('응답 → participant_id 별 status, 응답에 없는 사람은 그대로', () => {
    const map = remindResultsById({ session_id: 's', cooldown_sec: 60, summary: {}, results: [{ participant_id: 'a', status: 'queued' }, { participant_id: 'c', status: 'failed' }] });
    const rows = buildAwayRows([{ participantId: 'a', name: '가' }, { participantId: 'b', name: '나' }, { participantId: 'c', name: '다' }], map);
    expect(rows.map((r) => r.status)).toEqual(['queued', null, 'failed']);
  });

  it('쿨다운 안내', () => {
    expect(cooldownText(0)).toBe('');
    expect(cooldownText(45)).toBe('45초 뒤에 다시 할 수 있어요');
    expect(cooldownText(60)).toBe('1분 뒤에 다시 할 수 있어요');
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
const dialogText = (): string => container.querySelector('[role="dialog"]')?.textContent ?? '';
const click = async (el: Element | null | undefined): Promise<void> => { await act(async () => { (el as HTMLElement).click(); }); };
const byText = (sel: string, t: string): HTMLElement | undefined => [...container.querySelectorAll<HTMLElement>(sel)].find((el) => el.textContent?.includes(t));
const show = async (spec: LobbySheetCase): Promise<void> => { await act(async () => root.render(createElement(LobbySheetFixture, { spec, backdropSrc: '' }))); };

describe('회원 초대 시트', () => {
  it('입장 전 회원·요청 결과·입장 코드 복사·다시 알림', async () => {
    await show({ kind: 'invite', lobby: 'g-on-3' });
    const t = dialogText();
    expect(t).toContain('회원 초대');
    expect(t).toContain('초대 6명 · 대기실 3명');
    expect(t).toContain('3명이 아직 입장하지 않았어요');
    expect(t).toContain('아직 입장하지 않은 회원 3명');
    expect(t).toContain('초대했어요');
    expect(t).toContain('요청했어요 · 잠시 후 다시 할 수 있어요');
    expect(t).toContain('요청하지 못했어요');
    expect(t).toContain('입장 코드 4829');
    expect(t).toContain('참가자에게 직접 알려 주세요');
    expect(t).toContain('초대 추가');
    expect(container.querySelector('[aria-label="입장 코드 복사"]')).not.toBeNull();
    expect(t).not.toMatch(/QR/);
  });

  it('다시 알림은 대상(등록만 된 사람 + 실패한 사람)에게만 걸고 요청 결과로 바뀐다', async () => {
    await show({ kind: 'invite', lobby: 'g-on-3' });
    expect(byText('button', '2명에게 다시 알림')).toBeDefined();
    await click(byText('button', '2명에게 다시 알림'));
    expect(dialogText()).not.toContain('요청하지 못했어요');
    expect(byText('button', '다시 알릴 회원이 없어요')).toBeDefined();
    expect((byText('button', '다시 알릴 회원이 없어요') as HTMLButtonElement).disabled).toBe(true);
  });

  it('재시도 버튼은 실패한 한 명만', async () => {
    await show({ kind: 'invite', lobby: 'g-on-3' });
    const retries = [...container.querySelectorAll('button')].filter((b) => b.textContent?.includes('재시도'));
    expect(retries).toHaveLength(1);
  });

  it('코드 복사를 누르면 확인 표시로 바뀐다', async () => {
    await show({ kind: 'invite', lobby: 'g-on-3' });
    await click(container.querySelector('[aria-label="입장 코드 복사"]'));
    expect(container.querySelector('[aria-label="입장 코드 복사"] svg')).not.toBeNull();
  });

  it('전원 입장: 모두 입장했어요 + 다시 알릴 회원이 없어요(비활성)', async () => {
    await show({ kind: 'invite', lobby: 'g-on-8' });
    expect(dialogText()).toContain('모두 입장했어요');
    expect(dialogText()).toContain('초대한 회원이 모두 입장했어요');
    expect(dialogText()).toContain('다시 알릴 회원이 없어요');
    expect((byText('button', '다시 알릴 회원이 없어요') as HTMLButtonElement).disabled).toBe(true);
  });

  it('코드가 없으면 코드 행을 숨긴다, 재발송 호출은 대상 id 배열로', async () => {
    const onRemind = vi.fn();
    const away: AwayRow[] = [{ id: 'x', name: '가', status: null }];
    await act(async () => root.render(createElement(InviteSheetBody, { invited: 2, inRoom: 1, away, code: null, onCopyCode: () => undefined, onRemind, onInviteAdd: () => undefined })));
    expect(text()).not.toContain('입장 코드');
    await click(byText('button', '1명에게 다시 알림'));
    expect(onRemind).toHaveBeenCalledWith(['x']);
  });
});

describe('BGM 시트', () => {
  it('트랙 3종·재생바·볼륨·안내, 트랙을 고르면 선택 표시가 옮겨간다', async () => {
    await show({ kind: 'bgm', lobby: 'g-on-3' });
    const t = dialogText();
    for (const title of ['숲속 새벽', '계곡 물소리', '고요한 종소리']) expect(t).toContain(title);
    expect(t).toContain('01:20 / 03:40');
    expect(t).toContain('대기실에서 회원에게도 같은 음악이 들려요. 시작하면 자동으로 줄어들어요.');
    expect(container.querySelector('input[aria-label="모니터 볼륨"]')).not.toBeNull();
    const second = byText('button.fhb-track', '계곡 물소리');
    await click(second);
    expect(second?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[aria-label="일시정지"]')).not.toBeNull();
    await click(container.querySelector('[aria-label="일시정지"]'));
    expect(container.querySelector('[aria-label="재생"]')).not.toBeNull();
  });
});

describe('내 LINK BAND 시트', () => {
  it('미연결: 안내와 연결 버튼 → 누르면 연결됨', async () => {
    await show({ kind: 'band', lobby: 'g-on-3', band: { connected: false, leadOff: null } });
    expect(dialogText()).toContain('연결 안 됨');
    expect(dialogText()).toContain('내 뇌파를 함께 볼 때만 이마에 착용해 연결해요. 연결하지 않아도 클래스를 진행할 수 있어요.');
    await click(byText('button', 'LINK BAND 연결'));
    expect(dialogText()).toContain('연결됨');
  });

  it('연결·접촉 양호: 배터리·전극 칩만, 트래커는 숨김', async () => {
    await show({ kind: 'band', lobby: 'g-on-3', band: { connected: true, leadOff: { ch1: false, ch2: false } } });
    const t = dialogText();
    expect(t).toContain('연결됨');
    expect(t).toContain('배터리');
    expect(t).toContain('접촉 양호');
    expect(t).toContain('연결 해제');
    expect(container.querySelector('svg[role="img"][aria-label*="전극"]')).toBeNull();
  });

  it('접촉 불량 3종: 어느 전극인지 문구 + 트래커 + 3단계 안내', async () => {
    const cases: Array<[LobbySheetCase['band'], string]> = [
      [{ connected: true, leadOff: { ch1: true, ch2: false } }, 'L 전극이 이마에 닿지 않아요.'],
      [{ connected: true, leadOff: { ch1: false, ch2: true } }, 'R 전극이 이마에 닿지 않아요.'],
      [{ connected: true, leadOff: { ch1: true, ch2: true } }, 'L·R 전극이 모두 이마에 닿지 않아요.'],
    ];
    for (const [band, msg] of cases) {
      await show({ kind: 'band', lobby: 'g-on-3', band });
      expect(dialogText()).toContain('접촉 불량');
      expect(dialogText()).toContain('LINK BAND 위치를 조정해 주세요');
      expect(dialogText()).toContain(msg);
      expect(dialogText()).toContain('빨간색 전극이 밀착되도록 밴드 크기를 내 머리에 맞춰 주세요.');
      expect(container.querySelector('[data-pz="flow-electrode-labels"], svg')).not.toBeNull();
      expect(dialogText()).toContain('벗었다가 다시 착용해 주세요.');
    }
  });
});

describe('발언권 시트', () => {
  it('손든 회원·발언 중 회원·안내', async () => {
    await show({ kind: 'speak', lobby: 'g-on-3' });
    const t = dialogText();
    expect(t).toContain('손든 회원 2명');
    expect(t).toContain('발언 허용');
    expect(t).toContain('발언 중 1명');
    expect(t).toContain('발언 마치기');
    expect(t).toContain('발언을 허용하면 그 회원의 마이크가 켜져요.');
  });
});

describe('채팅 시트', () => {
  it('켜짐: 메시지 목록과 입력, 끄면 비어 있음 안내', async () => {
    await show({ kind: 'chat', lobby: 'g-on-3', chatEnabled: true });
    expect(dialogText()).toContain('회원 채팅');
    expect(dialogText()).toContain('켜짐');
    expect(dialogText()).toContain('안녕하세요, 잘 들려요');
    await click(container.querySelector('[role="switch"][aria-label="회원 채팅"]'));
    expect(dialogText()).toContain('채팅이 꺼져 있어요');
    expect(dialogText()).toContain('켜면 회원이 대기실에서도 메시지를 보낼 수 있어요');
    expect((container.querySelector('[aria-label="보내기"]') as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('input[aria-label="메시지"]') as HTMLInputElement).placeholder).toBe('채팅을 켜면 보낼 수 있어요');
  });

  it('꺼짐 케이스 첫 화면', async () => {
    await show({ kind: 'chat', lobby: 'g-on-3', chatEnabled: false });
    expect(dialogText()).toContain('꺼짐');
    expect(dialogText()).not.toContain('안녕하세요, 잘 들려요');
  });
});

describe('로비에서 시트 열기', () => {
  it('도크 버튼이 해당 시트를 열고, 시트가 열리면 시작하기는 막힌다(inert)', async () => {
    await show({ kind: 'chat', lobby: 'g-on-3' });
    expect(container.querySelector('.pz-shell__dock')?.hasAttribute('inert')).toBe(true);
  });
});
