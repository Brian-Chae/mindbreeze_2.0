// @ts-nocheck — link-band-sdk 이식본 (verbatim/noUnusedLocals 완화)
// 뇌 상태 분석 엔진
import type { BandPowers, SignalQuality, ArtifactDetection } from './signalProcessing';
import type { BrainStateType } from './types/eeg';

export interface BrainStateAnalysis {
  currentState: BrainStateType;
  confidence: number;
  stateScores: {
    relaxed: number;
    focused: number;
    active: number;
    stressed: number;
    drowsy: number;
  };
  metrics: {
    attention: number;
    meditation: number;
    arousal: number;
    workload: number;
  };
}

/**
 * 주파수 대역 파워를 기반으로 뇌 상태를 분석
 */
export function analyzeBrainState(
  bandPowers: BandPowers,
  signalQuality: SignalQuality,
  artifacts: ArtifactDetection
): BrainStateAnalysis {
  // 각 상태별 점수 계산
  const scores = {
    relaxed: calculateRelaxedScore(bandPowers),
    focused: calculateFocusedScore(bandPowers),
    active: calculateActiveScore(bandPowers),
    stressed: calculateStressedScore(bandPowers),
    drowsy: calculateDrowsyScore(bandPowers)
  };
  
  // 가장 높은 점수의 상태 선택
  const maxScore = Math.max(...Object.values(scores));
  let currentState: BrainStateType = 'relaxed';
  
  if (scores.focused === maxScore) currentState = 'focused';
  else if (scores.active === maxScore) currentState = 'active';
  else if (scores.stressed === maxScore) currentState = 'stressed';
  else if (scores.drowsy === maxScore) currentState = 'drowsy';
  
  // 신뢰도 계산 (신호 품질과 아티팩트 고려)
  const confidence = calculateConfidence(signalQuality, artifacts, maxScore);
  
  // 메트릭 계산
  const metrics = {
    attention: (bandPowers.beta / (bandPowers.alpha + bandPowers.theta)) * 100,
    meditation: (bandPowers.alpha / (bandPowers.beta + bandPowers.gamma)) * 100,
    arousal: (bandPowers.beta + bandPowers.gamma) / (bandPowers.alpha + bandPowers.theta) * 100,
    workload: (bandPowers.beta + bandPowers.gamma) * 100
  };
  
  return {
    currentState,
    confidence,
    stateScores: scores,
    metrics
  };
}

function calculateRelaxedScore(bandPowers: BandPowers): number {
  // 알파파가 높고 베타파가 낮을 때 이완 상태
  return (bandPowers.alpha * 0.6 + (1 - bandPowers.beta) * 0.4) * 100;
}

function calculateFocusedScore(bandPowers: BandPowers): number {
  // 베타파가 높고 알파파가 적당할 때 집중 상태
  return (bandPowers.beta * 0.5 + bandPowers.alpha * 0.3 + (1 - bandPowers.theta) * 0.2) * 100;
}

function calculateActiveScore(bandPowers: BandPowers): number {
  // 베타파와 감마파가 높을 때 활성 상태
  return (bandPowers.beta * 0.4 + bandPowers.gamma * 0.4 + bandPowers.alpha * 0.2) * 100;
}

function calculateStressedScore(bandPowers: BandPowers): number {
  // 베타파가 매우 높고 알파파가 낮을 때 스트레스 상태
  return (bandPowers.beta * 0.7 + (1 - bandPowers.alpha) * 0.3) * 100;
}

function calculateDrowsyScore(bandPowers: BandPowers): number {
  // 델타파와 세타파가 높을 때 졸음 상태
  return (bandPowers.delta * 0.5 + bandPowers.theta * 0.4 + (1 - bandPowers.beta) * 0.1) * 100;
}

function calculateConfidence(
  signalQuality: SignalQuality,
  artifacts: ArtifactDetection,
  maxScore: number
): number {
  let confidence = signalQuality.overall;
  
  // 아티팩트가 있으면 신뢰도 감소
  if (artifacts.movement) confidence *= 0.8;
  if (artifacts.eyeBlink) confidence *= 0.9;
  if (artifacts.muscleNoise) confidence *= 0.7;
  
  // 상태 점수가 낮으면 신뢰도 감소
  confidence *= (maxScore / 100);
  
  return Math.max(0, Math.min(100, confidence));
} 
