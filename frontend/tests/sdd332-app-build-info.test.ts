import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appBuildText } from '../src/lib/upload-status/view';
import { parseWebOs } from '../src/lib/native/app-build-info';
import { reportBandDevice, resetBandReportCache } from '../src/lib/band/band-device-report';

describe('SDD-332 앱 빌드 정보', () => {
  const sent = new Set<string>();
  beforeEach(() => resetBandReportCache(sent));
  const base = { sessionId: 's1', credential: 'c', platform: 'android' as const };
  const id = { serial: 'LXB-0263008A', firmware: '1.44.3' };

  it('보고 본문에 앱 정보가 포함된다', async () => {
    const put = vi.fn(async () => ({ ok: true }));
    await reportBandDevice({ ...base, identity: id, appInfo: { app_version: '1.0.0-dev', app_build: '56', os_name: 'Android', os_version: '15', device_model: 'SM-S921N' } }, { put, wait: async () => {}, sent });
    expect(put).toHaveBeenCalledWith('s1', 'c', { serial: 'LXB-0263008A', platform: 'android', firmware: '1.44.3', app_version: '1.0.0-dev', app_build: '56', os_name: 'Android', os_version: '15', device_model: 'SM-S921N' });
  });
  it('앱 정보가 없거나 빈 값이면 기존 본문과 같다', async () => {
    const put = vi.fn(async () => ({ ok: true }));
    await reportBandDevice({ ...base, identity: id, appInfo: { app_build: '' } }, { put, wait: async () => {}, sent });
    expect(put).toHaveBeenCalledWith('s1', 'c', { serial: 'LXB-0263008A', platform: 'android', firmware: '1.44.3' });
  });
  it('표시 한 줄', () => {
    expect(appBuildText({ app_build: '56', os_name: 'Android', os_version: '15', device_model: 'SM-S921N' })).toBe('앱 56 · Android 15 · SM-S921N');
    expect(appBuildText({ app_build: null })).toBeNull();
    expect(appBuildText({ os_name: 'iOS', os_version: '18.1' })).toBe('iOS 18.1');
  });
  it('웹 UA 파싱', () => {
    expect(parseWebOs('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)')).toEqual({ os_name: 'iOS', os_version: '17.5' });
    expect(parseWebOs('Mozilla/5.0 (Linux; Android 14; Pixel)')).toEqual({ os_name: 'Android', os_version: '14' });
  });
});
