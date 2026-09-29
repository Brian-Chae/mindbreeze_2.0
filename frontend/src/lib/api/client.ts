// API 기본 클라이언트: Bearer 토큰 자동 첨부 + 401 시 refresh 재시도 1회
// access token은 메모리에만 보관(XSS 탈취 방지), refresh token은 httpOnly cookie로 관리

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000/api/v1';

// access token은 localStorage가 아닌 모듈 메모리에만 보관한다.
// 페이지 새로고침 시 소멸하고, refresh(httpOnly cookie)로 자동 복구된다.
let accessToken: string | null = null;

export const tokenStorage = {
  getAccess: (): string | null => accessToken,
  set: (access: string): void => {
    accessToken = access;
  },
  clear: (): void => {
    accessToken = null;
  },
};

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

export async function refreshAccessToken(): Promise<string | null> {
  // refresh token은 httpOnly cookie로 자동 전송된다 (credentials: include)
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token: string };
    tokenStorage.set(data.access_token);
    return data.access_token;
  } catch {
    return null;
  }
}

/**
 * FastAPI 오류 응답의 detail 을 사용자 문구로 변환한다.
 * - detail 이 문자열이면 그대로 사용
 * - 422 검증 오류처럼 객체 배열이면 각 항목의 loc(필드 경로)와 msg(사유)를 조합
 */
export function formatErrorDetail(detail: unknown): string | null {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (!Array.isArray(detail)) return null;

  const parts: string[] = [];
  for (const item of detail) {
    if (typeof item === 'string') {
      if (item.trim()) parts.push(item.trim());
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const { loc, msg } = item as { loc?: unknown; msg?: unknown };
    const field = Array.isArray(loc)
      ? loc
          .filter((segment) => typeof segment === 'string' || typeof segment === 'number')
          .map((segment) => String(segment))
          .filter((segment) => segment !== 'body' && segment !== 'query' && segment !== 'path')
          .join('.')
      : '';
    const message = typeof msg === 'string' ? msg.trim() : '';
    if (field && message) parts.push(`${field}: ${message}`);
    else if (message) parts.push(message);
    else if (field) parts.push(field);
  }
  return parts.length > 0 ? parts.join(' / ') : null;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, skipAuth = false, headers = {} } = options;

  const buildHeaders = (token: string | null): Record<string, string> => {
    const h: Record<string, string> = { ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (!skipAuth && token) h.Authorization = `Bearer ${token}`;
    return h;
  };

  const doFetch = async (token: string | null): Promise<Response> => {
    return fetch(`${BASE_URL}${path}`, {
      method,
      headers: buildHeaders(token),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'include',
    });
  };

  let token = tokenStorage.getAccess();
  let res = await doFetch(token);

  // 401 → refresh 재시도 1회
  if (res.status === 401 && !skipAuth) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      token = newToken;
      res = await doFetch(token);
    } else {
      // refresh 실패 → 토큰 클리어 + 로그인 페이지로 강제 이동
      tokenStorage.clear();
      window.location.href = '/login';
      throw new ApiError(401, '인증이 만료되었습니다.', null);
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
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method'>): Promise<T> =>
    request<T>(path, { ...options, method: 'DELETE' }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    request<T>(path, { ...options, method: 'PATCH', body }),
};
