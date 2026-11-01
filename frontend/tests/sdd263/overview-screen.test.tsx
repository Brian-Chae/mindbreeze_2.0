// @vitest-environment jsdom
// SDD-263: 목록 화면 — 행 이동·390px 단일 마크업·403 데이터 제거·금지 문구·사이드바·설정 진입
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/lib/api/client';
import { useAuthStore } from '../../src/stores/authStore';

const fetchMock = vi.fn();
vi.mock('../../src/lib/api/upload-overview', async (orig) => ({ ...(await orig<typeof import('../../src/lib/api/upload-overview')>()), fetchUploadOverview: (...a: unknown[]) => fetchMock(...a) }));
vi.mock('../../src/lib/api/admin', () => ({ listAdminOrganizations: () => Promise.resolve([{ id: 'o1', name: '기관1' }]) }));
import { UploadOverviewScreen } from '../../src/components/class/upload-overview-screen';

const sum = (o = {}) => ({ participants: 40, needs_attention: 2, uploading: 1, received_unreconciled: 30, no_data: 5, excluded: 2, ...o });
const data = { as_of: null, poll_interval_sec: 3, etag: null, items: [
  { class_id: 'c1', class_title: 'A반', session_id: 's1', seq: 3, session_status: 'in_progress', band_not_connected: 4, org_id: null, org_name: null, host_name: '김', session_at: new Date().toISOString(), last_received_at: '2026-11-01T01:02:03Z', summary: sum(), status: null },
  { class_id: 'c2', class_title: 'B반', session_id: 's2', seq: 1, session_status: 'completed', band_not_connected: 0, org_id: null, org_name: null, host_name: null, session_at: new Date().toISOString(), last_received_at: null, summary: sum({ needs_attention: 0, uploading: 0 }), status: null },
] };
async function mount(platform = false) {
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  await act(async () => root.render(<MemoryRouter initialEntries={['/x']}><Routes><Route path="/x" element={<UploadOverviewScreen platform={platform} />} /><Route path="*" element={<div data-testid="dest" />} /></Routes></MemoryRouter>));
  await act(async () => { await Promise.resolve(); });
  return { host, root };
}
beforeEach(() => { fetchMock.mockReset(); useAuthStore.setState({ user: { id: 'u', role: 'counselor', name: 'n', email: 'e@e.test' } as never }); });
afterEach(() => { document.body.innerHTML = ''; });

it('V-O 목록: 회차별 요약·진행 중 먼저·상세 링크', async () => {
  fetchMock.mockResolvedValue({ kind: 'ok', data, etag: null, pollIntervalSec: 3 });
  const { host, root } = await mount();
  const rows = host.querySelectorAll('[data-testid="overview-row"]');
  expect(rows).toHaveLength(2);
  expect(rows[0].getAttribute('data-session-id')).toBe('s1');
  expect(rows[0].textContent).toContain('수신 확인 30');
  expect(rows[0].textContent).toContain('확인 필요 2');
  expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/classes/c1/sessions/s1/upload-status');
  expect(rows[0].textContent).toContain('밴드 연결 안 됨 4명');
  expect(host.textContent).not.toMatch(/완료|점수|100%|좋음|나쁨|보증/);
  await act(async () => root.unmount());
});
it('V-O 상태 필터·검색·빈 상태', async () => {
  fetchMock.mockResolvedValue({ kind: 'ok', data, etag: null, pollIntervalSec: 3 });
  const { host, root } = await mount();
  const sel = host.querySelector('select[aria-label="상태 필터"]') as HTMLSelectElement;
  await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!; set.call(sel, 'needs_attention'); sel.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.querySelectorAll('[data-testid="overview-row"]')).toHaveLength(1);
  await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!; set.call(sel, 'excluded'); sel.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.textContent).toContain('조건에 맞는 회차가 없어요');
  await act(async () => root.unmount());
});
it('V-O 빈 목록 안내', async () => {
  fetchMock.mockResolvedValue({ kind: 'ok', data: { ...data, items: [] }, etag: null, pollIntervalSec: 60 });
  const { host, root } = await mount();
  expect(host.textContent).toContain('볼 수 있는 회차가 없어요');
  await act(async () => root.unmount());
});
it('V-O 403: 이전 데이터 제거·권한 안내', async () => {
  fetchMock.mockResolvedValueOnce({ kind: 'ok', data, etag: 'W/"1"', pollIntervalSec: 0.01 });
  const { host, root } = await mount();
  expect(host.querySelectorAll('[data-testid="overview-row"]')).toHaveLength(2);
  fetchMock.mockRejectedValue(new ApiError(403, 'upload_status_forbidden', null));
  await act(async () => { (host.querySelector('[data-testid="live-refresh"]') as HTMLButtonElement).click(); await Promise.resolve(); await Promise.resolve(); });
  expect(host.querySelectorAll('[data-testid="overview-row"]')).toHaveLength(0);
  expect(host.textContent).toContain('볼 권한이 없어요');
  expect(host.textContent).not.toContain('A반');
  await act(async () => root.unmount());
});
it('V-O platform_admin: 기관 선택 전 조회 없음', async () => {
  useAuthStore.setState({ user: { id: 'u', role: 'platform_admin', name: 'n', email: 'e@e.test' } as never });
  const { host, root } = await mount(true);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(host.textContent).toContain('기관 선택 후');
  await act(async () => root.unmount());
});
