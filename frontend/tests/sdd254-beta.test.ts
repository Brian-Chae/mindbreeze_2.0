import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectBetaPlatform, fetchBetaConfig, formatBytes, isOutdatedBuild, parseBetaConfig, safeHttpsUrl } from '../src/lib/beta/beta-config';

const read = (n: string) => readFileSync(resolve(import.meta.dirname, '..', n), 'utf8');

describe('SDD-254 베타 설정', () => {
  it('UA 로 플랫폼을 판별한다', () => {
    expect(detectBetaPlatform('Mozilla/5.0 (Linux; Android 14; SM-S911N)')).toBe('android');
    expect(detectBetaPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('ios');
    expect(detectBetaPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('ios');
    expect(detectBetaPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe('desktop');
    expect(detectBetaPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('desktop');
  });
  it('https 외 URL 은 버린다', () => {
    expect(safeHttpsUrl('javascript:alert(1)')).toBe('');
    expect(safeHttpsUrl('http://a.com/x.apk')).toBe('');
    expect(safeHttpsUrl('https://a.com/x.apk')).toBe('https://a.com/x.apk');
    expect(safeHttpsUrl(undefined)).toBe('');
  });
  it('저장소의 public/beta.json 이 스키마를 통과하고 기본은 알림 꺼짐', () => {
    const cfg = parseBetaConfig(JSON.parse(read('public/beta.json')));
    expect(cfg).not.toBeNull();
    expect(cfg!.updateBannerEnabled).toBe(false);
    expect(cfg!.android.apkUrl).toBe('');
  });
  it('잘못된 스키마·sha 는 거른다', () => {
    expect(parseBetaConfig({ schemaVersion: 2 })).toBeNull();
    expect(parseBetaConfig(null)).toBeNull();
    const c = parseBetaConfig({ schemaVersion: 1, android: { sha256: 'xyz', apkUrl: 'https://a/b.apk', versionCode: 24 } });
    expect(c!.android.sha256).toBe('');
    expect(c!.android.versionCode).toBe(24);
  });
  it('설치 빌드가 최신보다 낮을 때만 새 버전으로 본다', () => {
    expect(isOutdatedBuild('23', 24)).toBe(true);
    expect(isOutdatedBuild('24', 24)).toBe(false);
    expect(isOutdatedBuild('25', 24)).toBe(false);
    expect(isOutdatedBuild('23', 0)).toBe(false);
    expect(isOutdatedBuild('abc', 24)).toBe(false);
  });
  it('fetchBetaConfig 는 실패 시 null', async () => {
    const bad = vi.fn().mockResolvedValue({ ok: false });
    expect(await fetchBetaConfig('', bad as unknown as typeof fetch)).toBeNull();
    const boom = vi.fn().mockRejectedValue(new Error('x'));
    expect(await fetchBetaConfig('', boom as unknown as typeof fetch)).toBeNull();
    const ok = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ schemaVersion: 1 }) });
    expect(await fetchBetaConfig('https://x.com/', ok as unknown as typeof fetch)).not.toBeNull();
    expect(ok.mock.calls[0][0]).toMatch(/^https:\/\/x\.com\/beta\.json\?t=/);
  });
  it('용량 표기', () => { expect(formatBytes(52428800)).toBe('50.0MB'); expect(formatBytes(0)).toBe(''); });
  it('라우트와 배너가 연결돼 있고 랜딩에 TestFlight 정보공유 안내가 있다', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('path="/beta"');
    expect(app).toContain('<BetaUpdateBanner />');
    expect(read('src/pages/BetaLandingPage.tsx')).toContain('Apple에 충돌·사용 정보가 공유돼요');
  });
});
