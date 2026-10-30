// 앱 내 업데이트 알림 설정 (SDD-259)
// 다운로드 사이트의 /latest.json 을 읽어 "새 버전 있음" 여부와 설치 파일 정보를 얻는다.
// 앱 재배포 없이 사이트 파일만 바꿔 새 버전을 알린다.

export const UPDATE_SITE_URL = 'https://download.mindbreeze.looxidlabs.com';
/** APK 를 내려받을 수 있는 호스트 허용 목록(네이티브에서도 재검증). */
export const ALLOWED_APK_HOSTS: readonly string[] = ['download.mindbreeze.looxidlabs.com'];

export interface UpdateAndroidInfo {
  versionName: string;
  versionCode: number;
  apkUrl: string;
  sha256: string;
  sizeBytes: number;
  publishedAt: string;
  notes: string;
}

export interface UpdateIosInfo {
  testflightUrl: string;
  latestBuild: number;
}

export interface UpdateManifest {
  schemaVersion: 1;
  updatedAt: string;
  updateBannerEnabled: boolean;
  /** 설치본이 이 값 미만이면 닫을 수 없는 강제 업데이트. 0 이면 꺼짐. */
  minSupportedVersionCode: number;
  android: UpdateAndroidInfo;
  ios: UpdateIosInfo;
}

export type UpdatePlatform = 'web' | 'ios' | 'android';

export interface UpdateDecision {
  kind: 'android' | 'ios';
  latestLabel: string;
  latestCode: number;
  sizeBytes: number;
  notes: string;
  /** 같은 버전 닫기 기억 키. */
  dismissKey: string;
  /** 설치본이 minSupportedVersionCode 미만 → 닫기 불가. */
  forced: boolean;
  apkUrl: string;
  sha256: string;
  testflightUrl: string;
}

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

/** https + 허용 호스트만 통과. */
export function safeApkUrl(v: unknown): string {
  const url = safeHttpsUrl(v);
  if (!url) return '';
  return ALLOWED_APK_HOSTS.includes(new URL(url).hostname) ? url : '';
}

/** 외부 JSON 을 검증·정규화한다. 잘못된 입력이면 null. */
export function parseUpdateManifest(raw: unknown): UpdateManifest | null {
  if (!isObj(raw) || raw.schemaVersion !== 1) return null;
  const a = isObj(raw.android) ? raw.android : {};
  const i = isObj(raw.ios) ? raw.ios : {};
  const sha = str(a.sha256);
  return {
    schemaVersion: 1,
    updatedAt: str(raw.updatedAt),
    updateBannerEnabled: raw.updateBannerEnabled === true,
    minSupportedVersionCode: num(raw.minSupportedVersionCode),
    android: {
      versionName: str(a.versionName),
      versionCode: num(a.versionCode),
      apkUrl: safeApkUrl(a.apkUrl),
      sha256: /^[0-9a-f]{64}$/i.test(sha) ? sha.toLowerCase() : '',
      sizeBytes: num(a.sizeBytes),
      publishedAt: str(a.publishedAt),
      notes: str(a.notes),
    },
    ios: {
      testflightUrl: safeHttpsUrl(i.testflightUrl),
      latestBuild: num(i.latestBuild),
    },
  };
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

/** 표시 조건 판단. 알릴 필요가 없으면 null. */
export function decideUpdate(
  manifest: UpdateManifest | null,
  platform: UpdatePlatform,
  installedBuild: string,
): UpdateDecision | null {
  if (!manifest || !manifest.updateBannerEnabled || platform === 'web') return null;
  const installed = Number.parseInt(installedBuild, 10);
  const forced =
    manifest.minSupportedVersionCode > 0 && Number.isFinite(installed) && installed < manifest.minSupportedVersionCode;

  if (platform === 'android') {
    const a = manifest.android;
    if (!isOutdatedBuild(installedBuild, a.versionCode)) return null;
    // 다운로드 주소·해시가 없으면 설치를 진행할 수 없으므로 알리지 않는다.
    if (!a.apkUrl || !a.sha256) return null;
    return {
      kind: 'android',
      latestLabel: a.versionName || String(a.versionCode),
      latestCode: a.versionCode,
      sizeBytes: a.sizeBytes,
      notes: a.notes,
      dismissKey: `android:${a.versionCode}`,
      forced,
      apkUrl: a.apkUrl,
      sha256: a.sha256,
      testflightUrl: '',
    };
  }

  const i = manifest.ios;
  if (!isOutdatedBuild(installedBuild, i.latestBuild) || !i.testflightUrl) return null;
  return {
    kind: 'ios',
    latestLabel: String(i.latestBuild),
    latestCode: i.latestBuild,
    sizeBytes: 0,
    notes: '',
    dismissKey: `ios:${i.latestBuild}`,
    forced,
    apkUrl: '',
    sha256: '',
    testflightUrl: i.testflightUrl,
  };
}

/** 닫기 기억 반영: 강제 업데이트는 닫기 기억을 무시한다. */
export function isDismissed(decision: UpdateDecision, storedKey: string | null): boolean {
  return !decision.forced && storedKey === decision.dismissKey;
}

/** 배너를 띄워도 되는 홈 경로. 클래스 입장·플레이어·측정 화면에서는 띄우지 않는다. */
export function isUpdateHomePath(pathname: string): boolean {
  return ['/app', '/dashboard', '/dashboard/org'].includes(pathname.replace(/\/+$/, '') || '/');
}

/** 매니페스트 조회 — 캐시 우회. 실패 시 null. */
export async function fetchUpdateManifest(
  baseUrl: string = UPDATE_SITE_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateManifest | null> {
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/latest.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return parseUpdateManifest(await res.json());
  } catch {
    return null;
  }
}
