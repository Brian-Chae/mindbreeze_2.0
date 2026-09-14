/**
 * lib/eeg 배럴 — BLE·신호처리·mock 진입점
 */

export { bluetoothService, eegBluetoothService } from './bluetoothService';
export { StreamProcessor } from './StreamProcessor';
export { mockDataGenerator, MockDataGenerator } from './mockDataGenerator';
export { AnalysisMetricsService } from './AnalysisMetricsService';
export type { LatestEegFeature, HrvMetricsSnapshot } from './AnalysisMetricsService';
export type { BandPowers, ConnectionState, LeadOffStatus } from './types/eeg';
export type { EEGAnalysisMetrics } from './types/processed-data';
export {
  CALIBRATION_METRIC_KEYS,
  scoreIndices,
  refreshActiveModel,
  getActiveModelCache,
} from './eegPersonalScore';
export {
  transformRaw,
  sigmoidScore,
  paramsFromSamples,
  SIGMOID_C,
  MAD_TO_SIGMA,
} from './eegSigmoidScore';
export type { CalibrationMetricKey, CalibrationBaseline, SigmoidParams } from './eegSigmoidScore';
