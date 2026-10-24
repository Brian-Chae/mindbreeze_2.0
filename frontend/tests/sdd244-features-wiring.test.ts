import { describe, expect, it, vi } from 'vitest';
import { metricsToFeature } from '../src/hooks/useBand';
import { AnalysisMetricsService } from '../src/lib/eeg/AnalysisMetricsService';
import { StreamProcessor } from '../src/lib/eeg/StreamProcessor';
import type { EEGAnalysisMetrics } from '../src/lib/eeg/types/processed-data';
import type { SampleWindow } from '../src/lib/biosignal/capture-session';

const baseMetrics = (over: Partial<EEGAnalysisMetrics> = {}): EEGAnalysisMetrics => ({
  timestamp: 1, totalPower: 5, emotionalBalance: 0, attention: 1, cognitiveLoad: 1, focusIndex: 1, relaxationIndex: 1, stressIndex: 1, hemisphericBalance: 0.2,
  emotionalStability: 1, attentionLevel: 1, meditationLevel: 1,
  movingAverageValues: { totalPower: 5, emotionalBalance: 0, attention: 1, cognitiveLoad: 1, focusIndex: 1, relaxationIndex: 1, stressIndex: 1, hemisphericBalance: 0.2, emotionalStability: 1, attentionLevel: 1, meditationLevel: 1 }, ...over });
const win: SampleWindow = { signal: 'eeg', streamId: 's', segmentId: 'g', first: 0, end: 500, rate: 250, anchorUtcUs: '0', anchorRelUs: '0' };

describe('SDD244 T09 기존 스칼라 누락 연결', () => {
  it('DB feature에 total_neural_activity·faa가 실리고 없으면 0이 아니라 null이다', () => {
    const withValues = metricsToFeature(baseMetrics({ totalNeuralActivity: 7, faa: -0.3 }), 0, null, 90, null);
    expect(withValues).toMatchObject({ total_neural_activity: 7, faa: -0.3, total_power: 5, hemispheric_balance: 0.2 });
    const without = metricsToFeature(baseMetrics(), 0, null, 90, null);
    expect(without.total_neural_activity).toBeNull(); expect(without.faa).toBeNull();
    // 기존 27개 의미는 그대로
    expect(without).toMatchObject({ focus_index: 1, relaxation_index: 1, meditation_level: 1, attention_level: 1 });
  });
  it('EEG 분석 서비스가 totalNeuralActivity를 지표에 실어 보낸다', async () => {
    const service = AnalysisMetricsService.getInstance();
    let received: EEGAnalysisMetrics | null = null;
    service.setCallbacks({ onMetricsUpdate: (_a, data) => { received = data as EEGAnalysisMetrics; } });
    await service.processEEGAnalysisMetrics({ timestamp: 1, bandPowers: { delta: 1, theta: 1, alpha: 1, beta: 1, gamma: 1 }, signalQuality: { overall: 90, channels: [90, 90], artifacts: { movement: false, eyeBlink: false, muscleNoise: false } }, brainState: { currentState: 'neutral', confidence: 0, stateHistory: [] } } as never,
      { focusIndex: 1, relaxationIndex: 1, stressIndex: 1, hemisphericBalance: 0, cognitiveLoad: 1, emotionalStability: 1, attentionLevel: 1, meditationLevel: 1, faa: 0.1, totalNeuralActivity: 9 });
    expect(received).toMatchObject({ totalNeuralActivity: 9, faa: 0.1 });
  });
});

describe('SDD244 T09 StreamProcessor emit 전달', () => {
  type Internals = { eegProcessor: unknown; ppgProcessor: unknown; accProcessor: unknown; performAdvancedEEGProcessing: (d: unknown[]) => Promise<void>; performAdvancedPPGProcessing: (d: unknown[]) => Promise<void>; performAdvancedACCProcessing: (d: unknown[]) => Promise<void> };
  const eegResult = { filteredData: [], signalQuality: { overall: 90, fp1: 90, fp2: 90, sqi: [] }, bandPowers: { delta: 1, theta: 1, alpha: 1, beta: 1, gamma: 1 }, brainState: { currentState: 'neutral', confidence: 0, stateHistory: [] },
    frequencySpectrum: { frequencies: [1], ch1Power: [1], ch2Power: [1], timestamp: 1 }, indices: { focusIndex: 1, relaxationIndex: 1, stressIndex: 1, hemisphericBalance: 0, cognitiveLoad: 1, emotionalStability: 1, totalPower: 1, totalNeuralActivity: 3, faa: 0.1 }, rawAnalysis: { ch1SQI: [], ch2SQI: [], overallSQI: [] } };
  const ppgResult = { filteredData: [], signalQuality: { overall: 90, red: 90, ir: 90, sqi: [], redSQI: [], irSQI: [], overallSQI: [] }, vitals: { heartRate: 60, hrv: 10 }, peakInfo: { peakCount: 1, avgPeakInterval: 1, peakQuality: 1 }, advancedHRV: { sdnn: 1, pnn50: 1, lfPower: 1, hfPower: 1, lfHfRatio: 1, stressIndex: 1, avnn: 1, pnn20: 1, sdsd: 1, hrMax: 1, hrMin: 1 }, rrIntervals: [] };
  const accResult = { filteredData: [], magnitude: [], activity: { type: 'stationary', confidence: 1, intensity: 0 }, movement: { avgMovement: 0, stdMovement: 0, maxMovement: 0, totalMovement: 0 }, posture: { tiltAngle: 0, stability: 1, balance: 1 }, signalQuality: { overall: 1, reliability: 1, consistency: 1 } };

  it('EEG·PPG·ACC emit마다 원창과 함께 onFeatureEmit이 호출된다(분석 시작 시점 창)', async () => {
    const sp = new StreamProcessor();
    const internals = sp as unknown as Internals;
    internals.eegProcessor = { processEEGData: async () => eegResult };
    internals.ppgProcessor = { processPPGData: async () => ppgResult };
    internals.accProcessor = { processACCData: async () => accResult };
    const emitted: { signal: string; window: SampleWindow | null; extras?: object }[] = [];
    const onFeatureWindow = vi.fn((signal: 'eeg' | 'ppg' | 'acc', count: number) => ({ ...win, signal, end: count }));
    sp.setCallbacks({ onFeatureWindow, onFeatureEmit: (signal, _data, window, extras) => { emitted.push({ signal, window, extras }); } });
    await internals.performAdvancedEEGProcessing(new Array(500).fill({}));
    await internals.performAdvancedPPGProcessing(new Array(100).fill({}));
    await internals.performAdvancedPPGProcessing(new Array(100).fill({}));   // 중첩 창: 두 번째 emit도 전달
    await internals.performAdvancedACCProcessing(new Array(30).fill({ timestamp: 1, x: 0, y: 0, z: 1 }));
    expect(emitted.map(e => e.signal)).toEqual(['eeg', 'ppg', 'ppg', 'acc']);
    expect(emitted[0].window).toMatchObject({ end: 500 });
    expect(emitted[1].extras).toHaveProperty('respiratory_rate');
    expect(onFeatureWindow).toHaveBeenCalledTimes(4);
  });
  it('콜백이 던져도 기존 분석 흐름은 계속된다', async () => {
    const sp = new StreamProcessor();
    const internals = sp as unknown as Internals;
    internals.eegProcessor = { processEEGData: async () => eegResult };
    const onProcessedEEG = vi.fn();
    sp.setCallbacks({ onFeatureEmit: () => { throw new Error('boom'); }, onProcessedEEG });
    await internals.performAdvancedEEGProcessing(new Array(500).fill({}));
    expect(onProcessedEEG).toHaveBeenCalled();
  });
});
