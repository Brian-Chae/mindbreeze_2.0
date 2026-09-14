// @ts-nocheck — link-band-sdk 이식본 (verbatim/noUnusedLocals 완화)
import type { EEGDataPoint } from './SimpleCircularBuffer';
import type { ProcessedEEGData, BandPowers, BrainStateAnalysis, SignalQuality } from './types/eeg';

// BiquadFilters.js 라이브러리 추가 - EEG 전용 고품질 신호 처리
import { Biquad, makeNotchFilter, makeBandpassFilter } from 'biquadjs';

/** Morlet 웨이블렛 복소수 샘플 */
interface ComplexSample {
  real: number;
  imag: number;
}

/** Morlet 사이클 수 (haru 정본 / SDD-035) */
const N_CYCLES = 7.0;
/** 분석에 사용할 최대 샘플 수 */
const MAX_ANALYSIS_SAMPLES = 1000;

/**
 * PSD 절대 보정 상수 (haru 정본)
 * PSD(f) = PSD_CALIB × corr(f) × P(f)
 */
const PSD_CALIB = 0.00739181390669613;

/**
 * 주파수별 보정벡터 corr(f), 1~45Hz (haru 정본)
 */
const PSD_CORRECTION_VECTOR: Readonly<Record<number, number>> = {
  1: 3.458011, 2: 0.954247, 3: 0.979583, 4: 1.014871, 5: 0.991486,
  6: 0.985819, 7: 0.988772, 8: 0.983593, 9: 1.000722, 10: 1.019498,
  11: 1.015089, 12: 1.002732, 13: 0.994022, 14: 0.986332, 15: 0.979657,
  16: 0.976007, 17: 0.976767, 18: 0.981398, 19: 0.987247, 20: 0.99246,
  21: 0.996599, 22: 0.999288, 23: 1.000258, 24: 1.000149, 25: 1.000518,
  26: 1.002928, 27: 1.008112, 28: 1.016309, 29: 1.027692, 30: 1.042752,
  31: 1.062329, 32: 1.087514, 33: 1.119614, 34: 1.160231, 35: 1.21135,
  36: 1.275479, 37: 1.355671, 38: 1.455584, 39: 1.579855, 40: 1.733971,
  41: 1.924999, 42: 2.161598, 43: 2.454839, 44: 2.818886, 45: 3.271393,
};

/** 주파수 f[Hz]에 해당하는 보정계수 — 가장 가까운 정수 Hz(1~45)로 반올림/클램프 */
function psdCorrectionFactor(frequency: number): number {
  const hz = Math.min(45, Math.max(1, Math.round(frequency)));
  return PSD_CORRECTION_VECTOR[hz] ?? 1;
}

/**
 * EEG 전용 독립 신호 처리기
 * 
 * 역할:
 * - Python 코드와 동일한 EEG 신호 처리 (60Hz 노치, 1-45Hz 밴드패스)
 * - 신호 품질 분석 (SQI 계산)
 * - 주파수 분석 (밴드 파워 계산)
 * - 뇌파 상태 분석 및 지수 계산
 * - Web Worker 분리 대상
 */
export class EEGSignalProcessor {
  private readonly samplingRate: number = 250; // Hz
  
  // 주파수 대역 정의 (Hz) — haru 정본 (SDD-035)
  private readonly bands = {
    delta: { min: 1, max: 4 },
    theta: { min: 4, max: 8 },
    alpha: { min: 8, max: 13 },
    beta: { min: 13, max: 30 },
    gamma: { min: 30, max: 45 }
  };

  constructor() {
    // Morlet wavelet 기반 처리기로 변경됨
  }
  
  /**
   * EEG 데이터 처리 메인 함수
   * Python 코드와 동일한 완전한 EEG 분석 수행
   */
  async processEEGData(data: EEGDataPoint[]): Promise<{
    filteredData: EEGDataPoint[];
    signalQuality: {
      overall: number;
      fp1: number;
      fp2: number;
      sqi: number[];
    };
    bandPowers: BandPowers;
    brainState: BrainStateAnalysis;
    frequencySpectrum: {
      frequencies: number[];
      ch1Power: number[];
      ch2Power: number[];
      timestamp: number;
    };
    indices: {
      focusIndex: number;
      relaxationIndex: number;
      stressIndex: number;
      hemisphericBalance: number;
      cognitiveLoad: number;
      emotionalStability: number;
      totalPower: number;
    };
    rawAnalysis: {
      ch1SQI: number[];
      ch2SQI: number[];
      overallSQI: number[];
    };
  }> {
    if (data.length < 500) {
      throw new Error('EEG 데이터가 부족합니다. 최소 2초(500샘플) 필요');
    }

    // 1. EEG 신호 처리 (Python processEEGSegment와 동일한 로직)
    const processedData = this.processEEGSegment(data);
    
    // 2. 계산된 지수들 추출
    const focusIndex = (processedData as any).focusIndex || 0;
    const relaxationIndex = (processedData as any).relaxationIndex || 0;
    const stressIndex = (processedData as any).stressIndex || 0;
    const hemisphericBalance = (processedData as any).hemisphericBalance || 0;
    const cognitiveLoad = (processedData as any).cognitiveLoad || 0;
    const emotionalStability = (processedData as any).emotionalStability || 0;
    const totalPower = (processedData as any).totalPower || 0;
    
    // 3. EEG 특화 결과 구성
    const result = {
      filteredData: processedData.filteredRawData,
      signalQuality: {
        overall: processedData.signalQuality.overall,
        fp1: processedData.signalQuality.channels[0],
        fp2: processedData.signalQuality.channels[1],
        sqi: processedData.overallSQI
      },
      bandPowers: processedData.bandPowers,
      brainState: processedData.brainState,
      frequencySpectrum: processedData.frequencySpectrum,
      indices: {
        focusIndex,
        relaxationIndex,
        stressIndex,
        hemisphericBalance,
        cognitiveLoad,
        emotionalStability,
        totalPower
      },
      rawAnalysis: {
        ch1SQI: processedData.ch1SQI,
        ch2SQI: processedData.ch2SQI,
        overallSQI: processedData.overallSQI
      }
    };

    return result;
  }

  /**
   * EEG 세그먼트 처리 (Python process_eeg_data와 동일한 로직)
   * 최소 2초의 데이터 필요 (500 샘플)
   */
  private processEEGSegment(data: EEGDataPoint[]): ProcessedEEGData & { 
    filteredRawData: EEGDataPoint[];
    ch1SQI: number[];
    ch2SQI: number[];
    overallSQI: number[];
    frequencySpectrum: { frequencies: number[]; ch1Power: number[]; ch2Power: number[]; timestamp: number };
  } {
    if (data.length < 500) {
      throw new Error('Insufficient EEG data points');
    }

    // 채널별 데이터 추출 (Python과 동일)
    const ch1Data = data.map(point => point.fp1);
    const ch2Data = data.map(point => point.fp2);

    // 1. 필터링 적용 (Python과 동일: Notch + Bandpass)
    const ch1Notched = this.applyNotchFilter(ch1Data, 60); // 60Hz 노치 필터
    const ch2Notched = this.applyNotchFilter(ch2Data, 60);
    
    const ch1Filtered = this.bandpassFilter(ch1Notched, 1, 45); // 1-45Hz 밴드패스
    const ch2Filtered = this.bandpassFilter(ch2Notched, 1, 45);

    // Transient response 제거: 앞 250개 샘플 제거 후 1000개로 분석
    const transientSamples = Math.floor(data.length * 0.15);
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

    // 3. 품질 마스크 생성 (임계값을 더 완화)
    const qualityThreshold = 15; // 15% 이상을 양호로 판단 (30% → 15%로 완화)
    const ch1QualityMask = ch1SQI.map(sqi => sqi >= qualityThreshold);
    const ch2QualityMask = ch2SQI.map(sqi => sqi >= qualityThreshold);
    const goodQualitySamples = ch1QualityMask.filter((mask, i) => mask && ch2QualityMask[i]).length;

    // 품질 분석 계산
    const avgCh1SQI = ch1SQI.reduce((a, b) => a + b, 0) / ch1SQI.length;
    const avgCh2SQI = ch2SQI.reduce((a, b) => a + b, 0) / ch2SQI.length;
    const qualityPercentage = (goodQualitySamples / ch1Clean.length) * 100;

    // 4. 주파수 분석 수행 (품질 관계없이 항상 수행)
    let ch1Power: number[] = [];
    let ch2Power: number[] = [];
    let frequencies: number[] = [];

    // 품질이 좋은 데이터가 있으면 사용, 없으면 전체 데이터 사용
    let ch1DataForAnalysis: number[];
    let ch2DataForAnalysis: number[];
    
    if (goodQualitySamples > 100) { // 최소 100개 샘플이 있을 때만 품질 필터링 적용
      const ch1QualityData = ch1Clean.filter((_: number, i: number) => ch1QualityMask[i]);
      const ch2QualityData = ch2Clean.filter((_: number, i: number) => ch2QualityMask[i]);
      
      const minLength = Math.min(ch1QualityData.length, ch2QualityData.length);
      ch1DataForAnalysis = ch1QualityData.slice(0, minLength);
      ch2DataForAnalysis = ch2QualityData.slice(0, minLength);
    } else {
      // 품질 필터링 없이 전체 데이터 사용
      ch1DataForAnalysis = ch1Clean;
      ch2DataForAnalysis = ch2Clean;
    }

    // 주파수 분석 수행
    if (ch1DataForAnalysis.length >= 125) { // 최소 0.5초 데이터 필요
      frequencies = Array.from({length: 45}, (_, i) => i + 1);
      
      // Morlet wavelet 기반 파워 스펙트럼 계산
      ch1Power = this.calculatePowerSpectrum(ch1DataForAnalysis, frequencies);
      ch2Power = this.calculatePowerSpectrum(ch2DataForAnalysis, frequencies);
    }
    
    // 5. 필터링된 원시 데이터 생성
    const stableStartIndex = transientSamples;
    const stableData = data.slice(stableStartIndex, stableStartIndex + ch1Clean.length);
    
    const filteredRawData: EEGDataPoint[] = stableData.map((point, i) => ({
      timestamp: point.timestamp,
      fp1: ch1Clean[i],
      fp2: ch2Clean[i],
      signalQuality: point.signalQuality,
      leadOff: point.leadOff
    }));
    
    // 6. 밴드 파워 계산
    const ch1BandPowers = this.computeBandPowers(ch1Power, frequencies);
    const ch2BandPowers = this.computeBandPowers(ch2Power, frequencies);

    // 7. EEG 지수 계산 (ch1BandPowers 객체 직접 사용)
    const safeFloat = (value: number, defaultValue: number = 0): number => {
      try {
        const val = parseFloat(value.toString());
        return (!isNaN(val) && isFinite(val)) ? val : defaultValue;
      } catch {
        return defaultValue;
      }
    };

    const totalPower = Object.values(ch1BandPowers).reduce((sum, power) => sum + power, 0);
    
    // EEG 지수 계산 (0~1 비율 → 0~100% 스케일로 변환)
    const focusIndex = safeFloat((ch1BandPowers.alpha + ch1BandPowers.theta) > 0 ? 
      ch1BandPowers.beta / (ch1BandPowers.alpha + ch1BandPowers.theta) : 0) * 100;
    const relaxationIndex = safeFloat((ch1BandPowers.alpha + ch1BandPowers.beta) > 0 ? 
      ch1BandPowers.alpha / (ch1BandPowers.alpha + ch1BandPowers.beta) : 0) * 100;
    const stressIndex = safeFloat((ch1BandPowers.alpha + ch1BandPowers.theta) > 0 ? 
      (ch1BandPowers.beta + ch1BandPowers.gamma) / (ch1BandPowers.alpha + ch1BandPowers.theta) : 0) * 100;
    
    // 좌우뇌 균형 계산 개선 (0으로 나누기 방지 및 자연스러운 값 처리)
    const leftAlpha = ch1BandPowers.alpha || 0;
    const rightAlpha = ch2BandPowers.alpha || 0;
    const alphaSum = leftAlpha + rightAlpha;
    
    let hemisphericBalance = 0;
    if (alphaSum > 0.001) { // 매우 작은 임계값 사용
      hemisphericBalance = (leftAlpha - rightAlpha) / alphaSum;
    } else if (leftAlpha > 0 || rightAlpha > 0) {
      // 한쪽만 값이 있는 경우
      hemisphericBalance = leftAlpha > rightAlpha ? 1 : -1;
    }
    // 극단값 제한 (-1 ~ 1 범위)
    hemisphericBalance = Math.max(-1, Math.min(1, hemisphericBalance));
    hemisphericBalance = safeFloat(hemisphericBalance);
    
    const cognitiveLoad = safeFloat(ch1BandPowers.alpha > 0 ? 
      ch1BandPowers.theta / ch1BandPowers.alpha : 0);
    const emotionalStability = safeFloat(ch1BandPowers.gamma > 0 ? 
      (ch1BandPowers.alpha + ch1BandPowers.theta) / ch1BandPowers.gamma : 0);

    // 신호 품질 평가 (이미 퍼센트 값으로 계산됨)
    const signalQuality: SignalQuality = {
      overall: (goodQualitySamples / ch1Clean.length) * 100,
      channels: [ch1SQI.reduce((a, b) => a + b, 0) / ch1SQI.length, 
                 ch2SQI.reduce((a, b) => a + b, 0) / ch2SQI.length],
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

    // 결과 반환
    const result: ProcessedEEGData & { 
      filteredRawData: EEGDataPoint[];
      ch1SQI: number[];
      ch2SQI: number[];
      overallSQI: number[];
      frequencySpectrum: { frequencies: number[]; ch1Power: number[]; ch2Power: number[]; timestamp: number };
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
      
      filteredRawData,
      ch1SQI,
      ch2SQI,
      overallSQI: ch1SQI.map((sqi1, i) => (sqi1 + ch2SQI[i]) / 2),
      frequencySpectrum: {
        frequencies,
        ch1Power,
        ch2Power,
        timestamp: Date.now()
      }
    };

    // 추가 지수들을 result에 추가
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
   * 실시간 EEG 품질 평가 (빠른 처리용)
   */
  async quickQualityCheck(data: EEGDataPoint[]): Promise<{
    isGoodQuality: boolean;
    qualityScore: number;
    issues: string[];
    detailedQuality?: {
      ch1Quality: number;
      ch2Quality: number;
      overallSQI: number;
    };
  }> {
    if (data.length < 50) {
      return {
        isGoodQuality: false,
        qualityScore: 0,
        issues: ['데이터 부족']
      };
    }

    const issues: string[] = [];
    let qualityScore = 1.0;

    // Lead-off 상태 확인
    const leadOffCount = data.filter(point => 
      point.leadOff?.ch1 || point.leadOff?.ch2
    ).length;
    
    if (leadOffCount > data.length * 0.1) {
      issues.push('전극 접촉 불량');
      qualityScore *= 0.5;
    }

    // 신호 범위 확인
    const fp1Values = data.map(point => Math.abs(point.fp1));
    const fp2Values = data.map(point => Math.abs(point.fp2));
    const maxFp1 = Math.max(...fp1Values);
    const maxFp2 = Math.max(...fp2Values);

    if (maxFp1 > 200 || maxFp2 > 200) {
      issues.push('신호 포화');
      qualityScore *= 0.3;
    }

    if (maxFp1 < 5 || maxFp2 < 5) {
      issues.push('신호 약함');
      qualityScore *= 0.6;
    }

    // 충분한 데이터가 있으면 상세 품질 분석 수행
    let detailedQuality;
    if (data.length >= 125) {
      try {
        const ch1Data = data.map(point => point.fp1);
        const ch2Data = data.map(point => point.fp2);
        
        const ch1Filtered = this.applyNotchFilter(ch1Data, 60);
        const ch2Filtered = this.applyNotchFilter(ch2Data, 60);
        
        const ch1Quality = this.calculateChannelQuality(ch1Filtered);
        const ch2Quality = this.calculateChannelQuality(ch2Filtered);
        const overallSQI = (ch1Quality + ch2Quality) / 2;
        
        detailedQuality = {
          ch1Quality,
          ch2Quality,
          overallSQI
        };
        
        qualityScore *= (overallSQI / 100);
        
      } catch (error) {
        issues.push('품질 분석 실패');
        qualityScore *= 0.7;
      }
    }

    return {
      isGoodQuality: qualityScore >= 0.7,
      qualityScore,
      issues,
      detailedQuality
    };
  }

  /**
   * EEG 채널별 데이터 추출
   */
  getChannelData(data: EEGDataPoint[], channel: 'fp1' | 'fp2'): [number, number][] {
    return data.map(point => [point.timestamp, point[channel]]);
  }

  /**
   * 뇌파 상태 요약
   */
  summarizeBrainState(brainState: BrainStateAnalysis): {
    state: string;
    confidence: number;
    description: string;
    recommendations: string[];
  } {
    const stateDescriptions = {
      'focused': '집중 상태',
      'relaxed': '이완 상태', 
      'stressed': '스트레스 상태',
      'drowsy': '졸음 상태',
      'active': '활성 상태',
      'unknown': '분석 중'
    };

    return {
      state: brainState.currentState,
      confidence: brainState.confidence,
      description: stateDescriptions[brainState.currentState as keyof typeof stateDescriptions] || '알 수 없음',
      recommendations: brainState.recommendations || []
    };
  }

  /**
   * 뇌파 지수 해석
   */
  interpretIndices(indices: {
    focusIndex: number;
    relaxationIndex: number;
    stressIndex: number;
    hemisphericBalance: number;
    cognitiveLoad: number;
    emotionalStability: number;
    totalPower: number;
  }): {
    focus: { level: string; score: number; description: string };
    relaxation: { level: string; score: number; description: string };
    stress: { level: string; score: number; description: string };
    balance: { level: string; score: number; description: string };
    cognitive: { level: string; score: number; description: string };
    emotional: { level: string; score: number; description: string };
  } {
    const interpretLevel = (value: number, thresholds: [number, number]): string => {
      if (value < thresholds[0]) return 'Low';
      if (value < thresholds[1]) return 'Medium';
      return 'High';
    };

    return {
      focus: {
        level: interpretLevel(indices.focusIndex, [0.5, 1.0]),
        score: indices.focusIndex,
        description: indices.focusIndex > 1.0 ? '높은 집중도' : indices.focusIndex > 0.5 ? '보통 집중도' : '낮은 집중도'
      },
      relaxation: {
        level: interpretLevel(indices.relaxationIndex, [0.3, 0.6]),
        score: indices.relaxationIndex,
        description: indices.relaxationIndex > 0.6 ? '높은 이완도' : indices.relaxationIndex > 0.3 ? '보통 이완도' : '낮은 이완도'
      },
      stress: {
        level: interpretLevel(indices.stressIndex, [1.0, 2.0]),
        score: indices.stressIndex,
        description: indices.stressIndex > 2.0 ? '높은 스트레스' : indices.stressIndex > 1.0 ? '보통 스트레스' : '낮은 스트레스'
      },
      balance: {
        level: Math.abs(indices.hemisphericBalance) < 0.1 ? 'Balanced' : 'Imbalanced',
        score: indices.hemisphericBalance,
        description: Math.abs(indices.hemisphericBalance) < 0.1 ? '좌우 균형' : indices.hemisphericBalance > 0 ? '좌뇌 우세' : '우뇌 우세'
      },
      cognitive: {
        level: interpretLevel(indices.cognitiveLoad, [0.5, 1.0]),
        score: indices.cognitiveLoad,
        description: indices.cognitiveLoad > 1.0 ? '높은 인지 부하' : indices.cognitiveLoad > 0.5 ? '보통 인지 부하' : '낮은 인지 부하'
      },
      emotional: {
        level: interpretLevel(indices.emotionalStability, [1.0, 2.0]),
        score: indices.emotionalStability,
        description: indices.emotionalStability > 2.0 ? '높은 정서 안정성' : indices.emotionalStability > 1.0 ? '보통 정서 안정성' : '낮은 정서 안정성'
      }
    };
  }

  // === 신호 처리 메서드들 ===

  /**
   * 60Hz 노치 필터 - BiquadFilters.js 사용
   */
  private applyNotchFilter(data: number[], notchFreq: number): number[] {
    try {
      // BiquadFilters.js의 노치 필터 사용
      const notchFilter = makeNotchFilter(notchFreq, this.samplingRate, 2); // 2Hz 대역폭
      const filtered = new Array(data.length);
      
      for (let i = 0; i < data.length; i++) {
        filtered[i] = notchFilter.applyFilter(data[i]);
      }
      
      return filtered;
    } catch (error) {
      console.warn('BiquadFilters.js 노치 필터 실패, 기본 구현 사용:', error);
      return this.fallbackNotchFilter(data, notchFreq);
    }
  }
  
  /**
   * 기본 노치 필터 (fallback)
   */
  private fallbackNotchFilter(data: number[], notchFreq: number): number[] {
    const fs = this.samplingRate;
    const omega = 2 * Math.PI * notchFreq / fs;
    const alpha = 0.95;
    
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
   * 밴드패스 필터 (1-45Hz) - BiquadFilters.js 사용
   */
  private bandpassFilter(data: number[], lowFreq: number, highFreq: number): number[] {
    try {
      // BiquadFilters.js의 밴드패스 필터 사용
      const bandpassFilter = makeBandpassFilter(lowFreq, highFreq, this.samplingRate);
      const filtered = new Array(data.length);
      
      for (let i = 0; i < data.length; i++) {
        filtered[i] = bandpassFilter.applyFilter(data[i]);
      }
      
      return filtered;
    } catch (error) {
      console.warn('BiquadFilters.js 밴드패스 필터 실패, 기본 구현 사용:', error);
      return this.fallbackBandpassFilter(data, lowFreq, highFreq);
    }
  }
  
  /**
   * 기본 밴드패스 필터 (fallback)
   */
  private fallbackBandpassFilter(data: number[], lowFreq: number, highFreq: number): number[] {
    const highpassed = this.applyHighpassFilter(data, lowFreq);
    const bandpassed = this.applyLowpassFilter(highpassed, highFreq);
    return bandpassed;
  }

  /**
   * 고역 통과 필터
   */
  private applyHighpassFilter(data: number[], cutoffFreq: number): number[] {
    const fs = this.samplingRate;
    const nyquist = fs / 2;
    const normalizedCutoff = cutoffFreq / nyquist;
    
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
    
    const alpha = Math.exp(-2 * Math.PI * normalizedCutoff);
    const filtered = new Array(data.length);
    
    filtered[0] = data[0];
    for (let i = 1; i < data.length; i++) {
      filtered[i] = alpha * filtered[i-1] + (1 - alpha) * data[i];
    }
    
    return filtered;
  }

  /**
   * 진폭 기반 SQI 계산 (절대값 150μV 기준 통일)
   */
  private calculateAmplitudeSQI(data: number[]): number[] {
    const windowSize = 125;
    const sqi = new Array(data.length).fill(0);
    
    for (let i = 0; i <= data.length - windowSize; i++) {
      const window = data.slice(i, i + windowSize);
      
      // 각 샘플에 대해 절대값 기반 품질 점수 계산
      const qualityScores = window.map(sample => {
        const absValue = Math.abs(sample);
        
        if (absValue <= 150) {
          // 150μV 이하: 100% 품질
          return 1.0;
        } else {
          // 150μV 초과: 점진적 품질 감소
          // 150μV를 넘으면 선형적으로 감소, 300μV에서 0%가 됨
          const excess = absValue - 150;
          const maxExcess = 150; // 150μV 이상 초과시 0%
          const qualityReduction = Math.min(excess / maxExcess, 1.0);
          return Math.max(0, 1.0 - qualityReduction);
        }
      });
      
      // 윈도우 내 평균 품질 점수 계산
      const qualityScore = qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length;
      
      for (let j = i; j < i + windowSize && j < data.length; j++) {
        sqi[j] = qualityScore;
      }
    }
    
    return sqi;
  }

  /**
   * 주파수 기반 SQI 계산
   */
  private calculateFrequencySQI(data: number[]): number[] {
    const windowSize = 125;
    const sqi = new Array(data.length).fill(0);
    
    for (let i = 0; i <= data.length - windowSize; i++) {
      const window = data.slice(i, i + windowSize);
      const variance = this.calculateVariance(window);
      const qualityScore = Math.max(0, Math.min(1, 1.0 - variance / 1000));
      
      for (let j = i; j < i + windowSize && j < data.length; j++) {
        sqi[j] = qualityScore;
      }
    }
    
    return sqi;
  }

  /**
   * 복합 SQI 계산
   */
  private calculateCombinedSQI(amplitudeSQI: number[], frequencySQI: number[]): number[] {
    const combinedSQI = new Array(amplitudeSQI.length);
    
    for (let i = 0; i < amplitudeSQI.length; i++) {
      combinedSQI[i] = 0.7 * amplitudeSQI[i] + 0.3 * frequencySQI[i];
    }
    
    return combinedSQI;
  }

  /**
   * Morlet wavelet 기반 파워 스펙트럼 계산
   * Python MNE tfr_morlet과 동일한 방식으로 구현
   */
  private calculatePowerSpectrum(data: number[], frequencies: number[]): number[] {
    if (data.length < 125) { // 최소 0.5초 데이터 필요
      return new Array(frequencies.length).fill(0);
    }
    
    const powers = new Array(frequencies.length);
    
    // 각 주파수에 대해 Morlet wavelet 변환 수행
    for (let i = 0; i < frequencies.length; i++) {
      const freq = frequencies[i];
      const power = this.morletWaveletTransform(data, freq);
      powers[i] = power;
    }
    
    return powers;
  }

  /**
   * Morlet 변환 — 7사이클, 선형 파워 반환 (haru 정본 / SDD-035)
   * @returns 해당 주파수 bin의 보정된 PSD [μV²/Hz] — PSD_CALIB × corr(f) × P(f)
   */
  private morletWaveletTransform(data: number[], frequency: number): number {
    const targetLength = Math.round((N_CYCLES * this.samplingRate) / frequency);
    const actualLength = Math.min(targetLength, data.length, MAX_ANALYSIS_SAMPLES);
    if (actualLength < 2) return 0;

    const effectiveCycles = (actualLength * frequency) / this.samplingRate;
    const wavelet = this.createMorletWavelet(actualLength, frequency, effectiveCycles);
    const convResult = this.convolve(data, wavelet);

    let totalPower = 0;
    for (let i = 0; i < convResult.length; i++) {
      const { real, imag } = convResult[i];
      totalPower += real * real + imag * imag;
    }

    const rawPower = convResult.length > 0 ? totalPower / convResult.length : 0;

    // 절대 보정: PSD(f) = PSD_CALIB × corr(f) × P(f) — linear μV² 유지 (dB 변환 금지)
    return PSD_CALIB * psdCorrectionFactor(frequency) * rawPower;
  }

  /**
   * 교정된 Morlet 웨이블렛 생성 (haru 정본 / SDD-035)
   * @param cycles 유효 사이클 수 — σ_t = cycles / (2π·f)
   */
  private createMorletWavelet(length: number, frequency: number, cycles: number): ComplexSample[] {
    const sigmaT = cycles / (2 * Math.PI * frequency);
    const center = (length - 1) / 2;
    const norm = Math.pow(Math.PI, -0.25) * Math.sqrt(1 / sigmaT) / Math.sqrt(this.samplingRate);
    const wavelet = new Array<ComplexSample>(length);

    for (let i = 0; i < length; i++) {
      const t = (i - center) / this.samplingRate;
      const gauss = Math.exp(-(t * t) / (2 * sigmaT * sigmaT));
      const omega = 2 * Math.PI * frequency * t;
      wavelet[i] = {
        real: norm * gauss * Math.cos(omega),
        imag: norm * gauss * Math.sin(omega),
      };
    }
    return wavelet;
  }

  /**
   * 복소수 컨볼루션 계산
   * @param signal 입력 신호 (실수)
   * @param wavelet 웨이블렛 (복소수)
   * @returns 컨볼루션 결과 (복소수)
   */
  private convolve(signal: number[], wavelet: ComplexSample[]): ComplexSample[] {
    const resultLength = Math.max(1, signal.length - wavelet.length + 1);
    const result = new Array<ComplexSample>(resultLength);

    for (let i = 0; i < resultLength; i++) {
      let realSum = 0;
      let imagSum = 0;
      for (let j = 0; j < wavelet.length; j++) {
        const signalVal = signal[i + j];
        realSum += signalVal * wavelet[j].real;
        imagSum += signalVal * wavelet[j].imag;
      }
      result[i] = { real: realSum, imag: imagSum };
    }
    return result;
  }

  /**
   * 밴드 파워 계산 — haru computeBandPowersLinear와 동일한 linear Σ P(f)·Δf
   * 반환 구조는 {delta,theta,alpha,beta,gamma} linear 유지 (소비처 호환)
   */
  private computeBandPowers(powerSpectrum: number[], frequencies: number[]): BandPowers {
    const empty: BandPowers = { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 };
    if (powerSpectrum.length === 0 || frequencies.length === 0) {
      return empty;
    }

    const result = { ...empty };
    for (let i = 0; i < frequencies.length; i++) {
      const freq = frequencies[i];
      const power = powerSpectrum[i];
      if (freq >= this.bands.delta.min && freq < this.bands.delta.max) {
        result.delta += power;
      } else if (freq >= this.bands.theta.min && freq < this.bands.theta.max) {
        result.theta += power;
      } else if (freq >= this.bands.alpha.min && freq < this.bands.alpha.max) {
        result.alpha += power;
      } else if (freq >= this.bands.beta.min && freq < this.bands.beta.max) {
        result.beta += power;
      } else if (freq >= this.bands.gamma.min && freq < this.bands.gamma.max) {
        result.gamma += power;
      }
    }
    return result;
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
   * 단일 채널 신호 품질 계산
   */
  private calculateChannelQuality(channelData: number[]): number {
    if (channelData.length === 0) return 0;
    
    const mean = channelData.reduce((sum, val) => sum + val, 0) / channelData.length;
    const variance = channelData.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / channelData.length;
    const stdDev = Math.sqrt(variance);
    
    const min = Math.min(...channelData);
    const max = Math.max(...channelData);
    const range = max - min;
    
    let quality = 100;
    
    if (stdDev < 5) quality -= 30;
    else if (stdDev < 10) quality -= 15;
    
    if (range > 500) quality -= 40;
    else if (range > 300) quality -= 20;
    
    if (range < 10) quality -= 50;
    
    return Math.max(0, Math.min(100, quality));
  }
} 
