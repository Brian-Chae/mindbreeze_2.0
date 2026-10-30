// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { playerCases } from '../src/lib/class/fixtures/host-cases';
import { HostParticipantGrid } from '../src/components/class/player/host/HostParticipantGrid';
import { PLAYER_METRICS } from '../src/lib/class/player-case';
import type { HostParticipant } from '../src/lib/class/host-player-case';
import { HARNESS_BACKDROP_SRC } from '../src/lib/class/player-harness';

async function withCase(id: string, check: (node: HTMLDivElement) => Promise<void>) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const node = document.createElement('div'); document.body.append(node);
  const root = createRoot(node);
  await act(async () => root.render(playerCases[id].render({ sheet: null, detail: null, backdropSrc: HARNESS_BACKDROP_SRC, params: new URLSearchParams() })));
  try { await check(node); } finally { await act(async () => root.unmount()); node.remove(); }
}
describe('SDD235 상시 신호 진입점', () => {
  it('0건도 흐린 활성 버튼으로 독립 신호 시트를 연다', async () => withCase('C01', async (node) => {
    const button = node.querySelector<HTMLButtonElement>('[data-signal="quiet"]');
    expect(button).not.toBeNull(); expect(button?.dataset.empty).toBe('true'); expect(button?.disabled).toBe(false);
    await act(async () => button?.click());
    const sheet = node.querySelector('[data-pz="sheet"]');
    expect(sheet?.textContent).toContain('코치에게만'); expect(sheet?.textContent).not.toContain('익명'); expect(sheet?.textContent).toContain('아직 없어요');
    expect(sheet?.textContent).not.toContain('민준');
    const checkin = [...(sheet?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.includes('체크인 요약 보기'));
    await act(async () => checkin?.click());
    expect(node.querySelector('[data-pz="sheet"]')?.getAttribute('aria-label')).toBe('수업 상태');
  }));
  it('손들기와 발언권 건수를 보여주며 중복 칩을 숨긴다', async () => withCase('C02', async (node) => {
    expect(node.querySelector('[data-signal="hands"]')?.textContent).toContain('2');
    expect(node.querySelector('[data-signal="hands"]')?.textContent).toContain('발언권');
    expect(node.querySelector('[data-pz="chipline"]')?.textContent).not.toContain('손든 회원 2');
    expect(node.querySelectorAll('[data-pz="dk"]')).toHaveLength(4);
  }));
});

it('전원 미착용이어도 손듦과 발언권을 타일에 표시한다', async () => {
  const node = document.createElement('div'); document.body.append(node);
  const root = createRoot(node);
  const base: HostParticipant = { id: 'anonymous-test', name: '회원 A', band: 'off', values: { focus: null, relaxation: null, emotional: null, bpm: null, respiration: null, hrv: null }, lowBattery: false, hand: true, speaking: false, agoLabel: null, checkin: [], attention: null, presenceState: 'connected' };
  try {
    await act(async () => root.render(<HostParticipantGrid participants={[base, { ...base, id: 'speaker', speaking: true }]} metric={PLAYER_METRICS[0]} allOff netBad={false} selectedId={null} onSelect={() => undefined} onRange={() => undefined} table={false} />));
    expect(node.querySelector('[data-hand="true"]')?.textContent).toContain('손듦 · 대기 중');
    expect(node.querySelector('[data-speaking="true"]')?.textContent).toContain('말하는 중');
    expect(node.querySelector('[data-hand="true"]')?.getAttribute('aria-label')).toContain('손들었어요');
  } finally { await act(async () => root.unmount()); node.remove(); }
});

it('1024 세로 화면도 바텀 시트 판정으로 모바일 신호 줄을 사용한다', async () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1366 });
  await withCase('C01', async (node) => {
    expect(node.querySelector('.hp-shell')?.getAttribute('data-sheet-mode')).toBe('bottom');
    expect(node.querySelector('.hp-mobile-signals [data-signal="hands"]')).not.toBeNull();
  });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 });
});
