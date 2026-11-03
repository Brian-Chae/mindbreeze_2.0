// SDD-278: 하위호환 — 새 필드가 든 응답을 구버전 앱(main 고정 사본) 파서가 오류 없이 expected_unknown 으로 읽는다(V13),
// 새 필드 없는 구서버 응답을 새 파서가 false/0 으로 처리한다(V14).
import { describe, expect, it } from 'vitest';
import { normalizePersonProgress as legacyPerson, normalizeSessionProgress as legacySession } from './legacy/upload-progress.legacy';
import { normalizeMySessions as legacyMy } from './legacy/my-upload-status.legacy';
import { normalizePersonProgress, normalizeSessionProgress } from '../../src/lib/api/upload-progress';
import { normalizeMySessions } from '../../src/lib/api/my-upload-status';
import { ABNORMAL_EXIT_NOTE, BUCKET_LABEL, boardState, personBucket } from '../../src/lib/upload-status/board';

const r = (e: number | null, v: number, p: number | null) => ({ expected: e, received: v, percent: p });
const personNew = { state: 'expected_unknown', feature: r(null, 7, null), raw: { eeg: r(null, 1, null), ppg: r(null, 1, null), acc: r(null, 1, null) }, total: r(null, 0, null), final_pending: false, abnormal_exit_suspected: true };
const sessNew = { participants: { total: 3, counted: 3, all_received: 1, in_progress: 0, needs_attention: 0, expected_unknown: 2, not_collected: 0, final_pending: 0, abnormal_exit_suspected: 1 }, feature: r(1, 1, 100), raw: { eeg: r(1, 1, 100), ppg: r(1, 1, 100), acc: r(1, 1, 100) }, overall: r(4, 4, 100) };
const rowNew = { session_id: 's1', class_id: 'c1', status: 'received_unreconciled', collection_state: 'eligible', progress_state: 'expected_unknown', percent: null, final_pending: false, abnormal_exit_suspected: true, session_status: 'completed' };

describe('V13 구버전 파서(고정 사본)가 새 응답을 읽는다', () => {
  it('참여자 progress → state === expected_unknown, 오류 없음', () => {
    expect(legacyPerson(personNew)?.state).toBe('expected_unknown');
  });
  it('회차 합계 → expected_unknown 인원 유지, 모르는 필드는 버려짐', () => {
    const s = legacySession(sessNew);
    expect(s?.participants.expected_unknown).toBe(2);
    expect((s?.participants as Record<string, unknown>).abnormal_exit_suspected).toBeUndefined();
  });
  it('회원 행 → progress_state === expected_unknown', () => {
    const out = legacyMy({ items: [rowNew] });
    expect(out.items).toHaveLength(1);
    expect(out.items[0].progress_state).toBe('expected_unknown');
  });
  it('새 state 열거값을 만들지 않았다: 새 파서의 STATES 에 없는 값은 여전히 null', () => {
    expect(normalizePersonProgress({ ...personNew, state: 'abnormal_exit_suspected' })).toBeNull();
    expect(legacyPerson({ ...personNew, state: 'abnormal_exit_suspected' })).toBeNull(); // 구버전이 모르는 값은 누락 — 그래서 추가하지 않는다
  });
});

describe('V14 새 파서가 구서버 응답(필드 없음)을 처리한다', () => {
  const { abnormal_exit_suspected: _a, ...personOld } = personNew;
  const { abnormal_exit_suspected: _b, ...partsOld } = sessNew.participants;
  const { abnormal_exit_suspected: _c, ...rowOld } = rowNew;
  it('참여자 false · 합계 0 · 회원 행 false', () => {
    expect(normalizePersonProgress(personOld)?.abnormal_exit_suspected).toBe(false);
    expect(normalizeSessionProgress({ ...sessNew, participants: partsOld })?.participants.abnormal_exit_suspected).toBe(0);
    expect(normalizeMySessions({ items: [rowOld] }).items[0].abnormal_exit_suspected).toBe(false);
  });
  it('새 응답은 true · 인원 그대로', () => {
    expect(normalizePersonProgress(personNew)?.abnormal_exit_suspected).toBe(true);
    expect(normalizeSessionProgress(sessNew)?.participants.abnormal_exit_suspected).toBe(1);
    expect(normalizeMySessions({ items: [rowNew] }).items[0].abnormal_exit_suspected).toBe(true);
  });
  it('문자열 "true" 같은 값은 false', () => {
    expect(normalizePersonProgress({ ...personNew, abnormal_exit_suspected: 'true' })?.abnormal_exit_suspected).toBe(false);
  });
});

describe('판정·분류', () => {
  const sess = (p: Record<string, unknown>) => ({ progress: normalizeSessionProgress({ ...sessNew, participants: { ...sessNew.participants, ...p } }), summary: { participants: 3, needs_attention: 0, uploading: 0, received_unreconciled: 0, no_data: 0, excluded: 0 }, session_status: 'completed', status: null }) as Parameters<typeof boardState>[0];
  it('남은 사람이 전부 의심이면 suspect, 정상 도착과 섞지 않는다', () => {
    expect(boardState(sess({ expected_unknown: 2, abnormal_exit_suspected: 2 }))).toBe('suspect');
    expect(boardState(sess({ all_received: 0, expected_unknown: 3, abnormal_exit_suspected: 3 }))).toBe('suspect');
  });
  it('의심 일부 + 대기 일부는 기존 판정 유지', () => {
    expect(boardState(sess({ all_received: 0, expected_unknown: 3, abnormal_exit_suspected: 1 }))).toBe('pending');
    expect(boardState(sess({ all_received: 1, in_progress: 1, expected_unknown: 1, abnormal_exit_suspected: 1 }))).toBe('sending');
  });
  it('확인할 사람이 있으면 warn 이 우선', () => {
    expect(boardState(sess({ needs_attention: 1, expected_unknown: 1, abnormal_exit_suspected: 1 }))).toBe('warn');
  });
  it('구 서버(필드 없음)는 기존대로 pending', () => {
    expect(boardState(sess({ all_received: 0, expected_unknown: 3, abnormal_exit_suspected: undefined }))).toBe('pending');
  });
  it('personBucket: 의심은 abnormal, needs_attention 은 attention 우선', () => {
    expect(personBucket({ progress: normalizePersonProgress(personNew) })).toBe('abnormal');
    expect(personBucket({ progress: normalizePersonProgress({ ...personNew, state: 'needs_attention' }) })).toBe('attention');
    expect(personBucket({ progress: legacyPerson(personNew) as never })).toBe('waiting'); // 구버전 형태(필드 없음)는 대기
    expect(BUCKET_LABEL.abnormal).toBe('비정상 종료 의심');
  });
  it('문구에 금지 표현이 없다', () => {
    expect(ABNORMAL_EXIT_NOTE).toBe('앱이 정상 종료되지 않아 총량 보고가 없어요. 도착한 데이터는 확인돼요.');
    expect(ABNORMAL_EXIT_NOTE).not.toMatch(/완료|점수|종합|좋음|나쁨|보증|100%|유실|손실|누락/);
  });
});
