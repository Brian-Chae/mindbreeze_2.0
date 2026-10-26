// [MB261026][FIX] 2차: 상담사 화면 "미입장" + 지표 없음 (dev 세션 4b907a64 실측)
// 1) v2 에서는 live-metrics 를 폴링하지 않아 행이 participantsToMetrics(세션 상세)로 만들어지는데,
//    participant_id 를 user_id 로 쓰고 entered_at 을 싣지 않아 v2 행과 매칭되지 않음 → '미입장'.
// 2) 서버 participation.connected 는 입장 이벤트에서 항상 false → 출석(attending)을 접속 근거로 쓴다.
// 3) Android getMeasurementSnapshot 은 계약 스냅샷을 `bridge` 아래에 둔다 → 최상위 seq 가 없어
//    BigInt(undefined) 로 attach 가 throw → startMeasurement 를 한 번도 부르지 않았다.
import { describe, expect, it, vi } from 'vitest';
import { PID, SID, snapshot } from './sdd246-web/fixtures';
import { applySnapshot, createLiveState, type LiveState } from '../src/lib/session-live/live-state';
import { toSessionLiveMetrics } from '../src/lib/session-live/live-legacy-adapter';
import { participantsToMetrics } from '../src/pages/sessions/participants-to-metrics';
import { NativeMeasurementFacade } from '../src/lib/native-measurement';
import type { NativeMeasurementPlugin } from '../src/lib/native-measurement/types';

function ready(connected: boolean, attendance: 'attending' | 'left' | 'waiting' = 'attending'): LiveState {
  const s0 = { ...createLiveState({ sessionId: SID }), expected: { requestId: snapshot().request_id, generation: '7' } };
  const st = applySnapshot(s0, snapshot()).state;
  return { ...st, participation: { [PID]: { version: '3', data: { participant_id: PID, role: 'member', attendance, connected } } } } as LiveState;
}

describe('세션 상세 → 호스트 행', () => {
  it('participant_id 와 entered_at 을 실어 v2 행과 매칭된다', () => {
    const rows = participantsToMetrics({
      participants: [{ participant_id: PID, user_id: 'u-1', user_name: '김회원', guest_name: null, is_guest: false, band_connected: false,
        is_waitlisted: false, entered_at: '2026-10-26T13:41:01Z' }],
    } as never);
    expect(rows[0]!.participant_id).toBe(PID);
    const v2 = toSessionLiveMetrics(ready(false), { nowMs: 1_760_000_002_000, legacy: rows });
    expect(v2[0]!.entered_at).toBe('2026-10-26T13:41:01Z');
    expect(v2[0]!.display_name).toBe('김회원');
  });
});

describe('접속 상태', () => {
  it('connected=false 라도 출석 중이면 참여 중', () => {
    expect(toSessionLiveMetrics(ready(false), { nowMs: 0 })[0]!.presence_state).toBe('connected');
  });
  it('퇴장(left)이면 미접속', () => {
    expect(toSessionLiveMetrics(ready(false, 'left'), { nowMs: 0 })[0]!.presence_state).toBe('disconnected');
  });
});

describe('Android 스냅샷 형식', () => {
  it('계약 스냅샷이 bridge 아래에 있어도 attach 가 throw 하지 않고 시작까지 간다', async () => {
    const startMeasurement = vi.fn(async () => ({ managerId: 'm', streamId: 's', ownerGeneration: '1' }));
    const plugin = {
      addListener: vi.fn(async () => ({ remove: async () => undefined })),
      getMeasurementSnapshot: vi.fn(async () => ({ state: 'IDLE', eegPackets: 0, bridge: { managerGeneration: '1', seq: '0', sessionId: SID, metrics: null } })),
      setNativeOwnership: vi.fn(async () => ({ enabled: true })),
      handoffCredentials: vi.fn(async () => ({ handoff: true })),
      startMeasurement,
    } as unknown as NativeMeasurementPlugin;
    const f = new NativeMeasurementFacade(plugin);
    await expect(f.attach(SID)).resolves.toBeTruthy();
    await f.startForSession({ platform: 'android', sessionId: SID, requestId: 'r', accountId: 'u', apiBase: 'a', socketBase: 's', instanceId: 'i',
      deviceId: 'D4:08', tokens: { accessToken: 'AT-x', refreshToken: 'RT-x' } });
    expect(startMeasurement).toHaveBeenCalledTimes(1);
  });
  it('seq 가 아예 없는 스냅샷도 attach 를 깨뜨리지 않는다', async () => {
    const plugin = {
      addListener: vi.fn(async () => ({ remove: async () => undefined })),
      getMeasurementSnapshot: vi.fn(async () => ({ state: 'IDLE' })),
    } as unknown as NativeMeasurementPlugin;
    await expect(new NativeMeasurementFacade(plugin).attach(SID)).resolves.toBeTruthy();
  });
});
