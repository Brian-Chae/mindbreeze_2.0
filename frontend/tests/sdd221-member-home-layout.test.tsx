// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { MemberStructureHomePage } from '../src/pages/client/member-structure-home-page';
const mocks = vi.hoisted(() => ({ home: vi.fn() }));
vi.mock('../src/hooks/use-class-structure', () => ({ useMixedHome: mocks.home }));
vi.mock('../src/hooks/use-client-counselors', () => ({ useClientCounselors: vi.fn() }));
vi.mock('../src/components/class/structure/structure-shell', () => ({ StructureShell: ({ children }: { children: React.ReactNode }) => <main className="cs-structure">{children}</main> }));
vi.mock('../src/pages/client/ClientHomePage', () => ({ default: ({ classSections }: { classSections?: React.ReactNode }) => <div className="mh-legacy">{classSections}</div> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
vi.stubGlobal('matchMedia', () => ({ matches: true }));
let clean: () => void;
afterEach(() => clean?.());
async function render(count: number, status = 'success') {
  mocks.home.mockReturnValue({ classes: { status, data: { classes: Array.from({ length: count }, (_, i) => ({ id: `c${i}`, title: `명상 ${i}`, status: 'active', progress: { completed: 1, total: 8 }, next_session: null })), total: count } }, counseling: { status: 'success', data: { relationships: [], total: 0 } }, retry: vi.fn() });
  const el = document.createElement('div'); document.body.append(el); const root = createRoot(el);
  await act(async () => root.render(<MemoryRouter><MemberStructureHomePage /></MemoryRouter>));
  clean = () => { act(() => root.unmount()); el.remove(); };
  return el;
}
it.each([1, 2, 3, 7])('%i개 카드가 공통 격자의 스크롤 줄에 배치된다', async (count) => {
  const el = await render(count);
  expect(el.querySelector('.mh-home')).not.toBeNull();
  expect(el.querySelectorAll('.mh-track > .mc-card')).toHaveLength(Math.min(count, 4));
  if (count > 4) expect(el.querySelector('.mh-classes .mc-link')?.textContent).toBe(`전체 보기 (${count})`);
  expect(el.querySelector('[aria-label="이전 클래스"]')).not.toBeNull();
  expect(el.querySelector('[aria-label="다음 클래스"]')).not.toBeNull();
});
it('키보드 포커스를 받은 카드를 화면 안으로 이동한다', async () => {
  const el = await render(7); const link = el.querySelectorAll<HTMLAnchorElement>('.mh-track a')[3];
  const scroll = vi.fn(); link.closest('article')!.scrollIntoView = scroll;
  await act(async () => link.focus());
  expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'start', behavior: 'instant' });
});
it.each(['loading', 'error', 'success'])('%s 대체 상태도 클래스 정렬 영역을 유지한다', async (status) => {
  const el = await render(0, status);
  expect(el.querySelector('.mh-classes .cs-read-state')).not.toBeNull();
  expect(el.querySelector('.mh-track')).toBeNull();
  expect(el.querySelector('[aria-label="내 상담"]')).toBeNull();
});
it('좌우 버튼은 카드 폭과 간격만큼 이동하고 시작점에서 이전 버튼을 막는다', async () => {
  const el = await render(7);
  const track = el.querySelector<HTMLDivElement>('.mh-track')!;
  Object.defineProperties(track, { scrollWidth: { value: 2060 }, clientWidth: { value: 800 } });
  const scroll = vi.fn(); track.scrollBy = scroll;
  await act(async () => track.dispatchEvent(new Event('scroll')));
  const previous = el.querySelector<HTMLButtonElement>('[aria-label="이전 클래스"]')!;
  const next = el.querySelector<HTMLButtonElement>('[aria-label="다음 클래스"]')!;
  expect(previous.disabled).toBe(true);
  await act(async () => next.click());
  expect(scroll).toHaveBeenLastCalledWith({ left: 296, behavior: 'smooth' });
  track.scrollLeft = 296;
  await act(async () => track.dispatchEvent(new Event('scroll')));
  expect(previous.disabled).toBe(false);
  await act(async () => previous.click());
  expect(scroll).toHaveBeenLastCalledWith({ left: -296, behavior: 'smooth' });
});
