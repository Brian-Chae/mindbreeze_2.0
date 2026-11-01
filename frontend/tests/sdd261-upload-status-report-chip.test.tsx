// @vitest-environment jsdom
// SDD-261: 리포트 화면 칩·안내 — 표시 규칙과 실패 격리
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api/client';
import { UploadAttentionChip } from '../src/components/class/upload-attention-chip';
import { UploadParticipantNotice } from '../src/components/class/upload-participant-notice';

const api = vi.hoisted(() => ({ fetchUploadStatus: vi.fn(), getSession: vi.fn() }));
vi.mock('../src/lib/api/upload-status', async (orig) => ({ ...(await orig<typeof import('../src/lib/api/upload-status')>()), fetchUploadStatus: api.fetchUploadStatus }));
vi.mock('../src/lib/api/session', () => ({ getSession: api.getSession }));

const body = (needs: number, status: 'needs_attention' | 'no_data' = 'needs_attention') => ({
  kind: 'ok' as const, etag: 'W/"a"', pollIntervalSec: 3,
  data: { class_id: 'c1', session_id: 's1', session_status: 'completed', as_of: '', basis: 'server_received', poll_interval_sec: 60, etag: 'W/"a"',
    summary: { participants: 2, needs_attention: needs, uploading: 0, received_unreconciled: 0, no_data: 0, excluded: 0 },
    participants: [{ participant_id: 'p1', status }, { participant_id: 'p2', status: 'no_data' }] },
});
let root: Root; let host: HTMLDivElement;
beforeEach(() => { api.fetchUploadStatus.mockReset(); api.getSession.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = async (el: React.ReactElement) => { await act(async () => root.render(<MemoryRouter>{el}</MemoryRouter>)); };

it('확인 필요 N명 칩이 현황 화면으로 링크한다', async () => {
  api.fetchUploadStatus.mockResolvedValue(body(3));
  await render(<UploadAttentionChip classId="c1" sessionId="s1" live={false} />);
  const a = host.querySelector('[data-testid="upload-attention-chip"]');
  expect(a?.textContent).toContain('확인할 사람 3명');
  expect(a?.getAttribute('href')).toBe('/classes/c1/sessions/s1/upload-status');
  expect(host.textContent).not.toMatch(/점수|좋음|나쁨|완료|100%/);
});
it('0명이면 칩을 숨긴다', async () => {
  api.fetchUploadStatus.mockResolvedValue(body(0));
  await render(<UploadAttentionChip classId="c1" sessionId="s1" live={false} />);
  expect(host.querySelector('[data-testid="upload-attention-chip"]')).toBeNull();
});
it.each([403, 404, 503])('조회 실패(%s)면 칩을 숨기고 예외를 던지지 않는다 (실패 격리)', async (status) => {
  api.fetchUploadStatus.mockRejectedValue(new ApiError(status, 'x', null));
  await render(<UploadAttentionChip classId="c1" sessionId="s1" live={false} />);
  expect(host.innerHTML).toBe('');
});
it('live=false 면 폴링하지 않는다', async () => {
  vi.useFakeTimers();
  api.fetchUploadStatus.mockResolvedValue(body(1));
  await render(<UploadAttentionChip classId="c1" sessionId="s1" live={false} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
  expect(api.fetchUploadStatus).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});
it('리포트 상세: 해당 참여자가 확인 필요일 때만 한 줄 안내', async () => {
  api.getSession.mockResolvedValue({ class_id: 'c1' });
  api.fetchUploadStatus.mockResolvedValue(body(1));
  await render(<UploadParticipantNotice sessionId="s1" participantId="p1" />);
  expect(host.textContent).toBe('데이터가 아직 더 도착할 수 있어요');
});
it('리포트 상세: 다른 상태 참여자·조회 실패·클래스 없음이면 숨긴다', async () => {
  api.getSession.mockResolvedValue({ class_id: 'c1' });
  api.fetchUploadStatus.mockResolvedValue(body(1));
  await render(<UploadParticipantNotice sessionId="s1" participantId="p2" />);
  expect(host.innerHTML).toBe('');
  api.fetchUploadStatus.mockRejectedValue(new ApiError(403, 'x', null));
  await render(<UploadParticipantNotice sessionId="s9" participantId="p1" />);
  expect(host.innerHTML).toBe('');
  api.getSession.mockResolvedValue({ class_id: null });
  await render(<UploadParticipantNotice sessionId="s10" participantId="p1" />);
  expect(host.innerHTML).toBe('');
});
