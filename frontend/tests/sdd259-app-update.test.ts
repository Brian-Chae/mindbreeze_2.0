import { describe, expect, it, vi } from 'vitest';
import {
  decideUpdate, fetchUpdateManifest, formatBytes, isDismissed, isOutdatedBuild, isUpdateHomePath,
  parseUpdateManifest, safeApkUrl, type UpdateManifest,
} from '../src/lib/update/update-config';

const SHA = 'a'.repeat(64);
const raw = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1, updatedAt: '2026-10-30', updateBannerEnabled: true, minSupportedVersionCode: 0,
  android: { versionName: '1.2.0', versionCode: 28, apkUrl: 'https://download.mindbreeze.looxidlabs.com/a.apk', sha256: SHA, sizeBytes: 110157515, publishedAt: 'x', notes: '' },
  ios: { testflightUrl: 'https://testflight.apple.com/join/QjQGu3pG', latestBuild: 12 },
  ...over,
});
const m = (over: Record<string, unknown> = {}): UpdateManifest => parseUpdateManifest(raw(over))!;

describe('A1~A4 parse', () => {
  it('정상 JSON 정규화', () => {
    const p = m();
    expect(p.android.versionCode).toBe(28);
    expect(p.ios.latestBuild).toBe(12);
    expect(p.updateBannerEnabled).toBe(true);
  });
  it('schemaVersion≠1·비객체 → null', () => {
    expect(parseUpdateManifest({ schemaVersion: 2 })).toBeNull();
    expect(parseUpdateManifest(null)).toBeNull();
    expect(parseUpdateManifest('x')).toBeNull();
  });
  it('sha256 형식/대소문자', () => {
    expect(m({ android: { ...raw().android, sha256: 'zz' } }).android.sha256).toBe('');
    expect(m({ android: { ...raw().android, sha256: 'A'.repeat(64) } }).android.sha256).toBe(SHA);
  });
  it('URL: http·javascript·허용 밖 호스트 차단', () => {
    expect(safeApkUrl('http://download.mindbreeze.looxidlabs.com/a.apk')).toBe('');
    expect(safeApkUrl('javascript:alert(1)')).toBe('');
    expect(safeApkUrl('https://evil.example.com/a.apk')).toBe('');
    expect(safeApkUrl('https://download.mindbreeze.looxidlabs.com/a.apk')).not.toBe('');
  });
  it('숫자 음수·NaN → 0', () => {
    expect(m({ minSupportedVersionCode: -3 }).minSupportedVersionCode).toBe(0);
    expect(m({ android: { ...raw().android, versionCode: NaN } }).android.versionCode).toBe(0);
  });
  it('updateBannerEnabled 는 true 일 때만 켜짐', () => {
    expect(m({ updateBannerEnabled: 'true' }).updateBannerEnabled).toBe(false);
  });
});

describe('A5 isOutdatedBuild', () => {
  it('비교', () => {
    expect(isOutdatedBuild('27', 28)).toBe(true);
    expect(isOutdatedBuild('28', 28)).toBe(false);
    expect(isOutdatedBuild('29', 28)).toBe(false);
    expect(isOutdatedBuild('27', 0)).toBe(false);
    expect(isOutdatedBuild('abc', 28)).toBe(false);
  });
});

describe('A6 decideUpdate', () => {
  it('web → null', () => expect(decideUpdate(m(), 'web', '1')).toBeNull());
  it('배너 꺼짐 → null', () => expect(decideUpdate(m({ updateBannerEnabled: false }), 'android', '27')).toBeNull());
  it('manifest null → null', () => expect(decideUpdate(null, 'android', '27')).toBeNull());
  it('android outdated → android', () => {
    const d = decideUpdate(m(), 'android', '27')!;
    expect(d.kind).toBe('android');
    expect(d.latestLabel).toBe('1.2.0');
    expect(d.dismissKey).toBe('android:28');
  });
  it('android 최신 → null', () => expect(decideUpdate(m(), 'android', '28')).toBeNull());
  it('android apkUrl/sha 비면 null', () => {
    expect(decideUpdate(m({ android: { ...raw().android, sha256: '' } }), 'android', '27')).toBeNull();
    expect(decideUpdate(m({ android: { ...raw().android, apkUrl: 'https://evil.com/a.apk' } }), 'android', '27')).toBeNull();
  });
  it('ios outdated → ios(TestFlight)', () => {
    const d = decideUpdate(m(), 'ios', '11')!;
    expect(d.kind).toBe('ios');
    expect(d.testflightUrl).toContain('testflight.apple.com');
  });
  it('ios testflight 없으면 null', () => {
    expect(decideUpdate(m({ ios: { testflightUrl: '', latestBuild: 12 } }), 'ios', '11')).toBeNull();
  });
});

describe('A7 dismiss/강제', () => {
  it('같은 키면 숨김, 새 버전이면 표시', () => {
    const d = decideUpdate(m(), 'android', '27')!;
    expect(isDismissed(d, 'android:28')).toBe(true);
    expect(isDismissed(d, 'android:27')).toBe(false);
    expect(isDismissed(d, null)).toBe(false);
  });
  it('강제(설치<minSupported)면 닫기 기억 무시', () => {
    const d = decideUpdate(m({ minSupportedVersionCode: 28 }), 'android', '27')!;
    expect(d.forced).toBe(true);
    expect(isDismissed(d, 'android:28')).toBe(false);
  });
  it('minSupported=0 이면 강제 아님', () => {
    expect(decideUpdate(m(), 'android', '1')!.forced).toBe(false);
  });
});

describe('A8 formatBytes', () => {
  it('변환', () => {
    expect(formatBytes(0)).toBe('');
    expect(formatBytes(110157515)).toBe('105.1MB');
  });
});

describe('A9 fetchUpdateManifest', () => {
  it('ok → 파싱, no-store', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => raw() });
    const r = await fetchUpdateManifest('https://x.test/', f as unknown as typeof fetch);
    expect(r?.android.versionCode).toBe(28);
    expect(f.mock.calls[0][0]).toMatch(/^https:\/\/x\.test\/latest\.json\?t=\d+$/);
    expect(f.mock.calls[0][1]).toEqual({ cache: 'no-store' });
  });
  it('!ok · throw · 무효 JSON → null', async () => {
    expect(await fetchUpdateManifest('https://x', vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch)).toBeNull();
    expect(await fetchUpdateManifest('https://x', vi.fn().mockRejectedValue(new Error('n')) as unknown as typeof fetch)).toBeNull();
    expect(await fetchUpdateManifest('https://x', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch)).toBeNull();
  });
});

describe('A10 isUpdateHomePath', () => {
  it('홈만 true', () => {
    for (const p of ['/app', '/dashboard', '/dashboard/org', '/app/']) expect(isUpdateHomePath(p)).toBe(true);
    for (const p of ['/class/x/enter', '/sessions/x/player', '/login', '/app/classes']) expect(isUpdateHomePath(p)).toBe(false);
  });
});
