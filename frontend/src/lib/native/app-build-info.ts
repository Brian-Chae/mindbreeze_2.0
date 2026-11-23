// SDD-332 — 측정에 쓴 앱 빌드·기기 OS 정보를 수집한다(밴드 시리얼 보고에 함께 보낸다).
// 부가 정보: 어떤 단계에서 실패해도 null 필드로 두고 던지지 않는다.
import { App } from '@capacitor/app';
import { Device } from '@capacitor/device';
import { getPlatform, isNativeApp } from './platform';

export interface AppBuildInfo {
  app_version?: string;
  app_build?: string;
  os_name?: string;
  os_version?: string;
  device_model?: string;
}

/** 웹 브라우저: UA 에서 OS 이름만 대략 추린다(빌드 번호 없음). */
export function parseWebOs(ua: string): { os_name?: string; os_version?: string } {
  if (/Android\s([\d.]+)/.exec(ua)) return { os_name: 'Android', os_version: /Android\s([\d.]+)/.exec(ua)?.[1] };
  const ios = /OS ([\d_]+) like Mac OS X/.exec(ua);
  if (ios) return { os_name: 'iOS', os_version: ios[1].replace(/_/g, '.') };
  if (/Windows/.test(ua)) return { os_name: 'Windows' };
  if (/Mac OS X/.test(ua)) return { os_name: 'macOS' };
  if (/Linux/.test(ua)) return { os_name: 'Linux' };
  return {};
}

const clean = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const s = String(v).trim().slice(0, max);
  return s || undefined;
};

let cached: Promise<AppBuildInfo> | null = null;

async function collect(): Promise<AppBuildInfo> {
  if (!isNativeApp()) {
    const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    return { os_name: parseWebOs(ua).os_name, os_version: parseWebOs(ua).os_version, device_model: 'web' };
  }
  const out: AppBuildInfo = {};
  try {
    const app = await App.getInfo(); // version=1.0.0-dev, build=Android versionCode / iOS CFBundleVersion
    out.app_version = clean(app.version, 32);
    out.app_build = clean(app.build, 16);
  } catch { /* 부가 정보 */ }
  try {
    const dev = await Device.getInfo();
    out.os_name = clean(dev.operatingSystem === 'ios' ? 'iOS' : dev.operatingSystem === 'android' ? 'Android' : dev.operatingSystem, 16);
    out.os_version = clean(dev.osVersion, 32);
    out.device_model = clean(dev.model, 64);
  } catch { /* 부가 정보 */ }
  if (!out.os_name) out.os_name = getPlatform() === 'ios' ? 'iOS' : getPlatform() === 'android' ? 'Android' : undefined;
  return out;
}

/** 프로세스당 한 번만 수집해 재사용한다. */
export function getAppBuildInfo(): Promise<AppBuildInfo> {
  cached ??= collect().catch(() => ({}));
  return cached;
}

/** 테스트용 캐시 초기화. */
export function resetAppBuildInfoCache(): void { cached = null; }
