// @ts-nocheck — link-band-sdk 이식본 (verbatim/noUnusedLocals 완화)
/**
 * Phase 1.5: 타임스탬프 동기화 시스템
 * 
 * 문제점:
 * - ACC timestamp 균열 (불규칙한 간격)
 * - 센서별 다른 타임스탬프 기준
 * - 비동기 처리로 인한 timestamp drift
 * 
 * 해결 방안:
 * - 마스터 타임스탬프 기준 통일
 * - 센서별 오프셋 자동 보정
 * - 실시간 동기화 상태 모니터링
 * - 타임스탬프 품질 평가
 */

export interface TimestampMetrics {
  masterTime: number;
  deviceTimeOffset: number;
  lastSyncTime: number;
  driftRate: number; // ms/sec
  syncQuality: number; // 0-1 (1이 최고)
  totalPackets: number;
  droppedPackets: number;
  outOfOrderPackets: number;
}

export interface SensorTimingInfo {
  sensorType: 'EEG' | 'PPG' | 'ACC';
  expectedInterval: number; // ms
  actualInterval: number; // ms
  jitter: number; // ms
  reliability: number; // 0-1
}

export interface TimestampValidationResult {
  isValid: boolean;
  correctedTimestamp: number;
  confidence: number;
  issues: string[];
}

/**
 * 타임스탬프 동기화 관리자
 * 
 * 모든 센서 데이터의 타임스탬프를 통일된 기준으로 정규화하고
 * 시간 동기화 품질을 실시간으로 모니터링
 */
export class TimestampSynchronizer {
  private metrics: TimestampMetrics;
  private sensorTimings: Map<string, SensorTimingInfo>;
  
  // 동기화 상태
  private isInitialized: boolean = false;
  private masterTimeBase: number = 0;
  private deviceTimeBase: number = 0;
  private lastDeviceTime: number = 0;
  // 장기 드리프트 보정 누적량(ms). 재동기화마다 소량(MAX_SLEW_PER_SYNC)씩만 이동한다.
  private slewMs: number = 0;
  // 현재 동기화 구간에서 관측한 최소(도착시각 - 장치시각). BLE 지연이 가장 작았던 패킷 = 실제 오프셋에 가장 가까움.
  private windowMinOffset: number = Infinity;
  
  // 센서별 직전 "샘플" 타임스탬프. 재동기화 시각(Date.now 벽시계)이 아니라
  // 같은 시간축(정규화 masterTime)의 직전 샘플을 기준으로 간격을 계산하기 위함.
  private lastSampleTimes: Map<string, number> = new Map();
  
  // 드리프트 추적
  private driftHistory: Array<{ time: number; drift: number }> = [];
  private readonly MAX_DRIFT_HISTORY = 100;
  
  // 센서별 타이밍 정보
  private readonly SENSOR_INTERVALS = {
    EEG: 4, // 250Hz → 4ms
    PPG: 20, // 50Hz → 20ms
    ACC: 33.33 // 30Hz → 33.33ms
  };
  
  // 품질 임계값
  private readonly MAX_ACCEPTABLE_JITTER = 10; // ms
  private readonly MAX_ACCEPTABLE_DRIFT = 5; // ms/sec
  private readonly SYNC_INTERVAL = 5000; // 5초마다 재동기화
  // 한 번의 재동기화에서 움직일 수 있는 최대량(ms). EEG 샘플 간격(4ms)보다 작아 시각 역행이 생기지 않는다.
  private readonly MAX_SLEW_PER_SYNC = 2;
  // 이 이상 어긋나면 재연결·일시정지로 보고 즉시 재앵커링(ms)
  private readonly HARD_RESYNC_THRESHOLD = 1000;
  
  constructor() {
    this.metrics = {
      masterTime: 0,
      deviceTimeOffset: 0,
      lastSyncTime: 0,
      driftRate: 0,
      syncQuality: 0,
      totalPackets: 0,
      droppedPackets: 0,
      outOfOrderPackets: 0
    };
    
    this.sensorTimings = new Map();
    this.initializeSensorTimings();
  }
  
  /**
   * 센서별 타이밍 정보 초기화
   */
  private initializeSensorTimings(): void {
    Object.entries(this.SENSOR_INTERVALS).forEach(([sensorType, interval]) => {
      this.sensorTimings.set(sensorType, {
        sensorType: sensorType as 'EEG' | 'PPG' | 'ACC',
        expectedInterval: interval,
        actualInterval: interval,
        jitter: 0,
        reliability: 1.0
      });
    });
  }
  
  /**
   * 시스템 초기화 (첫 번째 패킷 수신 시)
   */
  initialize(deviceTimestamp: number): void {
    const now = Date.now();
    
    this.masterTimeBase = now;
    this.deviceTimeBase = deviceTimestamp;
    this.lastDeviceTime = deviceTimestamp;
    
    this.metrics.masterTime = now;
    this.metrics.deviceTimeOffset = now - deviceTimestamp;
    this.metrics.lastSyncTime = now;
    
    this.isInitialized = true;
    
    console.log('TimestampSynchronizer 초기화:', {
      masterTime: this.masterTimeBase,
      deviceTime: this.deviceTimeBase,
      offset: this.metrics.deviceTimeOffset
    });
  }
  
  /**
   * 타임스탬프 정규화 (메인 함수)
   */
  normalizeTimestamp(
    deviceTimestamp: number, 
    sensorType: 'EEG' | 'PPG' | 'ACC'
  ): TimestampValidationResult {
    // 초기화 필요 시
    if (!this.isInitialized) {
      this.initialize(deviceTimestamp);
    }
    
    this.metrics.totalPackets++;
    
    // 기본 정규화
    const normalizedTime = this.performBasicNormalization(deviceTimestamp);
    
    // 타임스탬프 검증
    const validation = this.validateTimestamp(normalizedTime, sensorType, deviceTimestamp);
    
    // 센서별 타이밍 정보 업데이트
    this.updateSensorTiming(sensorType, normalizedTime);
    
    // 도착시각-장치시각 최소 오프셋 관측 (지터가 아닌 장기 드리프트 추정용)
    this.windowMinOffset = Math.min(this.windowMinOffset, Date.now() - deviceTimestamp);
    this.lastDeviceTime = deviceTimestamp;
    
    // 주기적(5초) 재동기화 확인
    this.checkResyncNeeded();
    
    // 메트릭 업데이트
    this.updateMetrics();
    
    return validation;
  }
  
  /**
   * 기본 타임스탬프 정규화
   * 장치 카운터(고정 매핑) + 완만하게 누적되는 보정량(slewMs). 샘플 시각은 장치 시계 간격 그대로 단조 증가한다.
   */
  private performBasicNormalization(deviceTimestamp: number): number {
    return this.masterTimeBase + (deviceTimestamp - this.deviceTimeBase) + this.slewMs;
  }
  
  /**
   * 타임스탬프 검증 및 보정
   */
  private validateTimestamp(
    normalizedTime: number, 
    sensorType: 'EEG' | 'PPG' | 'ACC',
    _originalDeviceTime: number
  ): TimestampValidationResult {
    const issues: string[] = [];
    let correctedTime = normalizedTime;
    let confidence = 1.0;
    
    // 1. 순서 검증 (직전 "샘플"보다 이후여야 함)
    //    lastSyncTime 은 Date.now() 벽시계라 정규화 masterTime 과 기준이 달라
    //    normalizedTime - lastSyncTime 이 항상 음수가 되어 매 샘플이 과거로 오판된다.
    //    따라서 센서별 직전 샘플 시각을 기준으로 삼는다.
    const sensorTiming = this.sensorTimings.get(sensorType);
    if (sensorTiming) {
      const expectedInterval = sensorTiming.expectedInterval;
      const lastSampleTime = this.lastSampleTimes.get(sensorType) ?? 0;
      const timeSinceLastSample = lastSampleTime > 0 ? normalizedTime - lastSampleTime : 0;
      
      // 너무 과거의 타임스탬프
      if (timeSinceLastSample < -expectedInterval * 2) {
        issues.push(`과거 타임스탬프 감지: ${timeSinceLastSample}ms`);
        this.metrics.outOfOrderPackets++;
        confidence *= 0.5;
      }
      
      // 너무 미래의 타임스탬프
      if (timeSinceLastSample > expectedInterval * 10) {
        issues.push(`미래 타임스탬프 감지: ${timeSinceLastSample}ms`);
        confidence *= 0.7;
      }
    }
    
    // 2. 간격 검증 (센서별 예상 간격과 비교)
    if (sensorTiming) {
      const actualInterval = sensorTiming.actualInterval;
      const expectedInterval = sensorTiming.expectedInterval;
      const intervalDiff = Math.abs(actualInterval - expectedInterval);
      
      if (intervalDiff > this.MAX_ACCEPTABLE_JITTER) {
        issues.push(`간격 불일치: 예상 ${expectedInterval}ms, 실제 ${actualInterval}ms`);
        confidence *= 0.8;
        
        // ACC 타임스탬프 균열 특별 처리
        if (sensorType === 'ACC' && intervalDiff > expectedInterval * 0.5) {
          correctedTime = this.correctACCTimestamp(normalizedTime, sensorType);
          issues.push('ACC 타임스탬프 균열 보정 적용');
        }
      }
    }
    
    // 3. 드리프트 검증
    if (Math.abs(this.metrics.driftRate) > this.MAX_ACCEPTABLE_DRIFT) {
      issues.push(`드리프트 임계값 초과: ${this.metrics.driftRate}ms/sec`);
      confidence *= 0.6;
    }
    
    const isValid = confidence > 0.5 && issues.length < 3;
    
    return {
      isValid,
      correctedTimestamp: correctedTime,
      confidence,
      issues
    };
  }
  
  /**
   * ACC 타임스탬프 균열 보정
   */
  private correctACCTimestamp(normalizedTime: number, sensorType: string): number {
    const sensorTiming = this.sensorTimings.get(sensorType);
    if (!sensorTiming) return normalizedTime;
    
    const expectedInterval = sensorTiming.expectedInterval;
    const lastSampleTime = this.lastSampleTimes.get(sensorType) ?? 0;
    if (lastSampleTime <= 0) return normalizedTime;
    
    // 예상 시간 계산 (재동기화 시각이 아니라 직전 샘플 기준으로 격자에 스냅)
    const timeSinceLastSample = normalizedTime - lastSampleTime;
    const expectedSteps = Math.round(timeSinceLastSample / expectedInterval);
    const correctedTime = lastSampleTime + (expectedSteps * expectedInterval);
    
    // 패킷 단위로 매초 발생하는 정상 스냅은 로그하지 않는다(1ms 초과 이탈만).
    if (Math.abs(correctedTime - normalizedTime) > 1) {
      console.log('ACC 타임스탬프 보정:', {
        original: normalizedTime,
        corrected: correctedTime,
        diff: correctedTime - normalizedTime
      });
    }
    
    return correctedTime;
  }
  
  /**
   * 센서별 타이밍 정보 업데이트
   */
  private updateSensorTiming(sensorType: 'EEG' | 'PPG' | 'ACC', normalizedTime: number): void {
    const sensorTiming = this.sensorTimings.get(sensorType);
    if (!sensorTiming) return;
    
    const lastTime = this.lastSampleTimes.get(sensorType) ?? 0;
    if (lastTime > 0) {
      const actualInterval = normalizedTime - lastTime;
      const expectedInterval = sensorTiming.expectedInterval;
      
      // 실제 간격 업데이트 (이동평균)
      const alpha = 0.1; // 스무딩 팩터
      sensorTiming.actualInterval = (1 - alpha) * sensorTiming.actualInterval + alpha * actualInterval;
      
      // 지터 계산
      const jitter = Math.abs(actualInterval - expectedInterval);
      sensorTiming.jitter = (1 - alpha) * sensorTiming.jitter + alpha * jitter;
      
      // 신뢰도 계산 (지터가 적을수록 높음)
      const maxJitter = expectedInterval * 0.5;
      sensorTiming.reliability = Math.max(0, 1 - (sensorTiming.jitter / maxJitter));
      
      this.sensorTimings.set(sensorType, sensorTiming);
    }
    
    // 다음 간격 계산을 위해 직전 샘플 시각 갱신 (첫 샘플도 기록)
    this.lastSampleTimes.set(sensorType, normalizedTime);
  }
  
  /**
   * 재동기화 필요 여부 확인 — 5초 주기로만 수행한다.
   * (이전: driftRate 가 3센서 공유 lastDeviceTime·벽시계를 섞어 계산되어 도착 지터만으로 임계값을 넘고 매 패킷 재앵커링)
   */
  private checkResyncNeeded(): void {
    const now = Date.now();
    if (now - this.metrics.lastSyncTime >= this.SYNC_INTERVAL) {
      this.performResync(now);
    }
  }
  
  /**
   * 재동기화 수행 — 구간 최소 오프셋 기반 장기 드리프트만 보정한다.
   * 샘플 시각 축은 재앵커링하지 않고 slewMs 만 소량 이동 (큰 이탈은 하드 리싱크).
   */
  private performResync(now: number): void {
    const elapsedSec = Math.max(0.001, (now - this.metrics.lastSyncTime) / 1000);
    this.metrics.lastSyncTime = now;
    
    if (!Number.isFinite(this.windowMinOffset)) return;
    
    const currentOffset = this.masterTimeBase - this.deviceTimeBase + this.slewMs;
    const delta = this.windowMinOffset - currentOffset;
    this.windowMinOffset = Infinity;
    
    if (Math.abs(delta) > this.HARD_RESYNC_THRESHOLD) {
      // 재연결·장치 일시정지 등: 매핑 자체를 다시 잡는다.
      this.masterTimeBase = now;
      this.deviceTimeBase = this.lastDeviceTime;
      this.slewMs = 0;
      this.lastSampleTimes.clear();
      this.metrics.deviceTimeOffset = now - this.lastDeviceTime;
      this.metrics.driftRate = 0;
      console.log('타임스탬프 하드 재동기화:', { delta });
      return;
    }
    
    const step = Math.max(-this.MAX_SLEW_PER_SYNC, Math.min(this.MAX_SLEW_PER_SYNC, delta));
    this.slewMs += step;
    // 센서별 직전 샘플 시각도 같은 양만큼 이동해 간격 계산 연속성 유지
    this.lastSampleTimes.forEach((t, k) => this.lastSampleTimes.set(k, t + step));
    this.metrics.deviceTimeOffset = currentOffset + step;
    this.metrics.driftRate = step / elapsedSec; // ms/sec
  }
  
  /**
   * 메트릭 업데이트
   */
  private updateMetrics(): void {
    this.metrics.masterTime = Date.now();
    
    // 동기화 품질 계산
    let qualityScore = 1.0;
    
    // 드리프트 품질
    const driftPenalty = Math.min(1.0, Math.abs(this.metrics.driftRate) / this.MAX_ACCEPTABLE_DRIFT);
    qualityScore *= (1 - driftPenalty * 0.3);
    
    // 센서별 신뢰도 평균
    const reliabilities = Array.from(this.sensorTimings.values()).map(t => t.reliability);
    const avgReliability = reliabilities.reduce((sum, r) => sum + r, 0) / reliabilities.length;
    qualityScore *= avgReliability;
    
    // 패킷 손실률
    const lossRate = this.metrics.droppedPackets / Math.max(1, this.metrics.totalPackets);
    qualityScore *= (1 - lossRate);
    
    this.metrics.syncQuality = Math.max(0, Math.min(1, qualityScore));
  }
  
  /**
   * 현재 메트릭 반환
   */
  getMetrics(): TimestampMetrics {
    return { ...this.metrics };
  }
  
  /**
   * 센서별 타이밍 정보 반환
   */
  getSensorTimings(): Map<string, SensorTimingInfo> {
    return new Map(this.sensorTimings);
  }
  
  /**
   * 동기화 품질 상태 반환
   */
  getSyncStatus(): {
    isHealthy: boolean;
    quality: number;
    issues: string[];
    recommendations: string[];
  } {
    const issues: string[] = [];
    const recommendations: string[] = [];
    
    // 드리프트 검사
    if (Math.abs(this.metrics.driftRate) > this.MAX_ACCEPTABLE_DRIFT) {
      issues.push(`드리프트 레이트 높음: ${this.metrics.driftRate.toFixed(2)}ms/sec`);
      recommendations.push('디바이스 재연결 권장');
    }
    
    // 센서별 문제 검사
    this.sensorTimings.forEach((timing, sensorType) => {
      if (timing.reliability < 0.8) {
        issues.push(`${sensorType} 센서 타이밍 불안정: ${(timing.reliability * 100).toFixed(1)}%`);
        recommendations.push(`${sensorType} 센서 연결 상태 확인`);
      }
      
      if (timing.jitter > this.MAX_ACCEPTABLE_JITTER) {
        issues.push(`${sensorType} 지터 높음: ${timing.jitter.toFixed(1)}ms`);
        recommendations.push(`${sensorType} 샘플링 레이트 조정 고려`);
      }
    });
    
    // 패킷 손실 검사
    const lossRate = this.metrics.droppedPackets / Math.max(1, this.metrics.totalPackets);
    if (lossRate > 0.05) { // 5% 이상 손실
      issues.push(`패킷 손실률 높음: ${(lossRate * 100).toFixed(1)}%`);
      recommendations.push('블루투스 연결 품질 확인');
    }
    
    const isHealthy = this.metrics.syncQuality > 0.8 && issues.length === 0;
    
    return {
      isHealthy,
      quality: this.metrics.syncQuality,
      issues,
      recommendations
    };
  }
  
  /**
   * 상태 초기화
   */
  reset(): void {
    this.isInitialized = false;
    this.masterTimeBase = 0;
    this.deviceTimeBase = 0;
    this.lastDeviceTime = 0;
    this.slewMs = 0;
    this.windowMinOffset = Infinity;
    this.lastSampleTimes.clear();
    this.driftHistory = [];
    
    this.metrics = {
      masterTime: 0,
      deviceTimeOffset: 0,
      lastSyncTime: 0,
      driftRate: 0,
      syncQuality: 0,
      totalPackets: 0,
      droppedPackets: 0,
      outOfOrderPackets: 0
    };
    
    this.initializeSensorTimings();
  }
  
  /**
   * 디버깅 정보 출력
   */
  getDebugInfo(): any {
    return {
      metrics: this.metrics,
      sensorTimings: Object.fromEntries(this.sensorTimings),
      driftHistory: this.driftHistory.slice(-10), // 최근 10개
      isInitialized: this.isInitialized,
      masterTimeBase: this.masterTimeBase,
      deviceTimeBase: this.deviceTimeBase
    };
  }
} 
