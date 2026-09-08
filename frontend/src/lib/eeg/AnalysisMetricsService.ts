/**
 * AnalysisMetricsService — MB 2.0용 분석 지표 서비스.
 * EEG 1초 feature 보관 + PPG HRV(SDNN/RMSSD/LF/HF) 계산.
 * HRV 로직은 haru_band_app AnalysisMetricsService에서 이식.
 */

import type { BandPowers, ProcessedEEGData } from './types/eeg';
import type { EEGAnalysisMetrics } from './types/processed-data';

export interface AnalysisCallbacks {
  onMetricsUpdate?: (action: string, data: unknown) => void;
}

export interface LatestEegFeature {
  timestamp: number;
  bandPowers: BandPowers;
  signalQuality: number;
  focusIndex: number;
  relaxationIndex: number;
  stressIndex: number;
  hemisphericBalance: number;
  cognitiveLoad: number;
  emotionalStability: number;
  attentionLevel: number;
  meditationLevel: number;
  totalPower: number;
}

type AdditionalIndices = {
  focusIndex: number;
  relaxationIndex: number;
  stressIndex: number;
  hemisphericBalance: number;
  cognitiveLoad: number;
  emotionalStability: number;
  attentionLevel: number;
  meditationLevel: number;
};

/** HRV 스냅샷 — 계산 불가 시 null (0 치환 금지) */
export interface HrvMetricsSnapshot {
  sdnn: number | null;
  rmssd: number | null;
  pnn50: number | null;
  lfPower: number | null;
  hfPower: number | null;
  lfHfRatio: number | null;
  stressIndex: number | null;
  avnn: number | null;
  pnn20: number | null;
  sdsd: number | null;
  hrMax: number | null;
  hrMin: number | null;
  heartRate: number | null;
  motion: number | null;
}

/** 분석 지표 싱글톤 — StreamProcessor가 호출, useBand가 구독 */
export class AnalysisMetricsService {
  private static instance: AnalysisMetricsService | null = null;

  private callbacks: AnalysisCallbacks = {};
  private latestEeg: LatestEegFeature | null = null;

  // --- HRV 상태 (haru_band_app 이식) ---
  private readonly MAX_HISTORY_SIZE = 120;
  private readonly LF_HF_BUFFER_SIZE = 120;
  private readonly LF_HF_CALCULATION_INTERVAL = 1000;

  private bpmBuffer: number[] = [];
  private rrIntervalBuffer: number[] = [];
  private lastLfHfCalculation = 0;

  private currentLfPower = 0;
  private currentHfPower = 0;
  private currentLfHfRatio = 0;
  private currentRMSSD = 0;
  private currentSDNN = 0;
  private currentSDSD = 0;
  private currentAVNN = 0;
  private currentPNN50 = 0;
  private currentPNN20 = 0;
  private currentStressIndex = 0;
  private currentHrMax = 0;
  private currentHrMin = 0;
  private currentHeartRate: number | null = null;
  /** ACC 움직임 활동도 0~1 */
  private currentMotion: number | null = null;

  private hasTimeDomainMetrics = false;
  private hasFrequencyDomainMetrics = false;
  private hasHeartRateStatistics = false;

  static getInstance(): AnalysisMetricsService {
    if (!AnalysisMetricsService.instance) {
      AnalysisMetricsService.instance = new AnalysisMetricsService();
    }
    return AnalysisMetricsService.instance;
  }

  /** 테스트용 싱글톤 리셋 */
  static resetInstance(): void {
    AnalysisMetricsService.instance = null;
  }

  setCallbacks(callbacks: AnalysisCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  getLatestEegFeature(): LatestEegFeature | null {
    return this.latestEeg;
  }

  /** EEG 1초 지표 수신 — StreamProcessor.performAdvancedEEGProcessing에서 호출 */
  async processEEGAnalysisMetrics(
    processedEEGData: ProcessedEEGData,
    additionalIndices: AdditionalIndices,
  ): Promise<void> {
    const totalPower = this.calculateTotalPower(processedEEGData.bandPowers);
    const feature: LatestEegFeature = {
      timestamp: processedEEGData.timestamp,
      bandPowers: processedEEGData.bandPowers,
      signalQuality: processedEEGData.signalQuality.overall,
      focusIndex: additionalIndices.focusIndex,
      relaxationIndex: additionalIndices.relaxationIndex,
      stressIndex: additionalIndices.stressIndex,
      hemisphericBalance: additionalIndices.hemisphericBalance,
      cognitiveLoad: additionalIndices.cognitiveLoad,
      emotionalStability: additionalIndices.emotionalStability,
      attentionLevel: additionalIndices.attentionLevel,
      meditationLevel: additionalIndices.meditationLevel,
      totalPower,
    };

    this.latestEeg = feature;

    const emotionalBalance = this.calculateEmotionalBalance(processedEEGData.bandPowers);
    const metrics: EEGAnalysisMetrics = {
      timestamp: feature.timestamp,
      totalPower: feature.totalPower,
      emotionalBalance,
      attention: feature.attentionLevel,
      cognitiveLoad: feature.cognitiveLoad,
      focusIndex: feature.focusIndex,
      relaxationIndex: feature.relaxationIndex,
      stressIndex: feature.stressIndex,
      hemisphericBalance: feature.hemisphericBalance,
      emotionalStability: feature.emotionalStability,
      attentionLevel: feature.attentionLevel,
      meditationLevel: feature.meditationLevel,
      movingAverageValues: {
        totalPower: feature.totalPower,
        emotionalBalance,
        attention: feature.attentionLevel,
        cognitiveLoad: feature.cognitiveLoad,
        focusIndex: feature.focusIndex,
        relaxationIndex: feature.relaxationIndex,
        stressIndex: feature.stressIndex,
        hemisphericBalance: feature.hemisphericBalance,
        emotionalStability: feature.emotionalStability,
        attentionLevel: feature.attentionLevel,
        meditationLevel: feature.meditationLevel,
      },
    };

    this.callbacks.onMetricsUpdate?.('eeg', metrics);
  }

  /**
   * PPG — RR 버퍼 갱신 후 시간/주파수 도메인 HRV 계산.
   * StreamProcessor가 rrIntervals를 넘긴다.
   */
  async processPPGAnalysisMetrics(
    ppgAnalysisResult: {
      vitals: { heartRate: number; spo2?: number; hrv?: number };
      advancedHRV?: unknown;
    },
    _timestamp: number,
    _currentSQI?: number,
    _isQualityGood?: boolean,
    rrIntervals?: number[],
  ): Promise<void> {
    const hr = ppgAnalysisResult.vitals.heartRate;
    if (hr > 40 && hr < 200) {
      this.currentHeartRate = hr;
      this.updateBpmBuffer(hr);
    }

    if (rrIntervals && rrIntervals.length > 0) {
      this.updateRRIntervalBuffer(rrIntervals);
      this.calculateLFHF();
    }

    this.callbacks.onMetricsUpdate?.('ppg', this.getCurrentHRVMetrics());
  }

  /** ACC — 움직임 활동도(0~1) 보관 */
  async processACCAnalysisMetrics(
    accAnalysisResult: {
      activity: { intensity: number; type?: string };
      movement?: { avgMovement?: number; maxMovement?: number };
      posture?: { stability?: number; balance?: number };
    },
    _timestamp: number,
  ): Promise<void> {
    // ACC intensity는 0~100% → 계약 motion은 0~1
    const intensity = accAnalysisResult.activity.intensity;
    if (Number.isFinite(intensity) && intensity >= 0) {
      this.currentMotion = Math.max(0, Math.min(1, intensity / 100));
    }
    this.callbacks.onMetricsUpdate?.('acc', { motion: this.currentMotion });
  }

  // ---------- Public HRV getters (계산 불가 시 null) ----------

  getCurrentHRVMetrics(): HrvMetricsSnapshot {
    return {
      sdnn: this.getCurrentSDNN(),
      rmssd: this.getCurrentRMSSD(),
      pnn50: this.getCurrentPNN50(),
      lfPower: this.getCurrentLfPower(),
      hfPower: this.getCurrentHfPower(),
      lfHfRatio: this.getCurrentLfHfRatio(),
      stressIndex: this.getCurrentStressIndex(),
      avnn: this.getCurrentAVNN(),
      pnn20: this.getCurrentPNN20(),
      sdsd: this.getCurrentSDSD(),
      hrMax: this.getCurrentHRMax(),
      hrMin: this.getCurrentHRMin(),
      heartRate: this.getCurrentHeartRate(),
      motion: this.getCurrentMotion(),
    };
  }

  getCurrentLfPower(): number | null {
    return this.hasFrequencyDomainMetrics ? this.currentLfPower : null;
  }

  getCurrentHfPower(): number | null {
    return this.hasFrequencyDomainMetrics ? this.currentHfPower : null;
  }

  getCurrentLfHfRatio(): number | null {
    return this.hasFrequencyDomainMetrics ? this.currentLfHfRatio : null;
  }

  getCurrentRMSSD(): number | null {
    return this.hasTimeDomainMetrics ? this.currentRMSSD : null;
  }

  getCurrentSDNN(): number | null {
    return this.hasTimeDomainMetrics ? this.currentSDNN : null;
  }

  getCurrentSDSD(): number | null {
    return this.hasTimeDomainMetrics ? this.currentSDSD : null;
  }

  getCurrentAVNN(): number | null {
    return this.hasTimeDomainMetrics ? this.currentAVNN : null;
  }

  getCurrentPNN50(): number | null {
    return this.hasTimeDomainMetrics ? this.currentPNN50 : null;
  }

  getCurrentPNN20(): number | null {
    return this.hasTimeDomainMetrics ? this.currentPNN20 : null;
  }

  getCurrentStressIndex(): number | null {
    return this.hasTimeDomainMetrics ? this.currentStressIndex : null;
  }

  getCurrentHRMax(): number | null {
    return this.hasHeartRateStatistics ? this.currentHrMax : null;
  }

  getCurrentHRMin(): number | null {
    return this.hasHeartRateStatistics ? this.currentHrMin : null;
  }

  getCurrentHeartRate(): number | null {
    return this.currentHeartRate;
  }

  getCurrentMotion(): number | null {
    return this.currentMotion;
  }

  getRRBufferStatus(): {
    isReady: boolean;
    bufferSize: number;
    bufferLength: number;
    readyRatio: number;
  } {
    const bufferLength = this.rrIntervalBuffer.length;
    const bufferSize = this.LF_HF_BUFFER_SIZE;
    return {
      isReady: bufferLength >= 30,
      bufferSize,
      bufferLength,
      readyRatio: bufferLength / bufferSize,
    };
  }

  // ---------- EEG helpers ----------

  private calculateTotalPower(bandPowers: BandPowers): number {
    return (
      bandPowers.delta +
      bandPowers.theta +
      bandPowers.alpha +
      bandPowers.beta +
      bandPowers.gamma
    );
  }

  private calculateEmotionalBalance(bandPowers: BandPowers): number {
    const denom = bandPowers.alpha + bandPowers.beta;
    if (denom <= 0) return 50;
    return Math.min(100, Math.max(0, (bandPowers.alpha / denom) * 100));
  }

  // ---------- HRV 계산 (haru_band_app 이식) ----------

  private updateRRIntervalBuffer(rrIntervals: number[]): void {
    const validRRIntervals = rrIntervals.filter((rr) => rr >= 200 && rr <= 2000);
    if (validRRIntervals.length === 0) return;

    this.rrIntervalBuffer.push(...validRRIntervals);
    if (this.rrIntervalBuffer.length > this.LF_HF_BUFFER_SIZE) {
      this.rrIntervalBuffer = this.rrIntervalBuffer.slice(-this.LF_HF_BUFFER_SIZE);
    }
  }

  private updateBpmBuffer(bpm: number): void {
    if (bpm > 40 && bpm < 200) {
      this.bpmBuffer.push(bpm);
      if (this.bpmBuffer.length > this.MAX_HISTORY_SIZE) {
        this.bpmBuffer.shift();
      }
    }
  }

  /** RR 버퍼 기반 전체 HRV 분석 (시간·스트레스·심박통계·주파수) */
  private calculateLFHF(): void {
    const currentTime = Date.now();

    if (this.rrIntervalBuffer.length < 30) {
      return;
    }

    if (this.rrIntervalBuffer.length >= this.LF_HF_BUFFER_SIZE) {
      if (currentTime - this.lastLfHfCalculation < this.LF_HF_CALCULATION_INTERVAL) {
        return;
      }
    }

    try {
      const rrCopy = [...this.rrIntervalBuffer];
      this.calculateTimeDomainMetrics(rrCopy);
      this.calculateStressMetrics(rrCopy);
      this.updateHeartRateStatistics();
      this.calculateFrequencyDomainMetrics(rrCopy);
      this.lastLfHfCalculation = currentTime;
    } catch (error) {
      console.error('❌ RR 간격 버퍼 기반 HRV 분석 실패:', error);
    }
  }

  private calculateTimeDomainMetrics(rrIntervals: number[]): void {
    if (rrIntervals.length < 10) {
      return;
    }

    this.currentAVNN =
      rrIntervals.reduce((sum, val) => sum + val, 0) / rrIntervals.length;

    const mean = this.currentAVNN;
    const variance =
      rrIntervals.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
      rrIntervals.length;
    this.currentSDNN = Math.sqrt(variance);

    if (rrIntervals.length >= 2) {
      const squaredDiffs: number[] = [];
      for (let i = 1; i < rrIntervals.length; i++) {
        const diff = rrIntervals[i] - rrIntervals[i - 1];
        squaredDiffs.push(diff * diff);
      }
      this.currentRMSSD = Math.sqrt(
        squaredDiffs.reduce((sum, val) => sum + val, 0) / squaredDiffs.length,
      );
    } else {
      this.currentRMSSD = 0;
    }

    if (rrIntervals.length >= 2) {
      const successiveDiffs: number[] = [];
      for (let i = 1; i < rrIntervals.length; i++) {
        successiveDiffs.push(rrIntervals[i] - rrIntervals[i - 1]);
      }
      const diffMean =
        successiveDiffs.reduce((sum, val) => sum + val, 0) / successiveDiffs.length;
      const diffVariance =
        successiveDiffs.reduce(
          (sum, val) => sum + Math.pow(val - diffMean, 2),
          0,
        ) / successiveDiffs.length;
      this.currentSDSD = Math.sqrt(diffVariance);
    } else {
      this.currentSDSD = 0;
    }

    if (rrIntervals.length >= 2) {
      let pnn50Count = 0;
      for (let i = 1; i < rrIntervals.length; i++) {
        if (Math.abs(rrIntervals[i] - rrIntervals[i - 1]) > 50) {
          pnn50Count++;
        }
      }
      this.currentPNN50 = (pnn50Count / (rrIntervals.length - 1)) * 100;
    } else {
      this.currentPNN50 = 0;
    }

    if (rrIntervals.length >= 2) {
      let pnn20Count = 0;
      for (let i = 1; i < rrIntervals.length; i++) {
        if (Math.abs(rrIntervals[i] - rrIntervals[i - 1]) > 20) {
          pnn20Count++;
        }
      }
      this.currentPNN20 = (pnn20Count / (rrIntervals.length - 1)) * 100;
    } else {
      this.currentPNN20 = 0;
    }

    this.hasTimeDomainMetrics = true;
  }

  private calculateStressMetrics(rrIntervals: number[]): void {
    if (rrIntervals.length < 10) {
      this.currentStressIndex = 0;
      return;
    }

    const normalizedSDNN = Math.max(0, Math.min(1, (100 - this.currentSDNN) / 70));
    const normalizedRMSSD = Math.max(
      0,
      Math.min(1, (50 - this.currentRMSSD) / 30),
    );
    const avgHeartRate = 60000 / this.currentAVNN;
    const heartRateStress = Math.max(
      0,
      Math.min(1, Math.abs(avgHeartRate - 80) / 40),
    );

    this.currentStressIndex =
      normalizedSDNN * 0.4 + normalizedRMSSD * 0.4 + heartRateStress * 0.2;
    this.currentStressIndex = Math.max(0, Math.min(1, this.currentStressIndex));
  }

  private updateHeartRateStatistics(): void {
    if (this.bpmBuffer.length === 0) {
      this.currentHrMax = 0;
      this.currentHrMin = 0;
      this.hasHeartRateStatistics = false;
      return;
    }

    const validBPMs = this.bpmBuffer.filter((bpm) => bpm > 40 && bpm < 200);
    if (validBPMs.length > 0) {
      this.currentHrMax = Math.max(...validBPMs);
      this.currentHrMin = Math.min(...validBPMs);
      this.hasHeartRateStatistics = true;
    } else {
      this.currentHrMax = 0;
      this.currentHrMin = 0;
      this.hasHeartRateStatistics = false;
    }
  }

  private calculateFrequencyDomainMetrics(rrIntervals: number[]): void {
    const validRR = rrIntervals.filter((rr) => rr >= 300 && rr <= 2000);
    const validityRatio = validRR.length / rrIntervals.length;

    if (validityRatio < 0.75) {
      return;
    }

    let outlierCount = 0;
    for (let i = 1; i < validRR.length; i++) {
      const changeRate = Math.abs(validRR[i] - validRR[i - 1]) / validRR[i - 1];
      if (changeRate > 0.25) {
        outlierCount++;
      }
    }
    const stabilityRatio = 1 - outlierCount / (validRR.length - 1);
    if (stabilityRatio < 0.75) {
      return;
    }

    if (rrIntervals.length < 30) {
      return;
    }

    const resamplingFs = 4.0;
    const resampledRR = this.resampleRRIntervals(rrIntervals, resamplingFs);
    if (resampledRR.length < 16) {
      return;
    }

    const { frequencies, powerSpectralDensity } = this.computeWelchPeriodogram(
      resampledRR,
      resamplingFs,
    );

    const lfPowerRaw = this.integratePowerInBand(
      frequencies,
      powerSpectralDensity,
      0.04,
      0.15,
    );
    const hfPowerRaw = this.integratePowerInBand(
      frequencies,
      powerSpectralDensity,
      0.15,
      0.4,
    );

    let lfPower = lfPowerRaw * 1000000;
    let hfPower = hfPowerRaw * 1000000;

    if (hfPower < 1 && lfPower > 10) {
      const extendedHfPower = this.integratePowerInBand(
        frequencies,
        powerSpectralDensity,
        0.12,
        0.5,
      );
      const extendedHfPowerScaled = extendedHfPower * 100;
      if (extendedHfPowerScaled > hfPower * 1.5) {
        hfPower = extendedHfPowerScaled;
      }
    }

    const newLfPower = this.getValidValue(lfPower, this.currentLfPower, 0.1);
    const newHfPower = this.getValidValue(hfPower, this.currentHfPower, 0.1);
    const newLfHfRatio =
      newHfPower > 0 ? newLfPower / newHfPower : this.currentLfHfRatio;

    this.currentLfPower = newLfPower;
    this.currentHfPower = newHfPower;
    this.currentLfHfRatio = this.getValidValue(
      newLfHfRatio,
      this.currentLfHfRatio,
      0.1,
    );
    this.hasFrequencyDomainMetrics = [
      this.currentLfPower,
      this.currentHfPower,
      this.currentLfHfRatio,
    ].every((value) => Number.isFinite(value) && value >= 0);
  }

  private getValidValue(
    value: number,
    previousValue = 0,
    minThreshold = 0.01,
  ): number {
    if (value > minThreshold && !isNaN(value) && isFinite(value)) {
      return value;
    }
    return previousValue;
  }

  private resampleRRIntervals(rrIntervals: number[], targetFs: number): number[] {
    if (rrIntervals.length < 2) {
      return [];
    }

    const rrIntervalsSeconds = rrIntervals.map((rr) => rr / 1000);
    const timeAxis = [0];
    for (let i = 0; i < rrIntervalsSeconds.length; i++) {
      timeAxis.push(timeAxis[timeAxis.length - 1] + rrIntervalsSeconds[i]);
    }

    const totalTime = timeAxis[timeAxis.length - 1];
    const numSamples = Math.floor(totalTime * targetFs);
    if (numSamples < 4) {
      return [];
    }

    const resampledTime = Array.from({ length: numSamples }, (_, i) => i / targetFs);
    return this.interpolateLinear(timeAxis, rrIntervalsSeconds, resampledTime);
  }

  private interpolateLinear(
    xOriginal: number[],
    yOriginal: number[],
    xNew: number[],
  ): number[] {
    const result: number[] = [];
    for (const x of xNew) {
      if (x <= xOriginal[0]) {
        result.push(yOriginal[0]);
      } else if (x >= xOriginal[xOriginal.length - 1]) {
        result.push(yOriginal[yOriginal.length - 1]);
      } else {
        let i = 0;
        while (i < xOriginal.length - 1 && xOriginal[i + 1] < x) {
          i++;
        }
        const x1 = xOriginal[i];
        const x2 = xOriginal[i + 1];
        const y1 = yOriginal[i];
        const y2 = yOriginal[i + 1];
        result.push(y1 + ((y2 - y1) * (x - x1)) / (x2 - x1));
      }
    }
    return result;
  }

  private computeWelchPeriodogram(
    data: number[],
    samplingRate: number,
  ): { frequencies: number[]; powerSpectralDensity: number[] } {
    const minWindowSize = 64;
    const maxWindowSize = 256;
    const windowSize = Math.max(
      minWindowSize,
      Math.min(maxWindowSize, Math.floor(data.length / 2)),
    );
    const overlap = Math.floor(windowSize / 2);
    const nfft = this.nextPowerOfTwo(windowSize);

    const frequencies: number[] = [];
    for (let i = 0; i <= nfft / 2; i++) {
      frequencies.push((i * samplingRate) / nfft);
    }

    const powerSpectrums: number[][] = [];
    const hammingWindow = this.generateHammingWindow(windowSize);

    let startIndex = 0;
    while (startIndex + windowSize <= data.length) {
      const segment = data.slice(startIndex, startIndex + windowSize);
      const windowedSegment = segment.map((val, i) => val * hammingWindow[i]);

      const paddedSegment = new Array(nfft).fill(0);
      for (let i = 0; i < windowedSegment.length; i++) {
        paddedSegment[i] = windowedSegment[i];
      }

      const fftResult = this.performFFT(paddedSegment);
      const windowPower = hammingWindow.reduce((sum, w) => sum + w * w, 0);

      const powerSpectrum: number[] = [];
      for (let i = 0; i <= nfft / 2; i++) {
        const real = fftResult[2 * i] || 0;
        const imag = fftResult[2 * i + 1] || 0;
        let power = (real * real + imag * imag) / (samplingRate * windowPower);
        if (i > 0 && i < nfft / 2) {
          power *= 2;
        }
        powerSpectrum.push(power);
      }

      powerSpectrums.push(powerSpectrum);
      startIndex += windowSize - overlap;
    }

    const powerSpectralDensity = new Array(frequencies.length).fill(0);
    for (const spectrum of powerSpectrums) {
      for (let i = 0; i < spectrum.length; i++) {
        powerSpectralDensity[i] += spectrum[i];
      }
    }
    for (let i = 0; i < powerSpectralDensity.length; i++) {
      powerSpectralDensity[i] /= powerSpectrums.length;
    }

    return { frequencies, powerSpectralDensity };
  }

  private integratePowerInBand(
    frequencies: number[],
    powerSpectralDensity: number[],
    lowFreq: number,
    highFreq: number,
  ): number {
    let power = 0;
    for (let i = 0; i < frequencies.length - 1; i++) {
      const freq = frequencies[i];
      const nextFreq = frequencies[i + 1];

      if (freq >= lowFreq && nextFreq <= highFreq) {
        const df = nextFreq - freq;
        const avgPower =
          (powerSpectralDensity[i] + powerSpectralDensity[i + 1]) / 2;
        power += avgPower * df;
      } else if (freq < lowFreq && nextFreq > lowFreq && nextFreq <= highFreq) {
        const df = nextFreq - lowFreq;
        const interpolatedPower =
          powerSpectralDensity[i] +
          ((powerSpectralDensity[i + 1] - powerSpectralDensity[i]) *
            (lowFreq - freq)) /
            (nextFreq - freq);
        const avgPower =
          (interpolatedPower + powerSpectralDensity[i + 1]) / 2;
        power += avgPower * df;
      } else if (freq >= lowFreq && freq < highFreq && nextFreq > highFreq) {
        const df = highFreq - freq;
        const interpolatedPower =
          powerSpectralDensity[i] +
          ((powerSpectralDensity[i + 1] - powerSpectralDensity[i]) *
            (highFreq - freq)) /
            (nextFreq - freq);
        const avgPower =
          (powerSpectralDensity[i] + interpolatedPower) / 2;
        power += avgPower * df;
      }
    }
    return power;
  }

  private generateHammingWindow(size: number): number[] {
    const window: number[] = [];
    for (let i = 0; i < size; i++) {
      window.push(0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return window;
  }

  private nextPowerOfTwo(n: number): number {
    let power = 1;
    while (power < n) {
      power *= 2;
    }
    return power;
  }

  private performFFT(data: number[]): number[] {
    const n = data.length;
    if (n <= 1) return data;

    if ((n & (n - 1)) !== 0) {
      throw new Error('FFT 입력 크기는 2의 거듭제곱이어야 합니다');
    }

    const complex = new Array(n * 2);
    for (let i = 0; i < n; i++) {
      complex[2 * i] = data[i];
      complex[2 * i + 1] = 0;
    }

    let j = 0;
    for (let i = 1; i < n; i++) {
      let bit = n >> 1;
      while (j & bit) {
        j ^= bit;
        bit >>= 1;
      }
      j ^= bit;

      if (i < j) {
        [complex[2 * i], complex[2 * j]] = [complex[2 * j], complex[2 * i]];
        [complex[2 * i + 1], complex[2 * j + 1]] = [
          complex[2 * j + 1],
          complex[2 * i + 1],
        ];
      }
    }

    let length = 2;
    while (length <= n) {
      const angle = (-2 * Math.PI) / length;
      const wreal = Math.cos(angle);
      const wimag = Math.sin(angle);

      for (let i = 0; i < n; i += length) {
        let wr = 1;
        let wi = 0;

        for (let jj = 0; jj < length / 2; jj++) {
          const u_real = complex[2 * (i + jj)];
          const u_imag = complex[2 * (i + jj) + 1];
          const v_real =
            complex[2 * (i + jj + length / 2)] * wr -
            complex[2 * (i + jj + length / 2) + 1] * wi;
          const v_imag =
            complex[2 * (i + jj + length / 2)] * wi +
            complex[2 * (i + jj + length / 2) + 1] * wr;

          complex[2 * (i + jj)] = u_real + v_real;
          complex[2 * (i + jj) + 1] = u_imag + v_imag;
          complex[2 * (i + jj + length / 2)] = u_real - v_real;
          complex[2 * (i + jj + length / 2) + 1] = u_imag - v_imag;

          const temp_wr = wr * wreal - wi * wimag;
          wi = wr * wimag + wi * wreal;
          wr = temp_wr;
        }
      }
      length *= 2;
    }

    return complex;
  }
}
