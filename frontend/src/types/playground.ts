/**
 * SDD-034 Playground 타입 — haru_band_app 이식본 (서버 대조 제외).
 */

export interface PlaygroundLogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error';
  source: 'ble' | 'stream' | 'metrics' | 'server';
  message: string;
  payload?: unknown;
}

export interface MetricView {
  key: string;
  label: string;
  value: number;
  unit: '' | '%' | 'μV²' | 'BPM' | 'ms' | 'g' | 'dB';
  range: [number, number];
  stale?: boolean;
}

export interface WaveformPoint {
  timestamp: number;
  value: number;
}

export interface BandPowerView {
  band: 'delta' | 'theta' | 'alpha' | 'beta' | 'gamma';
  label: string;
  power: number;
  domain: 'linear-uv2' | 'db';
  ratio: number;
}

export interface TrendPoint {
  t: number;
  [metricKey: string]: number;
}

export type PanelState = 'disconnected' | 'waiting' | 'ready' | 'error';

export type BandSensorState = 'good' | 'bad' | 'loading';

export interface BandSensors {
  leftElectrode: BandSensorState;
  rightElectrode: BandSensorState;
  ppgSensor: BandSensorState;
  signalQuality: BandSensorState;
}

export interface BandSpectrum {
  frequencies: number[];
  ch1Power: number[];
  ch2Power: number[];
  dominantFrequency: number;
}

export interface BandPpgWaveform {
  red: number[];
  ir: number[];
}

export interface BandAccSnapshot {
  magnitude: number[];
  magnitudeWaveform: WaveformPoint[];
  movement: number;
  intensity: number;
  activityType: string;
  tiltAngle: number;
  stability: number;
  avgMovement: number;
  maxMovement: number;
}

export interface BandRawIndices {
  focusIndex: number;
  relaxationIndex: number;
  stressIndex: number;
  cognitiveLoad: number;
  emotionalStability: number;
  hemisphericBalance: number;
  totalNeuralActivity: number;
}

export interface BandEegWaveform {
  fp1: WaveformPoint[];
  fp2: WaveformPoint[];
}
