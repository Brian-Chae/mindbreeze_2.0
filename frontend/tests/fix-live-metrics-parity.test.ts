// [MB261026][FIX] 상담사 화면 집중도·정서 안정 항상 "-" + 회원 화면과 숫자 불일치 (dev 세션 9f723021 실측)
// 1) v2 어댑터가 focus_display·emotion_display 를 행에 싣지 않고, hostMetricValues 는 이 둘을 WS extras 에서만 읽었다.
// 2) 회원 화면은 앱(native)·웹 band 계산값, 상담사는 서버 LiveState → 같은 출처(LiveState)로 맞춘다.
import { describe, expect, it } from 'vitest';
import { PID, SID, event, metricsData, snapshot } from './sdd246-web/fixtures';
import { applyEvent, applySnapshot, createLiveState, type LiveState } from '../src/lib/session-live/live-state';
import { toSessionLiveMetrics } from '../src/lib/session-live/live-legacy-adapter';
import { toHostParticipant } from '../src/components/class/player/host/host-live-model';
import { liveMetricSnapshot } from '../src/lib/session-live/live-metric-snapshot';

const NOW = 1_760_000_002_000;
function withMetrics(): LiveState {
  const s0 = { ...createLiveState({ sessionId: SID }), expected: { requestId: snapshot().request_id, generation: '7' } };
  let st = applySnapshot(s0, snapshot()).state;
  const d = metricsData('42', NOW - 1000, 71) as { metrics: Record<string, unknown> };
  const v = (value: number | null, validity = 'valid') => ({ value, unit: 'score_0_100', validity, reason: null, last_valid_sequence: null, last_valid_observed_at_ms: null });
  d.metrics = { ...d.metrics, focus_display: v(64), emotion_display: v(38), relaxation_display: v(55), bpm: v(null, 'warming_up') };
  st = applyEvent(st, event('metrics', 'metrics.updated', '42', '4', d)).state;
  return st;
}

describe('상담사 화면 6지표', () => {
  it('집중도·정서 안정도 LiveState 에서 바로 나온다(extras 없이)', () => {
    const rows = toSessionLiveMetrics(withMetrics(), { nowMs: NOW });
    const host = toHostParticipant(rows[0]!, { nowMs: NOW });
    expect(host.values.focus).toBe(64);
    expect(host.values.emotional).toBe(38);
    expect(host.values.relaxation).toBe(55);
    expect(host.values.bpm).toBeNull();
  });
});

describe('회원 화면 = 상담사 화면 같은 값', () => {
  it('liveMetricSnapshot 은 상담사 타일과 같은 수치를 돌려준다', () => {
    const st = withMetrics();
    const host = toHostParticipant(toSessionLiveMetrics(st, { nowMs: NOW })[0]!, { nowMs: NOW });
    const member = liveMetricSnapshot(st, PID, NOW);
    expect(member).toEqual({ focus: host.values.focus, relaxation: host.values.relaxation, emotional: host.values.emotional, bpm: null, respiration: null, hrv: null });
  });
  it('관측이 10초 넘게 끊기면 전 지표 null(상담사 "-" 와 동일, 다른 출처로 폴백하지 않음)', () => {
    expect(liveMetricSnapshot(withMetrics(), PID, NOW + 30_000)).toEqual({ focus: null, relaxation: null, emotional: null, bpm: null, respiration: null, hrv: null });
  });
  it('지표가 없으면 null(기존 경로로 폴백)', () => {
    const st = { ...withMetrics(), metrics: {} } as LiveState;
    expect(liveMetricSnapshot(st, PID, NOW)).toBeNull();
  });
});
