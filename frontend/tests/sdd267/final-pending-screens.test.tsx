// @vitest-environment jsdom
// SDD-267: 회원·상세 화면 렌더 — 칩/한 줄/그룹, 판정·% 불변, 금지어
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MySessionRow } from '../../src/lib/api/my-upload-status';
import type { UploadStatusResponse } from '../../src/lib/api/upload-status';
import { normalizePersonProgress, normalizeSessionProgress } from '../../src/lib/api/upload-progress';

const fetchMock = vi.fn();
vi.mock('../../src/lib/api/my-upload-status', async (orig) => ({ ...(await orig<typeof import('../../src/lib/api/my-upload-status')>()), fetchMySessions: (...a: unknown[]) => fetchMock(...a) }));
import { MyUploadStatusScreen } from '../../src/components/client/my-upload-status-screen';
import { UploadStatusTable } from '../../src/components/class/upload-status-table';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const BAN = /완료|점수|종합|좋음|나쁨|보증|feature|원시|EEG|PPG|ACC|업로드|수신/;
const row = (o: Partial<MySessionRow> = {}): MySessionRow => ({
  session_id: 's1', class_id: 'c1', class_title: '아침 명상', seq: 3, org_name: null, session_status: 'completed', started_at: '2026-10-30T01:00:00Z', ended_at: null,
  status: 'received_unreconciled', collection_state: 'eligible', progress_state: 'in_progress', percent: 100, final_pending: true, bytes_arrived: 27_000_000, bytes_expected: 27_000_000,
  duration_min: 52, measured_min: 51, last_received_at: null, ...o,
});
beforeEach(() => fetchMock.mockReset());
afterEach(() => { document.body.innerHTML = ''; });

it('회원: 칩 + 한 줄 안내, 99% 상한, 금지어 없음', async () => {
  fetchMock.mockResolvedValue({ kind: 'ok', etag: null, pollIntervalSec: 60, data: { as_of: null, poll_interval_sec: 60, etag: null, next_cursor: null, has_more: false, items: [row()] } });
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  await act(async () => root.render(<MyUploadStatusScreen />));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(host.querySelector('[data-testid="final-pending-chip"]')?.textContent).toContain('모두 도착 · 최종 확인 대기');
  expect(host.querySelector('[data-testid="my-action"]')?.textContent).toBe('서버에 모두 도착했어요. 앱을 한 번 열어 두면 최종 확인이 끝나요');
  expect(host.querySelector('[data-testid="my-percent"]')?.textContent).toContain('99%');
  expect(host.querySelector('[data-testid="my-upload-status"]')?.getAttribute('data-kind')).toBe('sending');
  expect(host.textContent).not.toMatch(BAN);
  await act(async () => root.unmount());
});

const r = (e: number | null, v: number, p: number | null) => ({ expected: e, received: v, percent: p });
const person = (id: string, name: string, fp: boolean, state = 'in_progress') => ({
  participant_id: id, display_name: name, reasons: [], is_guest: false, raw: { signals: [] }, last_feature_at: null, status: 'received_unreconciled', collection_state: 'eligible',
  progress: normalizePersonProgress({ state, final_pending: fp, feature: r(1, 1, 100), raw: { eeg: r(1, 1, 100), ppg: r(1, 1, 100), acc: r(1, 1, 100) }, total: r(4, 4, 100) }),
});
function detail(fpN: number, extra: Record<string, unknown> = {}): UploadStatusResponse {
  return {
    session_status: 'completed',
    summary: { participants: 3, needs_attention: 0, uploading: 3, received_unreconciled: 0, no_data: 0, excluded: 0 },
    participants: [person('a', '가온', true), person('b', '나래', false, 'all_received'), person('c', '다솜', false, 'all_received')],
    progress: normalizeSessionProgress({ participants: { total: 3, counted: 3, all_received: 2, in_progress: 1, needs_attention: 0, expected_unknown: 0, not_collected: 0, final_pending: fpN }, feature: r(3, 3, 100), raw: { eeg: r(3, 3, 100), ppg: r(3, 3, 100), acc: r(3, 3, 100) }, overall: r(12, 12, 100) }),
    metrics: { participants_expected: 3, participants_arrived: 3, measured_min: null, bytes_arrived: 10, bytes_expected: 10, duration_min: 50, participant_minutes_total: 150 },
    ...extra,
  } as unknown as UploadStatusResponse;
}
async function mountTable(d: UploadStatusResponse) {
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  await act(async () => root.render(<UploadStatusTable data={d} />));
  return { host, unmount: () => act(async () => root.unmount()) };
}

it('상세: 칩·한 줄·99%, 참여자는 정상 접힘 그룹의 "최종 확인 대기"(확인할 사람 아님)', async () => {
  const { host, unmount } = await mountTable(detail(1));
  expect(host.querySelector('[data-testid="final-pending-chip"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="final-pending-line"]')?.textContent).toBe('서버에 모두 도착했어요. 폰의 최종 확인만 기다리고 있어요');
  expect(host.querySelector('[data-testid="transfer-percent"]')?.textContent).toBe('99%');
  expect(host.querySelector('[data-testid="metric-state"]')?.textContent).toContain('전송 중');
  expect(host.querySelector('[data-testid="group-attention"]')).toBeNull();
  const g = host.querySelector('[data-testid="group-final-pending"]');
  expect(g?.tagName).toBe('DETAILS');
  expect(g?.hasAttribute('open')).toBe(false);
  expect(g?.textContent).toContain('최종 확인 대기 1명');
  expect(g?.textContent).toContain('폰에서 앱을 한 번 열면 곧 확인돼요');
  expect(g?.textContent).toContain('가온');
  expect(host.querySelector('[data-testid="group-waiting"]')).toBeNull();
  expect(host.textContent).not.toMatch(BAN);
  await unmount();
});

it('상세: final_pending 이 없으면 칩·그룹이 없다', async () => {
  const d = detail(0); d.participants = d.participants.map((p) => ({ ...p, progress: p.progress ? { ...p.progress, final_pending: false } : null }));
  const { host, unmount } = await mountTable(d);
  expect(host.querySelector('[data-testid="final-pending-chip"]')).toBeNull();
  expect(host.querySelector('[data-testid="group-final-pending"]')).toBeNull();
  await unmount();
});

it('상세: 남은 사람 중 일부만 final_pending 이면 칩은 있고 안내 한 줄은 없다', async () => {
  const d = detail(1);
  const { host, unmount } = await mountTable({ ...d, progress: { ...d.progress!, participants: { ...d.progress!.participants, counted: 4 } } } as UploadStatusResponse);
  expect(host.querySelector('[data-testid="final-pending-chip"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="final-pending-line"]')).toBeNull();
  await unmount();
});
