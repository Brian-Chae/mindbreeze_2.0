// @vitest-environment jsdom
// SDD-209 H7 — FH07 시작 확인(파생·녹음 선언·호출 순서) · FH08 나가기/닫기(확인 전 cancel 0)
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeaveCloseSheet } from '../src/components/class/flow/host/LeaveCloseSheet';
import { LobbyOverlayFixture, type LobbyOverlaySpec } from '../src/components/class/flow/host/LobbyOverlayFixture';
import { buildLobbyFixture } from '../src/lib/class/flow/host-lobby-fixtures';
import { deriveStartSheet, leaveCopy, planStartSequence, resolveStartAudio, retentionText, type StartSheetInput } from '../src/lib/class/flow/host-start-model';

function input(lobby: string, patch: Partial<StartSheetInput> = {}): StartSheetInput {
  const f = buildLobbyFixture(lobby);
  return { model: f.model, ctx: f.ctx, micOn: true, recordChecked: true, excluded: 0, research: 0, retentionDays: 90, ...patch };
}

describe('deriveStartSheet', () => {
  it('전원 준비: 시작하기/돌아가기, 준비 중 목록 없음', () => {
    const v = deriveStartSheet(input('g-on-8'));
    expect(v.peopleText).toBe('8명 모두 준비 완료');
    expect(v.pending).toHaveLength(0);
    expect([v.primaryLabel, v.secondaryLabel]).toEqual(['시작하기', '돌아가기']);
    expect(deriveStartSheet(input('o-on-1r')).peopleText).toBe('회원이 준비 완료');
  });

  it('준비 중 회원: 이름과 미완 단계 칩, 지금 시작하기/조금 더 기다리기', () => {
    const v = deriveStartSheet(input('g-on-3'));
    expect(v.peopleText).toBe('1명 준비 완료 · 2명 준비 중');
    expect(v.pending.map((m) => [m.name, m.chips.map((c) => c.label)])).toEqual([['민준', ['LINK BAND', '기기']], ['지우', ['설문', 'LINK BAND', '기기']]]);
    expect([v.primaryLabel, v.secondaryLabel]).toEqual(['지금 시작하기', '조금 더 기다리기']);
  });

  it('6명 이상 준비 중이면 3명만 보이고 외 N명으로 접는다', () => {
    const v = deriveStartSheet(input('g-on-12-many'));
    expect(v.pending).toHaveLength(8);
    expect(v.shown).toHaveLength(3);
    expect(v.moreCount).toBe(5);
    expect(deriveStartSheet(input('g-on-3')).moreCount).toBe(0);
  });

  it('접촉 불량은 준비 중 칩(경고 표시)으로 보인다', () => {
    const v = deriveStartSheet(input('g-on-3-contact'));
    expect(v.pending[0].chips).toEqual([{ label: 'LINK BAND', bad: true }]);
  });

  it('대기실 0명: 아무도 입장하지 않았어요 + 지금 시작하기(시작 가능)', () => {
    const v = deriveStartSheet(input('g-on-0'));
    expect(v.empty).toBe(true);
    expect(v.peopleText).toBe('아직 아무도 입장하지 않았어요');
    expect(v.pending).toHaveLength(0);
    expect([v.primaryLabel, v.secondaryLabel]).toEqual(['지금 시작하기', '조금 더 기다리기']);
  });

  it('온라인 마이크 꺼짐 → 체크 해제·비활성·수동 기록 안내', () => {
    const v = deriveStartSheet(input('g-on-3', { micOn: false }));
    expect(v).toMatchObject({ micRow: 'off', checked: false, checkboxDisabled: true, manual: true });
    expect(v.note).toBe('녹음 없이 수동 기록으로 진행해요. 메모로 기록지를 만들어요.');
  });

  it('코치가 체크를 해제하면 수동 기록(참가자 리포트 제외와 무관)', () => {
    const v = deriveStartSheet(input('g-on-8', { recordChecked: false, excluded: 2, research: 5 }));
    expect(v).toMatchObject({ micRow: 'on', checked: false, manual: true, checkboxDisabled: false });
    expect(v.countRows).toHaveLength(2);
  });

  it('정상: 녹음은 언제든 멈출 수 있어요', () => {
    expect(deriveStartSheet(input('g-on-8')).note).toBe('녹음은 언제든 멈출 수 있어요.');
  });

  it('오프라인: 장소 행, 이 기기 마이크로 녹음할 수 있어 체크가 활성', () => {
    const v = deriveStartSheet(input('g-off-3', { micOn: false }));
    expect(v).toMatchObject({ micRow: 'place', checked: true, checkboxDisabled: false, manual: false });
  });

  it('익명 인원 수 줄은 0명이면 없다, 있으면 문구 그대로', () => {
    expect(deriveStartSheet(input('g-on-8')).countRows).toEqual([]);
    expect(deriveStartSheet(input('g-on-8', { excluded: 2, research: 5 })).countRows.map((r) => r.text)).toEqual([
      '리포트에 반영하지 않는 참가자 2명', '연구 목적 활용에 동의한 참가자 5명',
    ]);
    expect(deriveStartSheet(input('o-on-1r', { research: 1 })).countRows.map((r) => r.text)).toEqual(['연구 목적 활용에 동의한 참가자 1명']);
  });

  it('보관 기간 고지: 서버 값이 있으면 N일, 없으면 일반 문구(자리표시자 금지)', () => {
    expect(retentionText(90)).toBe('기록 원본은 90일 후 삭제돼요');
    expect(retentionText(null)).toBe('기록 원본은 설정된 기간이 지나면 삭제돼요');
    expect(retentionText(null)).not.toMatch(/[{}]/);
  });
});

describe('resolveStartAudio / planStartSequence', () => {
  const online = buildLobbyFixture('g-on-3').ctx;
  const offline = buildLobbyFixture('g-off-3').ctx;

  it('체크 + 마이크 켜짐 → record, 마이크 꺼짐·체크 해제 → manual(audio/start false 선언)', () => {
    expect(resolveStartAudio({ ctx: online, micOn: true, recordChecked: true })).toBe('record');
    expect(resolveStartAudio({ ctx: online, micOn: false, recordChecked: true })).toBe('manual');
    expect(resolveStartAudio({ ctx: online, micOn: true, recordChecked: false })).toBe('manual');
    expect(resolveStartAudio({ ctx: offline, micOn: false, recordChecked: true })).toBe('record');
    expect(resolveStartAudio({ ctx: offline, micOn: true, recordChecked: false })).toBe('manual');
  });

  it('호출 순서: 전이(start) → LiveKit(온라인) → audio/start → 녹음기 → 영상. 전이 전에 audio/start 가 없다', () => {
    expect(planStartSequence({ place: 'online', audio: 'record', recordVideo: true, cameraOn: true })).toEqual([
      'transition-start', 'livekit-connect', 'audio-start-true', 'recorder-start', 'video-start',
    ]);
    const manual = planStartSequence({ place: 'online', audio: 'manual', recordVideo: false, cameraOn: true });
    expect(manual).toEqual(['transition-start', 'livekit-connect', 'audio-start-false']);
    expect(manual.indexOf('transition-start')).toBeLessThan(manual.indexOf('audio-start-false'));
  });

  it('오프라인은 LiveKit·영상 단계가 없다', () => {
    expect(planStartSequence({ place: 'offline', audio: 'record', recordVideo: true, cameraOn: true })).toEqual(['transition-start', 'audio-start-true', 'recorder-start']);
  });
});

describe('leaveCopy', () => {
  it('대기 회원 수에 따라 문구가 바뀐다', () => {
    expect(leaveCopy(3).intro).toBe('지금 대기실에 회원 3명이 있어요.');
    expect(leaveCopy(3).closeDesc).toBe('회원 3명이 모두 퇴장해요. 닫은 클래스는 다시 열 수 없어요.');
    expect(leaveCopy(0).intro).toBe('지금은 대기 중인 회원이 없어요.');
    expect(leaveCopy(0).closeDesc).toBe('클래스가 닫혀요. 닫은 클래스는 다시 열 수 없어요.');
    expect(leaveCopy(3).confirmBody).toBe('대기 중인 회원 3명이 모두 퇴장하고, 닫힌 클래스는 다시 열 수 없어요. 같은 설정으로 새 클래스를 만들 수 있어요.');
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
const dialog = (): string => container.querySelector('[role="dialog"]')?.textContent ?? '';
const click = async (el: Element | null | undefined): Promise<void> => { await act(async () => { (el as HTMLElement).click(); }); };
const byText = (sel: string, t: string): HTMLElement | undefined => [...container.querySelectorAll<HTMLElement>(sel)].find((el) => el.textContent?.includes(t));
const show = async (spec: LobbyOverlaySpec): Promise<void> => { await act(async () => root.render(createElement(LobbyOverlayFixture, { spec, backdropSrc: '' }))); };
const startSpec = (lobby: string, patch: Partial<Extract<LobbyOverlaySpec, { kind: 'start' }>> = {}): LobbyOverlaySpec => ({ kind: 'start', lobby, micOn: true, recordChecked: true, excluded: 0, research: 0, ...patch });

describe('FH07 시트', () => {
  it('전원 준비: 시안 문구와 익명 인원 수 줄', async () => {
    await show(startSpec('g-on-8', { excluded: 2, research: 5 }));
    const t = dialog();
    for (const s of ['시작 전에 확인해요', '준비 인원', '8명 모두 준비 완료', '마이크', '켜져 있어요', '기록 원본은 90일 후 삭제돼요', '나와 담당 코치만 열람', '리포트에 반영하지 않는 참가자 2명', '연구 목적 활용에 동의한 참가자 5명', '녹음하고 AI 기록지를 만들어요', '녹음은 언제든 멈출 수 있어요.']) expect(t).toContain(s);
    expect(byText('button', '시작하기')).toBeDefined();
    expect(byText('button', '돌아가기')).toBeDefined();
  });

  it('{N} 자리표시자나 별도 동의 모달 문구가 없다', async () => {
    await show(startSpec('g-on-8'));
    expect(dialog()).not.toMatch(/[{}]/);
    expect(dialog()).not.toContain('동의합니다');
  });

  it('준비 중 목록과 안내, 접힘', async () => {
    await show(startSpec('g-on-12-many'));
    expect(dialog()).toContain('외 5명');
    expect(dialog()).toContain('준비 중인 회원은 시작 후에도 입장해서 이어서 준비할 수 있어요');
    expect(byText('button', '지금 시작하기')).toBeDefined();
    expect(byText('button', '조금 더 기다리기')).toBeDefined();
  });

  it('마이크 꺼짐: 켜기 버튼, 체크박스 비활성·미체크, 켜면 되살아난다', async () => {
    await show(startSpec('g-on-3', { micOn: false }));
    const box = container.querySelector('[role="checkbox"]') as HTMLButtonElement;
    expect(box.disabled).toBe(true);
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect(dialog()).toContain('꺼져 있어요');
    expect(dialog()).toContain('녹음 없이 수동 기록으로 진행해요. 메모로 기록지를 만들어요.');
    await click(byText('button', '켜기'));
    expect((container.querySelector('[role="checkbox"]') as HTMLButtonElement).disabled).toBe(false);
    expect(dialog()).toContain('켜져 있어요');
  });

  it('체크 해제는 수동 기록 안내로 바뀐다', async () => {
    await show(startSpec('g-on-8'));
    await click(container.querySelector('[role="checkbox"]'));
    expect(dialog()).toContain('녹음 없이 수동 기록으로 진행해요.');
  });

  it('오프라인은 마이크 행 대신 장소', async () => {
    await show(startSpec('g-off-3'));
    expect(dialog()).toContain('장소');
    expect(dialog()).toContain('서울 강남구 테헤란로 123 · 4층 명상실');
    expect(dialog()).not.toContain('켜져 있어요');
  });

  it('대기실 0명: 시작 가능, 준비 중 목록 없음', async () => {
    await show(startSpec('g-on-0'));
    expect(dialog()).toContain('아직 아무도 입장하지 않았어요');
    expect(dialog()).toContain('시작하면 초대한 회원이 이후에 입장해요');
    expect(byText('button', '지금 시작하기')).toBeDefined();
  });

  it('시작하기 / 돌아가기 콜백', async () => {
    await show(startSpec('g-on-8'));
    await click(byText('button', '돌아가기'));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('FH08 시트', () => {
  const noop = (): void => undefined;
  const props = { open: true, waiting: 3, onLeave: noop, onAskClose: noop, onConfirmClose: noop, onContinue: noop, onBackToChoose: noop };

  it('선택 단계: 나가기·클래스 닫기·계속 준비하기', async () => {
    await act(async () => root.render(createElement(LeaveCloseSheet, { ...props, stage: 'choose' })));
    const t = dialog();
    for (const s of ['나갈까요?', '지금 대기실에 회원 3명이 있어요.', '클래스는 열린 채로 두어요.', '회원 3명이 모두 퇴장해요. 닫은 클래스는 다시 열 수 없어요.', '계속 준비하기']) expect(t).toContain(s);
  });

  it('클래스 닫기를 눌러도 실제 닫기 호출은 하지 않고 확인 단계를 요청한다(즉시 닫기 버그 방지)', async () => {
    const onAskClose = vi.fn();
    const onConfirmClose = vi.fn();
    await act(async () => root.render(createElement(LeaveCloseSheet, { ...props, stage: 'choose', onAskClose, onConfirmClose })));
    await click(byText('button.fhb-opt.danger', '클래스 닫기'));
    expect(onAskClose).toHaveBeenCalledTimes(1);
    expect(onConfirmClose).not.toHaveBeenCalled();
  });

  it('확인 단계: 재확인 문구, 닫기를 눌러야 확정, 취소는 선택으로', async () => {
    const onConfirmClose = vi.fn();
    const onBackToChoose = vi.fn();
    await act(async () => root.render(createElement(LeaveCloseSheet, { ...props, stage: 'confirm', onConfirmClose, onBackToChoose })));
    expect(dialog()).toContain('클래스를 정말 닫을까요?');
    expect(dialog()).toContain('대기 중인 회원 3명이 모두 퇴장하고, 닫힌 클래스는 다시 열 수 없어요. 같은 설정으로 새 클래스를 만들 수 있어요.');
    await click(byText('button', '취소'));
    expect(onBackToChoose).toHaveBeenCalled();
    expect(onConfirmClose).not.toHaveBeenCalled();
    await click([...container.querySelectorAll('button')].find((b) => b.textContent === '클래스 닫기'));
    expect(onConfirmClose).toHaveBeenCalledTimes(1);
  });

  it('로비 뒤로가기 → 선택 → 클래스 닫기 → 확인 시트로 이어진다', async () => {
    await show({ kind: 'leave', lobby: 'g-on-0', stage: 'choose' });
    expect(dialog()).toContain('지금은 대기 중인 회원이 없어요.');
    await click(byText('button.fhb-opt.danger', '클래스 닫기'));
    expect(dialog()).toContain('클래스를 정말 닫을까요?');
    expect(dialog()).toContain('닫힌 클래스는 다시 열 수 없어요. 같은 설정으로 새 클래스를 만들 수 있어요.');
  });
});
