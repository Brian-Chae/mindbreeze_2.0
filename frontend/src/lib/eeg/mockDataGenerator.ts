// @ts-nocheck — link-band-sdk 이식본 (verbatim/noUnusedLocals 완화)
/**
 * Mock Data Generator
 * 실제 센서 데이터와 동일한 형식의 Mock 데이터 생성
 */

import type { EEGDataPoint, PPGDataPoint, ACCDataPoint } from './SimpleCircularBuffer';
import type {
  EEGAnalysisMetrics,
  PPGAnalysisMetrics,
  ACCAnalysisMetrics,
} from './types/processed-data';


export class MockDataGenerator {
  /**
   * EEG Raw 데이터 생성 (250Hz)
   */
  generateEEGRaw(sampleCount: number = 250): EEGDataPoint[] {
    const baseTime = Date.now();
    return Array.from({ length: sampleCount }, (_, i) => ({
      timestamp: baseTime + i * 4, // 250Hz = 4ms 간격
      fp1: Math.sin(i * 0.1) * 100 + Math.random() * 20 - 10,
      fp2: Math.cos(i * 0.1) * 100 + Math.random() * 20 - 10,
      signalQuality: 80 + Math.random() * 20,
      leadOff: {
        ch1: false,
        ch2: false
      }
    }));
  }

  /**
   * PPG Raw 데이터 생성 (50Hz)
   */
  generatePPGRaw(sampleCount: number = 50): PPGDataPoint[] {
    const baseTime = Date.now();
    return Array.from({ length: sampleCount }, (_, i) => {
      // 심박수 시뮬레이션 (60-80 BPM)
      const heartbeat = Math.sin(i * 0.3) * 300 + 800;
      return {
        timestamp: baseTime + i * 20, // 50Hz = 20ms 간격
        red: heartbeat + Math.random() * 100,
        ir: heartbeat * 1.1 + Math.random() * 100,
        leadOff: {
          ch1: false,
          ch2: false
        }
      };
    });
  }

  /**
   * ACC Raw 데이터 생성 (30Hz)
   */
  generateACCRaw(sampleCount: number = 30): ACCDataPoint[] {
    const baseTime = Date.now();
    return Array.from({ length: sampleCount }, (_, i) => {
      const x = Math.sin(i * 0.2) * 0.5 + Math.random() * 0.2 - 0.1;
      const y = Math.cos(i * 0.2) * 0.5 + Math.random() * 0.2 - 0.1;
      const z = 1.0 + Math.random() * 0.1 - 0.05; // 중력
      return {
        timestamp: baseTime + i * 33, // 30Hz = 33ms 간격
        x,
        y,
        z,
        magnitude: Math.sqrt(x * x + y * y + z * z)
      };
    });
  }

  /**
   * EEG Analysis Metrics 생성
   *
   * EEG-MOCK-001/002: 값은 코호트(B0) 백분위 정규화 스케일과 맞춘 **raw 지표**여야 한다.
   * eegScore.ts 의 정규화(예: focus β/(α+θ) p5=0.381·p95=5.608, stress (β+γ)/(α+θ)
   * p5=0.462·p95=8.721, FAA p90=0.800)가 포화(0/100)되지 않도록 실제 raw 대역으로 생성한다.
   * (0~100 표시값을 넣으면 toRatioScale 이 100으로 나눠 focus 0~9점·stress 100점·균형 0점이 된다.)
   */
  generateEEGAnalysis(): EEGAnalysisMetrics {
    const baseValues = {
      /** μV² — TNA p5=18.5 · p95=9298 */
      totalPower: 1000 + Math.random() * 6000,
      /** 0~100 표시용(미채점) */
      emotionalBalance: 50 + Math.random() * 30,
      /** 0~100 표시용(미채점) */
      attention: 60 + Math.random() * 30,
      /** θ/α — p5=1.607 · p95=4.808 (낮을수록 좋음) */
      cognitiveLoad: 1.8 + Math.random() * 2.5,
      /** β/(α+θ) — p5=0.381 · p95=5.608 */
      focusIndex: 1.0 + Math.random() * 3.5,
      /** α/(α+β) — 사다리꼴 a=0.098·b=0.260·c=0.429 */
      relaxationIndex: 0.12 + Math.random() * 0.25,
      /** (β+γ)/(α+θ) — p5=0.462 · p95=8.721 (낮을수록 좋음) */
      stressIndex: 1.0 + Math.random() * 4.5,
      /** FAA = ln(α_fp2)−ln(α_fp1) — |FAA| p90=0.800 (0에 가까울수록 좋음) */
      hemisphericBalance: (Math.random() * 2 - 1) * 0.6,
      /** (α+θ)/γ — p5=0.235 · p95=7.241 */
      emotionalStability: 1.0 + Math.random() * 5.0,
      /** 0~100 표시용(미채점) */
      attentionLevel: 65 + Math.random() * 25,
      /** 0~100 표시용(미채점) */
      meditationLevel: 45 + Math.random() * 30
    };

    return {
      timestamp: Date.now(),
      ...baseValues,
      movingAverageValues: {
        ...baseValues
      }
    };
  }

  /**
   * PPG Analysis Metrics 생성
   */
  generatePPGAnalysis(): PPGAnalysisMetrics {
    const bpm = 60 + Math.random() * 40; // 60-100 BPM
    const baseValues = {
      bpm,
      sdnn: 30 + Math.random() * 40,
      rmssd: 25 + Math.random() * 35,
      pnn50: 10 + Math.random() * 30,
      lfPower: 400 + Math.random() * 400,
      hfPower: 300 + Math.random() * 300,
      lfHfRatio: 0.8 + Math.random() * 1.2,
      stressIndex: 30 + Math.random() * 40,
      spo2: 95 + Math.random() * 4,
      avnn: 700 + Math.random() * 200,
      pnn20: 20 + Math.random() * 40,
      sdsd: 20 + Math.random() * 30,
      hrMax: bpm + 10 + Math.random() * 10,
      hrMin: bpm - 10 - Math.random() * 10
    };

    return {
      timestamp: Date.now(),
      ...baseValues,
      movingAverageValues: {
        ...baseValues
      }
    };
  }

  /**
   * ACC Analysis Metrics 생성
   */
  generateACCAnalysis(): ACCAnalysisMetrics {
    const activities = ['stationary', 'sitting', 'walking', 'running'];
    const baseValues = {
      activityState: activities[Math.floor(Math.random() * activities.length)],
      intensity: Math.random() * 100,
      stability: 70 + Math.random() * 30,
      avgMovement: 0.3 + Math.random() * 0.5,
      maxMovement: 0.8 + Math.random() * 0.5
    };

    return {
      timestamp: Date.now(),
      ...baseValues,
      movingAverageValues: {
        ...baseValues
      }
    };
  }

  /**
   * 복합 Payload 생성 (모든 데이터 포함)
   */
  generateCombinedPayload() {
    return {
      version: '1.0' as const,
      eegRaw: this.generateEEGRaw(250),
      ppgRaw: this.generatePPGRaw(50),
      accRaw: this.generateACCRaw(30),
      eegAnalysis: this.generateEEGAnalysis(),
      ppgAnalysis: this.generatePPGAnalysis(),
      accAnalysis: this.generateACCAnalysis()
    };
  }

  /**
   * Raw 데이터만 생성
   */
  generateRawOnly() {
    return {
      version: '1.0' as const,
      eegRaw: this.generateEEGRaw(250),
      ppgRaw: this.generatePPGRaw(50),
      accRaw: this.generateACCRaw(30)
    };
  }

  /**
   * Analysis 데이터만 생성
   */
  generateAnalysisOnly() {
    return {
      version: '1.0' as const,
      eegAnalysis: this.generateEEGAnalysis(),
      ppgAnalysis: this.generatePPGAnalysis(),
      accAnalysis: this.generateACCAnalysis()
    };
  }
}

// 싱글톤 인스턴스
export const mockDataGenerator = new MockDataGenerator();
