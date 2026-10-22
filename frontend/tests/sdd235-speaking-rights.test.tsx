// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SpeakingRightsPanel } from '../src/components/session/SpeakingRightsPanel';
import type { SessionLiveMetric } from '../src/lib/api/session';

let root: Root;
let container: HTMLDivElement;
const row: SessionLiveMetric = {
  participant_id: 'p1', display_name: '민준', is_guest: false, band_connected: false,
  device_status: null, band_battery: null, avg_efficiency: null, current_efficiency: null,
  upload_status: 'pending', last_eeg_at: null, raise_hand: true, speaking: false,
};
const button = (label: string) => [...container.querySelectorAll('button')].find(b => b.textContent === label);
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it('손든 사람에게만 손 내리기를 제공하고 기존 발언권 조치를 유지한다', async () => {
  const lowered: string[] = [];
  await act(async () => root.render(<SpeakingRightsPanel participants={[row, { ...row, participant_id: 'p2', display_name: '지우', raise_hand: false, speaking: true }]} busyId={null} onGrant={vi.fn()} onRevoke={vi.fn()} onLowerHand={id => lowered.push(id)} />));
  expect(container.querySelectorAll('button[aria-label="민준 손 내리기"]')).toHaveLength(1);
  expect(container.querySelector('button[aria-label="지우 손 내리기"]')).toBeNull();
  expect(button('발언권 부여')).toBeDefined();
  expect(button('발언권 해제')).toBeDefined();
  await act(async () => button('손 내리기')?.click());
  expect(lowered).toEqual(['p1']);
  expect(container.textContent).toContain('🙋 손들기');
});

it('손 내리기 처리 중에는 같은 행의 중복 조치를 막고 실패를 행에 안내한다', async () => {
  await act(async () => root.render(<SpeakingRightsPanel participants={[row]} busyId={null} onGrant={vi.fn()} onRevoke={vi.fn()} onLowerHand={vi.fn()} lowerHandBusyId="p1" />));
  expect([...container.querySelectorAll('button')].every(b => b.disabled)).toBe(true);
  await act(async () => root.render(<SpeakingRightsPanel participants={[row]} busyId={null} onGrant={vi.fn()} onRevoke={vi.fn()} onLowerHand={vi.fn()} lowerHandError={{ participantId: 'p1', message: '손을 내리지 못했어요. 다시 시도해 주세요.' }} />));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('다시 시도');
  expect(button('손 내리기')?.disabled).toBe(false);
  expect(container.textContent).toContain('🙋 손들기');
});
