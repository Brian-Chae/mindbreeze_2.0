// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '../src/stores/authStore';
import { clearListCache, readListCache, writeListCache } from '../src/lib/class-structure/list-cache';

const login = (id: string, role = 'client') => useAuthStore.setState({ isAuthenticated: true, user: { id, role } as never });

describe('목록 캐시(stale-while-revalidate)', () => {
  beforeEach(() => { localStorage.clear(); login('u1'); });
  it('저장한 값을 같은 계정·리소스에서 읽는다', () => {
    writeListCache('classes:a', { classes: [{ id: 'c1' }], total: 1 });
    expect(readListCache('classes:a')).toEqual({ classes: [{ id: 'c1' }], total: 1 });
  });
  it('다른 계정·다른 리소스·미인증에는 노출하지 않는다', () => {
    writeListCache('classes:a', { total: 1 });
    expect(readListCache('classes:b')).toBeNull();
    login('u2');
    expect(readListCache('classes:a')).toBeNull();
    useAuthStore.setState({ isAuthenticated: false, user: null });
    expect(readListCache('classes:a')).toBeNull();
  });
  it('24시간이 지나면 버리고 로그아웃 정리로 전부 지운다', () => {
    writeListCache('classes:a', { total: 1 }, 1000);
    expect(readListCache('classes:a', 1000 + 24 * 3600 * 1000 + 1)).toBeNull();
    writeListCache('classes:a', { total: 1 });
    clearListCache();
    expect(readListCache('classes:a')).toBeNull();
  });
  it('너무 큰 응답은 저장하지 않는다', () => {
    writeListCache('classes:a', { blob: 'x'.repeat(300_000) });
    expect(readListCache('classes:a')).toBeNull();
  });
});
