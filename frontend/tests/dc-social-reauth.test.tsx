// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ExportDialog } from '../src/components/data-center/export-dialog';
import { exportApi } from '../src/lib/api/data-center-export';
import { useAuthStore } from '../src/stores/authStore';
import preview from '../../specs/sdd-243-platform-data-center/contracts/fixtures/export-preview.json';
import status from '../../specs/sdd-243-platform-data-center/contracts/fixtures/export-status.json';

vi.mock('../src/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/client')>()),
  apiClient: { get: vi.fn(), post: vi.fn() },
}));
const reauthForDataExport = vi.fn();
vi.mock('../src/lib/api/account', () => ({ reauthForDataExport: (p: unknown) => reauthForDataExport(p) }));
const googleLogin = vi.fn();
vi.mock('@react-oauth/google', () => ({
  useGoogleLogin: (opts: { onSuccess: (r: { access_token: string }) => void }) => () => {
    googleLogin();
    opts.onSuccess({ access_token: 'g-access' });
  },
}));
const native = { isNativeApp: vi.fn(() => false), platform: 'web' };
vi.mock('../src/lib/native/platform', () => ({ isNativeApp: () => native.isNativeApp(), getPlatform: () => native.platform }));
vi.mock('../src/lib/native/google', () => ({ nativeGoogleIdToken: vi.fn().mockResolvedValue('g-id-token') }));
vi.mock('../src/lib/native/apple', () => ({
  isAppleLoginAvailable: () => native.platform === 'ios',
  nativeAppleCredential: vi.fn().mockResolvedValue({ idToken: 'a-id', nonce: 'n1' }),
}));
vi.mock('../src/lib/api/auth', () => ({
  apiErrorCode: () => null,
  requestAppleChallenge: vi.fn().mockResolvedValue({ nonce: 'n1' }),
}));

let host: HTMLDivElement;
let root: Root;
const setProvider = (auth_provider: string) =>
  useAuthStore.setState({ user: { auth_provider } as never });

async function openToReauth(client: typeof exportApi) {
  await act(async () => {
    root.render(<ExportDialog target={{ scope: 'session', targetId: 's', label: '1회차' }} client={client} onClose={() => {}} />);
  });
  const dialog = document.querySelector('[role=dialog]')!;
  const input = (el: HTMLTextAreaElement, v: string) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  await act(async () => input(dialog.querySelector('textarea')!, '운영 확인'));
  const button = (t: string) => Array.from(dialog.querySelectorAll('button')).find((x) => x.textContent === t);
  await act(async () => button('범위 미리보기')!.click());
  await act(async () => {
    Array.from(dialog.querySelectorAll('input[type=checkbox]')).find((x) => x.parentElement?.textContent?.includes('제외 범위를'))?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  return { dialog, button };
}

const mkClient = () => ({
  ...exportApi,
  preview: vi.fn().mockResolvedValue({ ...preview, expires_at: '2099-01-01T00:00:00Z' }),
  reauth: vi.fn().mockResolvedValue({ proof: 'server-proof', expires_at: '2099-01-01T00:00:00Z' }),
  create: vi.fn().mockResolvedValue(status),
});

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  reauthForDataExport.mockReset().mockResolvedValue({ reauth_proof: 'sp-1', expires_in: 300 });
  native.isNativeApp.mockReturnValue(false);
  native.platform = 'web';
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useAuthStore.setState({ user: null });
});

describe('데이터 센터 소셜 재인증', () => {
  it('이메일 계정은 로그인 비밀번호 입력, SSO 문구 없음', async () => {
    setProvider('email');
    const { dialog } = await openToReauth(mkClient());
    expect(dialog.textContent).toContain('로그인 비밀번호');
    expect(dialog.textContent).not.toContain('SSO');
    expect(dialog.querySelector('input[type=password]')).not.toBeNull();
  });

  it('구글(웹): 버튼 → data_export proof → export-reauth social_proof', async () => {
    setProvider('google');
    const client = mkClient();
    const { dialog, button } = await openToReauth(client);
    expect(dialog.querySelector('input[type=password]')).toBeNull();
    expect(dialog.textContent).not.toContain('SSO');
    await act(async () => button('Google로 본인 확인')!.click());
    expect(reauthForDataExport).toHaveBeenCalledWith({ provider: 'google', access_token: 'g-access' });
    expect(client.reauth).toHaveBeenCalledWith({ social_proof: 'sp-1', request_hash: preview.request_hash, scope_org_id: undefined }, undefined);
    expect(button('다운로드 작업 생성')!.disabled).toBe(false);
  });

  it('구글(네이티브): id_token 경로', async () => {
    setProvider('google');
    native.isNativeApp.mockReturnValue(true);
    const { button } = await openToReauth(mkClient());
    await act(async () => button('Google로 본인 확인')!.click());
    expect(googleLogin).not.toHaveBeenCalled();
    expect(reauthForDataExport).toHaveBeenCalledWith({ provider: 'google', id_token: 'g-id-token' });
  });

  it('애플(iOS 앱): 챌린지 nonce + id_token', async () => {
    setProvider('apple');
    native.platform = 'ios';
    native.isNativeApp.mockReturnValue(true);
    const client = mkClient();
    const { button } = await openToReauth(client);
    await act(async () => button('Apple로 본인 확인')!.click());
    expect(reauthForDataExport).toHaveBeenCalledWith({ provider: 'apple', id_token: 'a-id', nonce: 'n1' });
    expect(client.reauth).toHaveBeenCalledWith(expect.objectContaining({ social_proof: 'sp-1' }), undefined);
  });

  it('애플(웹): 미지원 안내', async () => {
    setProvider('apple');
    const { dialog } = await openToReauth(mkClient());
    expect(dialog.textContent).toContain('Apple 본인 확인을 할 수 없어요');
  });
});
