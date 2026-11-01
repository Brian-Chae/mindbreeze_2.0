// SDD-262: 회원 본인 데이터 저장 현황 순수 로직 (V-M08~V-M13, V-M22)
import { describe, expect, it } from 'vitest';
import {
  buildMyStatus, MY_STATUS_LABEL, pickCandidateSessions, type MyFeatureSummary, type MyRawSummary, type SessionCandidateInput,
} from '../src/lib/upload-status/member-view';

const feat = (total: number, updated: string | null = null): MyFeatureSummary => ({ session_id: 's', participant_id: 'p', total_count: total, streams: [], updated_at: updated });
const raw = (o: Partial<MyRawSummary> = {}): MyRawSummary => ({
  session_id: 's', participant_id: 'p', total: 0, uploaded: 0, pending: 0, failed: 0, updated_at: null,
  streams: [], ...o,
});

describe('buildMyStatus', () => {
  it('failed>0 → 확인 필요 (V-M11)', () => {
    expect(buildMyStatus(feat(10), raw({ total: 5, uploaded: 3, failed: 2 })).kind).toBe('needs_attention');
  });
  it('pending>0 → 업로드 중', () => {
    expect(buildMyStatus(feat(10), raw({ total: 5, uploaded: 3, pending: 2 })).kind).toBe('uploading');
  });
  it('수신>0, pending/failed 0 → 수신 확인', () => {
    expect(buildMyStatus(feat(10), raw({ total: 5, uploaded: 5 })).kind).toBe('received');
  });
  it('둘 다 0 → 수신 기록 없음, 확인 필요 아님 (V-M13)', () => {
    const s = buildMyStatus(feat(0), raw());
    expect(s.kind).toBe('no_data');
    expect(s.kind).not.toBe('needs_attention');
  });
  it('feature 수와 raw 합계 일치 (V-M09/M10)', () => {
    const s = buildMyStatus(feat(520), raw({ total: 12, uploaded: 9, pending: 2, failed: 1, streams: [
      { stream_id: 'a', segment_id: 'g', signal_type: 'eeg', uploaded: 5, pending: 1, failed: 0, missing_ranges: [], truncated: false, min_index: 0, max_index: 5 },
      { stream_id: 'a', segment_id: 'g', signal_type: 'eeg', uploaded: 1, pending: 0, failed: 1, missing_ranges: [], truncated: false, min_index: 0, max_index: 1 },
      { stream_id: 'a', segment_id: 'g', signal_type: 'ppg', uploaded: 3, pending: 1, failed: 0, missing_ranges: [], truncated: false, min_index: 0, max_index: 3 },
    ] }));
    expect(s.featureWindows).toBe(520);
    expect(s.raw).toEqual({ registered: 12, uploaded: 9, pending: 2, failed: 1 });
    const eeg = s.signals.find((x) => x.signal === 'eeg');
    expect(eeg).toEqual({ signal: 'eeg', uploaded: 6, pending: 1, failed: 1 });
    expect(s.signals.map((x) => x.signal)).toEqual(['eeg', 'ppg', 'acc']);
    expect(s.signals.find((x) => x.signal === 'acc')).toEqual({ signal: 'acc', uploaded: 0, pending: 0, failed: 0 });
  });
  it('마지막 수신은 두 updated_at 중 늦은 값 (V-M12)', () => {
    expect(buildMyStatus(feat(1, '2026-11-01T01:00:00+00:00'), raw({ updated_at: '2026-11-01T02:00:00+00:00' })).lastReceivedAt).toBe('2026-11-01T02:00:00+00:00');
    expect(buildMyStatus(feat(1, '2026-11-01T03:00:00+00:00'), raw({ updated_at: null })).lastReceivedAt).toBe('2026-11-01T03:00:00+00:00');
    expect(buildMyStatus(feat(0), raw()).lastReceivedAt).toBeNull();
  });
  it('라벨에 금지 문구 없음 (V-M22)', () => {
    const all = Object.values(MY_STATUS_LABEL).join(' ');
    expect(all).not.toMatch(/완료|100%|점수|종합|좋음|나쁨|정상 작동|보증/);
  });
});

describe('pickCandidateSessions', () => {
  const base = (o: Partial<SessionCandidateInput>): SessionCandidateInput => ({ id: 'x', seq: 1, scheduled_at: '2026-10-01T00:00:00Z', status: 'completed', attendance: { entered_at: null }, classTitle: '클래스', ...o });
  it('본인 attendance 없는 회차·예정 회차 제외, 최근순 (V-M08)', () => {
    const rows = [
      base({ id: 'a', scheduled_at: '2026-10-01T00:00:00Z' }),
      base({ id: 'b', scheduled_at: '2026-10-05T00:00:00Z', status: 'in_progress' }),
      base({ id: 'c', attendance: null }),
      base({ id: 'd', status: 'scheduled' }),
      base({ id: 'e', status: 'cancelled' }),
    ];
    expect(pickCandidateSessions(rows).map((r) => r.id)).toEqual(['b', 'a']);
  });
});
