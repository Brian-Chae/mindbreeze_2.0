// 회원 화면 6지표를 상담사 타일과 같은 출처·같은 규칙으로 만든다(LiveState → 어댑터 → hostMetricValues).
// 회원 화면이 앱/웹 자체 계산값을, 상담사가 서버 LiveState 를 보던 불일치를 없앤다.
import type { MetricSnapshot } from '../../components/class/player/member/member-metrics';
import { hostMetricValues } from '../../components/class/player/host/host-live-model';
import type { LiveState } from './live-state';
import { toSessionLiveMetrics } from './live-legacy-adapter';

/**
 * participant 의 metrics 엔터티가 LiveState 에 없으면 null(기존 경로 폴백).
 * 있으면 상담사 타일과 동일한 값 — 관측이 끊겨 상담사가 "-" 이면 회원도 전부 null.
 */
export function liveMetricSnapshot(state: LiveState | null | undefined, participantId: string | null | undefined, nowMs: number): MetricSnapshot | null {
  if (!state || !participantId || !state.metrics[participantId]) return null;
  const row = toSessionLiveMetrics(state, { nowMs }).find((r) => r.participant_id === participantId);
  if (!row) return null;
  const v = hostMetricValues(row, undefined, nowMs);
  return { focus: v.focus, relaxation: v.relaxation, emotional: v.emotional, bpm: v.bpm, respiration: v.respiration, hrv: v.hrv };
}

/** SDD-316: 코어가 BPM·SDNN·호흡을 reason=not_worn(미착용)으로 보냈는가. 값이 아니라 사유만 본다. */
export function liveNotWorn(state: LiveState | null | undefined, participantId: string | null | undefined): boolean {
  if (!state || !participantId) return false;
  const m = state.metrics[participantId]?.data.metrics;
  if (!m) return false;
  return ['bpm', 'sdnn', 'respiration'].some((k) => m[k]?.reason === 'not_worn');
}
