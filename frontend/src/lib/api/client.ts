// API 기본 클라이언트: Bearer 토큰 자동 첨부 + 401 시 refresh 재시도 1회

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000/api/v1';

const TOKEN_KEY = 'mb_access_token';
const REFRESH_KEY = 'mb_refresh_token';

export const tokenStorage = {
  getAccess: (): string | null => localStorage.getItem(TOKEN_KEY),
  getRefresh: (): string | null => localStorage.getItem(REFRESH_KEY),
  set: (access: string, refresh?: string): void => {
    localStorage.setItem(TOKEN_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear: (): void => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
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
}

async function refreshAccessToken(): Promise<string | null> {
  const refresh = tokenStorage.getRefresh();
  if (!refresh) return null;
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token: string; refresh_token?: string };
    tokenStorage.set(data.access_token, data.refresh_token);
    return data.access_token;
  } catch {
    return null;
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, skipAuth = false, headers = {} } = options;

  const buildHeaders = (token: string | null): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json', ...headers };
    if (!skipAuth && token) h.Authorization = `Bearer ${token}`;
    return h;
  };

  const doFetch = async (token: string | null): Promise<Response> => {
    return fetch(`${BASE_URL}${path}`, {
      method,
      headers: buildHeaders(token),
      body: body !== undefined ? JSON.stringify(body) : undefined,
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
    const message =
      (data && typeof data === 'object' && 'detail' in data && typeof (data as { detail: unknown }).detail === 'string'
        ? (data as { detail: string }).detail
        : null) ?? `API 요청 실패 (${res.status})`;
    throw new ApiError(res.status, message, data);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const apiClient = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    request<T>(path, { ...options, method: 'DELETE' }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    request<T>(path, { ...options, method: 'PATCH', body }),
};
