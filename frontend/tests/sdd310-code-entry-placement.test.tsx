// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { MemberStructureHomePage } from '../src/pages/client/member-structure-home-page';
import { MemberClassesPage } from '../src/pages/client/member-classes-page';

const mocks = vi.hoisted(() => ({ home: vi.fn(), classes: vi.fn() }));
vi.mock('../src/hooks/use-class-structure', async (orig) => ({ ...(await orig<object>()), useMixedHome: mocks.home, useClasses: mocks.classes }));
vi.mock('../src/hooks/use-client-counselors', () => ({ useClientCounselors: () => ({ counselors: [], loading: false, error: false, refresh: async () => true, addCounselor: async () => { throw new Error('unused'); } }) }));
vi.mock('../src/hooks/use-class-apply', () => ({ useClassApply: () => ({ openApply: vi.fn(), overlay: null }) }));
vi.mock('../src/components/class/structure/structure-shell', () => ({ StructureShell: ({ children, rightSlot }: { children: React.ReactNode; rightSlot?: React.ReactNode }) => <main className="cs-structure"><div className="mb-page-header-actions">{rightSlot}</div>{children}</main> }));
vi.mock('../src/pages/client/ClientHomePage', () => ({ default: () => <div className="mh-legacy" /> }));
vi.mock('../src/components/class/structure/member-code-join', () => ({}), { virtual: true } as never);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
vi.stubGlobal('matchMedia', () => ({ matches: true }));
let clean: () => void;
afterEach(() => clean?.());
function Where() { return <p data-testid="where">{useLocation().pathname}</p>; }
async function render(node: React.ReactNode) {
  const el = document.createElement('div'); document.body.append(el); const root = createRoot(el);
  await act(async () => root.render(<MemoryRouter initialEntries={['/app']}><Routes><Route path="/app" element={node} /><Route path="/join" element={<Where />} /></Routes></MemoryRouter>));
  clean = () => { act(() => root.unmount()); el.remove(); };
  return el;
}
const empty = { status: 'success', data: { classes: [], total: 0 } };
const buttons = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLAnchorElement>('[data-testid="enter-with-code"]'));

it('홈(구조): 헤더 슬롯 버튼은 모바일 숨김, 본문 버튼은 히어로 아래 모바일 전용 48px 진한 배경+흰 글씨', async () => {
  mocks.home.mockReturnValue({ classes: empty, counseling: { status: 'success', data: { relationships: [], total: 0 } }, retry: vi.fn() });
  const el = await render(<MemberStructureHomePage />);
  const [header, body] = [buttons(el).find(b => b.closest('.mb-page-header-actions')), buttons(el).find(b => !b.closest('.mb-page-header-actions'))];
  expect(header?.className).toContain('mobile:hidden');
  expect(body).toBeDefined();
  expect(body!.className).toMatch(/\bmd:hidden\b/);
  expect(body!.className).toMatch(/\bh-12\b/);
  expect(body!.className).toMatch(/\bw-full\b/);
  expect(body!.className).toContain('bg-[#5F0080]');
  expect(body!.className).toContain('text-white');
  expect(body!.className).not.toContain('bg-white');
  expect(body!.className).not.toMatch(/\b(sticky|fixed)\b/);
  expect(body!.closest('[class*="sticky"],[class*="fixed"]')).toBeNull();
  expect(el.querySelector('[data-testid="class-hero"]')!.nextElementSibling).toBe(body!.parentElement === el.querySelector('.mh-home') ? body : body!.parentElement);
  expect(body!.textContent).toBe('코드로 바로 입장');
  expect(body!.textContent).not.toMatch(/점수|좋음|나쁨|완료|보증|100%/);
  await act(async () => body!.click());
  expect(el.querySelector('[data-testid="where"]')!.textContent).toBe('/join');
});

it('내 클래스: 헤더(보조, 모바일 숨김)와 본문(모바일 전용) 버튼이 각각 1개', async () => {
  mocks.classes.mockReturnValue({ state: empty, retry: vi.fn() });
  const el = await render(<MemberClassesPage />);
  const all = buttons(el);
  expect(all).toHaveLength(2);
  const header = all.find(b => b.closest('.mb-page-header-actions'))!;
  const body = all.find(b => !b.closest('.mb-page-header-actions'))!;
  expect(header.className).toContain('mobile:hidden');
  expect(header.getAttribute('data-header-action')).toBe('secondary');
  expect(body.className).toMatch(/\bmd:hidden\b/);
  expect(body.className).toMatch(/\bh-12\b/);
});
