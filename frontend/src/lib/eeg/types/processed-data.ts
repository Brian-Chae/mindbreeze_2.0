// 처리된 PPG 데이터 타입
export interface ProcessedPPGData {
  timestamp: number;
  heartRate: number;
  hrv: number;
  spo2: number;
  signalQuality: number;
}

// 처리된 ACC 데이터 타입  
export interface ProcessedACCData {
  timestamp: number;
  magnitude: number;
  activity: number;
  steps: number;
  orientation: {
    pitch: number;
    roll: number;
    yaw: number;
  };
}

// EEG 분석 지표 데이터 타입
export interface EEGAnalysisMetrics {
  timestamp: number;
  totalPower: number;
  emotionalBalance: number;
  attention: number;
  cognitiveLoad: number;
  focusIndex: number;
  relaxationIndex: number;
  stressIndex: number;
  hemisphericBalance: number;
  emotionalStability: number;
  attentionLevel: number;
  meditationLevel: number;
  /**
   * EEG-NUM-002: FAA = ln(α_fp2) − ln(α_fp1) (로그비). 좌우뇌 균형 점수화 정본 입력.
   * hemisphericBalance(-1~1 비율)와 스케일이 다르므로 점수화에는 이 값을 쓴다.
   */
  faa?: number | null;
  movingAverageValues: {
    totalPower: number;
    emotionalBalance: number;
    attention: number;
    cognitiveLoad: number;
    focusIndex: number;
    relaxationIndex: number;
    stressIndex: number;
    hemisphericBalance: number;
    emotionalStability: number;
    attentionLevel: number;
    meditationLevel: number;
  };
}

// PPG 분석 지표 데이터 타입
export interface PPGAnalysisMetrics {
  timestamp: number;
  bpm: number;
  sdnn: number;
  rmssd: number;
  pnn50: number;
  lfPower: number;
  hfPower: number;
  lfHfRatio: number;
  stressIndex: number;
  spo2: number;
  avnn: number;
  pnn20: number;
  sdsd: number;
  hrMax: number;
  hrMin: number;
  movingAverageValues: {
    bpm: number;
    sdnn: number;
    rmssd: number;
    pnn50: number;
    lfPower: number;
    hfPower: number;
    lfHfRatio: number;
    stressIndex: number;
    spo2: number;
    avnn: number;
    pnn20: number;
    sdsd: number;
    hrMax: number;
    hrMin: number;
  };
}

// ACC 분석 지표 데이터 타입
export interface ACCAnalysisMetrics {
  timestamp: number;
  activityState: string;
  intensity: number;
  stability: number;
  avgMovement: number;
  maxMovement: number;
  movingAverageValues: {
    intensity: number;
    stability: number;
    avgMovement: number;
    maxMovement: number;
  };
}
