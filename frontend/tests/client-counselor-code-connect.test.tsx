// @vitest-environment jsdom
// 회원 '상담사와 연결하기' 코드 입력 → 연결 후 화면 전환·'연결 중' 해제 회귀 테스트
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const post = vi.fn();
const get = vi.fn();
vi.mock('../src/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api/client')>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a) },
  };
});
vi.mock('../src/pages/client/ClientHomePage', () => ({ default: () => <div data-testid="home">HOME</div> }));
vi.mock('../src/components/client/ClientShell', () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock('../src/pages/client/ClientChatPage', () => ({ default: () => <div /> }));
vi.mock('../src/pages/client/ClientSessionListPage', () => ({ default: () => <div /> }));
vi.mock('../src/pages/client/ClientSessionDetailPage', () => ({ default: () => <div /> }));
vi.mock('../src/pages/client/ClientReportListPage', () => ({ default: () => <div /> }));
vi.mock('../src/pages/client/ClientNotificationPage', () => ({ default: () => <div /> }));
vi.mock('../src/pages/settings/ClientSettingsPage', () => ({ default: () => <div /> }));
vi.mock('../src/pages/settings/participation-profile-page', () => ({ default: () => <div /> }));

import ClientAppPage from '../src/pages/client/ClientAppPage';
import { useAuthStore } from '../src/stores/authStore';

const COUNSELOR = { id: 'c1', name: '김상담', profile_image: null };
let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<MemoryRouter initialEntries={['/app']}><ClientAppPage /></MemoryRouter>));
  await flush();
}
async function typeCode(code: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  const input = host!.querySelector('input') as HTMLInputElement;
  await act(async () => {
    setter.call(input, code);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
  await flush();
}

beforeEach(() => {
  post.mockReset();
  get.mockReset();
  useAuthStore.setState({ user: { id: 'u1', name: '회원', role: 'client', counselors: [] } as never });
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('상담사 코드 연결', () => {
  it('inputMode="numeric", pattern="[0-9]*", autoComplete="off" 속성과 안내 문구(6자리 숫자)를 단언한다', async () => {
    get.mockResolvedValueOnce([]);
    await mount();
    const input = host!.querySelector('input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('pattern')).toBe('[0-9]*');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(host!.textContent).toContain('6자리 숫자');
  });

  it('영문·특수문자 등 숫자 외 문자는 제거되어 숫자만 반영된다', async () => {
    get.mockResolvedValueOnce([]);
    await mount();
    const input = host!.querySelector('input') as HTMLInputElement;
    await typeCode('AB12#$34');
    expect(input.value).toBe('1234');
    expect(post).not.toHaveBeenCalled();
  });

  it('POST 가 단건 객체를 돌려줘도 홈으로 전환되고 연결 중이 사라진다', async () => {
    get.mockResolvedValueOnce([]); // 마운트 시 목록
    await mount();
    expect(host!.textContent).toContain('상담사와 연결하기');
    post.mockResolvedValueOnce(COUNSELOR); // 서버: CounselorInfo 단건
    get.mockResolvedValueOnce([COUNSELOR]); // 재조회
    await typeCode('001131');
    expect(host!.querySelector('[data-testid="home"]')).not.toBeNull();
    expect(host!.textContent).not.toContain('연결 중');
    expect(useAuthStore.getState().user?.counselors).toEqual([COUNSELOR]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('409(이미 연결)도 GET 목록으로 홈 전환', async () => {
    get.mockResolvedValueOnce([]);
    await mount();
    post.mockRejectedValueOnce(Object.assign(new Error('이미 연결'), { status: 409 }));
    get.mockResolvedValueOnce([COUNSELOR]);
    await typeCode('001131');
    expect(host!.querySelector('[data-testid="home"]')).not.toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('실패 시 오류 표시·입력 초기화·연결 중 해제', async () => {
    get.mockResolvedValueOnce([]);
    await mount();
    post.mockRejectedValueOnce(Object.assign(new Error('유효하지 않은 상담사 코드입니다'), { status: 404 }));
    await typeCode('999999');
    expect(host!.textContent).toContain('유효하지 않은 상담사 코드입니다');
    expect(host!.textContent).not.toContain('연결 중');
    expect((host!.querySelector('input') as HTMLInputElement).value).toBe('');
  });
});
