// SDD-334 — 입장 후 측정 미시작 표시 모델
import { describe, expect, it } from 'vitest';
import type { SessionLiveMetric } from '../src/lib/api/session';
import {
  isAbnormal, isMeasureNotStarted, measureNotStartedLabel, measureNotStartedMinutes, summarizeHostEntry,
  MEASURE_NOT_STARTED_GUIDE,
} from '../src/lib/class/host-player-case';
import { toHostParticipant } from '../src/components/class/player/host/host-live-model';
import { toSessionLiveMetrics } from '../src/lib/session-live/live-legacy-adapter';

const NOW = Date.parse('2026-11-23T06:10:00Z');
const row = (patch: Partial<SessionLiveMetric> = {}): SessionLiveMetric => ({
  participant_id: 'p1', display_name: '회원', is_guest: false, band_connected: false, device_status: 'unknown',
  band_battery: null, avg_efficiency: null, current_efficiency: null, upload_status: 'idle', last_eeg_at: null,
  entered_at: '2026-11-23T06:05:00Z', measure_not_started: true, measure_not_started_since: '2026-11-23T06:05:00Z',
  ...patch,
});

describe('측정 미시작 화면 모델', () => {
  it('서버 판정이 true 이고 데이터가 없으면 미시작이며 이상에 포함된다', () => {
    const p = toHostParticipant(row(), { nowMs: NOW });
    expect(isMeasureNotStarted(p)).toBe(true);
    expect(isAbnormal(p)).toBe(true);
    expect(p.measureNotStartedMin).toBe(5);
    expect(measureNotStartedLabel(p)).toBe('측정 시작 안 됨 · 5분째');
    expect(summarizeHostEntry([p]).abnormal).toBe(1);
  });

  it('실시간 지표(last_eeg_at)가 들어오면 서버 값이 true 여도 즉시 해제된다', () => {
    const p = toHostParticipant(row({ last_eeg_at: '2026-11-23T06:09:59Z', band_connected: true, device_status: 'ok' }), { nowMs: NOW });
    expect(isMeasureNotStarted(p)).toBe(false);
  });

  it('서버 값이 false 이거나 구 서버(필드 없음)면 해당 없음 — 밴드 미착용은 이상이 아니다', () => {
    expect(isMeasureNotStarted(toHostParticipant(row({ measure_not_started: false }), { nowMs: NOW }))).toBe(false);
    const legacy = row();
    delete legacy.measure_not_started;
    delete legacy.measure_not_started_since;
    const p = toHostParticipant(legacy, { nowMs: NOW });
    expect(isMeasureNotStarted(p)).toBe(false);
    expect(isAbnormal(p)).toBe(false);
  });

  it('미입장 회원은 이상에 세지 않는다', () => {
    const p = toHostParticipant(row({ entered_at: null, measure_not_started_since: null }), { nowMs: NOW });
    expect(isAbnormal(p)).toBe(false);
  });

  it('경과 분은 최소 1분, 시각을 못 읽으면 null', () => {
    expect(measureNotStartedMinutes('2026-11-23T06:09:30Z', NOW)).toBe(1);
    expect(measureNotStartedMinutes('2026-11-23T05:50:00Z', NOW)).toBe(20);
    expect(measureNotStartedMinutes(null, NOW)).toBeNull();
    expect(measureNotStartedMinutes('bad', NOW)).toBeNull();
  });

  it('조치 안내는 쉬운 말이고 점수가 없다', () => {
    expect(MEASURE_NOT_STARTED_GUIDE).toBe('앱에서 밴드 다시 연결을 눌러 주세요');
  });

  it('v2 어댑터가 REST 행의 측정 미시작 필드를 전달한다', () => {
    const state = {
      participation: { p1: { data: { connected: true, attendance: 'attending' } } },
      speaking: {}, metrics: {}, devices: {}, intents: {}, removed: {}, waiting: {}, session: { phase: 'LIVE' },
    } as unknown as Parameters<typeof toSessionLiveMetrics>[0];
    const out = toSessionLiveMetrics(state, { nowMs: NOW, legacy: [row()] });
    expect(out[0].measure_not_started).toBe(true);
    expect(out[0].measure_not_started_since).toBe('2026-11-23T06:05:00Z');
  });
});
