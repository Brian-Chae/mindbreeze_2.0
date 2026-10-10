// API 기본 클라이언트: Bearer 토큰 자동 첨부 + 401 시 refresh 재시도 1회
// access token은 메모리에만 보관(XSS 탈취 방지), refresh token은 httpOnly cookie로 관리

import { loginPathForRole } from '../auth-routing';
import type { UserRole } from './auth';
import { Capacitor } from '@capacitor/core';

// 네이티브 앱(Capacitor)은 앱 오리진(https://localhost)이 API와 달라 SameSite=Lax 쿠키가 전송되지 않는다.
// 그래서 앱에서만 서버가 응답 헤더로 주는 refresh token 을 로컬에 보관하고, refresh/logout 때 본문으로 보낸다.
const NATIVE_HEADER = 'X-MB-Native';
const NATIVE_REFRESH_RESPONSE_HEADER = 'X-MB-Refresh-Token';
const NATIVE_REFRESH_KEY = 'mb_native_refresh';
const isNativeClient = (): boolean => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
};
const nativeHeaders = (): Record<string, string> => (isNativeClient() ? { [NATIVE_HEADER]: 'capacitor' } : {});
function captureNativeRefresh(res: Response): void {
  if (!isNativeClient()) return;
  const next = res.headers.get(NATIVE_REFRESH_RESPONSE_HEADER);
  if (next) {
    try { localStorage.setItem(NATIVE_REFRESH_KEY, next); } catch { /* 저장 실패는 무시 */ }
  }
}
export function getNativeRefreshBody(): { refresh_token: string } | undefined {
  if (!isNativeClient()) return undefined;
  try {
    const t = localStorage.getItem(NATIVE_REFRESH_KEY);
    return t ? { refresh_token: t } : undefined;
  } catch { return undefined; }
}
export function clearNativeRefresh(): void {
  try { localStorage.removeItem(NATIVE_REFRESH_KEY); } catch { /* 무시 */ }
}

export const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000/api/v1';

// SEC-04: 401 리다이렉트는 하드코딩 '/login' 대신 역할별 로그인 경로를 쓴다.
// authStore 와의 순환 import 를 피하기 위해 persist 된 사용자(mb_user)에서 역할만 읽는다.
const PERSISTED_USER_KEY = 'mb_user';

function loginRedirectPath(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(PERSISTED_USER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { role?: UserRole };
        if (parsed?.role) return loginPathForRole(parsed.role);
      }
    }
  } catch {
    /* 손상된 저장값은 무시하고 기본 로그인 화면으로 이동한다 */
  }
  return '/login';
}

// access token은 localStorage가 아닌 모듈 메모리에만 보관한다.
// 페이지 새로고침 시 소멸하고, refresh(httpOnly cookie)로 자동 복구된다.
let accessToken: string | null = null;

/** access token 변경 구독자 — 단일 저장소의 변경을 외부 상태(authStore)로 동기화한다. */
type AccessTokenListener = (token: string | null) => void;
const accessTokenListeners = new Set<AccessTokenListener>();

function setAccessToken(next: string | null): void {
  accessToken = next;
  // API7-03: tokenStorage 를 access token 의 단일 소스로 두고, 변경을 구독자에게 전파한다.
  // (authStore.accessToken 미러가 401 자동 갱신을 놓쳐 소켓이 만료 토큰을 들고 있던 문제 해소)
  for (const listener of accessTokenListeners) {
    try {
      listener(next);
    } catch {
      // 구독자 오류가 토큰 저장/전파를 막아서는 안 된다.
    }
  }
}

export const tokenStorage = {
  getAccess: (): string | null => accessToken,
  set: (access: string): void => setAccessToken(access),
  clear: (): void => setAccessToken(null),
  /** access token 변경 구독(해제 함수 반환). */
  subscribe: (listener: AccessTokenListener): (() => void) => {
    accessTokenListeners.add(listener);
    return () => {
      accessTokenListeners.delete(listener);
    };
  },
};

/** 토큰/영속 사용자 정리 후 역할별 로그인 화면으로 보낸다(순환 import 회피용 커스텀 이벤트 사용). */
function terminateSession(): void {
  // 리다이렉트 경로는 persist 된 사용자(mb_user)에서 읽으므로 지우기 전에 계산한다.
  const redirectPath = loginRedirectPath();
  tokenStorage.clear();
  clearNativeRefresh();
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(PERSISTED_USER_KEY);
  } catch {
    /* 손상된 저장값은 무시한다 */
  }
  if (typeof window !== 'undefined') {
    // authStore 가 구독해 user/isAuthenticated 를 초기화한다.
    window.dispatchEvent(new CustomEvent('mb:session-expired'));
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = redirectPath;
    }
  }
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, message: string, data: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  skipAuth?: boolean;
  headers?: Record<string, string>;
  responseType?: 'json' | 'blob';
}

// SEC-06: FormData는 브라우저가 boundary 포함 Content-Type을 자동 설정하므로
// JSON 직렬화·Content-Type 수동 지정을 하지 않는다.
const isFormDataBody = (value: unknown): value is FormData =>
  typeof FormData !== 'undefined' && value instanceof FormData;

// 요청 타임아웃(API7-02). 네트워크/서버가 응답을 주지 않으면 fetch 가 영구 pending 되어
// 앱 전체가 고착된다. AbortController 로 요청을 중단해 상한을 둔다.
const REQUEST_TIMEOUT_MS = 15_000;
// blob(PDF 등) 다운로드는 생성·전송에 시간이 걸릴 수 있어 여유를 둔다.
const BLOB_TIMEOUT_MS = 60_000;

/** AbortController 기반 타임아웃 signal 을 만든다. 사용 후 반드시 clear() 로 타이머를 해제한다. */
function createTimeoutSignal(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

/** abort(타임아웃) 로 인한 오류인지 판별한다. */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

/**
 * refresh 실패 원인(API7-01). 실패를 한 덩어리로 뭉뚱그리지 않고 구분한다.
 * - invalid: refresh 토큰 자체가 만료/폐기됨(4xx) → 세션을 폐기해야 하는 유일한 경우
 * - network: 네트워크 단절·타임아웃 → 세션 유지, 재시도 대상
 * - server: 서버 5xx·비정상 응답 → 세션 유지, 재시도 대상
 */
export type RefreshFailureReason = 'invalid' | 'network' | 'server';

export type RefreshResult =
  | { ok: true; token: string; reason: null }
  | { ok: false; token: null; reason: RefreshFailureReason };

// 단일 비행(single-flight): 동시 refresh 요청을 하나로 병합한다.
// 페이지 새로고침 시 initialize()의 refresh와 여러 데이터 fetch의 401 재시도가
// 같은 refresh token으로 동시에 /auth/refresh 를 호출하면, 백엔드의 refresh 토큰
// 회전 + 재사용 감지가 "탈취"로 오판해 사용자 전체 토큰을 폐기 → 강제 로그아웃된다.
// in-flight promise 를 공유해 동시 호출을 1건으로 줄인다.
let refreshPromise: Promise<RefreshResult> | null = null;

/** refresh 를 실행하고 성공/실패 원인을 판별해 반환한다. */
export function refreshAccessTokenResult(): Promise<RefreshResult> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async (): Promise<RefreshResult> => {
    // refresh token은 httpOnly cookie로 자동 전송된다 (credentials: include)
    const { signal, clear } = createTimeoutSignal(REQUEST_TIMEOUT_MS);
    try {
      const nativeBody = getNativeRefreshBody();
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { ...nativeHeaders(), ...(nativeBody ? { 'Content-Type': 'application/json' } : {}) },
        body: nativeBody ? JSON.stringify(nativeBody) : undefined,
        credentials: 'include',
        signal,
      });
      if (res.ok) {
        captureNativeRefresh(res);
        const data = (await res.json()) as { access_token?: string };
        if (!data?.access_token) {
          // 200 이지만 토큰이 없는 비정상 응답 → 세션 폐기 대상이 아니다.
          return { ok: false, token: null, reason: 'server' };
        }
        tokenStorage.set(data.access_token);
        return { ok: true, token: data.access_token, reason: null };
      }
      // 4xx: refresh 토큰이 실제로 만료/폐기됨 → 세션 폐기가 맞다.
      if (res.status >= 400 && res.status < 500) {
        clearNativeRefresh();
        return { ok: false, token: null, reason: 'invalid' };
      }
      // 5xx: 서버 일시 장애 → 세션 유지
      return { ok: false, token: null, reason: 'server' };
    } catch {
      // 네트워크 오류·타임아웃(AbortError) → 세션 유지
      return { ok: false, token: null, reason: 'network' };
    } finally {
      clear();
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

/**
 * 하위 호환 래퍼: 토큰 또는 null 만 필요한 기존 호출부(socket/session/checkin)용.
 * 판별 결과가 필요하면 refreshAccessTokenResult() 를 쓴다.
 */
export async function refreshAccessToken(): Promise<string | null> {
  const result = await refreshAccessTokenResult();
  return result.ok ? result.token : null;
}

/**
 * FastAPI 오류 응답의 detail 을 사용자 문구로 변환한다.
 * - detail 이 문자열이면 그대로 사용
 * - 단일 객체({ msg, type } 등)면 loc/msg 를 조합
 * - 422 검증 오류처럼 객체 배열이면 각 항목의 loc(필드 경로)와 msg(사유)를 조합
 */
export function formatErrorDetail(detail: unknown): string | null {
  if (typeof detail === 'string' && detail.trim()) return detail;

  const formatItem = (item: unknown): string | null => {
    if (typeof item === 'string') return item.trim() || null;
    if (!item || typeof item !== 'object') return null;
    const { loc, msg } = item as { loc?: unknown; msg?: unknown };
    const field = Array.isArray(loc)
      ? loc
          .filter((segment) => typeof segment === 'string' || typeof segment === 'number')
          .map((segment) => String(segment))
          .filter((segment) => segment !== 'body' && segment !== 'query' && segment !== 'path')
          .join('.')
      : '';
    const message = typeof msg === 'string' ? msg.trim() : '';
    if (field && message) return `${field}: ${message}`;
    if (message) return message;
    if (field) return field;
    return null;
  };

  if (Array.isArray(detail)) {
    const parts = detail
      .map(formatItem)
      .filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join(' / ') : null;
  }

  // API7-10: 단일 객체 detail({ msg, type } 등)도 파싱한다.
  // FastAPI 는 검증 오류를 배열로 주지만, 커스텀 핸들러는 단일 객체로 줄 수 있다.
  if (detail && typeof detail === 'object') return formatItem(detail);

  return null;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, skipAuth = false, headers = {} } = options;

  const buildHeaders = (token: string | null): Record<string, string> => {
    const h: Record<string, string> = { ...headers, ...nativeHeaders() };
    if (body !== undefined && !isFormDataBody(body)) h['Content-Type'] = 'application/json';
    if (!skipAuth && token) h.Authorization = `Bearer ${token}`;
    return h;
  };

  const doFetch = async (token: string | null): Promise<Response> => {
    // API7-02: 응답이 오지 않으면 상한 시간 후 요청을 중단한다.
    const { signal, clear } = createTimeoutSignal(
      options.responseType === 'blob' ? BLOB_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
    );
    try {
      const response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: buildHeaders(token),
        body: body !== undefined ? (isFormDataBody(body) ? body : JSON.stringify(body)) : undefined,
        credentials: 'include',
        signal,
      });
      captureNativeRefresh(response);
      return response;
    } catch (error) {
      if (isAbortError(error)) {
        throw new ApiError(408, '요청 시간이 초과되었습니다. 네트워크 상태를 확인한 후 다시 시도해 주세요.', null);
      }
      throw error;
    } finally {
      clear();
    }
  };

  let token = tokenStorage.getAccess();
  let res = await doFetch(token);

  // 401 → refresh 재시도 1회
  if (res.status === 401 && !skipAuth) {
    const refresh = await refreshAccessTokenResult();
    if (refresh.ok) {
      token = refresh.token;
      res = await doFetch(token);
      // API7-05: 갱신 후 재시도도 401이면 세션이 실제로 무효다.
      // 초기 401(무효 refresh) 경로와 동일하게 정리·로그인 이동을 수행해야
      // '인증됨' 상태로 남아 401만 반복되는 상태에 빠지지 않는다.
      if (res.status === 401) {
        terminateSession();
        throw new ApiError(401, '인증이 만료되었습니다.', null);
      }
    } else if (refresh.reason === 'invalid') {
      // refresh 토큰이 실제로 만료/폐기된 경우에만 세션을 폐기하고 로그인 화면으로 보낸다.
      terminateSession();
      throw new ApiError(401, '인증이 만료되었습니다.', null);
    } else {
      // API7-01: 네트워크/서버 오류는 세션 만료가 아니다.
      // 토큰을 폐기하거나 로그인 화면으로 쫓아내지 않고, 재시도 가능한 오류로 알린다.
      throw new ApiError(
        503,
        refresh.reason === 'server'
          ? '서버가 일시적으로 응답하지 않아 인증을 갱신하지 못했습니다. 잠시 후 다시 시도해 주세요.'
          : '네트워크 연결이 불안정해 인증을 갱신하지 못했습니다. 연결을 확인한 후 다시 시도해 주세요.',
        null,
      );
    }
  }

  if (!res.ok) {
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // ignore
    }
    const payload = data && typeof data === 'object' ? (data as { detail?: unknown }) : null;
    const message = formatErrorDetail(payload?.detail) ?? `API 요청 실패 (${res.status})`;
    throw new ApiError(res.status, message, data);
  }

  if (res.status === 204) return undefined as T;
  if (options.responseType === 'blob') {
    if (!res.headers.get('content-type')?.toLowerCase().startsWith('application/pdf')) {
      throw new ApiError(502, 'PDF 파일을 받지 못했습니다. 다시 시도해 주세요.', null);
    }
    return (await res.blob()) as T;
  }
  return (await res.json()) as T;
}

export const apiClient = {
  getBlob: (path: string, options?: Omit<RequestOptions, 'method' | 'body' | 'responseType'>): Promise<Blob> =>
    request<Blob>(path, { ...options, method: 'GET', responseType: 'blob' }),
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    request<T>(path, { ...options, method: 'POST', body }),
  // SEC-06: multipart/form-data 업로드 전용 — 토큰·401 refresh·에러 포맷을 post와 동일하게 재사용한다.
  postForm: <T>(path: string, formData: FormData, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    request<T>(path, { ...options, method: 'POST', body: formData }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method'>): Promise<T> =>
    request<T>(path, { ...options, method: 'DELETE' }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    request<T>(path, { ...options, method: 'PATCH', body }),
};
