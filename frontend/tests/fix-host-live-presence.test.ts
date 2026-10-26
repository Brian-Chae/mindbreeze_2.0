// [MB261026][FIX] 상담사 화면 "체크인 확인 중 · 접속 확인 중" 고정 + 앱(Android) 측정 미시작.
// 1) v2 어댑터가 presence/checkin/entered_at 을 채우지 않아 타일이 항상 '접속 확인 중'으로 떨어졌다.
// 2) Capacitor 프록시는 없는 메서드도 truthy 라 `if (plugin.setJSBandOwnership)` 가드가 무력 →
//    Android 에서 "not implemented" 로 reject 되어 startMeasurement 가 한 번도 불리지 않았다(Note10 logcat 실측).
import { describe, expect, it, vi } from 'vitest';
import { PID, SID, snapshot } from './sdd246-web/fixtures';
import { applySnapshot, createLiveState, type LiveState } from '../src/lib/session-live/live-state';
import { toSessionLiveMetrics } from '../src/lib/session-live/live-legacy-adapter';
import { toHostParticipant } from '../src/components/class/player/host/host-live-model';
import { NativeMeasurementFacade } from '../src/lib/native-measurement';
import type { NativeMeasurementPlugin } from '../src/lib/native-measurement/types';

function ready(): LiveState {
  const s0 = { ...createLiveState({ sessionId: SID }), expected: { requestId: snapshot().request_id, generation: '7' } };
  return applySnapshot(s0, snapshot()).state;
}

describe('v2 호스트 타일 접속·체크인 상태', () => {
  it('participation.connected=true 면 참여 중, 입장 시각은 신원 행에서 가져온다', () => {
    const st = ready();
    const rows = toSessionLiveMetrics(st, {
      nowMs: 1_760_000_002_000,
      legacy: [{ participant_id: PID, display_name: '김회원', entered_at: '2026-10-26T12:53:54Z', checkin_state: 'completed' } as never],
    });
    expect(rows[0]!.presence_state).toBe('connected');
    expect(rows[0]!.entered_at).toBe('2026-10-26T12:53:54Z');
    expect(rows[0]!.checkin_state).toBe('completed');
    expect(rows[0]!.display_name).toBe('김회원');
    const host = toHostParticipant(rows[0]!, { nowMs: 1_760_000_002_000 });
    expect(host.presenceState).toBe('connected');
    expect(host.checkinState).toBe('completed');
  });

  it('연결이 끊기면 disconnected, 대기 도메인 ready 면 체크인 완료', () => {
    let st = ready();
    st = {
      ...st,
      participation: { ...st.participation, [PID]: { version: '9', data: { participant_id: PID, role: 'member', attendance: 'attending', connected: false } } },
      waiting: { ...st.waiting, [PID]: { version: '2', data: { participant_id: PID, ready: true, checkin_revision: '1', waitlist_position: null } } },
    } as LiveState;
    const rows = toSessionLiveMetrics(st, { nowMs: 1_760_000_002_000 });
    expect(rows[0]!.presence_state).toBe('disconnected');
    expect(rows[0]!.checkin_state).toBe('completed');
  });
});

/** Capacitor registerPlugin 프록시 흉내 — 구현 없는 메서드도 함수로 보이고 호출 시 UNIMPLEMENTED 로 reject. */
function proxyOf(impl: Partial<NativeMeasurementPlugin>): NativeMeasurementPlugin {
  return new Proxy(impl as Record<string, unknown>, {
    get(t, prop) {
      if (prop in t) return t[prop as string];
      return () => Promise.reject(Object.assign(new Error(`"NativeMeasurement.${String(prop)}()" is not implemented on android`), { code: 'UNIMPLEMENTED' }));
    },
  }) as unknown as NativeMeasurementPlugin;
}

describe('Android 앱 측정 시작', () => {
  it('setJSBandOwnership 이 없는 Android 플러그인에서도 startMeasurement 까지 간다', async () => {
    const startMeasurement = vi.fn(async () => ({ managerId: 'm', streamId: 's', ownerGeneration: '1' }));
    const p = proxyOf({
      setNativeOwnership: vi.fn(async () => ({ enabled: true })),
      handoffCredentials: vi.fn(async () => ({ handoff: true })),
      startMeasurement,
    });
    await new NativeMeasurementFacade(p).startForSession({
      platform: 'android', sessionId: SID, requestId: 'r-android', accountId: 'u1', apiBase: 'https://api/x', socketBase: 'https://api',
      instanceId: 'i1', deviceId: 'D4:08:43:81:72:F7', tokens: { accessToken: 'AT-secret', refreshToken: 'RT-secret' },
    });
    expect(startMeasurement).toHaveBeenCalledTimes(1);
  });
});
