// [FIX] 코드 입장 게스트 앱 실시간 지표 — 게스트는 앱에서도 web_wasm, 회원은 native 유지.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decideMeasurementPath } from '../src/lib/measurement-web/measurement-path';
import { shouldRestartNativeInPlace } from '../src/lib/measurement-web/use-native-measurement';

const base = { v2: true, native: true, webBluetooth: true, bandConnected: true, eegConsent: true, bandOptIn: true };

describe('측정 경로: 게스트 vs 회원 (앱)', () => {
  it('게스트+앱 → web_wasm (밴드 연결 시), 미연결이면 off', () => {
    expect(decideMeasurementPath({ ...base, guest: true })).toBe('web_wasm');
    expect(decideMeasurementPath({ ...base, guest: true, bandConnected: false })).toBe('off');
  });
  it('로그인 회원+앱 → native 유지(회귀)', () => {
    expect(decideMeasurementPath({ ...base, guest: false })).toBe('native');
    expect(decideMeasurementPath({ ...base })).toBe('native');
  });
  it('게스트도 동의·옵트인·v2 가드는 그대로', () => {
    expect(decideMeasurementPath({ ...base, guest: true, eegConsent: false })).toBe('off');
    expect(decideMeasurementPath({ ...base, guest: true, bandOptIn: false })).toBe('off');
    expect(decideMeasurementPath({ ...base, guest: true, v2: false })).toBe('legacy');
  });
});

describe('배선', () => {
  const c = readFileSync('src/components/class/player/member/MemberClassContainer.tsx', 'utf8');
  it('웹 측정 훅에 guest 전달, 회원 화면 snapshot 은 liveSnap/native/자체값 순', () => {
    expect(c).toContain('guest: !user?.id');
    expect(c).toContain('liveSnap ?? nativeM.metrics ?? buildSnapshot');
  });
  it('게스트의 수동 연결은 JS BLE: nativeAuto 는 회원만 true', () => {
    expect(c).toMatch(/nativeAuto: [^,]*Boolean\(user\?\.id\)|nativeAuto: [^,]*!isGuest/);
  });
  it('게스트 입장 자격 헤더 X-Entry-Credential 로 features/batch 전송', () => {
    const f = readFileSync('src/lib/api/feature-batch.ts', 'utf8');
    expect(f).toContain("'X-Entry-Credential': a.entryCredential");
    expect(c).toContain('featureAuth: { entryCredential, skipAuth: !isAuthenticated }');
  });
  it('게스트 live v2 소켓은 무토큰, join 에 entry_credential', () => {
    const u = readFileSync('src/lib/session-live/use-live-v2.ts', 'utf8');
    expect(u).toContain('skipAuth ? null : tokenStorage.getAccess()');
    const l = readFileSync('src/lib/session-live/live-client.ts', 'utf8');
    expect(l).toContain('entry_credential: this.o.entryCredential ?? null');
  });
});

describe('native 재시작 안정화 (iOS)', () => {
  it('같은 회차·계정 재실행이면 stop→start 대신 제자리 재연결', () => {
    expect(shouldRestartNativeInPlace({ active: true, sameSession: true })).toBe(true);
    expect(shouldRestartNativeInPlace({ active: true, sameSession: false })).toBe(false);
    expect(shouldRestartNativeInPlace({ active: false, sameSession: true })).toBe(false);
  });
  it('성공한 deviceId 를 보관해 재시작에 전달', () => {
    const s = readFileSync('src/lib/measurement-web/use-native-measurement.ts', 'utf8');
    expect(s).toContain('lastGoodDeviceIdRef');
    expect(s).toContain('start_reason');
    expect(s).toContain('unmountingRef'); // 언마운트는 즉시 stop
  });
});
