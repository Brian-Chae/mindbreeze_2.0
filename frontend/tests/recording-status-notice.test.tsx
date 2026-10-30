// 기록 상태 안내: 정상 저장·업로드 중에는 숨기고, 문제가 있을 때만 토스트로 알린다.
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BiosignalRecordingStatus, PENDING_NOTICE_DELAY_MS, type RecordingStatus } from '../src/lib/biosignal/recording-status';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const base: RecordingStatus = { status: 'running', stopReason: null, pendingCount: 0, blockedCount: 0, quotaWarning: false, resumeBlocked: vi.fn() };
let root: Root | null = null;
let host: HTMLDivElement | null = null;
async function render(state: RecordingStatus) {
  host ??= document.createElement('div');
  root ??= createRoot(host);
  await act(async () => { root!.render(<BiosignalRecordingStatus state={state} />); });
  return host;
}
afterEach(() => { act(() => root?.unmount()); root = null; host = null; vi.useRealTimers(); });

describe('BiosignalRecordingStatus', () => {
  it('정상 기록 중·짧은 전송 대기에는 아무것도 그리지 않는다', async () => {
    vi.useFakeTimers();
    const el = await render({ ...base, pendingCount: 5 });
    expect(el.textContent).toBe('');
    await act(async () => { vi.advanceTimersByTime(PENDING_NOTICE_DELAY_MS - 1000); });
    expect(el.textContent).toBe('');
  });
  it('대기가 줄지 않고 오래 쌓이면 안내하고, 줄면 사라진다', async () => {
    vi.useFakeTimers();
    const el = await render({ ...base, pendingCount: 5 });
    await act(async () => { vi.advanceTimersByTime(PENDING_NOTICE_DELAY_MS + 10); });
    expect(el.querySelector('[data-testid="biosignal-saving"]')).not.toBeNull();
    await render({ ...base, pendingCount: 2 });
    expect(el.textContent).toBe('');
    await render({ ...base, pendingCount: 0 });
    expect(el.textContent).toBe('');
  });
  it('저장 실패 중단·확인 필요는 즉시 알린다', async () => {
    const el = await render({ ...base, status: 'stopped', stopReason: 'quota', blockedCount: 2 });
    expect(el.textContent).toContain('저장 공간 부족');
    expect(el.textContent).toContain('전송 확인 필요 2건');
  });
});
