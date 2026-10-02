// SDD-101 C3 — multipart 청크 업로드 timeout·재시도 공용 헬퍼
// 4xx(400/413/409 등)는 재시도해도 동일하므로 즉시 throw, 5xx/타임아웃만 재시도한다.

import { ApiError, tokenStorage } from './client';

const UPLOAD_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseError(res: Response): Promise<ApiError> {
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // ignore
  }
  const msg =
    data && typeof data === 'object' && 'detail' in data && typeof (data as { detail: unknown }).detail === 'string'
      ? (data as { detail: string }).detail
      : `청크 업로드 실패 (${res.status})`;
  return new ApiError(res.status, msg, data);
}

function isRetryable(err: unknown): boolean {
  if (err instanceof ApiError) return err.status >= 500;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  return false;
}

export async function uploadFormWithRetry<T>(url: string, formData: FormData): Promise<T> {
  const token = tokenStorage.getAccess();
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
        signal: controller.signal,
      });
      if (!res.ok) throw await parseError(res);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS - 1 && isRetryable(err)) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}
