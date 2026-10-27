// 측정 가드(웹) — 무효(null) 지표가 0·직전값으로 바뀌지 않고, display 값이 재점수화되지 않음을 고정한다.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PID, SID, event, metricsData, snapshot } from './sdd246-web/fixtures';
import { applyEvent, applySnapshot, createLiveState } from '../src/lib/session-live/live-state';
import { toSessionLiveMetrics } from '../src/lib/session-live/live-legacy-adapter';
import { applyEegFeatureToMetrics } from '../src/lib/session-live/apply-eeg-feature';
import { invalidEegFeature } from '../src/hooks/useBand';
import { StreamProcessor } from '../src/lib/eeg/StreamProcessor';
import { AnalysisMetricsService } from '../src/lib/eeg/AnalysisMetricsService';
import type { SessionLiveMetric } from '../src/lib/api/session';
import type { SessionLiveEegFeatureEvent } from '../src/lib/socket';

const NOW = 1_760_000_002_000;

describe('무효 업로드 feature — EEG 지표 전부 null (0 치환 금지)', () => {
  it('invalidEegFeature', () => {
    const f = invalidEegFeature(NOW, 7, 80);
    for (const k of [
      'delta_power', 'theta_power', 'alpha_power', 'beta_power', 'gamma_power', 'total_power',
      'focus_index', 'relaxation_index', 'stress_index', 'meditation_level', 'attention_level',
      'cognitive_load', 'emotional_stability', 'hemispheric_balance', 'total_neural_activity', 'faa', 'signal_quality',
    ] as const) {
      expect(f[k], k).toBeNull();
    }
    expect(f.second_offset).toBe(7);
    expect(f.band_battery).toBe(80);
  });
});

describe('eeg_feature 증분 반영 — 명시적 null 은 직전값을 지운다', () => {
  const row: SessionLiveMetric = {
    participant_id: PID, display_name: 'a', is_guest: false, band_connected: true, device_status: 'ok',
    band_battery: 80, avg_efficiency: null, current_efficiency: 61, upload_status: 'streaming',
    last_eeg_at: new Date(NOW).toISOString(),
  };
  const ev = (over: Partial<SessionLiveEegFeatureEvent>): SessionLiveEegFeatureEvent => ({
    session_id: SID, participant_id: PID, last_eeg_at: new Date(NOW + 1000).toISOString(), ...over,
  });
  it('current_efficiency=null → 비움', () => {
    expect(applyEegFeatureToMetrics([row], ev({ current_efficiency: null }))[0].current_efficiency).toBeNull();
  });
  it('feature.relaxation_index=null → 비움', () => {
    const out = applyEegFeatureToMetrics([row], ev({ feature: { second_offset: 3, relaxation_index: null } }));
    expect(out[0].current_efficiency).toBeNull();
  });
  it('값이 오면 그대로 반영(재점수화 없음)', () => {
    expect(applyEegFeatureToMetrics([row], ev({ current_efficiency: 42 }))[0].current_efficiency).toBe(42);
  });
  it('필드가 아예 없는 이벤트는 기존 값 유지', () => {
    expect(applyEegFeatureToMetrics([row], ev({ band_battery: 70 }))[0].current_efficiency).toBe(61);
  });
});

describe('v2 어댑터 — display 그대로, 무효는 null', () => {
  function stateWith(relax: { value: number | null; validity: 'valid' | 'invalid' | 'warming_up'; reason?: string }) {
    const s0 = { ...createLiveState({ sessionId: SID }), expected: { requestId: snapshot().request_id, generation: '7' } };
    let st = applySnapshot(s0, snapshot()).state;
    const d = metricsData('42', NOW - 1000, 71) as { metrics: Record<string, unknown> };
    d.metrics = {
      ...d.metrics,
      relaxation_display: {
        value: relax.value, unit: 'score_0_100', validity: relax.validity, reason: relax.reason ?? null,
        last_valid_sequence: null, last_valid_observed_at_ms: null,
      },
    };
    st = applyEvent(st, event('metrics', 'metrics.updated', '42', '4', d)).state;
    return st;
  }
  it('수신 display 는 재점수화 없이 그대로(55 → 55)', () => {
    const rows = toSessionLiveMetrics(stateWith({ value: 55, validity: 'valid' }), { nowMs: NOW });
    expect(rows[0].current_efficiency).toBe(55);
  });
  it('invalid(saturated) → null — 0 도 직전값도 아님', () => {
    const rows = toSessionLiveMetrics(stateWith({ value: null, validity: 'invalid', reason: 'saturated' }), { nowMs: NOW });
    expect(rows[0].current_efficiency).toBeNull();
  });
});

describe('재점수화 지점 고정(정적) — v2 display 경로는 scoreIndices 를 거치지 않는다', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  it('ClassPlayerPage: v2 on 이면 toSessionLiveMetrics 결과를 그대로 반환(scoreServerRows 미경유)', () => {
    const src = read('../src/pages/sessions/ClassPlayerPage.tsx');
    const v2Branch = src.slice(src.indexOf('liveV2.active && liveV2.state'), src.indexOf('const base: SessionLiveMetric[]'));
    expect(v2Branch).toContain('return toSessionLiveMetrics(');
    expect(v2Branch).not.toContain('scoreServerRows');
    expect(v2Branch).not.toContain('scoreIndices');
  });
  it('MemberClassContainer: v2 on 이면 liveMetricSnapshot(display 그대로)이 우선, legacy 소켓은 v2 에서 비활성', () => {
    const src = read('../src/components/class/player/member/MemberClassContainer.tsx');
    expect(src).toContain('const snapshot = liveSnap ?? nativeM.metrics ?? buildSnapshot(');
    expect(src).toContain('enabled: connectionsActive && !v2On');
  });
  it('ClassPlayerPage 자기 행: 로컬 null 을 원격/직전 행 값으로 되살리지 않는다', () => {
    const src = read('../src/pages/sessions/ClassPlayerPage.tsx');
    expect(src).not.toContain('band.currentEfficiency ?? row.current_efficiency');
  });
});

describe('StreamProcessor 갭 — 장치 tick 기준으로 링을 비우고 무효를 방출', () => {
  const SEC = (n: number) => n / 250;
  const packet = (tSec: number, n: number, base: number) => ({
    type: 'eeg',
    samples: Array.from({ length: n }, (_, i) => ({
      timestamp: (base + i) * 4, ch1: Math.sin((base + i) * 0.3) * 30, ch2: Math.cos((base + i) * 0.2) * 30,
      leadoff_ch1: false, leadoff_ch2: false,
    })),
    metadata: { arrivalTime: Date.now(), deviceTimestampSec: tSec, numSamples: n, sensorType: 'EEG' },
  });
  function makeSp() {
    const sp = new StreamProcessor() as unknown as {
      handleBluetoothData: (d: unknown) => void;
      eegBuffer: { getSize: () => number };
      isStarted: boolean;
    };
    const invalid: string[] = [];
    const svc = AnalysisMetricsService.getInstance();
    svc.setCallbacks({ onMetricsUpdate: (a: string, d: unknown) => { if (a === 'eeg_invalid') invalid.push((d as { reason: string }).reason); } });
    return { sp, invalid };
  }
  it('도착 지터만 있고 tick 이 연속이면 링 유지·무효 없음', () => {
    const { sp, invalid } = makeSp();
    for (let k = 0; k < 10; k++) sp.handleBluetoothData(packet(10 + SEC(10 * (k + 1)), 10, k * 10));
    expect(sp.eegBuffer.getSize()).toBe(100);
    expect(invalid).toEqual([]);
  });
  it('tick 상 25샘플 누락 → 링 비우고 gap 방출', () => {
    const { sp, invalid } = makeSp();
    for (let k = 0; k < 10; k++) sp.handleBluetoothData(packet(10 + SEC(10 * (k + 1)), 10, k * 10));
    sp.handleBluetoothData(packet(10 + SEC(100) + SEC(35), 10, 110));
    expect(sp.eegBuffer.getSize()).toBe(10); // 갭 이전 샘플은 버리고 새 패킷만 재충전
    expect(invalid).toContain('gap');
  });
});
