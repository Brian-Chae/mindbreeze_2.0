// @vitest-environment jsdom
// SDD-209 M6 — FM07 시작 대기 · 시작 시각 계산 · 코치 시작 시 자동 진행
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WaitStartView, type WaitStartViewProps } from '../src/components/class/flow/member/WaitStartView';
import { startsInLabel } from '../src/lib/class/flow/member-format';

let root: Root;
let container: HTMLDivElement;
async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(node); });
}
const qa = <T extends Element = HTMLElement>(sel: string): T[] => [...document.querySelectorAll<T>(sel)];
const text = (): string => document.body.textContent ?? '';
const btn = (label: string): HTMLButtonElement | undefined => qa<HTMLButtonElement>('button').find((b) => (b.textContent ?? '').trim() === label);
const noop = (): void => undefined;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function props(over: Partial<WaitStartViewProps> = {}): WaitStartViewProps {
  return {
    place: 'online', size: 'group', bandMode: 'opt', title: '마음챙김 명상 · 4회차', hostName: '채용욱', whenLabel: '오늘 오후 3:00',
    startsIn: '약 5분 뒤에 시작해요', readyCount: null, address: null,
    bgm: { title: '심신이완 앰비언트', playing: true, volume: 0.6, blocked: false },
    onRecheck: noop, onExit: noop, onBgmToggle: noop, onBgmVolume: noop, ...over,
  };
}

describe('startsInLabel', () => {
  const now = new Date('2026-10-17T14:55:00+09:00');
  it('분 단위로 말한다', () => {
    expect(startsInLabel('2026-10-17T15:00:00+09:00', now)).toBe('약 5분 뒤에 시작해요');
    expect(startsInLabel('2026-10-17T14:55:30+09:00', now)).toBe('약 1분 뒤에 시작해요');
    expect(startsInLabel('2026-10-17T16:25:00+09:00', now)).toBe('약 1시간 30분 뒤에 시작해요');
    expect(startsInLabel('2026-10-17T17:55:00+09:00', now)).toBe('약 3시간 뒤에 시작해요');
  });
  it('시각이 지났거나 모르면 단정하지 않는다', () => {
    expect(startsInLabel('2026-10-17T14:50:00+09:00', now)).toBe('곧 시작해요');
    expect(startsInLabel(null, now)).toBeNull();
  });
});

describe('FM07 시작 대기', () => {
  it('온라인 그룹: 제목·방식 칩(온라인/그룹/LINK BAND 선택)·시작 예정·준비 안내·BGM·재확인·자동 입장 안내', async () => {
    await render(<WaitStartView {...props()} />);
    expect(text()).toContain('마음챙김 명상 · 4회차');
    expect(qa('.fl-chip').map((c) => c.textContent)).toEqual(['온라인', '그룹', 'LINK BAND 선택']);
    expect(text()).toContain('시작 예정');
    expect(text()).toContain('오늘 오후 3:00');
    expect(text()).toContain('약 5분 뒤에 시작해요');
    expect(text()).toContain('대기실 BGM · 재생 중');
    expect(btn('준비 다시 확인하기')).toBeDefined();
    expect(text()).toContain('코치가 시작하면 자동으로 입장해요.');
  });
  it('준비 인원은 데이터가 올 때만 `N명 중 M명`, 아니면 내 준비 문구(숫자를 지어내지 않는다)', async () => {
    await render(<WaitStartView {...props()} />);
    expect(text()).toContain('내 준비를 마쳤어요');
    expect(text()).not.toMatch(/\d+명 중/);
    await render(<WaitStartView {...props({ readyCount: { ready: 4, total: 6 } })} />);
    expect(text()).toContain('6명 중 4명이 준비를 마쳤어요');
  });
  it('1:1 은 `내 준비를 마쳤어요` + 코치가 곧 시작해요', async () => {
    await render(<WaitStartView {...props({ size: 'solo' })} />);
    expect(text()).toContain('내 준비를 마쳤어요');
    expect(text()).toContain('채용욱 코치가 곧 시작해요.');
  });
  it('BGM 꺼짐 표기와 토글·볼륨 동작', async () => {
    const onBgmToggle = vi.fn();
    const onBgmVolume = vi.fn();
    await render(<WaitStartView {...props({ bgm: { title: '심신이완 앰비언트', playing: false, volume: 0, blocked: false }, onBgmToggle, onBgmVolume })} />);
    expect(text()).toContain('대기실 BGM · 꺼짐');
    expect(document.querySelector<HTMLInputElement>('input[type="range"]')!.disabled).toBe(false);
    await render(<WaitStartView {...props({ onBgmToggle, onBgmVolume })} />);
    const toggle = qa<HTMLButtonElement>('button').find((b) => b.getAttribute('aria-label') === '일시정지')!;
    await act(async () => { toggle.click(); });
    expect(onBgmToggle).toHaveBeenCalledTimes(1);
  });
  it('오프라인: BGM 줄 DOM 0, 장소 + 안내(밴드 사용 안 함은 무음 안내만)', async () => {
    await render(<WaitStartView {...props({ place: 'offline', bandMode: 'none', bgm: null, address: '서울 강남구 테헤란로 123, 5층 명상실' })} />);
    expect(text()).not.toContain('대기실 BGM');
    expect(document.querySelector('input[type="range"]')).toBeNull();
    expect(text()).toContain('서울 강남구 테헤란로 123, 5층 명상실');
    expect(text()).toContain('자리에 앉아 기다려 주세요. 휴대폰은 무음으로 해 주세요.');
    expect(qa('.fl-chip').map((c) => c.textContent)).toEqual(['대면', '그룹', 'LINK BAND 사용 안 함']);
    await render(<WaitStartView {...props({ place: 'offline', bandMode: 'opt', bgm: null, address: '5층 명상실' })} />);
    expect(text()).toContain('이마에 LINK BAND를 착용하고 자리에 앉아 기다려 주세요.');
  });
  it('코랄 경고색 요소가 없다(P10)', async () => {
    await render(<WaitStartView {...props()} />);
    expect(qa('[data-tone="warn"]')).toHaveLength(0);
  });
  it('준비 다시 확인하기와 나가기', async () => {
    const onRecheck = vi.fn();
    const onExit = vi.fn();
    await render(<WaitStartView {...props({ onRecheck, onExit })} />);
    await act(async () => { btn('준비 다시 확인하기')!.click(); });
    expect(onRecheck).toHaveBeenCalledTimes(1);
    await act(async () => { qa<HTMLButtonElement>('button').find((b) => b.getAttribute('aria-label') === '나가기')!.click(); });
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
