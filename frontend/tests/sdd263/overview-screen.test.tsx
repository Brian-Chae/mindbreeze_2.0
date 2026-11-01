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
const M = (e: number, a: number, b: number, d: number, t: number) => ({ participants_expected: e, participants_arrived: a, measured_min: null, bytes_arrived: b, bytes_expected: null, duration_min: d, participant_minutes_total: t });
const r1 = { expected: 10, received: 10, percent: 100 };
const okProg = () => ({ participants: { total: 40, counted: 40, all_received: 40, in_progress: 0, needs_attention: 0, expected_unknown: 0, not_collected: 0 }, feature: r1, raw: { eeg: r1, ppg: r1, acc: r1 }, overall: r1 });
const data = { as_of: null, next_cursor: null, has_more: false, scan_limited: false, poll_interval_sec: 3, etag: null, items: [
  { class_id: 'c1', class_title: 'A반', session_id: 's1', seq: 3, session_status: 'in_progress', band_not_connected: 4, org_id: null, org_name: null, host_name: '김', session_at: new Date().toISOString(), last_received_at: '2026-11-01T01:02:03Z', summary: sum(), status: null, progress: null, metrics: M(38, 36, 1180000000, 52, 2082) },
  { class_id: 'c2', class_title: 'B반', session_id: 's2', seq: 1, session_status: 'completed', band_not_connected: 0, org_id: null, org_name: null, host_name: null, session_at: new Date().toISOString(), last_received_at: null, summary: sum({ needs_attention: 0, uploading: 0 }), status: null, progress: okProg(), metrics: M(40, 40, 1310000000, 60, 2400) },
] };
async function mount(platform = false) {
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  await act(async () => root.render(<MemoryRouter initialEntries={['/x']}><Routes><Route path="/x" element={<UploadOverviewScreen platform={platform} />} /><Route path="*" element={<div data-testid="dest" />} /></Routes></MemoryRouter>));
  await act(async () => { await Promise.resolve(); });
  return { host, root };
}
beforeEach(() => { fetchMock.mockReset(); useAuthStore.setState({ user: { id: 'u', role: 'counselor', name: 'n', email: 'e@e.test' } as never }); });
afterEach(() => { document.body.innerHTML = ''; });

it('SDD-265 목록: 확인할 곳 먼저·숫자 칸·상세 링크·정상 접기', async () => {
  fetchMock.mockResolvedValue({ kind: 'ok', data, etag: null, pollIntervalSec: 3 });
  const { host, root } = await mount();
  const rows = host.querySelectorAll('[data-testid="overview-row"]');
  expect(rows).toHaveLength(2);
  expect(rows[0].getAttribute('data-session-id')).toBe('s1');
  expect(rows[0].getAttribute('data-state')).toBe('warn');
  expect(rows[0].textContent).toContain('확인할 사람 2명');
  expect(rows[0].textContent).toContain('36/38명');
  expect(rows[0].textContent).toContain('1.10GB');
  expect(rows[0].textContent).toContain('52분');
  expect(rows[0].textContent).toContain('합계 34.7시간');
  expect(rows[0].textContent).toContain('2명이 앱을 다시 켜고');
  expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/classes/c1/sessions/s1/upload-status');
  expect((host.querySelector('[data-testid="group-warn"]') as HTMLDetailsElement).open).toBe(true);
  expect((host.querySelector('[data-testid="group-ok"]') as HTMLDetailsElement).open).toBe(false);
  expect(host.querySelector('[data-testid="hero-people"]')?.textContent).toContain('2명');
  expect(host.textContent).not.toMatch(/완료|점수|좋음|나쁨|보증|feature|원시|EEG|PPG|ACC|업로드|수신/);
  await act(async () => root.unmount());
});
it('SDD-265 목록: 한 쪽 10건 요청·커서로 다음/이전 페이지', async () => {
  fetchMock.mockResolvedValueOnce({ kind: 'ok', data: { ...data, next_cursor: 'C1', has_more: true }, etag: null, pollIntervalSec: 60 });
  const { host, root } = await mount();
  expect(fetchMock.mock.calls[0][0]).toMatchObject({ limit: 10, cursor: null });
  const next = host.querySelector('[data-testid="page-next"]') as HTMLButtonElement;
  const prev = host.querySelector('[data-testid="page-prev"]') as HTMLButtonElement;
  expect(next.disabled).toBe(false); expect(prev.disabled).toBe(true);
  fetchMock.mockResolvedValue({ kind: 'ok', data: { ...data, items: [data.items[1]], next_cursor: null, has_more: false }, etag: null, pollIntervalSec: 60 });
  await act(async () => { next.click(); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  expect(fetchMock.mock.calls.at(-1)?.[0]).toMatchObject({ limit: 10, cursor: 'C1' });
  expect(host.querySelector('[data-testid="page-info"]')?.textContent).toContain('2쪽');
  expect((host.querySelector('[data-testid="page-next"]') as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { (host.querySelector('[data-testid="page-prev"]') as HTMLButtonElement).click(); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  expect(fetchMock.mock.calls.at(-1)?.[0]).toMatchObject({ cursor: null });
  await act(async () => root.unmount());
});
it('SDD-265 목록: 확인할 사람 필터는 서버에 needs_attention_only 로 보낸다', async () => {
  fetchMock.mockResolvedValue({ kind: 'ok', data, etag: null, pollIntervalSec: 3 });
  const { host, root } = await mount();
  const sel = host.querySelector('select[aria-label="상태 필터"]') as HTMLSelectElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, 'warn'); sel.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(fetchMock.mock.calls.at(-1)?.[0]).toMatchObject({ needsAttentionOnly: true, cursor: null });
  expect(host.querySelectorAll('[data-testid="overview-row"]')).toHaveLength(1);
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, 'pending'); sel.dispatchEvent(new Event('change', { bubbles: true })); });
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
