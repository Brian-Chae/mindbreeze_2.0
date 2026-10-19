// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemberClassDetailPage } from '../src/pages/client/member-class-detail-page';
import type { ClassDetailDto, ClassSessionDto } from '../src/lib/api/class-structure';
const hooks = vi.hoisted(() => ({ detail: vi.fn() }));
vi.mock('../src/hooks/use-class-structure', () => ({ useClassDetail: hooks.detail }));
vi.mock('../src/components/class/structure/structure-shell', () => ({ StructureShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
const detail: ClassDetailDto = {
  id: 'class-1', area: 'meditation', title: '즉시 클래스', status: 'active', schedule_mode: 'fixed', planned_session_count: 1,
  progress: { completed: 0, total: 1 }, session_count: 1, has_open_session: true, next_session: null,
  location_type: 'online', location_address: null, linkband_mode: 'none', record_audio: false,
  capacity: 10, participant_mode: 'group', default_duration_min: 50, host_view: null,
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it('열린 회차와 진행 중 회차만 입장하기를 제공하며 완료·취소·예정 회차에는 숨긴다', async () => {
  const sessions: ClassSessionDto[] = ['open', 'in_progress', 'completed', 'cancelled', 'scheduled'].map((status, index) => ({
    id: `session-${index}`, seq: index + 1, scheduled_at: null, status, session_kind: 'regular', host: null, host_state: null,
  }));
  hooks.detail.mockReturnValue({ state: { status: 'success', data: { detail, sessions: { sessions, total: sessions.length } } }, retry: vi.fn() });
  await act(async () => root.render(<MemoryRouter initialEntries={['/app/classes/class-1']}><Routes><Route path="/app/classes/:classId" element={<MemberClassDetailPage />} /></Routes></MemoryRouter>));
  const links = [...container.querySelectorAll('a')].filter((link) => link.textContent === '입장하기');
  expect(links.map((link) => link.getAttribute('href'))).toEqual(['/class/session-0/enter', '/class/session-1/enter']);
  expect(container.querySelector('a a')).toBeNull();
});
