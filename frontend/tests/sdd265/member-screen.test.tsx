// @vitest-environment jsdom
// SDD-265: 회원 "내 데이터 저장 현황" — 최근 10회차 선택·상태·내 측정 길이/크기/전송 현황·한 줄 조치·401/403/오프라인
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/lib/api/client';
import type { MySessionRow } from '../../src/lib/api/my-upload-status';

const fetchMock = vi.fn();
vi.mock('../../src/lib/api/my-upload-status', async (orig) => ({ ...(await orig<typeof import('../../src/lib/api/my-upload-status')>()), fetchMySessions: (...a: unknown[]) => fetchMock(...a) }));
import { MyUploadStatusScreen } from '../../src/components/client/my-upload-status-screen';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const row = (id: string, o: Partial<MySessionRow> = {}): MySessionRow => ({
  session_id: id, class_id: 'c1', class_title: '아침 명상', seq: 3, org_name: null, session_status: 'completed', started_at: '2026-10-30T01:00:00Z', ended_at: null,
  status: 'received_unreconciled', collection_state: 'eligible', progress_state: 'in_progress', percent: 87.4, bytes_arrived: 27_000_000, bytes_expected: 31_000_000,
  duration_min: 52, measured_min: 51, last_received_at: null, ...o,
});
const ok = (items: MySessionRow[], extra: Record<string, unknown> = {}) => ({ kind: 'ok' as const, etag: null, pollIntervalSec: 60, data: { as_of: null, poll_interval_sec: 60, etag: null, next_cursor: null, has_more: false, items, ...extra } });
async function mount() {
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  await act(async () => root.render(<MyUploadStatusScreen />));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return { host, unmount: () => act(async () => root.unmount()) };
}
async function pick(host: HTMLElement, id: string) {
  const sel = host.querySelector('select') as HTMLSelectElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, id); sel.dispatchEvent(new Event('change', { bubbles: true })); });
}
beforeEach(() => { fetchMock.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

it('가장 최근 회차가 기본 선택되고 상태·내 측정 길이·내 데이터 크기·전송 현황·한 줄 조치가 한 화면에 보인다', async () => {
  fetchMock.mockResolvedValue(ok([row('s1'), row('s2', { progress_state: 'all_received', percent: 100, bytes_arrived: 31_000_000 })]));
  const { host, unmount } = await mount();
  expect(fetchMock.mock.calls[0][0]).toMatchObject({ limit: 10, cursor: null });
  const t = host.querySelector('[data-testid="my-upload-status"]')?.textContent ?? '';
  expect(t).toContain('전송 중'); expect(t).toContain('51분'); expect(t).toContain('26MB'); expect(t).toContain('87%');
  expect(host.querySelector('[data-testid="my-action"]')?.textContent).toContain('앱을 켠 채 와이파이에 연결');
  expect(host.querySelectorAll('select option')).toHaveLength(2);
  await unmount();
});
it('회차를 바꾸면 모두 도착은 100%·추가 조치 없음, 금지 문구 없음', async () => {
  fetchMock.mockResolvedValue(ok([row('s1'), row('s2', { progress_state: 'all_received', percent: 100, bytes_arrived: 31_000_000 })]));
  const { host, unmount } = await mount(); await pick(host, 's2');
  const t = host.querySelector('[data-testid="my-upload-status"]')?.textContent ?? '';
  expect(host.querySelector('[data-testid="my-upload-status"]')?.getAttribute('data-kind')).toBe('ok');
  expect(t).toContain('모두 도착'); expect(t).toContain('100%'); expect(t).toContain('추가 조치 없음');
  expect(host.textContent).not.toMatch(/완료|점수|종합|좋음|나쁨|보증|feature|원시|EEG|PPG|ACC|업로드|수신/);
  await unmount();
});
it('수집 제외(미착용·마이크 끔)는 확인 필요가 아니고 문제 없음 안내', async () => {
  fetchMock.mockResolvedValue(ok([row('s1', { collection_state: 'excluded', status: 'no_data', progress_state: 'not_collected', percent: null, bytes_arrived: 0 })]));
  const { host, unmount } = await mount();
  const t = host.querySelector('[data-testid="my-upload-status"]')?.textContent ?? '';
  expect(t).toContain('수집 제외'); expect(t).toContain('문제가 아니에요'); expect(t).not.toContain('확인 필요');
  await unmount();
});
it('기대량을 모르면 전송 현황은 집계 대기(0% 아님)', async () => {
  fetchMock.mockResolvedValue(ok([row('s1', { status: 'no_data', progress_state: 'expected_unknown', percent: null, bytes_expected: null, bytes_arrived: 0 })]));
  const { host, unmount } = await mount();
  expect(host.querySelector('[data-testid="my-percent"]')?.textContent).toContain('집계 대기');
  expect(host.querySelector('[data-testid="my-percent"]')?.textContent).not.toContain('0%');
  expect(host.querySelector('[data-testid="transfer-bar"]')?.getAttribute('data-unknown')).toBe('true');
  await unmount();
});
it('빈 목록 안내', async () => {
  fetchMock.mockResolvedValue(ok([]));
  const { host, unmount } = await mount(); expect(host.textContent).toContain('아직 확인할 회차가 없어요'); await unmount();
});
it.each([[403, '볼 수 없어요'], [401, '로그인이 필요']])('%s → 이전 수치 제거', async (status, text) => {
  fetchMock.mockResolvedValueOnce(ok([row('s1')])).mockRejectedValue(new ApiError(status, 'x', null));
  const { host, unmount } = await mount();
  expect(host.textContent).toContain('51분');
  await act(async () => { (host.querySelector('button:not([data-testid])') as HTMLButtonElement).click(); await Promise.resolve(); await Promise.resolve(); });
  expect(host.textContent).toContain(text); expect(host.textContent).not.toContain('51분');
  await unmount();
});
it('5xx → 안내만(수치는 유지하지 않고 재시도)', async () => {
  fetchMock.mockRejectedValue(new ApiError(500, 'x', null));
  const { host, unmount } = await mount(); expect(host.textContent).toContain('불러오지 못했어요'); await unmount();
});
it('오프라인이면 안내 + 요청 0', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const { host, unmount } = await mount();
  expect(host.textContent).toContain('오프라인'); expect(fetchMock).not.toHaveBeenCalled(); await unmount();
});
it('진행 중 회차가 있으면 서버 주기(5초)로 폴링, 없으면 60초', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  fetchMock.mockResolvedValue({ ...ok([row('live', { session_status: 'in_progress' })]), pollIntervalSec: null });
  const { unmount } = await mount();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(5100); }); expect(fetchMock).toHaveBeenCalledTimes(2);
  await unmount();
});
it('다음 10회차 → 커서로 재요청', async () => {
  fetchMock.mockResolvedValueOnce(ok([row('s1')], { next_cursor: 'C2', has_more: true }));
  const { host, unmount } = await mount();
  fetchMock.mockResolvedValue(ok([row('s11')]));
  await act(async () => { (host.querySelector('[data-testid="my-page-next"]') as HTMLButtonElement).click(); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  expect(fetchMock.mock.calls.at(-1)?.[0]).toMatchObject({ limit: 10, cursor: 'C2' });
  await unmount();
});
