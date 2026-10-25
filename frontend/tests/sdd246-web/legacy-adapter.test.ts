// SDD-246 T06 — v2 LiveState → 기존 호스트 화면 모델(SessionLiveMetric) 어댑터, 플래그, REST 폴백 경로.
import { describe, expect, it, vi } from 'vitest';
import { PID, SID, event, metricsData, snapshot, RICH_LEGACY_PARTICIPANT } from './fixtures';
import { applyEvent, applySnapshot, createLiveState, type LiveState } from '../../src/lib/session-live/live-state';
import { toSessionLiveMetrics } from '../../src/lib/session-live/live-legacy-adapter';
import { isLiveProtocolV2Enabled } from '../../src/lib/session-live/live-flag';
import { createRestFallback } from '../../src/lib/session-live/live-rest';
import { toHostParticipant } from '../../src/components/class/player/host/host-live-model';

function ready(): LiveState {
  const s0 = { ...createLiveState({ sessionId: SID }), expected: { requestId: snapshot().request_id, generation: '7' } };
  return applySnapshot(s0, snapshot()).state;
}

describe('toSessionLiveMetrics', () => {
  it('rich 참여객체의 null/과거 손이 있어도 v2 값이 기존 호스트 모델에 그대로 나온다', () => {
    let st = ready();
    st = applyEvent(st, event('metrics', 'metrics.updated', '42', '4', metricsData('42', 1_760_000_001_000, 71))).state;
    st = applyEvent(st, event('speaking', 'speaking.changed', '6', '4', { participant_id: PID, hand_raised: false, can_publish: false, grant_version: '1' })).state;
    const nowMs = 1_760_000_002_000;
    const rows = toSessionLiveMetrics(st, { nowMs, legacy: [RICH_LEGACY_PARTICIPANT] });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.raise_hand).toBe(false);
    expect(rows[0]!.device_status).toBe('ok');
    expect(rows[0]!.current_efficiency).toBe(55);
    const host = toHostParticipant(rows[0]!, { nowMs });
    expect(host.band).toBe('on');
    expect(host.hand).toBe(false);
    expect(host.values.relaxation).toBe(55);
  });

  it('관측이 10초 넘게 없으면 값을 지우고 접촉 상태를 ok 로 위장하지 않는다', () => {
    const st = ready();
    const rows = toSessionLiveMetrics(st, { nowMs: 1_760_000_000_000 + 30_000 });
    expect(rows[0]!.current_efficiency).toBeNull();
    expect(rows[0]!.device_status).not.toBe('ok');
  });

  it('leadoff 는 lead_off, 관측 없음은 unknown 이다(SQI 로 접촉을 합성하지 않음)', () => {
    let st = ready();
    const d = metricsData('42', 1_760_000_001_000, 71);
    d.contact = { fp1: 'leadoff', fp2: 'contact' };
    st = applyEvent(st, event('metrics', 'metrics.updated', '42', '4', d)).state;
    expect(toSessionLiveMetrics(st, { nowMs: 1_760_000_002_000 })[0]!.device_status).toBe('lead_off');
  });
});

describe('live-flag', () => {
  it('기본 off 이고 VITE_LIVE_PROTOCOL_V2=true 일 때만 on', () => {
    expect(isLiveProtocolV2Enabled({})).toBe(false);
    expect(isLiveProtocolV2Enabled({ VITE_LIVE_PROTOCOL_V2: 'false' })).toBe(false);
    expect(isLiveProtocolV2Enabled({ VITE_LIVE_PROTOCOL_V2: 'true' })).toBe(true);
  });
});

describe('REST 폴백 어댑터', () => {
  it('snapshot/commands 경로와 X-Live-Protocol 헤더를 쓴다', async () => {
    const get = vi.fn().mockResolvedValue(snapshot());
    const post = vi.fn().mockResolvedValue({ command_id: 'c', status: 'applied', epoch: '1', cursors: [], committed: true });
    const rest = createRestFallback({ get, post });
    await rest.getSnapshot({ sessionId: SID, requestId: 'r', generation: '2' });
    expect(get.mock.calls[0]![0]).toBe(`/sessions/${SID}/live-v2/snapshot?generation=2&request_id=r`);
    expect(get.mock.calls[0]![1]).toMatchObject({ headers: { 'X-Live-Protocol': '1,2' } });
    await rest.postCommand({ command_id: 'c' } as never);
    expect(post.mock.calls[0]![0]).toBe(`/sessions/${SID}/live-v2/commands`);
    expect(post.mock.calls[0]![2]).toMatchObject({ headers: { 'X-Live-Protocol': '1,2' } });
  });
});
