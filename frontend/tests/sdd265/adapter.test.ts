// SDD-265: 와이어 → 화면 형태 어댑터(계약 §1~§3). 누락 필드에 안전해야 한다.
import { describe, expect, it } from 'vitest';
import { normalizeOverview, uploadOverviewPath } from '../../src/lib/api/upload-overview';
import { normalizeStatus } from '../../src/lib/api/upload-status';
import { mySessionsPath, normalizeMySessions } from '../../src/lib/api/my-upload-status';
import { normalizePersonProgress, normalizeSessionProgress } from '../../src/lib/api/upload-progress';

describe('목록 어댑터', () => {
  const wire = {
    next_cursor: 'abc', has_more: true, scan_limited: false, total_candidates: 23,
    items: [{ class_id: 'c', session_id: 's', participants: 40, participants_expected: 38, participants_arrived: 36, bytes_arrived: 1_180_000_000, bytes_expected: 1_250_000_000, bytes_basis: 'estimate', duration_min: 52, participant_minutes_total: 2082,
      progress: { participants: { total: 40, counted: 38, all_received: 31, in_progress: 4, needs_attention: 1, expected_unknown: 2, not_collected: 2 }, feature: { expected: 10, received: 9, percent: 90 }, raw: { eeg: { expected: null, received: 0, percent: null } }, overall: { expected: 10, received: 9, percent: 90 } } }],
  };
  it('cursor·has_more·가산 필드를 읽는다', () => {
    const r = normalizeOverview(wire);
    expect(r.next_cursor).toBe('abc'); expect(r.has_more).toBe(true); expect(r.scan_limited).toBe(false);
    expect(r.items[0].metrics).toMatchObject({ participants_expected: 38, participants_arrived: 36, bytes_arrived: 1_180_000_000, bytes_expected: 1_250_000_000, duration_min: 52, participant_minutes_total: 2082 });
    expect(r.items[0].progress?.participants.needs_attention).toBe(1);
    expect(r.items[0].progress?.raw.ppg).toEqual({ expected: null, received: 0, percent: null });
  });
  it('구 서버 응답(가산 필드 없음)도 깨지지 않고 null 로 후퇴', () => {
    const r = normalizeOverview({ items: [{ class_id: 'c', session_id: 's' }] });
    expect(r.next_cursor).toBeNull(); expect(r.has_more).toBe(false); expect(r.items[0].progress).toBeNull();
    expect(r.items[0].metrics).toMatchObject({ bytes_arrived: null, duration_min: null, participants_arrived: null });
  });
  it('요청 경로: limit=10·cursor·needs_attention_only', () => {
    expect(uploadOverviewPath({ limit: 10, cursor: 'a b', needsAttentionOnly: true })).toBe('/upload-status/overview?limit=10&cursor=a+b&needs_attention_only=true');
    expect(uploadOverviewPath({ limit: 10 })).toBe('/upload-status/overview?limit=10');
  });
});

describe('상세·참여자 어댑터', () => {
  it('참여자별 progress·크기·측정 길이, 알 수 없는 state 는 null', () => {
    const r = normalizeStatus({ session_status: 'completed', summary: {}, bytes_arrived: 5, duration_min: 10, participants: [
      { participant_id: 'p', bytes_arrived: 3, measured_min: 9, progress: { state: 'all_received', feature: { expected: 1, received: 1, percent: 100 }, raw: {}, total: { expected: 1, received: 1, percent: 100 } } },
      { participant_id: 'q', progress: { state: '???' } },
      { participant_id: 'r' },
    ] });
    expect(r.metrics?.bytes_arrived).toBe(5);
    expect(r.participants[0].progress?.state).toBe('all_received'); expect(r.participants[0].metrics).toMatchObject({ bytes_arrived: 3, measured_min: 9 });
    expect(r.participants[1].progress).toBeNull(); expect(r.participants[2].progress).toBeNull();
  });
  it('progress 블록 정규화 단독', () => {
    expect(normalizePersonProgress(null)).toBeNull(); expect(normalizeSessionProgress('x')).toBeNull();
  });
});

describe('회원 목록 어댑터', () => {
  it('계약 §3 필드를 읽고 알 수 없는 값은 안전한 기본으로', () => {
    const r = normalizeMySessions({ next_cursor: null, has_more: false, items: [
      { session_id: 's', class_id: 'c', class_title: '아침', seq: 3, organization_name: '기관', session_status: 'completed', started_at: 't', status: 'received_unreconciled', collection_state: 'eligible', progress_state: 'in_progress', percent: 94.2, bytes_arrived: 27e6, bytes_expected: 31e6, duration_min: 52, measured_min: 51, last_received_at: 'x' },
      { session_id: 'z', status: 'weird', collection_state: 'nope', progress_state: 'nope' }, { class_id: 'no-id' },
    ] });
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ org_name: '기관', percent: 94.2, measured_min: 51, progress_state: 'in_progress' });
    expect(r.items[1]).toMatchObject({ status: 'no_data', collection_state: 'unknown', progress_state: null, percent: null });
  });
  it('요청 경로 기본 limit=10', () => {
    expect(mySessionsPath()).toBe('/upload-status/me/sessions?limit=10');
    expect(mySessionsPath({ cursor: 'C' })).toBe('/upload-status/me/sessions?limit=10&cursor=C');
  });
});
