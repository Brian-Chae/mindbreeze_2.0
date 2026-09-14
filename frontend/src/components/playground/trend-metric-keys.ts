/**
 * SDD-034 — 트렌드 선택 대상 지표 키 분류 (EEG/PPG).
 */

export const EEG_TREND_KEYS: ReadonlySet<string> = new Set([
  'focusIndex',
  'relaxationIndex',
  'stressIndex',
  'totalPower',
  'hemisphericBalance',
  'cognitiveLoad',
  'emotionalStability',
]);

export const PPG_TREND_KEYS: ReadonlySet<string> = new Set([
  'bpm',
  'rmssd',
  'sdnn',
  'lfHfRatio',
  'ppgStressIndex',
  'spo2',
]);

export function trendAxisOf(key: string): 'eeg' | 'ppg' {
  return PPG_TREND_KEYS.has(key) ? 'ppg' : 'eeg';
}

export const MAX_EEG_TREND = 3;
export const MAX_PPG_TREND = 2;
