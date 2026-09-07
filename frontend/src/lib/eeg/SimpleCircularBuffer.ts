// @ts-nocheck — link-band-sdk 이식본 (verbatim/noUnusedLocals 완화)
/**
 * Phase 1: 실시간 차트용 SimpleCircularBuffer
 * 고정 크기 원형 버퍼로 메모리 효율적인 데이터 저장
 */
export class SimpleCircularBuffer<T> {
  private buffer: T[];
  private head: number = 0;
  private tail: number = 0;
  private size: number = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  /**
   * 데이터 추가 (가장 오래된 데이터를 덮어씀)
   */
  push(item: T): void {
    this.buffer[this.tail] = item;
    
    if (this.size < this.capacity) {
      this.size++;
    } else {
      // 버퍼가 가득 찬 경우 head도 이동
      this.head = (this.head + 1) % this.capacity;
    }
    
    this.tail = (this.tail + 1) % this.capacity;
  }

  /**
   * 모든 데이터를 배열로 반환 (오래된 순서부터)
   */
  toArray(): T[] {
    if (this.size === 0) return [];
    
    const result: T[] = [];
    let current = this.head;
    
    for (let i = 0; i < this.size; i++) {
      result.push(this.buffer[current]);
      current = (current + 1) % this.capacity;
    }
    
    return result;
  }

  /**
   * 최신 n개 데이터 반환
   */
  getLatest(count: number): T[] {
    if (count <= 0 || this.size === 0) return [];
    
    const actualCount = Math.min(count, this.size);
    const result: T[] = [];
    
    let current = (this.tail - actualCount + this.capacity) % this.capacity;
    
    for (let i = 0; i < actualCount; i++) {
      result.push(this.buffer[current]);
      current = (current + 1) % this.capacity;
    }
    
    return result;
  }

  /**
   * 버퍼 초기화
   */
  clear(): void {
    this.head = 0;
    this.tail = 0;
    this.size = 0;
  }

  /**
   * 현재 저장된 데이터 개수
   */
  getSize(): number {
    return this.size;
  }

  /**
   * 버퍼 용량
   */
  getCapacity(): number {
    return this.capacity;
  }

  /**
   * 버퍼가 가득 찼는지 확인
   */
  isFull(): boolean {
    return this.size === this.capacity;
  }

  /**
   * 버퍼가 비어있는지 확인
   */
  isEmpty(): boolean {
    return this.size === 0;
  }
}

/**
 * EEG 데이터용 특화된 원형 버퍼
 */
export interface EEGDataPoint {
  timestamp: number;
  fp1: number;  // FP1 채널 (전전두엽 좌측)
  fp2: number;  // FP2 채널 (전전두엽 우측)
  signalQuality: number;
  leadOff: {    // Lead-off 상태 정보
    ch1: boolean; // 채널 1 전극 접촉 상태 (false = 접촉됨, true = 분리됨)
    ch2: boolean; // 채널 2 전극 접촉 상태 (false = 접촉됨, true = 분리됨)
  };
}

export class EEGCircularBuffer extends SimpleCircularBuffer<EEGDataPoint> {
  constructor(durationSeconds: number, samplingRate: number = 250) {
    // EEG 250Hz 기준으로 용량 계산
    const capacity = durationSeconds * samplingRate;
    super(capacity);
  }

  /**
   * 특정 시간 범위의 데이터 반환
   */
  getDataInTimeRange(startTime: number, endTime: number): EEGDataPoint[] {
    return this.toArray().filter(
      point => point.timestamp >= startTime && point.timestamp <= endTime
    );
  }

  /**
   * 최근 n초간의 데이터 반환
   */
  getRecentData(seconds: number): EEGDataPoint[] {
    const now = Date.now();
    const startTime = now - (seconds * 1000);
    return this.getDataInTimeRange(startTime, now);
  }

  /**
   * 평균 신호 품질 계산
   */
  getAverageSignalQuality(): number {
    const data = this.toArray();
    if (data.length === 0) return 0;
    
    const sum = data.reduce((acc, point) => acc + point.signalQuality, 0);
    return sum / data.length;
  }
}

/**
 * PPG 데이터용 특화된 원형 버퍼
 */
export interface PPGDataPoint {
  timestamp: number;
  red: number;
  ir: number;
  leadOff: {    // EEG Lead-off 상태를 참조 (PPG 자체에는 Lead-off가 없음)
    ch1: boolean; // EEG 채널 1 상태 참조
    ch2: boolean; // EEG 채널 2 상태 참조
  };
}

export class PPGCircularBuffer extends SimpleCircularBuffer<PPGDataPoint> {
  constructor(durationSeconds: number, samplingRate: number = 50) {
    // PPG 50Hz 기준으로 용량 계산
    const capacity = durationSeconds * samplingRate;
    super(capacity);
  }
}

/**
 * 가속도계 데이터용 특화된 원형 버퍼
 */
export interface ACCDataPoint {
  timestamp: number;
  x: number;
  y: number;
  z: number;
  magnitude: number; // 3축 크기 (√(x² + y² + z²))
}

export class ACCCircularBuffer extends SimpleCircularBuffer<ACCDataPoint> {
  constructor(durationSeconds: number, samplingRate: number = 30) {
    // ACC 30Hz 기준으로 용량 계산
    const capacity = durationSeconds * samplingRate;
    super(capacity);
  }

  /**
   * 움직임 강도 계산 (벡터 크기)
   */
  getMovementIntensity(): number[] {
    return this.toArray().map(point => 
      Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z)
    );
  }
} 
