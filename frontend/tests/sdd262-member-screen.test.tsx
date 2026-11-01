// @vitest-environment jsdom
// SDD-262: 회원 화면 (V-M05~07, M15~16, M19, M22)
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api/client';

const getSummaries = vi.fn(); const listOptions = vi.fn();
vi.mock('../src/lib/api/my-upload-status', () => ({ getMyUploadSummaries: (...a: unknown[]) => getSummaries(...a), listMySessionOptions: (...a: unknown[]) => listOptions(...a) }));
import { MyUploadStatusScreen } from '../src/components/client/my-upload-status-screen';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const opt = (id: string, status: string) => ({ id, seq: 3, scheduled_at: '2026-10-30T01:00:00Z', status, attendance: { entered_at: null }, classTitle: '아침 명상', classId: 'c1' });
const ok = (fw: number, o: Record<string, number> = {}) => ({
  feature: { session_id: 's', participant_id: 'p', total_count: fw, streams: [], updated_at: fw ? '2026-10-30T02:00:00+00:00' : null },
  raw: { session_id: 's', participant_id: 'p', total: o.total ?? 0, uploaded: o.uploaded ?? 0, pending: o.pending ?? 0, failed: o.failed ?? 0, streams: [], updated_at: null },
});
async function mount() {
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  await act(async () => root.render(<MyUploadStatusScreen />));
  await act(async () => { await Promise.resolve(); });
  return { host, unmount: () => act(async () => root.unmount()) };
}
async function pick(host: HTMLElement, id: string) {
  const sel = host.querySelector('select') as HTMLSelectElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, id); sel.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}
beforeEach(() => { getSummaries.mockReset(); listOptions.mockReset(); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

it('회차 선택 → 수신 N창·상태 표시, 금지 문구 없음 (V-M22)', async () => {
  listOptions.mockResolvedValue([opt('s1', 'completed')]); getSummaries.mockResolvedValue(ok(520, { total: 5, uploaded: 5 }));
  const { host, unmount } = await mount(); await pick(host, 's1');
  expect(host.textContent).toContain('수신 520창'); expect(host.textContent).toContain('수신 확인');
  expect(host.textContent).toContain('서버 수신 기준');
  expect(host.textContent).not.toMatch(/업로드 완료|100%|점수|종합|좋음|나쁨|정상 작동/);
  expect(getSummaries.mock.calls[0][0]).toBe('s1'); expect(getSummaries.mock.calls[0].length).toBeLessThanOrEqual(2); // participant_id 미전달 (V-M05)
  await unmount();
});
it('수신 기록 없음은 미착용 안내를 보이고 확인 필요가 아니다 (V-M13/14)', async () => {
  listOptions.mockResolvedValue([opt('s1', 'completed')]); getSummaries.mockResolvedValue(ok(0));
  const { host, unmount } = await mount(); await pick(host, 's1');
  expect(host.textContent).toContain('수신 기록 없음'); expect(host.textContent).toContain('마이크를 끈 경우'); expect(host.textContent).not.toContain('확인 필요');
  await unmount();
});
it.each([[403, '볼 수 없어요'], [404, '찾을 수 없어요']])('%s → 이전 수치 제거 (V-M06/07)', async (status, text) => {
  listOptions.mockResolvedValue([opt('s1', 'completed'), opt('s2', 'completed')]);
  getSummaries.mockResolvedValueOnce(ok(77, { total: 1, uploaded: 1 })).mockRejectedValueOnce(new ApiError(status, 'x', null));
  const { host, unmount } = await mount(); await pick(host, 's1'); expect(host.textContent).toContain('수신 77창');
  await pick(host, 's2'); expect(host.textContent).toContain(text); expect(host.textContent).not.toContain('77');
  await unmount();
});
it('5xx → 수치 제거 + 재시도 안내 (V-M16)', async () => {
  listOptions.mockResolvedValue([opt('s1', 'completed')]); getSummaries.mockRejectedValue(new ApiError(500, 'x', null));
  const { host, unmount } = await mount(); await pick(host, 's1');
  expect(host.textContent).toContain('불러오지 못했어요'); expect(host.textContent).not.toContain('수신 ');
  await unmount();
});
it('오프라인 카드 + 요청 0 (V-M15)', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  listOptions.mockResolvedValue([opt('s1', 'completed')]);
  const { host, unmount } = await mount(); await pick(host, 's1');
  expect(host.textContent).toContain('오프라인'); expect(getSummaries).not.toHaveBeenCalled();
  await unmount(); vi.restoreAllMocks();
});
it('진행 중 회차만 5초 폴링 (V-M19)', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  listOptions.mockResolvedValue([opt('live', 'in_progress'), opt('done', 'completed')]); getSummaries.mockResolvedValue(ok(1, { total: 1, uploaded: 1 }));
  const { host, unmount } = await mount(); await pick(host, 'live');
  expect(getSummaries).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(5100); }); expect(getSummaries).toHaveBeenCalledTimes(2);
  getSummaries.mockClear(); await pick(host, 'done');
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); }); expect(getSummaries).toHaveBeenCalledTimes(1);
  await unmount();
});
it('회차가 없으면 안내 (빈 목록)', async () => {
  listOptions.mockResolvedValue([opt('x', 'scheduled')]);
  const { host, unmount } = await mount(); expect(host.textContent).toContain('아직 확인할 회차가 없어요'); await unmount();
});
