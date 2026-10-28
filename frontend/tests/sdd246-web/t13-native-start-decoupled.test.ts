// 앱 라이브 지표 누락 수정 — 네이티브 측정 시작을 JS BLE 연결 순간에 묶지 않는다 + 배터리 모름은 null.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shouldStartNative } from '../../src/lib/measurement-web/use-native-measurement';

const base = { path: 'native' as const, hasIds: true, platform: 'ios', bandConnected: false, latched: false, knownDeviceId: null as string | null };

describe('shouldStartNative', () => {
  it('JS 미연결 + 캐시 기기 있음 → 시작(Android 포함)', () => {
    expect(shouldStartNative({ ...base, platform: 'android', knownDeviceId: 'AA:BB' })).toBe(true);
    expect(shouldStartNative({ ...base, knownDeviceId: 'UUID' })).toBe(true);
  });
  it('iOS 는 기기 ID 없이도 시작(네이티브 스캔), Android 는 주소 없으면 대기', () => {
    expect(shouldStartNative(base)).toBe(true);
    expect(shouldStartNative({ ...base, platform: 'android' })).toBe(false);
  });
  it('JS 가 연결돼 있으면 시작, 시작 후 JS 해제돼도 래치 유지', () => {
    expect(shouldStartNative({ ...base, platform: 'android', bandConnected: true })).toBe(true);
    expect(shouldStartNative({ ...base, platform: 'android', latched: true })).toBe(true);
  });
  it('native 경로 아님/참가자 없음 → 시작 안 함', () => {
    expect(shouldStartNative({ ...base, path: 'off' })).toBe(false);
    expect(shouldStartNative({ ...base, hasIds: false })).toBe(false);
  });
});

describe('배터리 모름 → null', () => {
  it('MemberClassContainer: 네이티브 소유 시 battery null(0% 아님)', () => {
    const c = readFileSync('src/components/class/player/member/MemberClassContainer.tsx', 'utf8');
    expect(c).toContain('battery: nativeOwnsBand ? null : band.battery');
  });
  it('bluetoothService.getBatteryLevel 은 모르면 0 이 아니라 null', async () => {
    const { bluetoothService } = await import('../../src/lib/eeg/bluetoothService');
    expect(await bluetoothService.getBatteryLevel()).toBeNull();
  });
});
