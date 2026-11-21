// 현장 QR 베타 배포 설정 (SDD-254)
// /beta.json 을 읽어 랜딩·앱 내 "새 버전 있음" 안내가 같은 값을 쓴다. 링크 교체는 이 파일(JSON)만 바꾼다.

export interface BetaAndroidInfo {
  versionName: string;
  versionCode: number;
  apkUrl: string;
  sha256: string;
  sizeBytes: number;
  publishedAt: string;
}

export interface BetaIosInfo {
  testflightUrl: string;
  latestBuild: number;
  expiresAt: string;
}

export interface BetaConfig {
  schemaVersion: number;
  updatedAt: string;
  landingEnabled: boolean;
  updateBannerEnabled: boolean;
  android: BetaAndroidInfo;
  ios: BetaIosInfo;
  support: { email: string };
}

export type BetaPlatform = 'ios' | 'android' | 'desktop';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** https 주소만 허용한다(javascript:, http: 차단). 비어 있으면 빈 문자열. */
export function safeHttpsUrl(v: unknown): string {
  const s = str(v).trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.toString() : '';
  } catch {
    return '';
  }
}

/** 외부 JSON 을 검증·정규화한다. 잘못된 입력이면 null. */
export function parseBetaConfig(raw: unknown): BetaConfig | null {
  if (!isObj(raw) || raw.schemaVersion !== 1) return null;
  const a = isObj(raw.android) ? raw.android : {};
  const i = isObj(raw.ios) ? raw.ios : {};
  const s = isObj(raw.support) ? raw.support : {};
  return {
    schemaVersion: 1,
    updatedAt: str(raw.updatedAt),
    landingEnabled: raw.landingEnabled !== false,
    updateBannerEnabled: raw.updateBannerEnabled === true,
    android: {
      versionName: str(a.versionName),
      versionCode: num(a.versionCode),
      apkUrl: safeHttpsUrl(a.apkUrl),
      sha256: /^[0-9a-f]{64}$/i.test(str(a.sha256)) ? str(a.sha256).toLowerCase() : '',
      sizeBytes: num(a.sizeBytes),
      publishedAt: str(a.publishedAt),
    },
    ios: {
      testflightUrl: safeHttpsUrl(i.testflightUrl),
      latestBuild: num(i.latestBuild),
      expiresAt: str(i.expiresAt),
    },
    support: { email: str(s.email) },
  };
}

/** User-Agent 로 플랫폼을 판별한다. iPadOS 는 Macintosh UA + 터치로 오므로 maxTouchPoints 를 함께 본다. */
export function detectBetaPlatform(userAgent: string, maxTouchPoints = 0): BetaPlatform {
  if (/android/i.test(userAgent)) return 'android';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios';
  if (/macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'ios';
  return 'desktop';
}

/** 설치된 빌드 번호(문자열)가 최신보다 낮으면 true. 최신 번호가 0(미설정)이면 false. */
export function isOutdatedBuild(installedBuild: string, latestBuild: number): boolean {
  if (latestBuild <= 0) return false;
  const n = Number.parseInt(installedBuild, 10);
  if (!Number.isFinite(n)) return false;
  return n < latestBuild;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '';
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** 베타 설정 조회 — 캐시 우회. 실패 시 null. */
export async function fetchBetaConfig(baseUrl = '', fetchImpl: typeof fetch = fetch): Promise<BetaConfig | null> {
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/beta.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return parseBetaConfig(await res.json());
  } catch {
    return null;
  }
}
