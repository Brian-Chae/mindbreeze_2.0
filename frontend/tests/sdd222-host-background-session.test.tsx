// @vitest-environment jsdom
// SDD-222 T-J10 — useHostBackgroundSession (V33·V34·V35·V41) + ClassPlayerPage 연결 정적 확인
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('../src/hooks/useBackgroundSession', () => ({
  useBackgroundSession: (...a: unknown[]) => {
    h.calls.push(a);
    return { batteryGuideOpen: false, dismissBatteryGuide: () => undefined };
  },
}));

import { useHostBackgroundSession } from '../src/hooks/useHostBackgroundSession';

type Args = Parameters<typeof useHostBackgroundSession>[0];
let root: Root;
function Harness(props: Args) { useHostBackgroundSession(props); return null; }
const render = (props: Args) => act(async () => root.render(<Harness {...props} />));
const last = () => h.calls[h.calls.length - 1];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.calls.length = 0;
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); });

describe('useHostBackgroundSession', () => {
  it('V33 호스트+온라인+대기/진행 중이면 host 역할·마이크 타입으로 켠다', async () => {
    await render({ isHost: true, isLobby: true, isRunning: false, online: true });
    expect(last()).toEqual([true, 'host', true]);
    await render({ isHost: true, isLobby: false, isRunning: true, online: true });
    expect(last()).toEqual([true, 'host', true]);
  });

  it('V34 호스트 오프라인 대면 수업은 마이크 타입 없이 켠다', async () => {
    await render({ isHost: true, isLobby: false, isRunning: true, online: false });
    expect(last()).toEqual([true, 'host', false]);
  });

  it('V35 종료·세팅 단계(대기/진행 아님)면 끈다', async () => {
    await render({ isHost: true, isLobby: false, isRunning: false, online: true });
    expect(last()?.[0]).toBe(false);
  });

  it('V41 호스트가 아니면(관찰자·회원 등) 켜지 않는다', async () => {
    await render({ isHost: false, isLobby: true, isRunning: true, online: true });
    expect(last()?.[0]).toBe(false);
  });
});

describe('ClassPlayerPage 연결 (정적 확인)', () => {
  const page = readFileSync(join(__dirname, '../src/pages/sessions/ClassPlayerPage.tsx'), 'utf-8');
  it('호스트 훅을 대기·진행 조건으로 호출한다', () => {
    expect(page).toContain('useHostBackgroundSession(');
  });
  it('복귀 시 경과 시각을 즉시 다시 계산한다(타이머 누적 오차 방지)', () => {
    expect(page).toMatch(/useAppResume\(/);
  });
});

describe('V40 호스트 밴드 관찰 모드 (정적 확인)', () => {
  const band = readFileSync(join(__dirname, '../src/hooks/useBand.ts'), 'utf-8');
  it('관찰 전용이면 raw 업로드를 켜지 않는다 — 재연결·갭 로그 경로는 공통', () => {
    expect(band).toMatch(/useEegRawUpload\(\{[\s\S]*?enabled: !observationOnly &&/);
  });
});

describe('FIX 백그라운드 녹음 — 녹음 중 마이크 타입', () => {
  it('V1 오프라인 수업이라도 녹음 중이면 마이크 타입으로 켠다', async () => {
    await render({ isHost: true, isLobby: false, isRunning: true, online: false, recording: true });
    expect(last()).toEqual([true, 'host', true]);
  });
  it('V2 녹음 아님·오프라인이면 마이크 타입 없음', async () => {
    await render({ isHost: true, isLobby: false, isRunning: true, online: false, recording: false });
    expect(last()).toEqual([true, 'host', false]);
  });
});
