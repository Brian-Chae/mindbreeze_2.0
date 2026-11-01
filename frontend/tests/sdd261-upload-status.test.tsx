// @vitest-environment jsdom
// SDD-261 FE-1: V-U19/29/32/39/42/44/45/48/64 — 훅 폴링 규칙과 표 표시 규칙
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api/client';
import type { UploadParticipantDto, UploadStatusResponse } from '../src/lib/api/upload-status';
import { useUploadStatus, type UploadStatusView } from '../src/hooks/use-upload-status';
import { UploadStatusTable } from '../src/components/class/upload-status-table';
import { UploadStatusLiveBar } from '../src/components/class/upload-status-live-bar';
import { errorBackoffMs, filterParticipants, groupParticipants, DEFAULT_FILTERS, pollDelayMs } from '../src/lib/upload-status/view';

const api = vi.hoisted(() => ({ fetchUploadStatus: vi.fn() }));
vi.mock('../src/lib/api/upload-status', async (orig) => ({ ...(await orig<typeof import('../src/lib/api/upload-status')>()), fetchUploadStatus: api.fetchUploadStatus }));

const sig = (t: 'eeg' | 'ppg' | 'acc', o: Partial<UploadParticipantDto['raw']['signals'][number]> = {}) =>
  ({ signal_type: t, registered: 0, uploaded: 0, pending: 0, failed: 0, internal_missing: 0, oldest_pending_at: null, ...o });
const person = (id: string, name: string | null, o: Partial<UploadParticipantDto> = {}): UploadParticipantDto => ({
  participant_id: id, display_name: name, is_guest: false, participation_status: 'active', collection_state: 'eligible',
  band_connected: false, report_included: true,
  feature: { received: 0, legacy_count: 0, internal_missing: 0, expected: null, expected_basis: 'unknown', completeness: 'unknown', last_received_at: null },
  raw: { signals: [sig('eeg'), sig('ppg'), sig('acc')], last_received_at: null, completeness: 'unknown' },
  phone_report: null, status: 'no_data', reasons: [], ...o,
});
const response = (participants: UploadParticipantDto[], extra: Partial<UploadStatusResponse> = {}): UploadStatusResponse => ({
  class_id: 'c1', session_id: 's1', session_status: 'in_progress', as_of: '2026-11-04T05:10:00Z', basis: 'server_received', poll_interval_sec: 3, etag: 'W/"a"',
  summary: { participants: participants.length, needs_attention: 0, uploading: 0, received_unreconciled: 0, no_data: 0, excluded: 0 }, participants, ...extra,
});
const ok = (data: UploadStatusResponse, etag = 'W/"a"', pollIntervalSec: number | null = 3) => ({ kind: 'ok' as const, data, etag, pollIntervalSec });
const notModified = (etag = 'W/"a"') => ({ kind: 'not_modified' as const, etag, pollIntervalSec: 3 });

let root: Root; let host: HTMLDivElement;
beforeEach(() => { vi.useFakeTimers(); api.fetchUploadStatus.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

const box: { view: UploadStatusView | null } = { view: null };
function Probe({ classId = 'c1', sessionId = 's1' }: { classId?: string | null; sessionId?: string | null }) {
  const v = useUploadStatus(classId, sessionId);
  useEffect(() => { box.view = v; });
  return <p data-testid="names">{v.data?.participants.map((p) => p.display_name).join(',')}</p>;
}
const mount = async (el = <Probe />) => { await act(async () => root.render(el)); };
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('순수 규칙', () => {
  it('오류 backoff 3→6→12→30→60초, 이후 60초 유지', () => {
    expect([1, 2, 3, 4, 5, 9].map(errorBackoffMs)).toEqual([3000, 6000, 12000, 30000, 60000, 60000]);
  });
  it('서버 X-Poll-Interval 우선, 없으면 회차 상태 기본값', () => {
    expect(pollDelayMs(7, 'in_progress')).toBe(7000);
    expect(pollDelayMs(null, 'in_progress')).toBe(3000);
    expect(pollDelayMs(null, 'completed')).toBe(60000);
  });
  it('필터·그룹: 확인 필요 우선, 이름 검색', () => {
    const rows = [person('2', '나나'), person('1', '가가', { status: 'needs_attention' }), person('3', null, { status: 'excluded', collection_state: 'excluded' })];
    expect(groupParticipants(rows, 'attention').map((g) => [g.label, g.rows.map((r) => r.participant_id)])).toEqual([['확인 필요', ['1']], ['그 외 참여자', ['2', '3']]]);
    expect(filterParticipants(rows, { ...DEFAULT_FILTERS, query: '나' }).map((r) => r.participant_id)).toEqual(['2']);
    expect(filterParticipants(rows, { ...DEFAULT_FILTERS, status: 'excluded' }).map((r) => r.participant_id)).toEqual(['3']);
  });
});

describe('useUploadStatus', () => {
  it('첫 조회 후 If-None-Match 로 재조회하고 304 면 데이터를 유지한다 (V-U39)', async () => {
    api.fetchUploadStatus.mockResolvedValueOnce(ok(response([person('1', '가가')]))).mockResolvedValue(notModified());
    await mount();
    expect(box.view?.data?.participants).toHaveLength(1);
    await tick(3000);
    expect(api.fetchUploadStatus).toHaveBeenCalledTimes(2);
    expect(api.fetchUploadStatus.mock.calls[1][2]).toMatchObject({ etag: 'W/"a"' });
    expect(box.view?.data?.participants[0].display_name).toBe('가가');
  });

  it('X-Poll-Interval 을 따라 주기를 바꾼다 (V-U46)', async () => {
    api.fetchUploadStatus.mockResolvedValue(ok(response([]), 'W/"a"', 7));
    await mount();
    await tick(6500); expect(api.fetchUploadStatus).toHaveBeenCalledTimes(1);
    await tick(600); expect(api.fetchUploadStatus).toHaveBeenCalledTimes(2);
  });

  it('정지 중에는 요청이 없고 재개하면 즉시 1회 조회한다 (V-U42)', async () => {
    api.fetchUploadStatus.mockResolvedValue(ok(response([])));
    await mount();
    act(() => box.view?.pause());
    await tick(20000); expect(api.fetchUploadStatus).toHaveBeenCalledTimes(1);
    await act(async () => box.view?.resume()); expect(api.fetchUploadStatus).toHaveBeenCalledTimes(2);
  });

  it('탭이 숨겨지면 요청이 없고 복귀 즉시 1회 조회한다 (V-U44)', async () => {
    api.fetchUploadStatus.mockResolvedValue(ok(response([])));
    await mount();
    act(() => setHidden(true));
    await tick(30000); expect(api.fetchUploadStatus).toHaveBeenCalledTimes(1);
    await act(async () => setHidden(false)); expect(api.fetchUploadStatus).toHaveBeenCalledTimes(2);
  });

  it('오류 시 마지막 데이터를 유지하고 실패를 표시하며 backoff 한다 (V-U45)', async () => {
    api.fetchUploadStatus.mockResolvedValueOnce(ok(response([person('1', '가가')]))).mockRejectedValue(new ApiError(503, 'x', null));
    await mount();
    await tick(3000);
    expect(box.view?.data?.participants[0].display_name).toBe('가가');
    expect(box.view?.error?.status).toBe(503);
    expect(api.fetchUploadStatus).toHaveBeenCalledTimes(2);
    await tick(3000); expect(api.fetchUploadStatus).toHaveBeenCalledTimes(3); // 1회 실패 → 3초
    await tick(5000); expect(api.fetchUploadStatus).toHaveBeenCalledTimes(3); // 2회 실패 → 6초
    await tick(1500); expect(api.fetchUploadStatus).toHaveBeenCalledTimes(4);
  });

  it('403 이면 이전 이름·건수를 제거하고 중단한다 (V-U19)', async () => {
    api.fetchUploadStatus.mockResolvedValueOnce(ok(response([person('1', '가가')]))).mockRejectedValue(new ApiError(403, 'upload_status_forbidden', null));
    await mount();
    expect(host.textContent).toContain('가가');
    await tick(3000);
    expect(box.view?.data).toBeNull();
    expect(host.textContent).not.toContain('가가');
    expect(box.view?.forbidden).toBe(true);
    await tick(60000); expect(api.fetchUploadStatus).toHaveBeenCalledTimes(2);
  });

  it('회차가 바뀌면 이전 요청을 취소하고 이전 데이터를 비운다 (V-U48)', async () => {
    const signals: AbortSignal[] = [];
    api.fetchUploadStatus.mockImplementation((_c: string, _s: string, o: { signal: AbortSignal }) => { signals.push(o.signal); return new Promise(() => undefined); });
    await mount(<Probe sessionId="s1" />);
    await mount(<Probe sessionId="s2" />);
    expect(signals[0].aborted).toBe(true);
    expect(box.view?.data).toBeNull();
  });

  it('classId/sessionId 가 없으면 조회하지 않는다', async () => {
    await mount(<Probe classId={null} sessionId={null} />);
    expect(api.fetchUploadStatus).not.toHaveBeenCalled();
  });
});

const ratio = { expected: 10, received: 10, percent: 100 };
const prog = (state: NonNullable<UploadParticipantDto['progress']>['state']): NonNullable<UploadParticipantDto['progress']> =>
  ({ state, feature: ratio, raw: { eeg: ratio, ppg: ratio, acc: ratio }, total: ratio });

describe('UploadStatusTable', () => {
  const mixed = response([
    person('1', '박지민', { status: 'needs_attention', reasons: ['raw_failed'], progress: prog('needs_attention'), feature: { ...person('x', null).feature, received: 354, last_received_at: '2026-11-04T05:09:58Z' },
      raw: { signals: [sig('eeg', { registered: 180, uploaded: 174, failed: 6 }), sig('ppg'), sig('acc')], last_received_at: '2026-11-04T05:09:55Z', completeness: 'unknown' } }),
    person('2', null, { status: 'no_data', band_connected: false }),
    person('3', '도착후보', { status: 'received_unreconciled', progress: prog('all_received'), feature: { ...person('x', null).feature, received: 10 },
      raw: { signals: [sig('eeg', { registered: 10, uploaded: 10 }), sig('ppg'), sig('acc')], last_received_at: null, completeness: 'unknown' } }),
    person('4', '제외', { status: 'excluded', collection_state: 'excluded', progress: prog('not_collected') }),
  ]);
  const render = async () => mount(<MemoryRouter><UploadStatusTable data={mixed} /></MemoryRouter>);

  it('SDD-265: 금지어·구 용어가 없고 새 용어로 보인다 (V-U29/32/64)', async () => {
    await render();
    const text = host.textContent ?? '';
    expect(text).toContain('회차 데이터 상황판');
    expect(text).toContain('확인할 사람 · 1명');
    expect(text).toContain('이름 미확인');
    for (const banned of ['미착용', '완료', '리포트 생성 가능', '점수', '좋음', '나쁨', '양호', 'feature', '원시', 'EEG', 'PPG', 'ACC', '업로드', '수신']) expect(text).not.toContain(banned);
  });

  it('확인할 사람이 먼저 나오고 정상·대기는 접혀 있다', async () => {
    await render();
    const first = host.querySelector('[data-testid="group-attention"] [data-testid="upload-row"]');
    expect(first?.textContent).toContain('박지민');
    expect(first?.textContent).toContain('앱 다시 켜기');
    expect((host.querySelector('[data-testid="group-arrived"]') as HTMLDetailsElement).open).toBe(false);
    expect((host.querySelector('[data-testid="group-waiting"]') as HTMLDetailsElement).open).toBe(false);
    expect(host.querySelectorAll('[data-testid="upload-row"]')).toHaveLength(4);
  });

  it('검색 결과가 없으면 안내 문구를 보인다', async () => {
    await render();
    const input = host.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '없는이름'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(host.textContent).toContain('조건에 맞는 참여자가 없어요');
  });

  it('참여자 0명이면 안내 문구를 보인다', async () => {
    await mount(<MemoryRouter><UploadStatusTable data={response([])} /></MemoryRouter>);
    expect(host.textContent).toContain('등록된 참여자가 없어요');
  });
});

describe('UploadStatusLiveBar', () => {
  const base = { paused: false, loading: false, error: null, forbidden: false, lastFetchedAt: new Date('2026-11-04T05:10:00Z'), lastReceivedAt: null, offline: false };
  it('실시간 N초 전 갱신과 정지 버튼, 정지 시 재개 버튼', async () => {
    const onPause = vi.fn(); const onResume = vi.fn(); const onRefresh = vi.fn();
    vi.setSystemTime(new Date('2026-11-04T05:10:02Z'));
    await mount(<UploadStatusLiveBar {...base} onPause={onPause} onResume={onResume} onRefresh={onRefresh} />);
    expect(host.textContent).toContain('실시간 · 2초 전 갱신');
    await act(async () => (host.querySelector('[data-testid="live-toggle"]') as HTMLButtonElement).click());
    expect(onPause).toHaveBeenCalled();
    await mount(<UploadStatusLiveBar {...base} paused onPause={onPause} onResume={onResume} onRefresh={onRefresh} />);
    expect(host.textContent).toContain('정지됨');
    await act(async () => (host.querySelector('[data-testid="live-toggle"]') as HTMLButtonElement).click());
    expect(onResume).toHaveBeenCalled();
  });
  it('조회 중에는 새로고침 버튼이 비활성(중복 방지), 오프라인·실패 문구', async () => {
    await mount(<UploadStatusLiveBar {...base} loading offline error={new ApiError(503, 'x', null)} onPause={vi.fn()} onResume={vi.fn()} onRefresh={vi.fn()} />);
    expect((host.querySelector('[data-testid="live-refresh"]') as HTMLButtonElement).disabled).toBe(true);
    expect(host.textContent).toContain('인터넷 연결 후 다시 확인');
    expect(host.textContent).toContain('조회 실패');
  });
});
