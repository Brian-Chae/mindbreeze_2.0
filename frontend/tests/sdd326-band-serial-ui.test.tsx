// @vitest-environment jsdom
// SDD-326 T10: 업로드 현황 시리얼 칼럼·검색·기기 상세 시트, T7: bluetoothService 이름 스냅샷(인계 뒤 유지)
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadParticipantDto, UploadStatusResponse } from '../src/lib/api/upload-status';
import { UploadStatusTable } from '../src/components/class/upload-status-table';
import { matchesParticipantQuery, splitBandSerial } from '../src/lib/upload-status/view';

const api = vi.hoisted(() => ({ fetchBandDeviceUsage: vi.fn() }));
vi.mock('../src/lib/api/upload-status', async (orig) => ({ ...(await orig<typeof import('../src/lib/api/upload-status')>()), fetchBandDeviceUsage: api.fetchBandDeviceUsage }));

const sig = (t: 'eeg' | 'ppg' | 'acc') => ({ signal_type: t, registered: 0, uploaded: 0, pending: 0, failed: 0, internal_missing: 0, oldest_pending_at: null });
const person = (id: string, name: string, o: Partial<UploadParticipantDto> = {}): UploadParticipantDto => ({
  participant_id: id, display_name: name, is_guest: false, participation_status: 'active', collection_state: 'eligible',
  band_connected: false, report_included: true,
  feature: { received: 0, legacy_count: 0, internal_missing: 0, expected: null, expected_basis: 'unknown', completeness: 'unknown', last_received_at: null },
  raw: { signals: [sig('eeg'), sig('ppg'), sig('acc')], last_received_at: null, completeness: 'unknown' },
  phone_report: null, status: 'needs_attention', reasons: [], ...o,
});
const response = (participants: UploadParticipantDto[]): UploadStatusResponse => ({
  class_id: 'c1', session_id: 's1', session_status: 'completed', as_of: '2026-11-12T05:10:00Z', basis: 'server_received', poll_interval_sec: 3, etag: 'W/"a"',
  summary: { participants: participants.length, needs_attention: participants.length, uploading: 0, received_unreconciled: 0, no_data: 0, excluded: 0 }, participants,
});

let root: Root; let host: HTMLDivElement;
beforeEach(() => { api.fetchBandDeviceUsage.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const mount = async (data: UploadStatusResponse) => { await act(async () => root.render(<MemoryRouter><UploadStatusTable data={data} /></MemoryRouter>)); };

describe('순수 규칙', () => {
  it('시리얼을 앞부분·끝 4자로 나누고, 없거나 공백이면 null', () => {
    expect(splitBandSerial({ band_serial: 'LXB-0263008A' })).toEqual({ head: 'LXB-0263', tail: '008A' });
    expect(splitBandSerial({ band_serial: null })).toBeNull();
    expect(splitBandSerial({ band_serial: '  ' })).toBeNull();
    expect(splitBandSerial({})).toBeNull();
    expect(splitBandSerial({ band_serial: 'AB' })).toEqual({ head: '', tail: 'AB' });
  });
  it('검색은 이름과 시리얼(대소문자 무시) 모두에 맞는다', () => {
    const p = person('1', '가가', { band_serial: 'LXB-0263008A' });
    expect(matchesParticipantQuery(p, '008a')).toBe(true);
    expect(matchesParticipantQuery(p, '가')).toBe(true);
    expect(matchesParticipantQuery(p, 'zzz')).toBe(false);
    expect(matchesParticipantQuery(p, '  ')).toBe(true);
  });
});

describe('업로드 현황 시리얼 칼럼', () => {
  it('시리얼이 있으면 끝 4자를 강조해 보이고, 없거나 구 서버(필드 없음)면 "미수집"', async () => {
    await mount(response([person('1', '가가', { band_serial: 'LXB-0263008A' }), person('2', '나나', { band_serial: null }), person('3', '다다')]));
    const cells = [...host.querySelectorAll('[data-testid="band-serial"]')];
    expect(cells.map((c) => c.textContent)).toEqual(['LXB-0263008A', '미수집', '미수집']);
    expect(cells[0].querySelector('b')?.textContent).toBe('008A');
    expect(host.textContent).toContain('밴드 시리얼');
  });
  it('시리얼로 검색하면 해당 참여자만 남는다', async () => {
    await mount(response([person('1', '가가', { band_serial: 'LXB-0263008A' }), person('2', '나나', { band_serial: 'LXB-11112222' })]));
    const input = host.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '2222');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const names = [...host.querySelectorAll('[data-testid="upload-row"]')].map((r) => r.querySelector('td')?.textContent);
    expect(names).toEqual(['나나']);
  });
  it('시리얼을 누르면 사용 이력 시트가 열리고 회차·교체·스트림 수를 보여 준다', async () => {
    api.fetchBandDeviceUsage.mockResolvedValue({
      serial: 'LXB-0263008A', truncated: false,
      items: [{ session_id: 's9', session_title: '대구 몸돌봄', session_started_at: '2026-11-11T05:00:00Z', participant_id: 'p1', display_name: '가가', firmware: '1.0.4', platform: 'android', first_seen_at: '2026-11-11T05:01:00Z', last_seen_at: '2026-11-11T06:01:00Z', is_current: false, stream_count: 3, superseded_count: 2 }],
    });
    await mount(response([person('1', '가가', { band_serial: 'LXB-0263008A' })]));
    await act(async () => { (host.querySelector('button[data-testid="band-serial"]') as HTMLButtonElement).click(); });
    expect(api.fetchBandDeviceUsage).toHaveBeenCalledWith('LXB-0263008A');
    const sheet = document.querySelector('[data-testid="band-usage-sheet"]');
    expect(sheet?.textContent).toContain('대구 몸돌봄');
    expect(sheet?.textContent).toContain('중간에 다른 밴드로 교체됨');
    expect(sheet?.textContent).toContain('스트림 3개 · 교체로 닫힌 스트림 2개');
    expect(sheet?.textContent).toContain('펌웨어 1.0.4');
  });
  it('이력 조회 실패(권한 등)는 안내만 보이고 화면이 깨지지 않는다', async () => {
    api.fetchBandDeviceUsage.mockRejectedValue(new Error('403'));
    await mount(response([person('1', '가가', { band_serial: 'LXB-0263008A' })]));
    await act(async () => { (host.querySelector('button[data-testid="band-serial"]') as HTMLButtonElement).click(); });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('불러오지 못했어요');
  });
});
