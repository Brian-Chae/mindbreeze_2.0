// @vitest-environment jsdom
// SDD-293 — 밴드 조기 네이티브 인계(verify.md V1~V8)
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  platform: 'android', connected: true, order: [] as string[], adoptOk: true,
  plugin: {} as Record<string, unknown>,
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => h.platform, isNativePlatform: () => true }, registerPlugin: () => h.plugin }));
vi.mock('../src/lib/session-live/live-flag', () => ({ isLiveProtocolV2Enabled: () => true }));
vi.mock('../src/lib/eeg/bluetoothService', () => ({
  bluetoothService: {
    isConnected: () => h.connected, getDeviceId: () => 'DEV-1', getCachedDeviceId: () => 'DEV-1',
    releaseForNative: async () => { h.order.push('js_disconnect'); return 'DEV-1'; },
  },
}));

import { NativeMeasurementFacade } from '../src/lib/native-measurement';
import { getBandHold, clearBandHold, setBandHold } from '../src/lib/native-measurement/band-hold';
import { shouldHoldBand, useNativeBandHold, type HoldWantInput } from '../src/lib/measurement-web/use-native-band-hold';
import { shouldStartNative } from '../src/lib/measurement-web/use-native-measurement';

const mkPlugin = (over: Record<string, unknown> = {}) => ({
  setNativeOwnership: vi.fn(async () => ({ enabled: true })),
  adoptBand: vi.fn(async () => { h.order.push('adopt'); return { accepted: h.adoptOk }; }),
  releaseBand: vi.fn(async () => { h.order.push('release_band'); return { accepted: true }; }),
  setJSBandOwnership: vi.fn(async () => ({ accepted: true })),
  handoffCredentials: vi.fn(async () => ({ handoff: true })),
  registerCredential: vi.fn(async () => ({ credentialHandle: 'h'.repeat(20) })),
  startMeasurement: vi.fn(async () => { h.order.push('startMeasurement'); return { managerId: 'm', streamId: null, ownerGeneration: null }; }),
  stopMeasurement: vi.fn(async () => ({ accepted: true })),
  ...over,
});
const facadeOf = (p: ReturnType<typeof mkPlugin>) => new NativeMeasurementFacade(p as never);

const want: HoldWantInput = { native: true, platform: 'android', guest: false, v2: true, bandOptIn: true, eegConsent: true, bandDone: true };

beforeEach(() => { h.platform = 'android'; h.connected = true; h.order = []; h.adoptOk = true; clearBandHold(); });

describe('V7 shouldHoldBand / shouldStartNative 순수 판정', () => {
  it('회원+native+동의+밴드 단계 완료만 true', () => {
    expect(shouldHoldBand(want)).toBe(true);
    for (const k of ['guest'] as const) expect(shouldHoldBand({ ...want, [k]: true })).toBe(false);
    for (const k of ['native', 'v2', 'bandOptIn', 'eegConsent', 'bandDone'] as const) expect(shouldHoldBand({ ...want, [k]: false })).toBe(false);
    expect(shouldHoldBand({ ...want, platform: 'web' })).toBe(false);
  });
  it('보류 ID 만 있어도 Android 는 시작 가능', () => {
    expect(shouldStartNative({ path: 'native', hasIds: true, platform: 'android', bandConnected: false, latched: false, knownDeviceId: 'DEV-1' })).toBe(true);
  });
});

describe('V1·V6 facade.adoptBand', () => {
  it('Android: adopt → JS 해제 순서, startMeasurement 호출 0, 보류 상태 true', async () => {
    const p = mkPlugin(); const f = facadeOf(p);
    const r = await f.adoptBand({ platform: 'android', deviceId: 'AA:BB', releaseJsBand: async () => { h.order.push('js_disconnect'); return 'AA:BB'; } });
    expect(r).toEqual({ held: true, deviceId: 'AA:BB' });
    expect(h.order).toEqual(['adopt', 'js_disconnect']);
    expect(p.startMeasurement).not.toHaveBeenCalled();
    expect(getBandHold()).toEqual({ held: true, deviceId: 'AA:BB' });
  });
  it('iOS: 네이티브 보류 확인 후 소유권 이전, 그 다음 JS 해제', async () => {
    const p = mkPlugin(); const f = facadeOf(p);
    await f.adoptBand({ platform: 'ios', deviceId: 'UUID-1', releaseJsBand: async () => { h.order.push('js_disconnect'); return 'UUID-1'; } });
    expect(p.adoptBand).toHaveBeenCalledWith({ peripheralId: 'UUID-1' });
    expect(h.order).toEqual(['adopt', 'js_disconnect']);
    expect(p.setJSBandOwnership).toHaveBeenCalledWith({ owning: false });
  });
  it('V6 구 네이티브(adoptBand 없음/거절) → JS 해제 0, held=false', async () => {
    for (const p of [mkPlugin({ adoptBand: undefined }), mkPlugin({ adoptBand: vi.fn(async () => ({ accepted: false })) })]) {
      h.order = [];
      const r = await facadeOf(p).adoptBand({ platform: 'android', deviceId: 'AA', releaseJsBand: async () => { h.order.push('js_disconnect'); return null; } });
      expect(r.held).toBe(false); expect(h.order).not.toContain('js_disconnect'); expect(getBandHold().held).toBe(false);
    }
  });
});

describe('V2 startForSession alreadyHeld — 재연결 0회', () => {
  const base = { sessionId: '00000001-0000-4000-8000-000000000001', requestId: '0000001e-0000-4000-8000-00000000001e', accountId: 'u1', apiBase: 'https://a/api/v1', socketBase: 'https://a', instanceId: 'i', deviceId: 'AA:BB', tokens: { accessToken: 'at-aaaaaaaa', refreshToken: 'rt-bbbbbbbb' } };
  for (const platform of ['android', 'ios'] as const) {
    it(`${platform}: JS 해제·소유권 이전 호출 없이 startMeasurement 만`, async () => {
      const p = mkPlugin(); const f = facadeOf(p);
      await f.startForSession({ ...base, platform, releaseJsBand: async () => { h.order.push('js_disconnect'); return 'x'; }, alreadyHeld: true });
      expect(h.order).toEqual(['startMeasurement']);
      expect(p.setJSBandOwnership).not.toHaveBeenCalled();
    });
  }
  it('보류 아님(기존 경로)은 JS 해제 후 시작 — 불변', async () => {
    const f = facadeOf(mkPlugin());
    await f.startForSession({ ...base, platform: 'android', releaseJsBand: async () => { h.order.push('js_disconnect'); return 'x'; } });
    expect(h.order).toEqual(['js_disconnect', 'startMeasurement']);
  });
});

describe('V4 releaseHeldBand', () => {
  it('보류 해제 + releaseBand 호출, 미구현이어도 오류 없음', async () => {
    setBandHold({ held: true, deviceId: 'AA' });
    const p = mkPlugin(); await facadeOf(p).releaseHeldBand();
    expect(p.releaseBand).toHaveBeenCalledTimes(1); expect(getBandHold().held).toBe(false);
    await expect(facadeOf(mkPlugin({ releaseBand: undefined })).releaseHeldBand()).resolves.toBeUndefined();
  });
});

describe('V1·V4·V5 useNativeBandHold 훅', () => {
  let root: Root; let p: ReturnType<typeof mkPlugin>;
  const flush = () => act(async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); });
  function Probe(props: { want: HoldWantInput; live: boolean }) { useNativeBandHold(props); return null; }
  beforeEach(async () => {
    p = mkPlugin(); h.plugin = p;
    const mod = await import('../src/lib/native-measurement');
    vi.spyOn(mod, 'getNativeMeasurement').mockReturnValue(facadeOf(p) as never);
    root = createRoot(document.createElement('div'));
  });
  afterEach(() => { act(() => root.unmount()); vi.restoreAllMocks(); });

  it('V1 밴드 단계 완료 → adoptBand 1회, 재렌더에도 1회, 측정 시작 0', async () => {
    await act(async () => { root.render(<Probe want={want} live={false} />); }); await flush();
    await act(async () => { root.render(<Probe want={{ ...want }} live={false} />); }); await flush();
    expect(p.adoptBand).toHaveBeenCalledTimes(1); expect(p.startMeasurement).not.toHaveBeenCalled();
    expect(getBandHold().held).toBe(true);
  });
  it('V4 클래스 시작 없이 언마운트 → releaseBand', async () => {
    await act(async () => { root.render(<Probe want={want} live={false} />); }); await flush();
    act(() => root.unmount()); await flush();
    expect(p.releaseBand).toHaveBeenCalledTimes(1); expect(getBandHold().held).toBe(false);
    root = createRoot(document.createElement('div'));
  });
  it('V4 단계 c 로 되돌아가면(want=false, 라이브 아님) 해제', async () => {
    await act(async () => { root.render(<Probe want={want} live={false} />); }); await flush();
    await act(async () => { root.render(<Probe want={{ ...want, bandDone: false }} live={false} />); }); await flush();
    expect(p.releaseBand).toHaveBeenCalledTimes(1);
  });
  it('라이브 중 want 가 꺼져도 해제하지 않는다(측정 훅이 소유)', async () => {
    await act(async () => { root.render(<Probe want={want} live={false} />); }); await flush();
    await act(async () => { root.render(<Probe want={{ ...want, bandDone: false }} live />); }); await flush();
    expect(p.releaseBand).not.toHaveBeenCalled();
  });
  it('V5 게스트·밴드 없이 참여·미동의 → adoptBand 0', async () => {
    for (const w of [{ ...want, guest: true }, { ...want, bandOptIn: false }, { ...want, eegConsent: false }, { ...want, native: false }]) {
      await act(async () => { root.render(<Probe want={w} live={false} />); }); await flush();
    }
    expect(p.adoptBand).not.toHaveBeenCalled();
  });
});

describe('V8 JS 경로 종료 시 해제', () => {
  it('useCloseBiosignalOnEnd: 기록 뒤 after 호출(순서 보장)', async () => {
    const { useCloseBiosignalOnEnd } = await import('../src/hooks/useCloseBiosignalOnEnd');
    const order: string[] = [];
    function T() { useCloseBiosignalOnEnd(true, async () => { order.push('close'); }, () => order.push('disconnect')); return null; }
    const root = createRoot(document.createElement('div'));
    await act(async () => { root.render(<T />); });
    await act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });
    expect(order).toEqual(['close', 'disconnect']);
    act(() => root.unmount());
  });
});
