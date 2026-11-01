// SDD-267: 최종 확인 대기 보조 표기 — 어댑터·판정 불변·분류·문구·금지어
import { describe, expect, it } from 'vitest';
import { normalizePersonProgress, normalizeSessionProgress } from '../../src/lib/api/upload-progress';
import { normalizeMySessions } from '../../src/lib/api/my-upload-status';
import {
  BUCKET_LABEL, FINAL_PENDING_CHIP, FINAL_PENDING_COACH, FINAL_PENDING_MEMBER, FINAL_PENDING_PERSON_NOTE, boardState, finalPendingCount, personBucket, showFinalPending, transferPercent,
} from '../../src/lib/upload-status/board';
import { memberFinalPending, memberKind, memberLine, memberPercent } from '../../src/lib/upload-status/member-view';
import type { MySessionRow } from '../../src/lib/api/my-upload-status';

const r = (e: number | null, v: number, p: number | null) => ({ expected: e, received: v, percent: p });
const personRaw = (o = {}) => ({ state: 'in_progress', feature: r(10, 10, 100), raw: { eeg: r(5, 5, 100), ppg: r(5, 5, 100), acc: r(5, 5, 100) }, total: r(25, 25, 100), ...o });
const part = (o = {}) => ({ total: 4, counted: 4, all_received: 3, in_progress: 1, needs_attention: 0, expected_unknown: 0, not_collected: 0, final_pending: 1, ...o });
const sessRaw = (p = part()) => ({ participants: p, feature: r(1, 1, 100), raw: { eeg: r(1, 1, 100), ppg: r(1, 1, 100), acc: r(1, 1, 100) }, overall: r(10, 10, 100) });
const BAN = /완료|점수|종합|좋음|나쁨|보증|feature|원시|EEG|PPG|ACC|업로드|수신/;

describe('어댑터', () => {
  it('참여자 final_pending: true 만 true, 없으면 false(구 서버)', () => {
    expect(normalizePersonProgress(personRaw({ final_pending: true }))?.final_pending).toBe(true);
    expect(normalizePersonProgress(personRaw())?.final_pending).toBe(false);
    expect(normalizePersonProgress(personRaw({ final_pending: 'yes' }))?.final_pending).toBe(false);
  });
  it('회차 합계 final_pending 인원, 없으면 0', () => {
    expect(normalizeSessionProgress(sessRaw())?.participants.final_pending).toBe(1);
    const old = sessRaw(); delete (old.participants as Record<string, unknown>).final_pending;
    expect(normalizeSessionProgress(old)?.participants.final_pending).toBe(0);
  });
  it('회원 행 final_pending', () => {
    const base = { session_id: 's1', class_id: 'c' };
    const out = normalizeMySessions({ items: [{ ...base, final_pending: true }, { ...base, session_id: 's2' }] });
    expect(out.items.map((i) => i.final_pending)).toEqual([true, false]);
  });
});

describe('판정 불변', () => {
  const sess = (p = part()) => ({ progress: normalizeSessionProgress(sessRaw(p)), summary: { participants: 4, needs_attention: 0, uploading: 0, received_unreconciled: 0, no_data: 0, excluded: 0 }, session_status: 'completed', status: null }) as Parameters<typeof boardState>[0];
  it('final_pending 이 있어도 boardState 는 sending 그대로(ok 로 승격하지 않는다)', () => {
    expect(boardState(sess())).toBe('sending');
    expect(boardState(sess(part({ final_pending: 0 })))).toBe('sending');
  });
  it('전송 % 는 99% 상한 유지', () => { expect(transferPercent(undefined, r(10, 10, 100), false)).toBe(99); });
  it('확인할 사람이 있으면 warn 이 우선이라 칩을 보이지 않는다', () => {
    expect(boardState(sess(part({ needs_attention: 1 })))).toBe('warn');
    expect(showFinalPending('warn', 1)).toBe(false);
    expect(showFinalPending('live', 1)).toBe(false);
    expect(showFinalPending('ok', 1)).toBe(false);
    expect(showFinalPending('sending', 0)).toBe(false);
    expect(showFinalPending('sending', 2)).toBe(true);
  });
  it('finalPendingCount: progress 없으면 0', () => {
    expect(finalPendingCount({ progress: null })).toBe(0);
    expect(finalPendingCount({ progress: normalizeSessionProgress(sessRaw()) })).toBe(1);
  });
});

describe('참여자 분류', () => {
  it('in_progress + final_pending → final_pending 그룹(확인할 사람 아님)', () => {
    expect(personBucket({ progress: normalizePersonProgress(personRaw({ final_pending: true })) })).toBe('final_pending');
    expect(personBucket({ progress: normalizePersonProgress(personRaw()) })).toBe('waiting');
  });
  it('needs_attention 이면 final_pending 이 있어도 attention', () => {
    expect(personBucket({ progress: normalizePersonProgress(personRaw({ state: 'needs_attention', final_pending: true })) })).toBe('attention');
  });
  it('all_received 는 arrived 그대로', () => {
    expect(personBucket({ progress: normalizePersonProgress(personRaw({ state: 'all_received', final_pending: true })) })).toBe('arrived');
  });
});

describe('회원', () => {
  const row = (o: Partial<MySessionRow> = {}): MySessionRow => ({
    session_id: 's', class_id: 'c', class_title: null, seq: 1, org_name: null, session_status: 'completed', started_at: null, ended_at: null,
    status: 'received_unreconciled', collection_state: 'eligible', progress_state: 'in_progress', percent: 100, final_pending: true,
    bytes_arrived: 1, bytes_expected: 1, duration_min: 1, measured_min: 1, last_received_at: null, ...o,
  });
  it('전송 중 + final_pending 에서만 한 줄·99% 상한', () => {
    const k = memberKind(row());
    expect(k).toBe('sending');
    expect(memberFinalPending(row(), k)).toBe(true);
    expect(memberLine(k, true)).toBe(FINAL_PENDING_MEMBER);
    expect(memberPercent(row(), k)).toBe(99);
    expect(memberFinalPending(row({ final_pending: false }), k)).toBe(false);
    expect(memberFinalPending(row({ progress_state: 'all_received' }), memberKind(row({ progress_state: 'all_received' })))).toBe(false);
    expect(memberFinalPending(row({ collection_state: 'excluded' }), memberKind(row({ collection_state: 'excluded' })))).toBe(false);
  });
});

describe('문구', () => {
  it('정해진 문구와 금지어 없음', () => {
    expect(FINAL_PENDING_CHIP).toBe('모두 도착 · 최종 확인 대기');
    expect(BUCKET_LABEL.final_pending).toBe('최종 확인 대기');
    for (const t of [FINAL_PENDING_CHIP, FINAL_PENDING_COACH, FINAL_PENDING_PERSON_NOTE, FINAL_PENDING_MEMBER, BUCKET_LABEL.final_pending]) expect(t).not.toMatch(BAN);
  });
});
