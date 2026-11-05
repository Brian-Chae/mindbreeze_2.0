// SDD-305 B — Android 앱의 인증 갱신 단일 창구(웹 쪽).
// 앱(Android, 인증 조정자 지원 빌드)에서는 refresh 토큰을 native 조정자만 쥔다. WebView 의 모든 갱신 진입점
// (초기화·401·소켓·refreshAuth)은 이 모듈의 ensureAccess 를 거치고, 결과는 access 와 세대(generation)뿐이다.
// refresh 토큰은 이 모듈이 돌려주지도 로그로 남기지도 않는다. 일반 웹(브라우저)·iOS·구 APK 는 기존 경로(쿠키/localStorage)를 그대로 쓴다.
import { Capacitor } from '@capacitor/core';
import { getMeasurementPlugin } from './plugin';

export type NativeAccessResult =
  | { status: 'ok'; accessToken: string; generation: number }
  | { status: 'no_credentials' | 'invalid' | 'transient' | 'account_mismatch' };

interface AuthCapablePlugin {
  getCapabilities(): Promise<{ authCoordinator?: number }>;
  ensureAccess?(req: { apiBase: string; forceRefresh: boolean; observedGeneration?: number; accountId?: string }): Promise<Record<string, unknown>>;
  handoffCredentials?(req: { accessToken: string; refreshToken: string }): Promise<Record<string, unknown>>;
  signOutNative?(req: { apiBase?: string }): Promise<Record<string, unknown>>;
}

let ready = false;
let detection: Promise<boolean> | null = null;
let lastGeneration: number | null = null;
/** 진행 중인 인계(로그인 직후 등). ensureAccess 는 이것이 끝난 뒤 실행해 오래된 저장소를 읽지 않는다. */
let pendingAdopt: Promise<unknown> = Promise.resolve();

const isAndroidNative = (): boolean => {
  try { return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'; } catch { return false; }
};

const plugin = (): AuthCapablePlugin => getMeasurementPlugin() as unknown as AuthCapablePlugin;

/** 기능 탐지: 인증 조정자를 가진 APK 인가. 구 APK(capability 없음/호출 실패)는 false → 기존 경로. */
export function detectNativeAuth(): Promise<boolean> {
  if (detection) return detection;
  detection = (async () => {
    if (!isAndroidNative()) return false;
    try {
      const caps = await plugin().getCapabilities();
      ready = Number(caps?.authCoordinator) >= 1;
    } catch {
      ready = false;
    }
    return ready;
  })();
  return detection;
}

/** 동기 판정(탐지가 끝난 뒤에만 true). 아직 모르면 false = 기존 경로. */
export const isNativeAuthReady = (): boolean => ready;

/** 마지막으로 받은 세대. 401 을 받은 호출자가 observedGeneration 으로 넘긴다. */
export const getNativeAuthGeneration = (): number | null => lastGeneration;

function parse(r: Record<string, unknown> | null | undefined): NativeAccessResult | null {
  const status = r?.status;
  if (status === 'ok' && typeof r?.accessToken === 'string' && r.accessToken) {
    const generation = Number(r.generation);
    if (Number.isFinite(generation)) lastGeneration = generation;
    return { status: 'ok', accessToken: r.accessToken, generation };
  }
  if (status === 'no_credentials' || status === 'invalid' || status === 'transient' || status === 'account_mismatch') return { status };
  return null;
}

/** native 조정자에게 access 를 요청한다. 사용 불가/오류면 null(호출자는 기존 경로로 폴백). */
export async function nativeEnsureAccess(req: {
  apiBase: string; forceRefresh: boolean; observedGeneration?: number | null; accountId?: string;
}): Promise<NativeAccessResult | null> {
  if (!(await detectNativeAuth())) return null;
  const p = plugin();
  if (!p.ensureAccess) return null;
  await pendingAdopt.catch(() => undefined);
  try {
    const out = await p.ensureAccess({
      apiBase: req.apiBase, forceRefresh: req.forceRefresh,
      ...(req.observedGeneration != null ? { observedGeneration: req.observedGeneration } : {}),
      ...(req.accountId ? { accountId: req.accountId } : {}),
    });
    return parse(out);
  } catch {
    return null;
  }
}

/**
 * JS 가 가진 자격증명을 native 조정자에 넘긴다. native 가 같은 계정의 더 새로운 쌍을 이미 갖고 있으면 무시한다(뒤로 가지 않음).
 * 성공(저장 확인)하면 true — 호출자는 그때 JS 의 refresh 복사본을 지운다.
 */
export async function nativeAdopt(accessToken: string | null, refreshToken: string | null): Promise<boolean> {
  if (!(await detectNativeAuth())) return false;
  const p = plugin();
  if (!p.handoffCredentials || (!accessToken && !refreshToken)) return false;
  const run = (async (): Promise<boolean> => {
    try {
      const out = await p.handoffCredentials!({ accessToken: accessToken ?? '', refreshToken: refreshToken ?? '' });
      if (typeof out?.generation === 'number') lastGeneration = out.generation;
      return Boolean(out?.handoff);
    } catch {
      return false;
    }
  })();
  pendingAdopt = run;
  return run;
}

/** 로그아웃·계정 전환: native 의 진행 중 갱신을 무효화하고 저장소를 비운다. 서버 폐기는 native 가 best-effort 로 한다. */
export async function nativeSignOut(apiBase?: string): Promise<void> {
  if (!(await detectNativeAuth())) return;
  try {
    await plugin().signOutNative?.({ ...(apiBase ? { apiBase } : {}) });
  } catch { /* 로컬 로그아웃을 막지 않는다 */ }
  lastGeneration = null;
  pendingAdopt = Promise.resolve();
}

export function resetNativeAuthForTests(): void {
  ready = false; detection = null; lastGeneration = null; pendingAdopt = Promise.resolve();
}
