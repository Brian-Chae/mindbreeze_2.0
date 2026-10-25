// SDD-246 T06 — 감사 보고서 A5·B1·B2 재현 + 단일 reducer 보장.
// 시나리오: joined → metric → lower → heartbeat → 늦은 GET(rich participant 포함)
import { describe, expect, it } from 'vitest';
import { RICH_LEGACY_PARTICIPANT, PID, event, metricsData, snapshot } from './fixtures';
import {
  applyEvent,
  applyHeartbeat,
  applyRestSnapshot,
  applySnapshot,
  createLiveState,
  type LiveState,
} from '../../src/lib/session-live/live-state';
import { buildMemberRows } from '../../src/lib/session-live/live-view';

/** 현행 ClassPlayerPage.tsx:1141-1146 병합식 그대로(`...p` 가 뒤에서 덮는다). 결함 재현용 복사본. */
function legacyMerge(latest: Record<string, unknown>, rich: Record<string, unknown>): Record<string, unknown> {
  return { display_name: '참가자', device_status: null, current_efficiency: null, last_eeg_at: null, ...latest, ...rich };
}

function ready(): LiveState {
  const s0 = createLiveState({ sessionId: snapshot().session_id });
  const begun = { ...s0, expected: { requestId: snapshot().request_id, generation: '7' } };
  return applySnapshot(begun, snapshot()).state;
}

describe('A5/B1/B2 재현 — 현행 병합식은 최신 값을 덮는다(RED 증거)', () => {
  it('현행 식: 최신 측정행 + rich 참여행 → device null·이완 null·과거 손 true 로 되돌아간다', () => {
    const latest = { device_status: 'ok', current_efficiency: 55, last_eeg_at: '2026-10-26T00:00:05Z', raise_hand: false };
    const merged = legacyMerge(latest, RICH_LEGACY_PARTICIPANT as unknown as Record<string, unknown>);
    expect(merged.device_status).toBeNull();
    expect(merged.current_efficiency).toBeNull();
    expect(merged.raise_hand).toBe(true);
  });
});

describe('단일 reducer — joined→metric→lower→heartbeat→늦은 GET', () => {
  it('rich participant·늦은 GET·null 이 최신 지표와 손 상태를 덮지 못한다', () => {
    let st = ready();
    // metric(seq 42, 더 최신 관측)
    st = applyEvent(st, event('metrics', 'metrics.updated', '42', '4', metricsData('42', 1_760_000_001_000, 71))).state;
    // 손 내리기
    st = applyEvent(st, event('speaking', 'speaking.changed', '6', '4', { participant_id: PID, hand_raised: false, can_publish: false, grant_version: '1' })).state;
    // heartbeat(through 가 상태와 같음 → 무해)
    const hb = applyHeartbeat(st, { session_id: st.sessionId, epoch: '1', auth_revision: '4', server_time_ms: 1_760_000_005_000, through: [
      { audience: 'host', domain: 'metrics', seq: '42' },
      { audience: 'host', domain: 'speaking', seq: '6' },
    ] });
    expect(hb.effects).toEqual([]);
    st = hb.state;
    // 늦게 도착한 과거 GET snapshot: 손 true·지표 null·rich 참여객체
    const late = snapshot({
      request_id: '00000099-0000-4000-8000-000000000099',
      through: [
        { audience: 'host', domain: 'metrics', seq: '41' },
        { audience: 'host', domain: 'speaking', seq: '5' },
      ],
    });
    const lateRes = applyRestSnapshot({ ...st, expected: { requestId: late.request_id, generation: '7' } }, late);
    expect(lateRes.applied).toBe(false);
    st = lateRes.state;

    const rows = buildMemberRows(st, { nowMs: 1_760_000_002_000, legacy: [RICH_LEGACY_PARTICIPANT] });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.handRaised).toBe(false);
    expect(row.metrics.focus_display.value).toBe(71);
    expect(row.metrics.focus_display.validity).toBe('valid');
    expect(row.sequence).toBe('42');
    // rich 객체의 null 이 숫자·장치 상태를 지우지 못한다
    expect(row.deviceContact).toEqual({ fp1: 'contact', fp2: 'contact' });
  });

  it('이전 seq(중복) 이벤트는 폐기하고 gap 이면 resync 를 요청한다', () => {
    let st = ready();
    st = applyEvent(st, event('metrics', 'metrics.updated', '42', '4', metricsData('42', 1_760_000_001_000, 71))).state;
    const dup = applyEvent(st, event('metrics', 'metrics.updated', '42', '4', metricsData('42', 1_760_000_001_000, 10)));
    expect(dup.state).toBe(st);
    const gap = applyEvent(st, event('metrics', 'metrics.updated', '45', '7', metricsData('45', 1_760_000_004_000, 90)));
    expect(gap.effects).toContainEqual({ type: 'resync', reason: 'seq_gap' });
    expect(buildMemberRows(gap.state, { nowMs: 1_760_000_002_000 })[0]!.metrics.focus_display.value).toBe(71);
  });

  it('낮은 entity_version 이벤트는 순서가 맞아도 필드를 낮추지 못한다', () => {
    let st = ready();
    st = applyEvent(st, event('speaking', 'speaking.changed', '6', '9', { participant_id: PID, hand_raised: false, can_publish: false, grant_version: '1' })).state;
    st = applyEvent(st, event('speaking', 'speaking.changed', '7', '4', { participant_id: PID, hand_raised: true, can_publish: false, grant_version: '1' })).state;
    expect(buildMemberRows(st, { nowMs: 0 })[0]!.handRaised).toBe(false);
  });

  it('heartbeat through 가 상태보다 앞서면 유실로 보고 resync', () => {
    const st = ready();
    const hb = applyHeartbeat(st, { session_id: st.sessionId, epoch: '1', auth_revision: '4', server_time_ms: 1, through: [{ audience: 'host', domain: 'metrics', seq: '44' }] });
    expect(hb.effects).toContainEqual({ type: 'resync', reason: 'heartbeat_ahead' });
  });
});
