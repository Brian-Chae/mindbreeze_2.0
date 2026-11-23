// @vitest-environment jsdom
// SDD-330 A: 권한 바로가기 — 앱 안 직접 요청 · 설정 화면 열기 · 배터리 예외 · 웹/구버전 폴백
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  native: true,
  platform: 'android' as 'android' | 'ios' | 'web',
  plugin: {
    openAppSettings: vi.fn(async () => undefined),
    isIgnoringBatteryOptimizations: vi.fn(async () => ({ ignoring: false })),
    requestIgnoreBatteryOptimizations: vi.fn(async () => undefined),
    openBatterySettings: vi.fn(async () => undefined),
  },
  initialize: vi.fn(async () => undefined),
}));
vi.mock('../src/lib/native/platform', () => ({ isNativeApp: () => m.native, getPlatform: () => (m.native ? m.platform : 'web') }));
vi.mock('@capacitor/core', () => ({ registerPlugin: () => m.plugin, Capacitor: { isNativePlatform: () => m.native, getPlatform: () => m.platform } }));
vi.mock('@capacitor-community/bluetooth-le', () => ({ BleClient: { initialize: m.initialize } }));

import { PermissionShortcuts } from '../src/components/native/permission-shortcuts';
import * as settings from '../src/lib/native/app-settings';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root; let div: HTMLDivElement;
const q = (id: string) => div.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(() => { m.native = true; m.platform = 'android'; vi.clearAllMocks(); m.plugin.isIgnoringBatteryOptimizations.mockResolvedValue({ ignoring: false }); div = document.createElement('div'); document.body.append(div); root = createRoot(div); });
afterEach(async () => { await act(async () => root.unmount()); div.remove(); });

describe('SDD-330 권한 바로가기', () => {
  it('Android: 세 버튼이 보이고 각각 앱 안 요청·설정 화면·배터리 예외를 연다', async () => {
    const onRequested = vi.fn();
    await act(async () => root.render(createElement(PermissionShortcuts, { onRequested })));
    await flush();
    expect(q('perm-allow')?.textContent).toBe('권한 허용하기');
    expect(q('perm-open-settings')?.textContent).toBe('설정 열기');
    expect(q('perm-battery')?.textContent).toBe('배터리 제한 풀기');
    await act(async () => { q('perm-allow')!.click(); });
    await flush();
    expect(m.initialize).toHaveBeenCalledWith({ androidNeverForLocation: true });
    expect(onRequested).toHaveBeenCalledOnce();
    await act(async () => { q('perm-open-settings')!.click(); });
    expect(m.plugin.openAppSettings).toHaveBeenCalledOnce();
    await act(async () => { q('perm-battery')!.click(); });
    expect(m.plugin.requestIgnoreBatteryOptimizations).toHaveBeenCalledOnce();
  });

  it('이미 배터리 최적화에서 제외됐으면 배터리 버튼을 숨긴다', async () => {
    m.plugin.isIgnoringBatteryOptimizations.mockResolvedValue({ ignoring: true });
    await act(async () => root.render(createElement(PermissionShortcuts, {})));
    await flush();
    expect(q('perm-battery')).toBeNull();
    expect(q('perm-open-settings')).not.toBeNull();
  });

  it('iOS: 배터리 버튼 없이 허용·설정 열기만', async () => {
    m.platform = 'ios';
    await act(async () => root.render(createElement(PermissionShortcuts, {})));
    await flush();
    expect(q('perm-allow')).not.toBeNull();
    expect(q('perm-open-settings')).not.toBeNull();
    expect(q('perm-battery')).toBeNull();
    expect(m.plugin.isIgnoringBatteryOptimizations).not.toHaveBeenCalled();
  });

  it('웹 브라우저에서는 아무것도 그리지 않는다', async () => {
    m.native = false;
    await act(async () => root.render(createElement(PermissionShortcuts, {})));
    expect(div.innerHTML).toBe('');
  });

  it('플러그인이 없는 구버전 앱: 호출은 예외 없이 false 로 폴백한다', async () => {
    m.plugin.openAppSettings.mockRejectedValueOnce(new Error('"AppSettings" plugin is not implemented on android'));
    expect(await settings.openAppSettings()).toBe(false);
    m.plugin.isIgnoringBatteryOptimizations.mockRejectedValueOnce(new Error('not implemented'));
    expect(await settings.isBatteryOptimizationIgnored()).toBeNull();
    m.initialize.mockRejectedValueOnce(new Error('denied'));
    expect(await settings.requestBluetoothPermission()).toBe(false);
  });
});
