// SDD-272 — 시각 보정 전(time_uncertain)이어도 서버가 방금 받은 값은 가리지 않는다. 수신 경과(서버시계끼리)로만 판정.
import { describe, expect, it } from 'vitest';
import { PID, STREAM, event, metricsData, snapshot } from './sdd246-web/fixtures';
import { applyEvent, applySnapshot, beginResync, createLiveState } from '../src/lib/session-live/live-state';
import { buildMemberRows, displayCell } from '../src/lib/session-live/live-view';
import { toSessionLiveMetrics } from '../src/lib/session-live/live-legacy-adapter';
import { BarAggregator } from '../src/lib/session-live/live-view';
import { collectBars } from '../src/lib/session-live/metric-bars';

const RECV = 1_760_000_000_900;

function stateWith(freshness: 'fresh' | 'time_uncertain', withReceived: boolean) {
  const snap = snapshot({ metrics: { entities: {}, tombstones: [] } });
  const begun = beginResync(createLiveState({ sessionId: snap.session_id }), { requestId: snap.request_id, generation: snap.connection_generation });
  const base = applySnapshot(begun, snap).state;
  const data = { ...metricsData('42', 1_760_000_000_000, 62), freshness, observed_at_ms: freshness === 'time_uncertain' ? null : 1_760_000_000_000 };
  const ev = event('metrics', 'metrics.updated', '42', '5', data);
  if (!withReceived) (ev as { received_at_server_ms?: number }).received_at_server_ms = undefined;
  else ev.received_at_server_ms = RECV;
  return applyEvent(base, ev).state;
}

const cell = (st: ReturnType<typeof stateWith>, nowMs: number) => displayCell(buildMemberRows(st, { nowMs })[0]!, 'focus_display');

describe('SDD-272 time_uncertain 표시 방어', () => {
  it('V1 수신 직후(1s)면 값을 보이고 시각 보정 중 표식', () => {
    const st = stateWith('time_uncertain', true);
    const row = buildMemberRows(st, { nowMs: RECV + 1_000 })[0]!;
    expect(row.timeUncertain).toBe(true);
    expect(displayCell(row, 'focus_display')).toMatchObject({ text: '62', status: 'value', value: 62 });
  });
  it('V2 경계 5000ms=value, 5001ms=delayed', () => {
    const st = stateWith('time_uncertain', true);
    expect(cell(st, RECV + 5_000).status).toBe('value');
    expect(cell(st, RECV + 5_001).status).toBe('delayed');
  });
  it('V3 경계 30000ms=delayed, 30001ms=가림', () => {
    const st = stateWith('time_uncertain', true);
    expect(cell(st, RECV + 30_000).status).toBe('delayed');
    expect(cell(st, RECV + 30_001)).toMatchObject({ text: '-', status: 'stale' });
  });
  it('V4 수신 시각을 모르면(snapshot 복원 등) 기존대로 가린다', () => {
    const st = stateWith('time_uncertain', false);
    expect(cell(st, RECV + 1_000)).toMatchObject({ text: '-', status: 'time_uncertain' });
  });
  it('V5 서버 freshness=fresh 는 기존 동작 그대로, 표식 없음', () => {
    const st = stateWith('fresh', true);
    const row = buildMemberRows(st, { nowMs: 1_760_000_000_500 })[0]!;
    expect(row.timeUncertain).toBe(false);
    expect(displayCell(row, 'focus_display').status).toBe('value');
  });
  it('V6 applyEvent 가 수신 시각을 항목에 보관한다', () => {
    const st = stateWith('time_uncertain', true);
    expect(st.metrics[PID]!.data.received_at_server_ms).toBe(RECV);
    expect(st.metrics[PID]!.data.stream_id).toBe(STREAM);
  });
  it('V7 레거시 어댑터: 수신 직후엔 숫자를 넘기고, 5분 막대에는 넣지 않는다(observed 없음)', () => {
    const st = stateWith('time_uncertain', true);
    const [m] = toSessionLiveMetrics(st, { nowMs: RECV + 1_000 });
    expect(m!.focus_score).toBe(62);
    expect(m!.band_connected).toBe(true);
    const agg = new BarAggregator();
    collectBars(agg, st, PID, 'focus_display', RECV + 1_000);
    expect(agg.series()).toEqual([]);
  });
});
