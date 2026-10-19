// @vitest-environment jsdom
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useClientCounselors } from '../src/hooks/use-client-counselors';
import { useAuthStore } from '../src/stores/authStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const get = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/api/client', async (orig) => {
  const actual = await orig<typeof import('../src/lib/api/client')>();
  return { ...actual, apiClient: { ...actual.apiClient, get } };
});

function Probe() { useClientCounselors(); return null; }
let cleanup: (() => void) | undefined;
async function mount() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(createElement(Probe)); });
  cleanup = () => { act(() => root.unmount()); container.remove(); };
}
afterEach(() => { cleanup?.(); cleanup = undefined; get.mockReset(); });

describe('useClientCounselors', () => {
  it('마운트하면 /client/counselors 결과를 authStore 사용자에 채운다', async () => {
    useAuthStore.setState({ user: { id: 'u1', name: '회원', role: 'client', counselors: [] } as never });
    get.mockResolvedValue([{ id: 'c1', name: '김상담', profile_image: null }]);
    await mount();
    expect(get).toHaveBeenCalledWith('/client/counselors');
    expect(useAuthStore.getState().user?.counselors).toEqual([{ id: 'c1', name: '김상담', profile_image: null }]);
  });
  it('조회가 실패하면 기존 값을 건드리지 않는다', async () => {
    const existing = [{ id: 'c9', name: '기존', profile_image: null }];
    useAuthStore.setState({ user: { id: 'u1', name: '회원', role: 'client', counselors: existing } as never });
    get.mockRejectedValue(new Error('x'));
    await mount();
    expect(useAuthStore.getState().user?.counselors).toEqual(existing);
  });
  it('응답이 배열이 아니면 빈 목록으로 처리한다', async () => {
    useAuthStore.setState({ user: { id: 'u1', name: '회원', role: 'client', counselors: [{ id: 'c1', name: 'a', profile_image: null }] } as never });
    get.mockResolvedValue(null);
    await mount();
    expect(useAuthStore.getState().user?.counselors).toEqual([]);
  });
});
