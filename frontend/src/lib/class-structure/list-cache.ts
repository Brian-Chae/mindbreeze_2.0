// 클래스·상담 목록의 마지막 성공 응답을 로컬에 두어 재방문 때 빈 화면 없이 바로 그린다.
// 계정(id·role)별로 분리하고 로그아웃·계정 전환 시 읽지 않는다. 새 응답이 오면 화면과 캐시를 함께 갱신한다.
import { useAuthStore } from '../../stores/authStore';

const PREFIX = 'mb_list_cache:';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_BYTES = 200_000;

interface Entry { at: number; data: unknown }

function keyFor(resource: string): string | null {
  const { user, isAuthenticated } = useAuthStore.getState();
  return isAuthenticated && user ? `${PREFIX}${user.id}:${user.role}:${resource}` : null;
}

export function readListCache<T>(resource: string, now: number = Date.now()): T | null {
  const key = keyFor(resource);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry;
    if (!entry || typeof entry.at !== 'number' || now - entry.at > MAX_AGE_MS || typeof entry.data !== 'object' || entry.data === null) return null;
    return entry.data as T;
  } catch { return null; }
}

export function writeListCache(resource: string, data: unknown, now: number = Date.now()): void {
  const key = keyFor(resource);
  if (!key) return;
  try {
    const raw = JSON.stringify({ at: now, data } satisfies Entry);
    if (raw.length > MAX_BYTES) { localStorage.removeItem(key); return; }
    localStorage.setItem(key, raw);
  } catch { /* 저장 실패(용량·비공개 모드)는 무시한다 */ }
}

export function clearListCache(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch { /* 무시 */ }
}
