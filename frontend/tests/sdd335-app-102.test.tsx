// @vitest-environment jsdom
// SDD-335 — 앱 1.0.2: PPG LE·복귀 재시작 판정·재진입 requestId·최소 앱 버전·동의 안내.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseRawPacket } from '../src/lib/biosignal/raw-capture';
import { deterministicRequestId, shouldRestartOnResume } from '../src/lib/measurement-web/use-native-measurement';
import { isBelowMinVersion, parseUpdateManifest, parseVersion } from '../src/lib/update/update-config';
import { storeUrlFor } from '../src/lib/update/use-min-app-version';
import { AppUpdateRequiredScreen } from '../src/components/update/AppUpdateRequiredScreen';
import { EegConsentChoiceView } from '../src/components/class/flow/member/EegConsentChoiceView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

Object.defineProperty(window, 'matchMedia', { writable: true, value: (q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }) });

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove(); root = null; host = null;
});
async function mount(node: React.ReactElement) {
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
}

describe('V1 PPG 헤더 little endian', () => {
  it('fd 03 cd 00 → 13,435,901 (EEG·ACC 불변)', () => {
    const b = (n: number) => new Uint8Array([0xfd, 0x03, 0xcd, 0x00, ...new Array(n).fill(0)]);
    expect(parseRawPacket('ppg', new DataView(b(6).buffer)).tickRaw).toBe(13_435_901);
    expect(parseRawPacket('acc', new DataView(b(6).buffer)).tickRaw).toBe(13_435_901); // 기존 little endian 유지
    expect(parseRawPacket('eeg', new DataView(b(7).buffer)).tickRaw).toBe(13_435_901);
  });
});

describe('V2 복귀 재시작 판정', () => {
  const snap = (state: string, streamId: string | null) => ({ state, streamId } as never);
  it('failed 는 항상 재시작', () => expect(shouldRestartOnResume('failed', null)).toBe(true));
  it('running + 멈춘 엔진', () => {
    for (const s of ['BLOCKED', 'CLOSED', 'IDLE']) expect(shouldRestartOnResume('running', snap(s, 'x'))).toBe(true);
    expect(shouldRestartOnResume('running', snap('CAPTURING', null))).toBe(true);
  });
  it('running + 정상·종료 처리·판단 보류', () => {
    expect(shouldRestartOnResume('running', snap('CAPTURING', 'x'))).toBe(false);
    expect(shouldRestartOnResume('running', snap('RECONNECTING', 'x'))).toBe(false);
    expect(shouldRestartOnResume('running', snap('SEALING', null))).toBe(false);
    expect(shouldRestartOnResume('running', snap('DRAINING', null))).toBe(false);
    expect(shouldRestartOnResume('running', null)).toBe(false);
  });
  it('starting·idle 은 건드리지 않는다', () => {
    expect(shouldRestartOnResume('starting', snap('BLOCKED', null))).toBe(false);
    expect(shouldRestartOnResume('idle', snap('BLOCKED', null))).toBe(false);
  });
});

describe('V3 재진입 requestId', () => {
  const S = '11111111-1111-4111-8111-111111111111';
  it('세대 0 은 기존과 동일, 세대마다 다르고 결정적', () => {
    expect(deterministicRequestId(S, 'p1', 0)).toBe(deterministicRequestId(S, 'p1'));
    const g1 = deterministicRequestId(S, 'p1', 1);
    expect(g1).not.toBe(deterministicRequestId(S, 'p1'));
    expect(g1).toBe(deterministicRequestId(S, 'p1', 1));
    expect(g1).not.toBe(deterministicRequestId(S, 'p1', 2));
    expect(g1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('V4·V5 최소 앱 버전', () => {
  it('비교', () => {
    expect(isBelowMinVersion('1.0.0', '1.0.1')).toBe(true);
    expect(isBelowMinVersion('1.0.1', '1.0.1')).toBe(false);
    expect(isBelowMinVersion('1.0.2', '1.0.1')).toBe(false);
    expect(isBelowMinVersion('1.0.1-dev', '1.0.1')).toBe(false);
    expect(isBelowMinVersion('0.9.9', '1.0.0')).toBe(true);
    expect(isBelowMinVersion('1.10.0', '1.9.0')).toBe(false);
    expect(isBelowMinVersion('', '1.0.1')).toBe(false);
    expect(isBelowMinVersion('1.0.0', '')).toBe(false);
    expect(isBelowMinVersion('x', 'y')).toBe(false);
    expect(parseVersion('1.0')).toEqual([1, 0, 0]);
  });
  const raw = (over: Record<string, unknown> = {}) => ({ schemaVersion: 1, updatedAt: 'x', updateBannerEnabled: true, minSupportedVersionCode: 0, android: {}, ios: {}, ...over });
  it('매니페스트 파싱', () => {
    expect(parseUpdateManifest(raw())!.minAppVersion).toBe('');
    expect(parseUpdateManifest(raw({ minAppVersion: 7 }))!.minAppVersion).toBe('');
    expect(parseUpdateManifest(raw({ minAppVersion: 'abc' }))!.minAppVersion).toBe('');
    expect(parseUpdateManifest(raw({ minAppVersion: ' 1.0.1 ' }))!.minAppVersion).toBe('1.0.1');
  });
  it('스토어 주소', () => {
    expect(storeUrlFor('ios')).toContain('apps.apple.com');
    expect(storeUrlFor('android')).toContain('play.google.com');
  });
});

describe('V7 구버전 화면', () => {
  it('설치·필요 버전과 스토어 버튼, 닫기 없음', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onHome = vi.fn();
    await mount(<AppUpdateRequiredScreen installed="1.0.0" required="1.0.1" storeUrl="https://apps.apple.com/kr/app/id1" onHome={onHome} />);
    expect(host!.textContent).toContain('앱을 업데이트해 주세요');
    expect(host!.textContent).toContain('1.0.0');
    expect(host!.textContent).toContain('1.0.1 이상');
    const btn = [...host!.querySelectorAll('button')].find((b) => b.textContent === '스토어에서 업데이트')!;
    await act(async () => btn.click());
    expect(open).toHaveBeenCalledWith('https://apps.apple.com/kr/app/id1', '_blank', 'noopener');
    open.mockRestore();
  });
});

describe('V6 동의 안내', () => {
  it('뇌파 선택 화면에 측정·리포트 지표 없음 안내', async () => {
    await mount(<EegConsentChoiceView steps={{ total: 3, current: 1 }} saving={false} error={null} onAgree={() => undefined} onDecline={() => undefined} onBack={() => undefined} onExit={() => undefined} />);
    expect(host!.querySelector('[data-testid="eeg-decline-notice"]')?.textContent).toContain('측정과 리포트 지표가 없어요');
  });
});
