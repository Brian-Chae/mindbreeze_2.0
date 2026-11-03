// @vitest-environment jsdom
// SDD-278: 코치 화면 — 별도 줄·설명·접힌 목록, 확인할 사람 수·진행 막대 분모에서 제외, 금지어 없음 (V15)
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { UploadStatusResponse } from '../../src/lib/api/upload-status';
import { normalizePersonProgress, normalizeSessionProgress } from '../../src/lib/api/upload-progress';
import { UploadStatusTable } from '../../src/components/class/upload-status-table';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const BAN = /완료|점수|종합|좋음|나쁨|보증|feature|원시|EEG|PPG|ACC|업로드|수신|100%|유실|손실/;
const r = (e: number | null, v: number, p: number | null) => ({ expected: e, received: v, percent: p });
const full = { feature: r(1, 1, 100), raw: { eeg: r(1, 1, 100), ppg: r(1, 1, 100), acc: r(1, 1, 100) }, total: r(4, 4, 100) };
const unk = { feature: r(null, 7, null), raw: { eeg: r(null, 1, null), ppg: r(null, 1, null), acc: r(null, 1, null) }, total: r(null, 0, null) };
const person = (id: string, name: string, raw: Record<string, unknown>) => ({ participant_id: id, display_name: name, reasons: [], is_guest: true, raw: { signals: [] }, last_feature_at: null, status: 'received_unreconciled', collection_state: 'eligible', progress: normalizePersonProgress(raw) });
function detail(suspect: number): UploadStatusResponse {
  const ps = [
    person('a', '가온', { state: 'all_received', ...full }),
    ...Array.from({ length: suspect }, (_, i) => person(`s${i}`, `의심${i + 1}`, { state: 'expected_unknown', ...unk, abnormal_exit_suspected: true })),
  ];
  return {
    session_status: 'completed',
    summary: { participants: ps.length, needs_attention: 0, uploading: 0, received_unreconciled: ps.length, no_data: 0, excluded: 0 },
    participants: ps,
    progress: normalizeSessionProgress({ participants: { total: ps.length, counted: ps.length, all_received: 1, in_progress: 0, needs_attention: 0, expected_unknown: suspect, not_collected: 0, final_pending: 0, abnormal_exit_suspected: suspect }, ...{ feature: r(1, 1, 100), raw: full.raw, overall: r(4, 4, 100) } }),
    metrics: { participants_expected: ps.length, participants_arrived: ps.length, measured_min: null, bytes_arrived: 10, bytes_expected: 10, duration_min: 50, participant_minutes_total: 150 },
  } as unknown as UploadStatusResponse;
}
afterEach(() => { document.body.innerHTML = ''; });
async function mount(node: JSX.Element) {
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>));
  return { host, unmount: () => act(async () => root.unmount()) };
}

it('상세: 비정상 종료 의심 N명 줄 + 설명, 접힌 목록, 확인할 사람 아님, 정상과 섞지 않음', async () => {
  const { host, unmount } = await mount(<UploadStatusTable data={detail(2)} />);
  const line = host.querySelector('[data-testid="abnormal-exit-line"]');
  expect(line?.textContent).toContain('비정상 종료 의심 2명');
  expect(line?.textContent).toContain('앱이 정상 종료되지 않아 총량 보고가 없어요. 도착한 데이터는 확인돼요.');
  expect(host.querySelector('[data-testid="group-attention"]')).toBeNull();
  const g = host.querySelector('[data-testid="group-abnormal"]');
  expect(g?.tagName).toBe('DETAILS');
  expect(g?.hasAttribute('open')).toBe(false);
  expect(g?.textContent).toContain('의심1');
  expect(host.querySelector('[data-testid="group-arrived"]')?.textContent).not.toContain('의심');
  expect(host.querySelector('[data-testid="group-waiting"]')).toBeNull();
  expect(host.querySelector('[data-testid="metric-state"]')?.textContent).not.toContain('확인할 사람');
  expect(host.textContent).not.toMatch(BAN);
  await unmount();
});

it('상세: 의심 0명이면 줄·그룹이 없다(구 서버와 동일)', async () => {
  const { host, unmount } = await mount(<UploadStatusTable data={detail(0)} />);
  expect(host.querySelector('[data-testid="abnormal-exit-line"]')).toBeNull();
  expect(host.querySelector('[data-testid="group-abnormal"]')).toBeNull();
  await unmount();
});

it('상세: 진행 막대 %는 의심을 뺀 서버 합계 기준(크기 기반 추정으로 덮지 않음)', async () => {
  const d = detail(2);
  const { host, unmount } = await mount(<UploadStatusTable data={d} />);
  // 의심 제외 합계(4/4=100%)이지만 모두 도착이 아니므로 99% 상한
  expect(host.querySelector('[data-testid="transfer-percent"]')?.textContent).toBe('99%');
  await unmount();
});

it('리포트 칩: 확인할 사람 수에 의심을 섞지 않고 별도 칩', async () => {
  vi.resetModules();
  vi.doMock('../../src/hooks/use-upload-status', () => ({ useUploadStatus: () => ({ data: detail(2), error: null }) }));
  const { UploadAttentionChip } = await import('../../src/components/class/upload-attention-chip');
  const { host, unmount } = await mount(<UploadAttentionChip classId="c1" sessionId="s1" />);
  expect(host.querySelector('[data-testid="upload-attention-chip"]')).toBeNull();
  expect(host.querySelector('[data-testid="upload-abnormal-chip"]')?.textContent).toContain('비정상 종료 의심 2명');
  expect(host.textContent).not.toMatch(BAN);
  await unmount();
  vi.doUnmock('../../src/hooks/use-upload-status');
});
