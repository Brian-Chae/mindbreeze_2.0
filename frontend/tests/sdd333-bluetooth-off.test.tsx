// @vitest-environment jsdom
// SDD-333: 블루투스 꺼짐 안내 — 우선순위·감지 훅(꺼짐→켜짐 재연결)·플랫폼별 버튼
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  native: true,
  platform: 'android' as 'android' | 'ios' | 'web',
  enabled: true as boolean | null,
  notify: null as ((on: boolean) => void) | null,
  plugin: {
    openAppSettings: vi.fn(async () => undefined),
    isBluetoothEnabled: vi.fn(async () => ({ enabled: m_enabled() })),
    requestEnableBluetooth: vi.fn(async () => ({ mode: 'system_dialog' })),
    openBluetoothSettings: vi.fn(async () => ({ mode: 'settings' })),
  },
  initialize: vi.fn(async () => undefined),
}));
function m_enabled(): boolean | null { return m.enabled; }
vi.mock('../src/lib/native/platform', () => ({ isNativeApp: () => m.native, getPlatform: () => (m.native ? m.platform : 'web') }));
vi.mock('@capacitor/core', () => ({ registerPlugin: () => m.plugin, Capacitor: { isNativePlatform: () => m.native, getPlatform: () => m.platform } }));
vi.mock('@capacitor-community/bluetooth-le', () => ({
  BleClient: {
    initialize: m.initialize,
    startEnabledNotifications: async (cb: (on: boolean) => void) => { m.notify = cb; },
    stopEnabledNotifications: async () => { m.notify = null; },
  },
}));

import { pickBandNotice, bluetoothOffHelp } from '../src/lib/native/bluetooth-notice';
import { BluetoothOffShortcuts } from '../src/components/native/bluetooth-off-shortcuts';
import { useBluetoothPower } from '../src/hooks/useBluetoothPower';
import { requestEnableBluetooth } from '../src/lib/native/app-settings';
import { toNativeDevice } from '../src/lib/native-measurement/device-status';
import type { MeasurementSnapshot } from '../src/lib/native-measurement/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root; let div: HTMLDivElement;
const q = (id: string) => div.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(() => { m.native = true; m.platform = 'android'; m.enabled = true; m.notify = null; vi.clearAllMocks(); div = document.createElement('div'); document.body.append(div); root = createRoot(div); });
afterEach(async () => { await act(async () => root.unmount()); div.remove(); });

describe('SDD-333 우선순위', () => {
  it('꺼짐이면 깨우기 안내보다 우선한다', () => {
    expect(pickBandNotice({ bluetoothOff: true, wakeHint: true })).toBe('bluetooth_off');
    expect(pickBandNotice({ bluetoothOff: true, wakeHint: false })).toBe('bluetooth_off');
  });
  it('켜짐·알 수 없음이면 깨우기 안내 규칙 그대로', () => {
    expect(pickBandNotice({ bluetoothOff: false, wakeHint: true })).toBe('wake');
    expect(pickBandNotice({ bluetoothOff: null, wakeHint: true })).toBe('wake');
    expect(pickBandNotice({ bluetoothOff: null, wakeHint: false })).toBe('none');
  });
  it('iOS 안내는 제어센터를 언급한다', () => {
    expect(bluetoothOffHelp('ios', true)).toContain('제어센터');
    expect(bluetoothOffHelp('android', true)).not.toContain('제어센터');
  });
  it('네이티브 snapshot 의 bluetooth_off 이유를 기기 상태로 전달한다', () => {
    const snap = { blocked_reason: 'bluetooth_off', metrics: null, collection: { band_state: 'reconnecting' } } as unknown as MeasurementSnapshot;
    expect(toNativeDevice(snap).bluetoothOff).toBe(true);
    expect(toNativeDevice({ ...snap, blocked_reason: null } as MeasurementSnapshot).bluetoothOff).toBe(false);
  });
});

function Probe({ onTurnedOn, nativeBlocked }: { onTurnedOn?: () => void; nativeBlocked?: boolean }) {
  const off = useBluetoothPower({ onTurnedOn, nativeBlocked });
  return createElement('span', { 'data-testid': 'off' }, String(off));
}

describe('SDD-333 감지 훅', () => {
  it('꺼짐을 읽으면 true, 켜지면 false 가 되고 꺼짐→켜짐에서 onTurnedOn 이 한 번 불린다', async () => {
    m.enabled = false;
    const onTurnedOn = vi.fn();
    await act(async () => root.render(createElement(Probe, { onTurnedOn })));
    await flush();
    expect(q('off')?.textContent).toBe('true');
    await act(async () => { m.notify?.(true); });
    expect(q('off')?.textContent).toBe('false');
    expect(onTurnedOn).toHaveBeenCalledOnce();
  });
  it('처음부터 켜짐이면 재연결을 부르지 않는다', async () => {
    const onTurnedOn = vi.fn();
    await act(async () => root.render(createElement(Probe, { onTurnedOn })));
    await flush();
    expect(q('off')?.textContent).toBe('false');
    expect(onTurnedOn).not.toHaveBeenCalled();
  });
  it('알 수 없으면(null) 꺼짐으로 보지 않는다', async () => {
    m.enabled = null;
    await act(async () => root.render(createElement(Probe, {})));
    await flush();
    expect(q('off')?.textContent).toBe('null');
  });
  it('직접 읽은 값이 없을 때 네이티브가 bluetooth_off 를 알리면 true, 켜졌다고 읽히면 그 값이 우선', async () => {
    m.enabled = null;
    await act(async () => root.render(createElement(Probe, { nativeBlocked: true })));
    await flush();
    expect(q('off')?.textContent).toBe('true');
    m.enabled = true;
    await act(async () => { m.notify?.(true); });
    expect(q('off')?.textContent).toBe('false');
  });
  it('(구) 네이티브 이유만', async () => {
    m.enabled = null;
    await act(async () => root.render(createElement(Probe, { nativeBlocked: true })));
    await flush();
    expect(q('off')?.textContent).toBe('true');
  });
  it('웹에서는 항상 null', async () => {
    m.native = false;
    await act(async () => root.render(createElement(Probe, {})));
    await flush();
    expect(q('off')?.textContent).toBe('null');
  });
});

describe('SDD-333 버튼', () => {
  it('Android: [블루투스 켜기] 가 시스템 켜기 창을 요청한다', async () => {
    await act(async () => root.render(createElement(BluetoothOffShortcuts)));
    expect(q('bt-turn-on')?.textContent).toBe('블루투스 켜기');
    expect(q('bt-open-settings')).toBeNull();
    await act(async () => { q('bt-turn-on')!.click(); });
    await flush();
    expect(m.plugin.requestEnableBluetooth).toHaveBeenCalledOnce();
  });
  it('iOS: 켜기 알림 요청 뒤 제어센터 안내와 [설정 열기] 가 나온다', async () => {
    m.platform = 'ios';
    m.plugin.requestEnableBluetooth.mockResolvedValueOnce({ mode: 'power_alert' });
    await act(async () => root.render(createElement(BluetoothOffShortcuts)));
    expect(q('bt-help')?.textContent).not.toContain('제어센터 ');
    await act(async () => { q('bt-turn-on')!.click(); });
    await flush();
    expect(q('bt-help')?.textContent).toContain('제어센터');
    await act(async () => { q('bt-open-settings')!.click(); });
    expect(m.plugin.openAppSettings).toHaveBeenCalledOnce();
  });
  it('웹에서는 버튼을 그리지 않는다', async () => {
    m.native = false;
    await act(async () => root.render(createElement(BluetoothOffShortcuts)));
    expect(div.innerHTML).toBe('');
  });
  it('Android 12+ 권한 없음(permission) → 권한 요청 뒤 재시도', async () => {
    m.plugin.requestEnableBluetooth.mockRejectedValueOnce({ code: 'permission', message: 'permission' });
    const r = await requestEnableBluetooth();
    expect(m.initialize).toHaveBeenCalled();
    expect(m.plugin.requestEnableBluetooth).toHaveBeenCalledTimes(2);
    expect(r).toBe('system_dialog');
  });
  it('구버전 앱(메서드 없음)이면 unavailable', async () => {
    m.plugin.requestEnableBluetooth.mockRejectedValueOnce(new Error('not implemented'));
    expect(await requestEnableBluetooth()).toBe('unavailable');
  });
});
