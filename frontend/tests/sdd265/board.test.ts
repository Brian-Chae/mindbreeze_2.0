// SDD-265: 상황판 순수 로직 — 상태 판정·표기·%·조치 문구·참여자 분류·금지어
import { describe, expect, it } from 'vitest';
import {
  BOARD_LABEL, MEMBER_LABEL, arrivedText, basisNote, boardState, coachAction, formatBytes, formatMinutes, formatTotalHours, memberAction,
  pageCount, personBucket, slicePage, transferPercent,
} from '../../src/lib/upload-status/board';
import { memberKind, memberLine, memberPercent } from '../../src/lib/upload-status/member-view';
import type { MySessionRow } from '../../src/lib/api/my-upload-status';

const sum = (o = {}) => ({ participants: 40, needs_attention: 0, uploading: 0, received_unreconciled: 0, no_data: 0, excluded: 0, ...o });
const part = (o = {}) => ({ total: 40, counted: 38, all_received: 36, in_progress: 0, needs_attention: 0, expected_unknown: 2, not_collected: 2, ...o });
const r = (e: number | null, v: number, p: number | null) => ({ expected: e, received: v, percent: p });
const prog = (p = part()) => ({ participants: p, feature: r(1, 1, 100), raw: { eeg: r(1, 1, 100), ppg: r(1, 1, 100), acc: r(1, 1, 100) }, overall: r(10, 9, 90) });
const sess = (o = {}) => ({ progress: prog(), summary: sum(), session_status: 'completed', status: null, ...o }) as Parameters<typeof boardState>[0];

describe('boardState', () => {
  it('확인할 사람이 있으면 warn 이 최우선', () => {
    expect(boardState(sess({ progress: prog(part({ needs_attention: 2 })), session_status: 'in_progress' }))).toBe('warn');
  });
  it('진행 중이면 live', () => { expect(boardState(sess({ session_status: 'in_progress' }))).toBe('live'); });
  it('counted 전원 all_received 면 ok', () => {
    expect(boardState(sess({ progress: prog(part({ counted: 38, all_received: 38, expected_unknown: 0 })) }))).toBe('ok');
  });
  it('기대량 미확인 전원이면 pending, 일부 도착 중이면 sending', () => {
    expect(boardState(sess({ progress: prog(part({ counted: 38, all_received: 0, expected_unknown: 38 })) }))).toBe('pending');
    expect(boardState(sess({ progress: prog(part({ counted: 38, all_received: 20, in_progress: 16, expected_unknown: 2 })) }))).toBe('sending');
  });
  it('progress 가 없으면(구 서버) 모두 도착을 만들지 않고 집계 대기', () => {
    expect(boardState(sess({ progress: null }))).toBe('pending');
    expect(boardState(sess({ progress: null, summary: sum({ uploading: 1 }) }))).toBe('sending');
    expect(boardState(sess({ progress: null, summary: sum({ needs_attention: 1 }) }))).toBe('warn');
  });
});

describe('표기', () => {
  it('데이터 크기: 모르면 —, MB/GB 단위', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(27_000_000)).toBe('26MB');
    expect(formatBytes(1_180_000_000)).toBe('1.10GB');
    expect(formatBytes(0)).toBe('0KB');
  });
  it('측정 길이·참여자 합계 시간', () => {
    expect(formatMinutes(52)).toBe('52분'); expect(formatMinutes(null)).toBe('—');
    expect(formatTotalHours(2082)).toBe('34.7시간');
  });
  it('도착한 참여자 N/M명, 분모 모르면 —', () => {
    expect(arrivedText({ participants_arrived: 36, participants_expected: 38 })).toBe('36/38명');
    expect(arrivedText({ participants_arrived: 3, participants_expected: null })).toBe('—');
    expect(arrivedText(undefined)).toBe('—');
  });
  it('전송 현황 %: 모두 도착이 아니면 99% 를 넘기지 않고 내림', () => {
    const m = { participants_expected: 1, participants_arrived: 1, measured_min: null, bytes_arrived: 999, bytes_expected: 1000, duration_min: 1, participant_minutes_total: 1 };
    expect(transferPercent(m, null, false)).toBe(99);
    expect(transferPercent({ ...m, bytes_arrived: 1000 }, null, false)).toBe(99);
    expect(transferPercent({ ...m, bytes_arrived: 1000 }, null, true)).toBe(100);
    expect(transferPercent({ ...m, bytes_expected: null }, r(10, 9, 94.2), false)).toBe(94);
    expect(transferPercent({ ...m, bytes_expected: null }, r(null, 0, null), false)).toBeNull();
  });
  it('근거 한 줄: 확인된 N명 기준·집계 대기·수집 제외', () => {
    expect(basisNote(prog(), 'warn')).toBe('확인된 36명 기준 · 2명 집계 대기 · 2명 수집 제외');
    expect(basisNote(prog(part({ counted: 40, all_received: 40, expected_unknown: 0, not_collected: 0 })), 'ok')).toBe('40명 모두 도착');
    expect(basisNote(null, 'pending')).toBe('전체 예상 크기 확인 전');
  });
});

describe('조치 문구·금지어', () => {
  it('코치 조치는 실제 가능한 행동만, 발송·메일 표현 없음', () => {
    const all = [coachAction('warn', 2), coachAction('live', 0), coachAction('sending', 0), coachAction('pending', 0), memberAction('warn'), memberAction('live'), memberAction('pending'), memberAction('ok')].join(' ');
    expect(coachAction('ok', 0)).toBeNull();
    expect(all).toContain('2명이 앱을 다시 켜고 와이파이에 연결하면 이어서 도착해요');
    expect(all).not.toMatch(/발송|메일|알림 보내|점수|완료|보증|좋음|나쁨/);
  });
  it('라벨에 금지어 없음 (feature/원시/EEG/PPG/ACC/업로드/수신/완료/점수)', () => {
    const all = [...Object.values(BOARD_LABEL), ...Object.values(MEMBER_LABEL)].join(' ');
    expect(all).not.toMatch(/feature|원시|raw|EEG|PPG|ACC|업로드|수신|완료|점수|종합|좋음|나쁨|보증/i);
  });
});

describe('참여자 분류·페이지', () => {
  it('progress.state 로 분류하고 구 서버면 기존 status 로 후퇴', () => {
    const p = (state: string) => ({ progress: { state, feature: r(1, 1, 100), raw: { eeg: r(1, 1, 100), ppg: r(1, 1, 100), acc: r(1, 1, 100) }, total: r(1, 1, 100) } }) as Parameters<typeof personBucket>[0];
    expect(personBucket(p('needs_attention'))).toBe('attention');
    expect(personBucket(p('all_received'))).toBe('arrived');
    expect(personBucket(p('not_collected'))).toBe('excluded');
    expect(personBucket(p('in_progress'))).toBe('waiting');
    expect(personBucket(p('expected_unknown'))).toBe('waiting');
    expect(personBucket({ progress: null, status: 'needs_attention' })).toBe('attention');
    expect(personBucket({ progress: null, collection_state: 'excluded' })).toBe('excluded');
    expect(personBucket({ progress: null })).toBe('waiting');
  });
  it('10명씩 페이지', () => {
    const rows = Array.from({ length: 36 }, (_, i) => i);
    expect(pageCount(36)).toBe(4); expect(pageCount(0)).toBe(1);
    expect(slicePage(rows, 3)).toEqual([30, 31, 32, 33, 34, 35]);
    expect(slicePage(rows, 0)).toHaveLength(10);
  });
});

const myRow = (o: Partial<MySessionRow> = {}): MySessionRow => ({
  session_id: 's', class_id: 'c', class_title: 'A', seq: 1, org_name: null, session_status: 'completed', started_at: null, ended_at: null, status: 'received_unreconciled',
  collection_state: 'eligible', progress_state: 'in_progress', percent: 87.4, bytes_arrived: 27e6, bytes_expected: 31e6, duration_min: 52, measured_min: 51, last_received_at: null, ...o,
});
describe('회원 상태', () => {
  it('수집 제외는 문제가 아니다(확인 필요가 되지 않음)', () => {
    const k = memberKind(myRow({ collection_state: 'excluded', status: 'no_data', progress_state: 'not_collected' }));
    expect(k).toBe('excluded');
    expect(memberLine(k)).toContain('문제가 아니에요');
    expect(memberPercent(myRow({ collection_state: 'excluded' }), k)).toBeNull();
  });
  it('확인 필요 > 측정 중 > 모두 도착 > 전송 중 > 집계 대기', () => {
    expect(memberKind(myRow({ status: 'needs_attention' }))).toBe('warn');
    expect(memberKind(myRow({ session_status: 'in_progress' }))).toBe('live');
    expect(memberKind(myRow({ progress_state: 'all_received' }))).toBe('ok');
    expect(memberKind(myRow({ status: 'uploading', progress_state: 'in_progress' }))).toBe('sending');
    expect(memberKind(myRow({ status: 'no_data', progress_state: 'expected_unknown' }))).toBe('pending');
  });
  it('전송 현황: 서버 percent 내림, 모두 도착 아니면 99 상한, 근거 없으면 null', () => {
    expect(memberPercent(myRow({ percent: 87.4 }), 'sending')).toBe(87);
    expect(memberPercent(myRow({ percent: 100 }), 'sending')).toBe(99);
    expect(memberPercent(myRow({ percent: 100 }), 'ok')).toBe(100);
    expect(memberPercent(myRow({ percent: null, bytes_expected: null }), 'pending')).toBeNull();
    expect(memberPercent(myRow({ percent: null, bytes_arrived: 15, bytes_expected: 31 }), 'sending')).toBe(48);
  });
});
