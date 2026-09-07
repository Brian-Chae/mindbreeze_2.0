/**
 * AnalysisMetricsService — MB 2.0용 경량 스텁.
 * SDK 원본(브로드캐스트·IndexedDB·Moving Average 큐) 대신
 * 최신 EEG 1초 feature를 보관하고 콜백으로 전달한다.
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

/** 분석 지표 싱글톤 — StreamProcessor가 호출, useBand가 구독 */
export class AnalysisMetricsService {
  private static instance: AnalysisMetricsService | null = null;

  private callbacks: AnalysisCallbacks = {};
  private latestEeg: LatestEegFeature | null = null;

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

  /** PPG — MVP1에서는 파싱만, 지표 업로드 없음 */
  async processPPGAnalysisMetrics(
    _ppgAnalysisResult: unknown,
    _timestamp: number,
    _currentSQI?: number,
    _isQualityGood?: boolean,
    _rrIntervals?: number[],
  ): Promise<void> {
    // no-op
  }

  /** ACC — MVP1에서는 파싱만 */
  async processACCAnalysisMetrics(
    _accAnalysisResult: unknown,
    _timestamp: number,
  ): Promise<void> {
    // no-op
  }

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
}
