// @ts-nocheck — link-band-sdk 이식본 (verbatim/noUnusedLocals 완화)
import FFT from 'fft.js';
import type { ProcessedEEGData, BandPowers, BrainStateAnalysis, SignalQuality, BrainStateType } from './types/eeg';
import type { EEGDataPoint, PPGDataPoint } from './SimpleCircularBuffer';

// BiquadFilters.js 라이브러리 추가 - PPG 전용 고품질 신호 처리
import { Biquad, makeNotchFilter, makeBandpassFilter } from 'biquadjs';

/**
 * Phase 1: JavaScript 기반 기본 신호 처리기
 * Python 코드와 동일한 EEG 신호 처리 및 분석 (FP1, FP2 채널)
 * PPG 신호 처리 추가 (Python SDK 호환)
 */
export class BasicSignalProcessor {
  private readonly samplingRate: number = 250; // Hz
  private readonly ppgSamplingRate: number = 50; // Hz
  private readonly fftSize: number = 512; // FFT 크기 (Python과 동일하게 증가)
  private fft: FFT;
  
  // 주파수 대역 정의 (Hz) - Python 코드와 동일
  private readonly bands = {
    delta: { min: 0.5, max: 4 },
    theta: { min: 4, max: 8 },
    alpha: { min: 8, max: 13 },
    beta: { min: 13, max: 30 },
    gamma: { min: 30, max: 50 }
  };

  constructor() {
    this.fft = new FFT(this.fftSize);
  }

  /**
   * EEG 세그먼트 처리 (Python process_eeg_data와 동일한 로직)
   * 최소 2초의 데이터 필요 (500 샘플)
   */
  processEEGSegment(data: EEGDataPoint[]): ProcessedEEGData & { 
    filteredRawData: EEGDataPoint[];
    ch1SQI: number[];
    ch2SQI: number[];
    overallSQI: number[];
    frequencySpectrum: { frequencies: number[]; magnitudes: number[]; timestamp: number };
  } {
    if (data.length < 500) {  // Python과 동일: 최소 2초 데이터 (250Hz * 2s = 500)
      throw new Error('Insufficient EEG data points');
    }

    // 채널별 데이터 추출 (Python과 동일)
    const ch1Data = data.map(point => point.fp1);
    const ch2Data = data.map(point => point.fp2);
    const ch1Leadoff = data.map(point => point.leadOff?.ch1 || false);
    const ch2Leadoff = data.map(point => point.leadOff?.ch2 || false);

    // 1. 필터링 적용 (Python과 동일: Notch + Bandpass)
    const ch1Notched = this.applyNotchFilter(ch1Data, 60); // 60Hz 노치 필터
    const ch2Notched = this.applyNotchFilter(ch2Data, 60);
    
    const ch1Filtered = this.bandpassFilter(ch1Notched, 1, 45); // 1-45Hz 밴드패스
    const ch2Filtered = this.bandpassFilter(ch2Notched, 1, 45);

    // 🔧 Transient response 제거: 앞 250개 샘플 제거 후 1000개로 분석
    const transientSamples = 250;
    const ch1Clean = ch1Filtered.length > transientSamples ? ch1Filtered.slice(transientSamples) : ch1Filtered;
    const ch2Clean = ch2Filtered.length > transientSamples ? ch2Filtered.slice(transientSamples) : ch2Filtered;
    
    // 2. SQI 계산 (깨끗한 1000개 데이터로)
    const ch1AmplitudeSQI = this.calculateAmplitudeSQI(ch1Clean);
    const ch2AmplitudeSQI = this.calculateAmplitudeSQI(ch2Clean);
    const ch1FrequencySQI = this.calculateFrequencySQI(ch1Clean);
    const ch2FrequencySQI = this.calculateFrequencySQI(ch2Clean);
    
    // SQI 값을 0~100 범위로 변환 (퍼센트 값)
    const ch1SQI = this.calculateCombinedSQI(ch1AmplitudeSQI, ch1FrequencySQI).map(sqi => sqi * 100);
    const ch2SQI = this.calculateCombinedSQI(ch2AmplitudeSQI, ch2FrequencySQI).map(sqi => sqi * 100);

    // 3. 품질 마스크 생성 (퍼센트 값 기준)
    const ch1QualityMask = ch1SQI.map(sqi => sqi >= 30); // 30% 이상을 양호로 판단
    const ch2QualityMask = ch2SQI.map(sqi => sqi >= 30);
    const goodQualitySamples = ch1QualityMask.filter((mask, i) => mask && ch2QualityMask[i]).length;

    // 4. 고품질 데이터에 대해 주파수 분석 수행 (깨끗한 1000개 데이터로)
    let ch1Power: number[] = [];
    let ch2Power: number[] = [];
    let frequencies: number[] = [];

    if (goodQualitySamples > 0) {
      // 고품질 데이터만 추출
      const ch1QualityData = ch1Clean.filter((_: number, i: number) => ch1QualityMask[i]);
      const ch2QualityData = ch2Clean.filter((_: number, i: number) => ch2QualityMask[i]);
      
      const minLength = Math.min(ch1QualityData.length, ch2QualityData.length);
      const ch1Data = ch1QualityData.slice(0, minLength);
      const ch2Data = ch2QualityData.slice(0, minLength);

      // 주파수 분석 (1-45Hz, 1Hz 간격)
      frequencies = Array.from({length: 45}, (_, i) => i + 1);
      
      if (ch1Data.length >= this.fftSize) {
        ch1Power = this.calculatePowerSpectrum(ch1Data, frequencies);
        ch2Power = this.calculatePowerSpectrum(ch2Data, frequencies);
      }
    }

    // 5. 다운샘플링 제거 - 원본 1250개 필터링된 데이터 유지
    // const downsampleFactor = Math.max(1, Math.floor(ch1Filtered.length / 250));
    // const ch1FilteredDownsampled = this.downsample(ch1Filtered, downsampleFactor);
    // const ch2FilteredDownsampled = this.downsample(ch2Filtered, downsampleFactor);
    // const ch1SQIDownsampled = this.downsample(ch1SQI, downsampleFactor);
    // const ch2SQIDownsampled = this.downsample(ch2SQI, downsampleFactor);
    
    // 🔧 transient 제거된 1000개 데이터만 반환 (차트용)
    const ch1FilteredDownsampled = ch1Clean;
    const ch2FilteredDownsampled = ch2Clean;
    
    // 🔧 SQI는 깨끗한 1000개 데이터 기준 (분석용)
    const ch1SQIDownsampled = ch1SQI;
    const ch2SQIDownsampled = ch2SQI;
    
    // 6. 밴드 파워 계산 (깨끗한 1000개 데이터로)
    const ch1BandPowers = this.computeBandPowers(ch1Power, frequencies);
    const ch2BandPowers = this.computeBandPowers(ch2Power, frequencies);

    // 7. EEG 지수 계산 (Python과 정확히 동일)
    const safeFloat = (value: number, defaultValue: number = 0): number => {
      try {
        const val = parseFloat(value.toString());
        return (!isNaN(val) && isFinite(val)) ? val : defaultValue;
      } catch {
        return defaultValue;
      }
    };

    // Python 코드와 동일한 계산
    const totalPower = Object.values(ch1BandPowers).reduce((sum, power) => sum + power, 0);
    const beta = ch1BandPowers.beta;
    const alpha = ch1BandPowers.alpha;
    const theta = ch1BandPowers.theta;
    const gamma = ch1BandPowers.gamma;

    const focusIndex = safeFloat((alpha + theta) > 0 ? beta / (alpha + theta) : 0) * 100;
    const relaxationIndex = safeFloat((alpha + beta) > 0 ? alpha / (alpha + beta) : 0) * 100;
    const stressIndex = safeFloat((alpha + theta) > 0 ? (beta + gamma) / (alpha + theta) : 0) * 100;
    
    // 반구 균형 (좌우 채널 비교) - 개선된 계산
    const leftPower = ch1BandPowers.alpha || 0;
    const rightPower = ch2BandPowers.alpha || 0;
    const powerSum = leftPower + rightPower;
    
    let hemisphericBalance = 0;
    if (powerSum > 0.001) { // 매우 작은 임계값 사용
      hemisphericBalance = (leftPower - rightPower) / powerSum;
    } else if (leftPower > 0 || rightPower > 0) {
      // 한쪽만 값이 있는 경우
      hemisphericBalance = leftPower > rightPower ? 1 : -1;
    }
    // 극단값 제한 (-1 ~ 1 범위)
    hemisphericBalance = Math.max(-1, Math.min(1, hemisphericBalance));
    hemisphericBalance = safeFloat(hemisphericBalance);
    
    const cognitiveLoad = safeFloat(alpha > 0 ? theta / alpha : 0);
    const emotionalStability = safeFloat(gamma > 0 ? (alpha + theta) / gamma : 0);

    // 필터링된 원시 데이터 생성 (transient 제거된 구간의 타임스탬프 사용)
    const stableStartIndex = transientSamples; // 250개 제거된 시작 인덱스
    const stableData = data.slice(stableStartIndex, stableStartIndex + ch1FilteredDownsampled.length);
    
    // 🔧 실제 필터링된 데이터 사용 (ch1Clean, ch2Clean이 이미 필터링되고 transient 제거된 데이터)
    const filteredRawData: EEGDataPoint[] = stableData.map((point, i) => ({
      timestamp: point.timestamp,
      fp1: ch1FilteredDownsampled[i], // ch1Clean 데이터 (60Hz 노치 + 1-45Hz 밴드패스 필터 적용)
      fp2: ch2FilteredDownsampled[i], // ch2Clean 데이터 (60Hz 노치 + 1-45Hz 밴드패스 필터 적용)
      signalQuality: point.signalQuality,
      leadOff: point.leadOff
    }));
    
    // 신호 품질 평가
    const signalQuality: SignalQuality = {
      overall: (goodQualitySamples / ch1Clean.length) * 100,
      channels: [ch1SQI.reduce((a, b) => a + b, 0) / ch1SQI.length * 100, 
                 ch2SQI.reduce((a, b) => a + b, 0) / ch2SQI.length * 100],
      artifacts: {
        movement: false,
        eyeBlink: false,
        muscleNoise: false
      }
    };

    // 뇌 상태 분석
    const brainState: BrainStateAnalysis = {
      currentState: goodQualitySamples >= 1000 ? 'focused' : 'unknown',
      confidence: goodQualitySamples / ch1Clean.length,
      stateHistory: [],
      metrics: {
        arousal: focusIndex,
        valence: relaxationIndex,
        attention: focusIndex,
        relaxation: relaxationIndex
      }
    };

    // 결과 반환 (Python과 동일한 구조)
    const result: ProcessedEEGData & { 
      filteredRawData: EEGDataPoint[];
      ch1SQI: number[];
      ch2SQI: number[];
      overallSQI: number[];
      frequencySpectrum: { frequencies: number[]; magnitudes: number[]; timestamp: number };
    } = {
      bandPowers: {
        delta: ch1BandPowers.delta,
        theta: ch1BandPowers.theta,
        alpha: ch1BandPowers.alpha,
        beta: ch1BandPowers.beta,
        gamma: ch1BandPowers.gamma
      },
      signalQuality,
      brainState,
      timestamp: Date.now(),
      
      // 추가 데이터
      filteredRawData,
      ch1SQI: ch1SQIDownsampled,
      ch2SQI: ch2SQIDownsampled,
      overallSQI: ch1SQIDownsampled.map((sqi1, i) => (sqi1 + ch2SQIDownsampled[i]) / 2),
      frequencySpectrum: {
        frequencies,
        magnitudes: ch1Power,
        timestamp: Date.now()
      }
    };

    // Python과 동일한 추가 지수들을 result에 추가
    (result as any).totalPower = safeFloat(totalPower);
    (result as any).focusIndex = focusIndex;
    (result as any).relaxationIndex = relaxationIndex;
    (result as any).stressIndex = stressIndex;
    (result as any).hemisphericBalance = hemisphericBalance;
    (result as any).cognitiveLoad = cognitiveLoad;
    (result as any).emotionalStability = emotionalStability;

    return result;
  }

  /**
   * PPG 세그먼트 처리 (Python SDK 호환)
   * 최소 1초 분량 버퍼, 50 샘플 (50Hz)
   */
  processPPGSegment(data: PPGDataPoint[]): { 
    filteredRawData: PPGDataPoint[]; 
    heartRate: number; 
    hrv: number; 
    signalQuality: number;
    spo2?: number;
    redSQI: number[];
    irSQI: number[];
    overallSQI: number[];
    advancedHRV?: {
      sdnn: number;
      pnn50: number;
      lfPower: number;
      hfPower: number;
      lfHfRatio: number;
      stressIndex: number;
      avnn: number;
      pnn20: number;
      sdsd: number;
      hrMax: number;
      hrMin: number;
    };
  } {
    if (data.length === 0) {
      throw new Error('Empty PPG data segment');
    }

    // Red와 IR 채널 데이터 분리
    const redData = data.map(point => point.red);
    const irData = data.map(point => point.ir);
    
    // 1. PPG 밴드패스 필터 적용 (0.5-5.0Hz) - Python SDK와 동일

    
    const filteredRed = this.applyPPGBandpassFilter(redData);
    const filteredIR = this.applyPPGBandpassFilter(irData);
    
    console.log('🔧 PPG 밴드패스 필터링 완료:', {
      filteredRedRange: [Math.min(...filteredRed).toFixed(2), Math.max(...filteredRed).toFixed(2)],
      filteredIRRange: [Math.min(...filteredIR).toFixed(2), Math.max(...filteredIR).toFixed(2)]
    });
    
    // 2. Transient response 제거 (필터링 초기 불안정 구간)
    // 작은 버퍼에서는 앞의 10개만 제거 (더 빠른 처리)
    const transientSamples = Math.min(10, Math.max(0, data.length - 40)); // 최소 40개는 남겨두기
    
    const stableData = data.slice(transientSamples);
    const stableRed = filteredRed.slice(transientSamples);
    const stableIR = filteredIR.slice(transientSamples);
    
    // 3. PPG SQI 계산 (안정화된 데이터에만 적용 - EEG와 동일한 방식)
    const redSQI = this.calculatePPGSQI(stableRed);
    const irSQI = this.calculatePPGSQI(stableIR);
    
    // 전체 SQI는 Red와 IR의 평균
    const overallSQI = redSQI.map((red, i) => (red + irSQI[i]) / 2);
    
    const goodMask = overallSQI.map(sqi => sqi >= 0.8);
    const goodQualityRatio = goodMask.filter(Boolean).length / goodMask.length;
    
    const filteredRawData: PPGDataPoint[] = stableData.map((point, i) => ({
      timestamp: point.timestamp,
      red: stableRed[i] || point.red, // 필터링 실패 시 원본 사용
      ir: stableIR[i] || point.ir, // 필터링 실패 시 원본 사용
      leadOff: point.leadOff // Lead-off 정보 전달
    }));
    
    // 4. 심박수 및 HRV 계산 (신호 품질이 좋은 경우에만)
    let heartRate = 0;
    let hrv = 0;
    let spo2: number | undefined = undefined;
    
    if (goodQualityRatio >= 0.2) { // 기준 완화 (0.3 → 0.2)
      // 품질이 좋은 데이터만 사용하여 심박수 계산
      const goodRedData = stableRed.filter((_, i) => goodMask[i]);
      
      if (goodRedData.length >= 20) { // 최소 데이터 요구사항 완화 (30 → 20)
        heartRate = this.calculateHeartRate(goodRedData);
        hrv = this.calculateHRV(goodRedData);
        
        // SpO2 계산 (Red/IR 비율 기반)
        const goodIRData = stableIR.filter((_, i) => goodMask[i]);
        if (goodIRData.length >= 20) {
          spo2 = this.calculateSpO2(goodRedData, goodIRData);
        }
      }
    }
    
    return {
      filteredRawData,
      heartRate,
      hrv,
      signalQuality: goodQualityRatio,
      spo2,
      redSQI: redSQI,
      irSQI: irSQI,
      overallSQI: overallSQI,
      advancedHRV: {
        sdnn: hrv,
        pnn50: 0,
        lfPower: 0,
        hfPower: 0,
        lfHfRatio: 0,
        stressIndex: 0,
        avnn: 0,
        pnn20: 0,
        sdsd: 0,
        hrMax: 0,
        hrMin: 0
      }
    };
  }

  /**
   * PPG 밴드패스 필터 (0.5-5.0Hz) - BiquadFilters.js 사용
   */
  private applyPPGBandpassFilter(data: number[]): number[] {
    try {
      // DC 성분 제거 (평균값 빼기)
      const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
      const dcRemoved = data.map(val => val - mean);
      
      console.log('🔧 PPG 밴드패스 필터 적용 시작:', {
        dataLength: data.length,
        originalMean: mean.toFixed(2),
        originalRange: [Math.min(...data).toFixed(2), Math.max(...data).toFixed(2)],
        dcRemovedRange: [Math.min(...dcRemoved).toFixed(2), Math.max(...dcRemoved).toFixed(2)]
      });
      
      // BiquadFilters.js의 밴드패스 필터 사용 (0.5-5.0Hz)
      const bandpassFilter = makeBandpassFilter(0.5, 5.0, this.ppgSamplingRate);
      const filtered = new Array(dcRemoved.length);
      
      for (let i = 0; i < dcRemoved.length; i++) {
        filtered[i] = bandpassFilter.applyFilter(dcRemoved[i]);
      }
      
      console.log('🔧 PPG 밴드패스 필터 적용 완료:', {
        filteredRange: [Math.min(...filtered).toFixed(2), Math.max(...filtered).toFixed(2)],
        filteredMean: (filtered.reduce((a, b) => a + b, 0) / filtered.length).toFixed(2),
        firstFewOriginal: data.slice(0, 5).map(v => v.toFixed(1)),
        firstFewFiltered: filtered.slice(0, 5).map(v => v.toFixed(1)),
        filteringEffect: `${((Math.abs(Math.max(...filtered) - Math.max(...data)) / Math.max(...data)) * 100).toFixed(1)}% 변화`
      });
      
      return filtered;
    } catch (error) {
      console.warn('BiquadFilters.js PPG 밴드패스 필터 실패, 기본 구현 사용:', error);
      return this.fallbackPPGBandpassFilter(data);
    }
  }

  /**
   * PPG 밴드패스 필터 (fallback) - 기본 구현
   */
  private fallbackPPGBandpassFilter(data: number[]): number[] {
    // DC 성분 제거 (평균값 빼기)
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    const dcRemoved = data.map(val => val - mean);
    
    // 1. 고역 통과 필터 (0.5Hz) - 2차 Butterworth
    const highpassed = this.applyPPGHighpass(dcRemoved, 0.5);
    
    // 2. 저역 통과 필터 (5.0Hz) - 2차 Butterworth
    const lowpassed = this.applyPPGLowpass(highpassed, 5.0);
    
    return lowpassed;
  }

  /**
   * PPG 고역 통과 필터 (2차 Butterworth, 0.5Hz)
   */
  private applyPPGHighpass(data: number[], cutoffFreq: number): number[] {
    const fs = this.ppgSamplingRate; // 50Hz
    const nyquist = fs / 2; // 25Hz
    const normalizedCutoff = cutoffFreq / nyquist; // 0.5 / 25 = 0.02
    
    // 2차 Butterworth 고역통과 필터 계수 계산
    const sqrt2 = Math.sqrt(2);
    const omega = Math.tan(Math.PI * normalizedCutoff);
    const k = omega * omega;
    const a = sqrt2 * omega;
    const norm = 1 + a + k;
    
    // 필터 계수 (정규화)
    const b0 = 1 / norm;
    const b1 = -2 / norm;
    const b2 = 1 / norm;
    const a1 = (2 * (k - 1)) / norm;
    const a2 = (1 - a + k) / norm;
    
    // 필터 적용
    const filtered = new Array(data.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    
    for (let i = 0; i < data.length; i++) {
      const x0 = data[i];
      const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      
      filtered[i] = y0;
      
      // 지연 업데이트
      x2 = x1; x1 = x0;
      y2 = y1; y1 = y0;
    }
    
    return filtered;
  }

  /**
   * PPG 저역 통과 필터 (2차 Butterworth, 5.0Hz)
   */
  private applyPPGLowpass(data: number[], cutoffFreq: number): number[] {
    const fs = this.ppgSamplingRate; // 50Hz
    const nyquist = fs / 2; // 25Hz
    const normalizedCutoff = cutoffFreq / nyquist; // 5.0 / 25 = 0.2
    
    // 2차 Butterworth 저역통과 필터 계수 계산
    const sqrt2 = Math.sqrt(2);
    const omega = Math.tan(Math.PI * normalizedCutoff);
    const k = omega * omega;
    const a = sqrt2 * omega;
    const norm = 1 + a + k;
    
    // 필터 계수 (정규화)
    const b0 = k / norm;
    const b1 = 2 * k / norm;
    const b2 = k / norm;
    const a1 = (2 * (k - 1)) / norm;
    const a2 = (1 - a + k) / norm;
    
    // 필터 적용
    const filtered = new Array(data.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    
    for (let i = 0; i < data.length; i++) {
      const x0 = data[i];
      const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      
      filtered[i] = y0;
      
      // 지연 업데이트
      x2 = x1; x1 = x0;
      y2 = y1; y1 = y0;
    }
    
    return filtered;
  }

  /**
   * PPG SQI 계산 (EEG와 동일한 방식: 절대값 250 기준)
   */
  private calculatePPGSQI(data: number[]): number[] {
    const windowSize = 25; // 0.5초 윈도우 (50Hz * 0.5s)
    const sqi: number[] = new Array(data.length).fill(0);
    const threshold = 250; // 고정 기준선 (150 → 250으로 확대)
    
    for (let i = 0; i <= data.length - windowSize; i++) {
      const window = data.slice(i, i + windowSize);
      
      // 각 샘플에 대해 개별 품질 점수 계산 (EEG와 동일한 방식)
      const qualityScores = window.map(sample => {
        const absValue = Math.abs(sample);
        
        if (absValue <= threshold) {
          // 기준선 이하: 100% 품질
          return 1.0;
        } else {
          // 기준선 초과: 점진적 품질 감소
          // 250을 넘으면 선형적으로 감소, 500에서 0%가 됨
          const excess = absValue - threshold;
          const maxExcess = threshold; // 250 이상 초과시 0%
          const qualityReduction = Math.min(excess / maxExcess, 1.0);
          return Math.max(0, 1.0 - qualityReduction);
        }
      });
      
      // 윈도우 내 평균 품질 점수 계산
      const windowSQI = qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length;
      
      // 윈도우 내 모든 샘플에 SQI 값 할당
      for (let j = i; j < i + windowSize; j++) {
        sqi[j] = windowSQI;
      }
    }
    
    return sqi;
  }

  /**
   * 데이터 통계 계산 (미사용)
   */
  private calculateDataStatistics(data: number[]): {
    mean: number;
    stdDev: number;
    min: number;
    max: number;
  } {
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
    const stdDev = Math.sqrt(variance);
    const min = Math.min(...data);
    const max = Math.max(...data);
    
    return { mean, stdDev, min, max };
  }

  /**
   * EEG SQI 계산 (절대값 150μV 기준으로 통일)
   */
  private calculateEEGSQI(data: number[], threshold: number = 150): number[] {
    const windowSize = 125; // 0.5초 윈도우 (250Hz * 0.5s)
    const sqi: number[] = new Array(data.length).fill(0);
    
    for (let i = 0; i <= data.length - windowSize; i++) {
      const window = data.slice(i, i + windowSize);
      
      // 각 샘플에 대해 개별 품질 점수 계산
      const qualityScores = window.map(sample => {
        const absValue = Math.abs(sample);
        
        if (absValue <= threshold) {
          // 기준선 이하: 100% 품질
          return 1.0;
        } else {
          // 기준선 초과: 점진적 품질 감소
          // 150μV를 넘으면 선형적으로 감소, 300μV에서 0%가 됨
          const excess = absValue - threshold;
          const maxExcess = threshold; // 150μV 이상 초과시 0%
          const qualityReduction = Math.min(excess / maxExcess, 1.0);
          return Math.max(0, 1.0 - qualityReduction);
        }
      });
      
      // 윈도우 내 평균 품질 점수 계산
      const windowSQI = qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length;
      
      // 윈도우 내 모든 샘플에 SQI 값 할당
      for (let j = i; j < i + windowSize; j++) {
        sqi[j] = windowSQI;
      }
    }
    
    return sqi;
  }

  /**
   * 심박수 계산 (개선된 알고리즘)
   * PPGSignalProcessor와 동일한 다중 방법론 적용
   */
  private calculateHeartRate(data: number[]): number {
    if (data.length < 50) return 0; // 최소 1초 데이터 필요 (50Hz * 1s)
    
    // 1. 전처리: 신호 스무딩 및 정규화
    const preprocessed = this.preprocessForHeartRate(data);
    if (preprocessed.length === 0) {
      return 0;
    }
    
    // 2. 다중 피크 검출 방법 적용
    const method1Peaks = this.detectPeaksAdaptiveThreshold(preprocessed);
    const method2Peaks = this.detectPeaksDerivativeBased(preprocessed);
    
    // 3. 최적 피크 세트 선택
    const bestPeaks = this.selectBestPeakSet([
      { peaks: method1Peaks, method: 'adaptive' },
      { peaks: method2Peaks, method: 'derivative' }
    ], preprocessed);
    
    if (bestPeaks.length < 2) {
      return 0;
    }
    
    // 4. RR 간격 계산 및 이상값 제거
    const rrIntervals = this.calculateRRIntervalsWithOutlierRemoval(bestPeaks);
    
    if (rrIntervals.length === 0) {
      return 0;
    }
    
    // 5. 심박수 계산 (가중평균 사용)
    const heartRate = this.calculateWeightedHeartRate(rrIntervals);
    
    // 6. 최종 검증 및 스무딩
    const finalHeartRate = this.validateAndSmoothHeartRate(heartRate, rrIntervals);
    
    return finalHeartRate;
  }

  /**
   * 심박수 계산을 위한 전처리
   */
  private preprocessForHeartRate(data: number[]): number[] {
    // 1. 이동평균 필터로 고주파 노이즈 제거
    const smoothed = this.applyMovingAverage(data, 3);
    
    // 2. 신호 정규화 (zero-mean)
    const mean = smoothed.reduce((sum, val) => sum + val, 0) / smoothed.length;
    const normalized = smoothed.map(val => val - mean);
    
    // 3. 신호 품질 확인
    const variance = normalized.reduce((sum, val) => sum + val * val, 0) / normalized.length;
    const std = Math.sqrt(variance);
    if (std < 10) {
      return [];
    }
    
    return normalized;
  }

  /**
   * 적응형 임계값 기반 피크 검출
   */
  private detectPeaksAdaptiveThreshold(data: number[]): number[] {
    const peaks: number[] = [];
    const windowSize = Math.floor(this.ppgSamplingRate * 0.5); // 0.5초 윈도우
    const minPeakDistance = Math.floor(this.ppgSamplingRate * 0.4); // 0.4초 최소 간격
    
    for (let i = windowSize; i < data.length - windowSize; i++) {
      // 지역 윈도우에서 동적 임계값 계산
      const window = data.slice(i - windowSize, i + windowSize);
      const localMax = Math.max(...window);
      const localMean = window.reduce((sum, val) => sum + val, 0) / window.length;
      const threshold = localMean + (localMax - localMean) * 0.6;
      
      // 피크 조건 확인
      if (data[i] > threshold && 
          data[i] > data[i-1] && 
          data[i] > data[i+1] &&
          data[i] > data[i-2] && 
          data[i] > data[i+2]) {
        
        // 최소 거리 확인
        if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minPeakDistance) {
          peaks.push(i);
        }
      }
    }
    
    return peaks;
  }

  /**
   * 미분 기반 피크 검출
   */
  private detectPeaksDerivativeBased(data: number[]): number[] {
    const peaks: number[] = [];
    const minPeakDistance = Math.floor(this.ppgSamplingRate * 0.4);
    
    // 1차 미분 계산
    const firstDerivative = [];
    for (let i = 1; i < data.length; i++) {
      firstDerivative.push(data[i] - data[i-1]);
    }
    
    // 2차 미분 계산
    const secondDerivative = [];
    for (let i = 1; i < firstDerivative.length; i++) {
      secondDerivative.push(firstDerivative[i] - firstDerivative[i-1]);
    }
    
    // 영점 교차 및 피크 검출
    for (let i = 2; i < data.length - 2; i++) {
      const idx = i - 2;
      
      if (idx >= 0 && idx < firstDerivative.length - 1 && idx < secondDerivative.length) {
        // 1차 미분 영점 교차 (양수에서 음수로)
        if (firstDerivative[idx] > 0 && firstDerivative[idx + 1] <= 0) {
          // 2차 미분이 음수 (극대값)
          if (secondDerivative[idx] < 0) {
            // 신호 강도 확인
            const localWindow = data.slice(Math.max(0, i-10), Math.min(data.length, i+10));
            const localMax = Math.max(...localWindow);
            const localMean = localWindow.reduce((sum, val) => sum + val, 0) / localWindow.length;
            
            if (data[i] > localMean + (localMax - localMean) * 0.3) {
              // 최소 거리 확인
              if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minPeakDistance) {
                peaks.push(i);
              }
            }
          }
        }
      }
    }
    
    return peaks;
  }

  /**
   * 최적 피크 세트 선택
   */
  private selectBestPeakSet(peakSets: Array<{peaks: number[], method: string}>, data: number[]): number[] {
    if (peakSets.length === 0) return [];
    
    let bestScore = -1;
    let bestPeaks: number[] = [];
    
    for (const peakSet of peakSets) {
      if (peakSet.peaks.length < 2) continue;
      
      // 피크 품질 평가
      const score = this.evaluatePeakQuality(peakSet.peaks, data);
      
      if (score > bestScore) {
        bestScore = score;
        bestPeaks = peakSet.peaks;
      }
    }
    
    return bestPeaks;
  }

  /**
   * 피크 품질 평가
   */
  private evaluatePeakQuality(peaks: number[], data: number[]): number {
    if (peaks.length < 2) return 0;
    
    // 1. RR 간격 일관성 평가
    const rrIntervals = [];
    for (let i = 1; i < peaks.length; i++) {
      const interval = peaks[i] - peaks[i-1];
      rrIntervals.push(interval);
    }
    
    const meanRR = rrIntervals.reduce((sum, val) => sum + val, 0) / rrIntervals.length;
    const rrVariance = rrIntervals.reduce((sum, val) => sum + Math.pow(val - meanRR, 2), 0) / rrIntervals.length;
    const rrCV = Math.sqrt(rrVariance) / meanRR;
    
    const consistencyScore = Math.max(0, 1 - rrCV);
    
    // 2. 피크 강도 평가
    const peakAmplitudes = peaks.map(idx => data[idx]);
    const meanAmplitude = peakAmplitudes.reduce((sum, val) => sum + val, 0) / peakAmplitudes.length;
    const amplitudeScore = Math.min(1, meanAmplitude / (Math.max(...data) * 0.5));
    
    // 3. 생리학적 타당성 평가
    const avgHeartRate = 60 / (meanRR / this.ppgSamplingRate);
    const physiologyScore = (avgHeartRate >= 40 && avgHeartRate <= 200) ? 1 : 0;
    
    // 종합 점수 (가중평균)
    return consistencyScore * 0.5 + amplitudeScore * 0.3 + physiologyScore * 0.2;
  }

  /**
   * 이상값 제거를 포함한 RR 간격 계산
   */
  private calculateRRIntervalsWithOutlierRemoval(peaks: number[]): number[] {
    if (peaks.length < 2) return [];
    
    // 1. 기본 RR 간격 계산 (밀리초)
    const rrIntervals = [];
    for (let i = 1; i < peaks.length; i++) {
      const interval = (peaks[i] - peaks[i-1]) * (1000 / this.ppgSamplingRate);
      rrIntervals.push(interval);
    }
    
    // 2. 생리학적 범위 필터링 (300-1500ms)
    const validRR = rrIntervals.filter(rr => rr >= 300 && rr <= 1500);
    
    if (validRR.length < 2) return validRR;
    
    // 3. 통계적 이상값 제거 (IQR 방법)
    const sortedRR = [...validRR].sort((a, b) => a - b);
    const q1 = sortedRR[Math.floor(sortedRR.length * 0.25)];
    const q3 = sortedRR[Math.floor(sortedRR.length * 0.75)];
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;
    
    const filteredRR = validRR.filter(rr => rr >= lowerBound && rr <= upperBound);
    
    return filteredRR;
  }

  /**
   * 가중평균 기반 심박수 계산
   */
  private calculateWeightedHeartRate(rrIntervals: number[]): number {
    if (rrIntervals.length === 0) return 0;
    
    if (rrIntervals.length === 1) {
      return 60000 / rrIntervals[0];
    }
    
    // 최근 값에 더 높은 가중치 부여
    let weightedSum = 0;
    let totalWeight = 0;
    
    for (let i = 0; i < rrIntervals.length; i++) {
      const weight = (i + 1) / rrIntervals.length;
      weightedSum += (60000 / rrIntervals[i]) * weight;
      totalWeight += weight;
    }
    
    return weightedSum / totalWeight;
  }

  /**
   * 심박수 검증 및 스무딩
   */
  private validateAndSmoothHeartRate(heartRate: number, rrIntervals: number[]): number {
    // 1. 생리학적 범위 확인
    if (heartRate < 40 || heartRate > 200) {
      return 0;
    }
    
    // 2. RR 간격 일관성 확인
    if (rrIntervals.length >= 3) {
      const rrMean = rrIntervals.reduce((sum, val) => sum + val, 0) / rrIntervals.length;
      const rrStd = Math.sqrt(rrIntervals.reduce((sum, val) => sum + Math.pow(val - rrMean, 2), 0) / rrIntervals.length);
      const cv = rrStd / rrMean;
      
      // 변동계수가 너무 크면 신뢰도 낮음
      if (cv > 0.5) {
        return Math.round(heartRate * 0.9); // 10% 감소
      }
    }
    
    // 3. 최종 반올림
    return Math.round(heartRate);
  }

  /**
   * 이동평균 필터
   */
  private applyMovingAverage(data: number[], windowSize: number): number[] {
    if (data.length < windowSize) return data;
    
    const filtered = [];
    for (let i = windowSize - 1; i < data.length; i++) {
      let sum = 0;
      for (let j = i - windowSize + 1; j <= i; j++) {
        sum += data[j];
      }
      filtered.push(sum / windowSize);
    }
    
    return filtered;
  }

  /**
   * HRV 계산 (RMSSD 방식) - 개선된 피크 검출 사용
   */
  private calculateHRV(data: number[]): number {
    if (data.length < 50) return 0; // 최소 1초 데이터 필요
    
    // 전처리된 데이터 사용
    const preprocessed = this.preprocessForHeartRate(data);
    if (preprocessed.length === 0) return 0;
    
    // 개선된 피크 검출 사용
    const peaks = this.detectPeaksAdaptiveThreshold(preprocessed);
    if (peaks.length < 2) return 0;
    
    // RR 간격 계산 및 이상값 제거
    const rrIntervals = this.calculateRRIntervalsWithOutlierRemoval(peaks);
    if (rrIntervals.length < 2) return 0;
    
    // RMSSD 계산
    const squaredDiffs = [];
    for (let i = 1; i < rrIntervals.length; i++) {
      const diff = rrIntervals[i] - rrIntervals[i-1];
      squaredDiffs.push(diff * diff);
    }
    
    const meanSquaredDiff = squaredDiffs.reduce((sum, val) => sum + val, 0) / squaredDiffs.length;
    return Math.sqrt(meanSquaredDiff);
  }

  /**
   * SpO2 계산 (Red/IR 비율 기반)
   */
  private calculateSpO2(redData: number[], irData: number[]): number {
    if (redData.length !== irData.length || redData.length < 50) return 0;
    
    // AC/DC 비율 계산
    const redMean = redData.reduce((sum, val) => sum + val, 0) / redData.length;
    const irMean = irData.reduce((sum, val) => sum + val, 0) / irData.length;
    
    const redAC = Math.sqrt(redData.reduce((sum, val) => sum + Math.pow(val - redMean, 2), 0) / redData.length);
    const irAC = Math.sqrt(irData.reduce((sum, val) => sum + Math.pow(val - irMean, 2), 0) / irData.length);
    
    const redRatio = redAC / redMean;
    const irRatio = irAC / irMean;
    
    if (irRatio === 0) return 0;
    
    // 간단한 SpO2 계산 (실제로는 더 복잡한 캘리브레이션 필요)
    const ratio = redRatio / irRatio;
    const spo2 = 110 - 25 * ratio;
    
    // 합리적인 범위 (70-100%)
    return Math.max(70, Math.min(100, spo2));
  }

  /**
   * 기본 필터링 (노이즈 제거)
   */
  private applyBasicFilter(data: number[]): number[] {
    // 1. 60Hz 노치 필터 (전력선 노이즈 제거)
    const notched = this.applyNotchFilter(data, 60);
    
    // 2. Moving average로 고주파 노이즈 제거
    const smoothed = this.movingAverage(notched, 3);
    
    // 3. 기본 bandpass filter (0.5-50Hz)
    const filtered = this.bandpassFilter(smoothed, 0.5, 50);
    
    return filtered;
  }

  /**
   * 이동 평균 필터
   */
  private movingAverage(data: number[], windowSize: number): number[] {
    const result: number[] = [];
    const halfWindow = Math.floor(windowSize / 2);
    
    for (let i = 0; i < data.length; i++) {
      const start = Math.max(0, i - halfWindow);
      const end = Math.min(data.length, i + halfWindow + 1);
      
      let sum = 0;
      for (let j = start; j < end; j++) {
        sum += data[j];
      }
      
      result.push(sum / (end - start));
    }
    
    return result;
  }

  /**
   * 실제 밴드패스 필터 (0.5-50Hz) - IIR Butterworth 구현
   */
  private bandpassFilter(data: number[], lowFreq: number, highFreq: number): number[] {
    // 고역 통과 필터 적용
    const highpassed = this.applyHighpassFilter(data, lowFreq);
    // 저역 통과 필터 적용
    const bandpassed = this.applyLowpassFilter(highpassed, highFreq);
    return bandpassed;
  }

  /**
   * 60Hz 노치 필터 (Python notch_filter와 동일)
   */
  private applyNotchFilter(data: number[], notchFreq: number): number[] {
    // 간단한 노치 필터 구현 (IIR 필터)
    const fs = this.samplingRate;
    const omega = 2 * Math.PI * notchFreq / fs;
    const alpha = 0.95; // 노치 강도
    
    const filtered = new Array(data.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    
    const b0 = 1;
    const b1 = -2 * Math.cos(omega);
    const b2 = 1;
    const a0 = 1 + alpha;
    const a1 = -2 * Math.cos(omega);
    const a2 = alpha;
    
    for (let i = 0; i < data.length; i++) {
      const x0 = data[i];
      const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      
      filtered[i] = y0;
      
      x2 = x1; x1 = x0;
      y2 = y1; y1 = y0;
    }
    
    return filtered;
  }

  /**
   * 고역 통과 필터
   */
  private applyHighpassFilter(data: number[], cutoffFreq: number): number[] {
    const fs = this.samplingRate;
    const nyquist = fs / 2;
    const normalizedCutoff = cutoffFreq / nyquist;
    
    // 1차 Butterworth 고역통과 필터
    const alpha = Math.exp(-2 * Math.PI * normalizedCutoff);
    const filtered = new Array(data.length);
    
    filtered[0] = data[0];
    for (let i = 1; i < data.length; i++) {
      filtered[i] = alpha * (filtered[i-1] + data[i] - data[i-1]);
    }
    
    return filtered;
  }

  /**
   * 저역 통과 필터
   */
  private applyLowpassFilter(data: number[], cutoffFreq: number): number[] {
    const fs = this.samplingRate;
    const nyquist = fs / 2;
    const normalizedCutoff = cutoffFreq / nyquist;
    
    // 1차 Butterworth 저역통과 필터
    const alpha = Math.exp(-2 * Math.PI * normalizedCutoff);
    const filtered = new Array(data.length);
    
    filtered[0] = data[0];
    for (let i = 1; i < data.length; i++) {
      filtered[i] = alpha * filtered[i-1] + (1 - alpha) * data[i];
    }
    
    return filtered;
  }

  /**
   * 진폭 기반 SQI 계산 (Python calculate_amplitude_sqi와 동일)
   */
  private calculateAmplitudeSQI(data: number[]): number[] {
    const windowSize = 125; // 0.5초 윈도우 (250Hz * 0.5s)
    const sqi = new Array(data.length).fill(0);
    
    for (let i = 0; i <= data.length - windowSize; i++) {
      const window = data.slice(i, i + windowSize);
      const amplitude = Math.max(...window) - Math.min(...window);
      
      // 진폭이 적정 범위(10-100μV)에 있으면 좋은 품질
      let qualityScore = 0;
      if (amplitude >= 10 && amplitude <= 100) {
        qualityScore = 1.0;
      } else if (amplitude < 10) {
        qualityScore = amplitude / 10;
      } else {
        qualityScore = Math.max(0, 1.0 - (amplitude - 100) / 100);
      }
      
      for (let j = i; j < i + windowSize && j < data.length; j++) {
        sqi[j] = qualityScore;
      }
    }
    
    return sqi;
  }

  /**
   * 주파수 기반 SQI 계산 (Python calculate_frequency_sqi와 동일)
   */
  private calculateFrequencySQI(data: number[]): number[] {
    const windowSize = 125; // 0.5초 윈도우
    const sqi = new Array(data.length).fill(0);
    
    for (let i = 0; i <= data.length - windowSize; i++) {
      const window = data.slice(i, i + windowSize);
      
      // 간단한 주파수 도메인 품질 평가
      // 고주파 노이즈 비율 계산
      const variance = this.calculateVariance(window);
      const qualityScore = Math.max(0, Math.min(1, 1.0 - variance / 1000));
      
      for (let j = i; j < i + windowSize && j < data.length; j++) {
        sqi[j] = qualityScore;
      }
    }
    
    return sqi;
  }

  /**
   * 복합 SQI 계산 (Python calculate_combined_sqi와 동일)
   */
  private calculateCombinedSQI(amplitudeSQI: number[], frequencySQI: number[]): number[] {
    const combinedSQI = new Array(amplitudeSQI.length);
    
    for (let i = 0; i < amplitudeSQI.length; i++) {
      // 진폭과 주파수 SQI의 가중 평균
      combinedSQI[i] = 0.7 * amplitudeSQI[i] + 0.3 * frequencySQI[i];
    }
    
    return combinedSQI;
  }

  /**
   * 파워 스펙트럼 계산
   */
  private calculatePowerSpectrum(data: number[], frequencies: number[]): number[] {
    if (data.length < this.fftSize) {
      return new Array(frequencies.length).fill(0);
    }
    
    // 윈도우 함수 적용 (Hanning window)
    const windowed = this.applyHanningWindow(data.slice(0, this.fftSize));
    
    // FFT 수행
    const fftResult = this.performFFT(windowed);
    
    // 주파수별 파워 추출
    const powers = new Array(frequencies.length);
    const freqResolution = this.samplingRate / this.fftSize;
    
    for (let i = 0; i < frequencies.length; i++) {
      const freq = frequencies[i];
      const binIndex = Math.round(freq / freqResolution);
      
      if (binIndex < fftResult.length) {
        powers[i] = fftResult[binIndex] * fftResult[binIndex]; // Power = |X(f)|^2
      } else {
        powers[i] = 0;
      }
    }
    
    return powers;
  }

  /**
   * 밴드 파워 계산 (Python compute_band_powers와 동일)
   */
  private computeBandPowers(powerSpectrum: number[], frequencies: number[]): BandPowers {
    if (powerSpectrum.length === 0 || frequencies.length === 0) {
      return {
        delta: 0,
        theta: 0,
        alpha: 0,
        beta: 0,
        gamma: 0
      };
    }
    
    let deltaPower = 0, thetaPower = 0, alphaPower = 0, betaPower = 0, gammaPower = 0;
    
    for (let i = 0; i < frequencies.length; i++) {
      const freq = frequencies[i];
      const power = powerSpectrum[i];
      
      if (freq >= this.bands.delta.min && freq < this.bands.delta.max) {
        deltaPower += power;
      } else if (freq >= this.bands.theta.min && freq < this.bands.theta.max) {
        thetaPower += power;
      } else if (freq >= this.bands.alpha.min && freq < this.bands.alpha.max) {
        alphaPower += power;
      } else if (freq >= this.bands.beta.min && freq < this.bands.beta.max) {
        betaPower += power;
      } else if (freq >= this.bands.gamma.min && freq < this.bands.gamma.max) {
        gammaPower += power;
      }
    }
    
    // 정규화 없이 절대값 반환 (Python과 동일)
    return {
      delta: deltaPower,
      theta: thetaPower,
      alpha: alphaPower,
      beta: betaPower,
      gamma: gammaPower
    };
  }

  /**
   * 다운샘플링
   */
  private downsample(data: number[], factor: number): number[] {
    if (factor <= 1) return data;
    
    const downsampled = [];
    for (let i = 0; i < data.length; i += factor) {
      downsampled.push(data[i]);
    }
    
    return downsampled;
  }

  /**
   * 분산 계산
   */
  private calculateVariance(data: number[]): number {
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
    return variance;
  }

  /**
   * Hanning 윈도우 적용
   */
  private applyHanningWindow(data: number[]): number[] {
    const windowed = new Array(data.length);
    const N = data.length;
    
    for (let i = 0; i < N; i++) {
      const window = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
      windowed[i] = data[i] * window;
    }
    
    return windowed;
  }

  /**
   * FFT 수행
   */
  private performFFT(data: number[]): number[] {
    const fftInput = new Array(this.fftSize * 2).fill(0);
    
    // 실수 부분만 설정 (허수 부분은 0)
    for (let i = 0; i < Math.min(data.length, this.fftSize); i++) {
      fftInput[i * 2] = data[i];     // 실수부
      fftInput[i * 2 + 1] = 0;       // 허수부
    }
    
    const fftOutput = new Array(this.fftSize * 2);
    this.fft.realTransform(fftOutput, fftInput);
    
    // 크기 계산
    const magnitudes = new Array(this.fftSize / 2);
    for (let i = 0; i < this.fftSize / 2; i++) {
      const real = fftOutput[i * 2];
      const imag = fftOutput[i * 2 + 1];
      magnitudes[i] = Math.sqrt(real * real + imag * imag);
    }
    
    return magnitudes;
  }

  /**
   * 신호 품질 평가
   */
  private calculateSignalQuality(data: EEGDataPoint[]): SignalQuality {
    if (data.length === 0) {
      return {
        overall: 0,
        channels: [0, 0],
        artifacts: {
          movement: true,
          eyeBlink: true,
          muscleNoise: true
        }
      };
    }

    // 채널별 신호 품질 계산
    const fp1Quality = this.calculateChannelQuality(data.map(p => p.fp1));
    const fp2Quality = this.calculateChannelQuality(data.map(p => p.fp2));
    
    // 아티팩트 검출
    const artifacts = this.detectArtifacts(data);
    
    // 전체 품질 점수
    const overall = (fp1Quality + fp2Quality) / 2;
    
    return {
      overall,
      channels: [fp1Quality, fp2Quality],
      artifacts
    };
  }

  /**
   * 단일 채널 신호 품질 계산
   */
  private calculateChannelQuality(channelData: number[]): number {
    if (channelData.length === 0) return 0;
    
    // 1. 신호 분산 확인 (너무 낮으면 접촉 불량)
    const mean = channelData.reduce((sum, val) => sum + val, 0) / channelData.length;
    const variance = channelData.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / channelData.length;
    const stdDev = Math.sqrt(variance);
    
    // 2. 신호 범위 확인
    const min = Math.min(...channelData);
    const max = Math.max(...channelData);
    const range = max - min;
    
    // 3. 품질 점수 계산 (경험적 공식)
    let quality = 100;
    
    // 신호가 너무 약하면 감점
    if (stdDev < 5) quality -= 30;
    else if (stdDev < 10) quality -= 15;
    
    // 신호가 너무 강하면 감점 (포화)
    if (range > 500) quality -= 40;
    else if (range > 300) quality -= 20;
    
    // 신호가 너무 평평하면 감점
    if (range < 10) quality -= 50;
    
    return Math.max(0, Math.min(100, quality));
  }

  /**
   * 아티팩트 검출
   */
  private detectArtifacts(data: EEGDataPoint[]): { movement: boolean; eyeBlink: boolean; muscleNoise: boolean } {
    // 간단한 임계값 기반 검출
    const fp1Values = data.map(point => Math.abs(point.fp1));
    const fp2Values = data.map(point => Math.abs(point.fp2));
    
    const maxFp1 = Math.max(...fp1Values);
    const maxFp2 = Math.max(...fp2Values);
    
    // 임계값 (μV 단위 가정)
    const movementThreshold = 200;
    const eyeBlinkThreshold = 150;
    const muscleNoiseThreshold = 100;
    
    return {
      movement: maxFp1 > movementThreshold || maxFp2 > movementThreshold,
      eyeBlink: maxFp1 > eyeBlinkThreshold || maxFp2 > eyeBlinkThreshold,
      muscleNoise: this.calculateHighFreqNoise(data) > muscleNoiseThreshold
    };
  }

  /**
   * 고주파 노이즈 계산 (근전도 노이즈 검출용)
   */
  private calculateHighFreqNoise(data: EEGDataPoint[]): number {
    // 간단한 차분 기반 고주파 성분 추정
    let totalDiff = 0;
    
    for (let i = 1; i < data.length; i++) {
      const diffFp1 = Math.abs(data[i].fp1 - data[i-1].fp1);
      const diffFp2 = Math.abs(data[i].fp2 - data[i-1].fp2);
      totalDiff += diffFp1 + diffFp2;
    }
    
    return totalDiff / (data.length - 1);
  }

  /**
   * 뇌파 상태 분석
   */
  private analyzeBrainState(bandPowers: BandPowers, signalQuality: SignalQuality): BrainStateAnalysis {
    // 신호 품질이 낮으면 분석 불가
    if (signalQuality.overall < 50) {
      return {
        currentState: 'unknown',
        confidence: 0,
        stateHistory: [],
        recommendations: ['신호 품질을 개선해주세요']
      };
    }

    // 정규화된 밴드 파워
    const totalPower = bandPowers.delta + bandPowers.theta + bandPowers.alpha + bandPowers.beta + bandPowers.gamma;
    const normalized = {
      delta: bandPowers.delta / totalPower,
      theta: bandPowers.theta / totalPower,
      alpha: bandPowers.alpha / totalPower,
      beta: bandPowers.beta / totalPower,
      gamma: bandPowers.gamma / totalPower
    };

    // 상태 분류 로직
    let currentState: BrainStateType;
    let confidence: number;

    if (normalized.alpha > 0.4 && normalized.beta < 0.3) {
      currentState = 'relaxed';
      confidence = normalized.alpha;
    } else if (normalized.beta > 0.4 && normalized.alpha < 0.3) {
      currentState = 'stressed';
      confidence = normalized.beta;
    } else if (normalized.alpha > 0.3 && normalized.beta > 0.3) {
      currentState = 'focused';
      confidence = (normalized.alpha + normalized.beta) / 2;
    } else if (normalized.theta > 0.4 || normalized.delta > 0.4) {
      currentState = 'drowsy';
      confidence = Math.max(normalized.theta, normalized.delta);
    } else {
      currentState = 'active';
      confidence = normalized.gamma;
    }

    // 메트릭 계산
    const metrics = {
      arousal: normalized.beta + normalized.gamma,
      valence: normalized.alpha - normalized.beta,
      attention: normalized.beta - normalized.theta,
      relaxation: normalized.alpha - normalized.beta
    };

    // 추천사항 생성
    const recommendations = this.generateRecommendations(currentState, bandPowers, signalQuality);

    return {
      currentState,
      confidence: Math.min(confidence * 2, 1), // 0-1 범위로 조정
      stateHistory: [currentState],
      recommendations,
      metrics
    };
  }

  /**
   * 추천사항 생성
   */
  private generateRecommendations(
    state: BrainStateType, 
    _bandPowers: BandPowers, 
    signalQuality: SignalQuality
  ): string[] {
    const recommendations: string[] = [];

    // 신호 품질 기반 추천
    if (signalQuality.overall < 70) {
      recommendations.push('전극 접촉을 확인해주세요');
    }
    if (signalQuality.artifacts.movement) {
      recommendations.push('움직임을 최소화해주세요');
    }
    if (signalQuality.artifacts.eyeBlink) {
      recommendations.push('눈 깜빡임을 줄여주세요');
    }

    // 뇌파 상태 기반 추천
    switch (state) {
      case 'focused':
        recommendations.push('집중 상태가 좋습니다');
        break;
      case 'relaxed':
        recommendations.push('편안한 상태입니다');
        break;
      case 'drowsy':
        recommendations.push('각성도를 높여보세요');
        break;
      case 'stressed':
        recommendations.push('휴식을 취해보세요');
        break;
      default:
        recommendations.push('데이터 수집 중입니다');
    }

    return recommendations;
  }

  /**
   * ACC 데이터 처리 (파이썬 signal_processing.py와 동일한 로직)
   */
  processACCData(accData: { x: number; y: number; z: number; timestamp: number }[]): {
    xChange: number[];
    yChange: number[];
    zChange: number[];
    movementMagnitude: number[];
    avgMovement: number;
    stdMovement: number;
    maxMovement: number;
    activityState: string;
    xChangeMean: number;
    yChangeMean: number;
    zChangeMean: number;
  } | null {
    if (accData.length < 2) {
      return null;
    }

    // Extract coordinate arrays
    const xData = accData.map(d => d.x);
    const yData = accData.map(d => d.y);
    const zData = accData.map(d => d.z);

    // Calculate gradients (변화율) - 파이썬 np.gradient와 동일한 로직
    const xChange = this.calculateGradient(xData);
    const yChange = this.calculateGradient(yData);
    const zChange = this.calculateGradient(zData);

    // Calculate movement magnitude
    const movementMagnitude = xChange.map((x, i) => 
      Math.sqrt(x * x + yChange[i] * yChange[i] + zChange[i] * zChange[i])
    );

    // Calculate statistics
    const avgMovementRaw = movementMagnitude.reduce((sum, val) => sum + val, 0) / movementMagnitude.length;
    const stdMovementRaw = Math.sqrt(
      movementMagnitude.reduce((sum, val) => sum + Math.pow(val - avgMovementRaw, 2), 0) / movementMagnitude.length
    );
    const maxMovementRaw = Math.max(...movementMagnitude);

    // 100을 곱하여 그래프 표시용 스케일링 (사용자 혼동 방지)
    const avgMovement = avgMovementRaw * 100;
    const stdMovement = stdMovementRaw * 100;
    const maxMovement = maxMovementRaw * 100;

    // Determine activity state (스케일링된 값 기준)
    let activityState: string;
    if (avgMovement < 200) {
      activityState = "stationary";
    } else if (avgMovement < 600) {
      activityState = "sitting";
    } else if (avgMovement < 1000) {
      activityState = "walking";
    } else {
      activityState = "running";
    }

    // Calculate means
    const xChangeMean = xChange.reduce((sum, val) => sum + val, 0) / xChange.length;
    const yChangeMean = yChange.reduce((sum, val) => sum + val, 0) / yChange.length;
    const zChangeMean = zChange.reduce((sum, val) => sum + val, 0) / zChange.length;

    return {
      xChange,
      yChange,
      zChange,
      movementMagnitude,
      avgMovement,
      stdMovement,
      maxMovement,
      activityState,
      xChangeMean,
      yChangeMean,
      zChangeMean
    };
  }

  /**
   * 그래디언트 계산 (파이썬 np.gradient와 동일한 로직)
   */
  private calculateGradient(data: number[]): number[] {
    if (data.length < 2) {
      return [];
    }

    const gradient = new Array(data.length);

    // 첫 번째 점: 전진 차분
    gradient[0] = data[1] - data[0];

    // 중간 점들: 중앙 차분
    for (let i = 1; i < data.length - 1; i++) {
      gradient[i] = (data[i + 1] - data[i - 1]) / 2;
    }

    // 마지막 점: 후진 차분
    gradient[data.length - 1] = data[data.length - 1] - data[data.length - 2];

    return gradient;
  }
} 
