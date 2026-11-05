// @vitest-environment jsdom
// SDD-305 B5~B8: 앱(Android) 갱신 진입점이 native 인증 조정자를 거치고, 일반 웹/구 APK 는 기존 경로를 유지한다.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  native: true,
  platform: 'android',
  caps: { authCoordinator: 1 } as Record<string, unknown> | Error,
  ensure: vi.fn(),
  adopt: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => h.native, getPlatform: () => h.platform },
  registerPlugin: () => ({
    getCapabilities: async () => { if (h.caps instanceof Error) throw h.caps; return h.caps; },
    ensureAccess: (...a: unknown[]) => h.ensure(...a),
    handoffCredentials: (...a: unknown[]) => h.adopt(...a),
    signOutNative: (...a: unknown[]) => h.signOut(...a),
  }),
}));
vi.mock('../src/lib/feature-flags', () => ({ isLiveProtocolV2Enabled: () => false }));

const jwt = (sub: string) => `h.${btoa(JSON.stringify({ sub, exp: 9999999999 }))}.s`;

async function load() {
  vi.resetModules();
  const auth = await import('../src/lib/native-auth');
  auth.resetNativeAuthForTests();
  const client = await import('../src/lib/api/client');
  await auth.detectNativeAuth();
  return { auth, client };
}

describe('SDD-305 native 인증 bridge', () => {
  beforeEach(() => {
    h.native = true; h.platform = 'android'; h.caps = { authCoordinator: 1 };
    h.ensure.mockReset(); h.adopt.mockReset(); h.signOut.mockReset();
    h.adopt.mockResolvedValue({ handoff: true, adopted: true, generation: 1 });
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch must not be called'); }));
  });

  it('B5: 앱에서 refreshAccessTokenResult 는 HTTP fetch 없이 native ensureAccess 만 호출한다', async () => {
    h.ensure.mockResolvedValue({ status: 'ok', accessToken: jwt('u1'), generation: 3 });
    const { client } = await load();
    const r = await client.refreshAccessTokenResult();
    expect(r).toMatchObject({ ok: true });
    expect(h.ensure).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(client.tokenStorage.getAccess()).toBe(jwt('u1'));
    expect(client.getNativeRefreshBody()).toBeUndefined(); // refresh 복사본은 JS 가 쥐지 않는다
  });

  it('B5: 동시 갱신 호출은 native 로 한 번만 나간다(single-flight)', async () => {
    h.ensure.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 30)); return { status: 'ok', accessToken: jwt('u1'), generation: 1 }; });
    const { client } = await load();
    await Promise.all([client.refreshAccessTokenResult(), client.refreshAccessTokenResult(), client.refreshAccessToken()]);
    expect(h.ensure).toHaveBeenCalledTimes(1);
  });

  it('B5: 두 번째 갱신은 직전 세대를 observedGeneration 으로 넘겨 강제 갱신을 요청한다', async () => {
    h.ensure.mockResolvedValue({ status: 'ok', accessToken: jwt('u1'), generation: 7 });
    const { client } = await load();
    await client.refreshAccessTokenResult();
    await client.refreshAccessTokenResult();
    expect(h.ensure.mock.calls[1][0]).toMatchObject({ forceRefresh: true, observedGeneration: 7 });
  });

  it('native invalid → reason invalid(세션 폐기), transient → network(세션 유지)', async () => {
    const { client } = await load();
    h.ensure.mockResolvedValueOnce({ status: 'invalid' });
    expect(await client.refreshAccessTokenResult()).toMatchObject({ ok: false, reason: 'invalid' });
    h.ensure.mockResolvedValueOnce({ status: 'transient' });
    expect(await client.refreshAccessTokenResult()).toMatchObject({ ok: false, reason: 'network' });
  });

  it('구 빌드가 localStorage 에 남긴 refresh 는 native 가 비어 있을 때만 1회 이관하고 JS 복사본을 지운다', async () => {
    localStorage.setItem('mb_native_refresh', 'legacy-rt');
    h.ensure
      .mockResolvedValueOnce({ status: 'no_credentials' })
      .mockResolvedValueOnce({ status: 'ok', accessToken: jwt('u1'), generation: 1 });
    const { client } = await load();
    const r = await client.refreshAccessTokenResult();
    expect(r.ok).toBe(true);
    expect(h.adopt).toHaveBeenCalledTimes(1);
    expect(h.adopt.mock.calls[0][0]).toMatchObject({ refreshToken: 'legacy-rt' });
    expect(localStorage.getItem('mb_native_refresh')).toBeNull();
  });

  it('B7: 구 APK(capability 없음)는 기존 쿠키/localStorage 경로를 그대로 쓴다', async () => {
    h.caps = {};
    localStorage.setItem('mb_native_refresh', 'rt-old');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'at-new' }), { status: 200, headers: { 'X-MB-Refresh-Token': 'rt-new' } })));
    const { client, auth } = await load();
    expect(auth.isNativeAuthReady()).toBe(false);
    const r = await client.refreshAccessTokenResult();
    expect(r).toMatchObject({ ok: true, token: 'at-new' });
    expect(h.ensure).not.toHaveBeenCalled();
    expect(localStorage.getItem('mb_native_refresh')).toBe('rt-new');
  });

  it('B7: capability 조회가 실패해도(구 APK UNIMPLEMENTED) 기존 경로로 폴백한다', async () => {
    h.caps = new Error('UNIMPLEMENTED');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'at' }), { status: 200 })));
    const { client } = await load();
    expect(await client.refreshAccessTokenResult()).toMatchObject({ ok: true });
    expect(h.ensure).not.toHaveBeenCalled();
  });

  it('B6: 일반 웹(브라우저)은 native 를 건드리지 않고 HttpOnly 쿠키 경로 그대로', async () => {
    h.native = false; h.platform = 'web';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'web-at' }), { status: 200 })));
    const { client } = await load();
    expect(await client.refreshAccessTokenResult()).toMatchObject({ ok: true, token: 'web-at' });
    expect(h.ensure).not.toHaveBeenCalled();
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].credentials).toBe('include');
  });

  it('B8: nativeEnsureAccess 결과/오류 어디에도 refresh 토큰 필드가 없다', async () => {
    h.ensure.mockResolvedValue({ status: 'ok', accessToken: jwt('u1'), generation: 2, refreshToken: 'LEAK' });
    const { auth } = await load();
    const r = await auth.nativeEnsureAccess({ apiBase: 'x', forceRefresh: false });
    expect(JSON.stringify(r)).not.toContain('LEAK');
  });

  it('로그아웃: nativeSignOut 이 native signOutNative 를 호출한다', async () => {
    const { auth } = await load();
    await auth.nativeSignOut('http://api');
    expect(h.signOut).toHaveBeenCalledWith({ apiBase: 'http://api' });
  });

  it('진행 중 인계가 끝난 뒤 ensureAccess 가 실행된다(오래된 저장소 읽기 방지)', async () => {
    const order: string[] = [];
    h.adopt.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 30)); order.push('adopt'); return { handoff: true, generation: 1 }; });
    h.ensure.mockImplementation(async () => { order.push('ensure'); return { status: 'ok', accessToken: jwt('u1'), generation: 2 }; });
    const { auth } = await load();
    void auth.nativeAdopt(jwt('u1'), 'rt');
    await auth.nativeEnsureAccess({ apiBase: 'x', forceRefresh: false });
    expect(order).toEqual(['adopt', 'ensure']);
  });
});
