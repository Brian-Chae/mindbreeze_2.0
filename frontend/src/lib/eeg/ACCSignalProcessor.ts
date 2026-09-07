// @ts-nocheck — link-band-sdk 이식본 (verbatim/noUnusedLocals 완화)
import type { ACCDataPoint } from './SimpleCircularBuffer';

/**
 * ACC 신호 처리기
 * 3축 가속도 데이터를 처리하여 움직임 분석, 활동 상태 분류, 자세 분석 등을 수행
 */
export class ACCSignalProcessor {
  private samplingRate: number = 50; // 50Hz
  private gravityConstant: number = 9.81; // m/s²
  
  constructor() {
    console.log('🔧 ACCSignalProcessor 초기화 완료');
  }

  /**
   * ACC 데이터 처리 메인 함수
   */
  async processACCData(data: ACCDataPoint[]): Promise<{
    filteredData: ACCDataPoint[];
    magnitude: { timestamp: number; value: number }[];
    activity: {
      type: 'stationary' | 'sitting' | 'walking' | 'running';
      confidence: number;
      intensity: number;
    };
    movement: {
      avgMovement: number;
      stdMovement: number;
      maxMovement: number;
      totalMovement: number;
    };
    posture: {
      tiltAngle: number;
      stability: number;
      balance: number;
    };
    signalQuality: {
      overall: number;
      reliability: number;
      consistency: number;
    };
  }> {
    if (data.length === 0) {
      throw new Error('ACC 데이터가 없습니다');
    }

    try {
      // 1. 데이터 필터링
      // const filteredData = this.applyLowPassFilter(data);
      
      // 2. 가속도 크기 계산
      const magnitudeData = this.calculateMagnitude(data);
      
      // 3. 움직임 분석
      const movementAnalysis = this.analyzeMovement(magnitudeData);
      
      // 4. 활동 상태 분류
      const activityClassification = this.classifyActivity(movementAnalysis);
      
      // 5. 자세 분석
      const postureAnalysis = this.analyzePosture(data);
      
      // 6. 신호 품질 평가
      // const signalQuality = this.evaluateSignalQuality(data, filteredData);
      
      // console.log('🔧 ACC 처리 완료:', {
      //   inputLength: data.length,
      //   // filteredLength: filteredData.length,
      //   magnitudeLength: magnitudeData.length,
      //   activityType: activityClassification.type,
      //   avgMovement: movementAnalysis.avgMovement.toFixed(2),
      //   maxMovement: movementAnalysis.maxMovement.toFixed(2)
      // });
      
      return {
        filteredData: [],
        magnitude: magnitudeData,
        activity: activityClassification,
        movement: movementAnalysis,
        posture: postureAnalysis,
        signalQuality: {
          overall: 0,
          reliability: 0,
          consistency: 0
        }
      };
      
    } catch (error) {
      console.error('ACC 처리 오류:', error);
      throw error;
    }
  }

  /**
   * 저역통과 필터 적용 (노이즈 제거)
   */
  private applyLowPassFilter(data: ACCDataPoint[]): ACCDataPoint[] {
    if (data.length < 3) return data;
    
    const alpha = 0.1; // 필터 계수 (0.1 = 강한 필터링)
    const filtered: ACCDataPoint[] = [data[0]]; // 첫 번째 데이터는 그대로
    
    for (let i = 1; i < data.length; i++) {
      const prev = filtered[i - 1];
      const curr = data[i];
      
      const filteredPoint = {
        timestamp: curr.timestamp,
        x: prev.x + alpha * (curr.x - prev.x),
        y: prev.y + alpha * (curr.y - prev.y),
        z: prev.z + alpha * (curr.z - prev.z)
      };
      
      // magnitude 계산
      const magnitude = Math.sqrt(
        filteredPoint.x * filteredPoint.x + 
        filteredPoint.y * filteredPoint.y + 
        filteredPoint.z * filteredPoint.z
      );
      
      filtered.push({
        ...filteredPoint,
        magnitude
      });
    }
    
    return filtered;
  }

  /**
   * 가속도 크기 계산 (중력 제거)
   */
  private calculateMagnitude(data: ACCDataPoint[]): { timestamp: number; value: number }[] {
    return data.map(point => {
      // 3축 가속도 크기 계산: sqrt(x² + y² + z²)
      const magnitude = Math.sqrt(
        point.x * point.x + 
        point.y * point.y + 
        point.z * point.z
      );
      
      // 중력 제거 (1g ≈ 9.81 m/s²)
      const movementMagnitude = Math.max(0, magnitude - 1.0);
      
      // 스케일링 (BasicSignalProcessor와 동일)
      const scaledValue = movementMagnitude * 100;
      
      return {
        timestamp: point.timestamp,
        value: scaledValue
      };
    });
  }

  /**
   * 움직임 분석
   */
  private analyzeMovement(magnitudeData: { timestamp: number; value: number }[]): {
    avgMovement: number;
    stdMovement: number;
    maxMovement: number;
    totalMovement: number;
  } {
    if (magnitudeData.length === 0) {
      return {
        avgMovement: 0,
        stdMovement: 0,
        maxMovement: 0,
        totalMovement: 0
      };
    }
    
    const values = magnitudeData.map(d => d.value);
    
    // 평균 움직임
    const avgMovement = values.reduce((sum, val) => sum + val, 0) / values.length;
    
    // 표준편차 (변동성)
    const variance = values.reduce((sum, val) => sum + Math.pow(val - avgMovement, 2), 0) / values.length;
    const stdMovement = Math.sqrt(variance);
    
    // 최대 움직임
    const maxMovement = Math.max(...values);
    
    // 총 움직임 (적분)
    const totalMovement = values.reduce((sum, val) => sum + val, 0);
    
    return {
      avgMovement,
      stdMovement,
      maxMovement,
      totalMovement
    };
  }

  /**
   * 활동 상태 분류
   */
  private classifyActivity(movement: {
    avgMovement: number;
    stdMovement: number;
    maxMovement: number;
    totalMovement: number;
  }): {
    type: 'stationary' | 'sitting' | 'walking' | 'running';
    confidence: number;
    intensity: number;
  } {
    const { avgMovement, stdMovement, maxMovement } = movement;
    
    // 활동 강도 계산 (0-100)
    let intensity = 0;
    if (avgMovement <= 5) {
      intensity = avgMovement * 4; // 0-20%
    } else if (avgMovement <= 15) {
      intensity = 20 + (avgMovement - 5) * 4; // 20-60%
    } else {
      intensity = 60 + Math.min(40, (avgMovement - 15) * 2); // 60-100%
    }
    
    // 활동 상태 분류
    let activityType: 'stationary' | 'sitting' | 'walking' | 'running';
    let confidence = 0;
    
    if (avgMovement < 3 && maxMovement < 10) {
      activityType = 'stationary';
      confidence = 0.9;
    } else if (avgMovement < 8 && maxMovement < 20) {
      activityType = 'sitting';
      confidence = 0.8;
    } else if (avgMovement < 20 && maxMovement < 40) {
      activityType = 'walking';
      confidence = 0.7;
    } else {
      activityType = 'running';
      confidence = 0.6;
    }
    
    // 표준편차가 클수록 신뢰도 감소
    if (stdMovement > avgMovement * 0.8) {
      confidence *= 0.8;
    }
    
    return {
      type: activityType,
      confidence,
      intensity: Math.round(intensity)
    };
  }

  /**
   * 자세 분석
   */
  private analyzePosture(data: ACCDataPoint[]): {
    tiltAngle: number;
    stability: number;
    balance: number;
  } {
    if (data.length === 0) {
      return { tiltAngle: 0, stability: 0, balance: 0 };
    }
    
    // 평균 가속도 계산 (중력 벡터 추정)
    const avgX = data.reduce((sum, p) => sum + p.x, 0) / data.length;
    const avgY = data.reduce((sum, p) => sum + p.y, 0) / data.length;
    const avgZ = data.reduce((sum, p) => sum + p.z, 0) / data.length;
    
    // 기울기 각도 계산 (도 단위)
    const tiltAngle = Math.atan2(
      Math.sqrt(avgX * avgX + avgY * avgY),
      Math.abs(avgZ)
    ) * (180 / Math.PI);
    
    // 안정성 계산 (변동성의 역수)
    const xVariance = data.reduce((sum, p) => sum + Math.pow(p.x - avgX, 2), 0) / data.length;
    const yVariance = data.reduce((sum, p) => sum + Math.pow(p.y - avgY, 2), 0) / data.length;
    const zVariance = data.reduce((sum, p) => sum + Math.pow(p.z - avgZ, 2), 0) / data.length;
    
    const totalVariance = xVariance + yVariance + zVariance;
    const stability = Math.max(0, 100 - totalVariance * 50); // 0-100%
    
    // 균형 계산 (X, Y 축 균형)
    const xyBalance = Math.abs(avgX) + Math.abs(avgY);
    const balance = Math.max(0, 100 - xyBalance * 50); // 0-100%
    
    return {
      tiltAngle: Math.round(tiltAngle * 10) / 10, // 소수점 1자리
      stability: Math.round(stability),
      balance: Math.round(balance)
    };
  }

  /**
   * 신호 품질 평가
   */
  private evaluateSignalQuality(rawData: ACCDataPoint[], filteredData: ACCDataPoint[]): {
    overall: number;
    reliability: number;
    consistency: number;
  } {
    if (rawData.length === 0 || filteredData.length === 0) {
      return { overall: 0, reliability: 0, consistency: 0 };
    }
    
    // 1. 신뢰성: 데이터 완전성 확인
    const reliability = (filteredData.length / rawData.length) * 100;
    
    // 2. 일관성: 타임스탬프 간격 확인
    let consistentTimestamps = 0;
    const expectedInterval = 1000 / this.samplingRate; // 20ms for 50Hz
    
    for (let i = 1; i < rawData.length; i++) {
      const interval = rawData[i].timestamp - rawData[i-1].timestamp;
      if (Math.abs(interval - expectedInterval) < expectedInterval * 0.5) {
        consistentTimestamps++;
      }
    }
    
    const consistency = rawData.length > 1 ? 
      (consistentTimestamps / (rawData.length - 1)) * 100 : 100;
    
    // 3. 전체 품질 (가중평균)
    const overall = (reliability * 0.6 + consistency * 0.4);
    
    return {
      overall: Math.round(overall),
      reliability: Math.round(reliability),
      consistency: Math.round(consistency)
    };
  }

  /**
   * 샘플링 레이트 설정
   */
  setSamplingRate(rate: number): void {
    this.samplingRate = rate;
    console.log(`🔧 ACC 샘플링 레이트 설정: ${rate}Hz`);
  }

  /**
   * 처리기 정리
   */
  dispose(): void {
    console.log('🔧 ACCSignalProcessor 정리 완료');
  }
} 
