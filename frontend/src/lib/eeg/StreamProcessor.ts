// @ts-nocheck — link-band-sdk 이식본 (verbatim/noUnusedLocals 완화)
import type { EEGDataPoint, PPGDataPoint, ACCDataPoint } from './SimpleCircularBuffer';
import { EEGCircularBuffer, PPGCircularBuffer, ACCCircularBuffer } from './SimpleCircularBuffer';
import { TimestampSynchronizer } from './TimestampSynchronizer';
import { EEGSignalProcessor } from './EEGSignalProcessor';
import { PPGSignalProcessor } from './PPGSignalProcessor';
import { ACCSignalProcessor } from './ACCSignalProcessor';
import type { ProcessedEEGData } from './types/eeg';
import { AnalysisMetricsService } from './AnalysisMetricsService';
import type { ChunkMetadata } from './blePacketParser';
import { createLogger } from "./logger";


const logger = createLogger("StreamProc");
/**
 * Phase 1.7: 단순화된 스트림 처리기
 * 
 * 목표:
 * - 복잡한 이벤트 시스템 제거
 * - Store 중심 아키텍처로 단순화
 * - 신호 처리 → Store 업데이트 → React 렌더링
 * - 데이터 플로우 추적 용이성 확보
 */

// Store 업데이트 콜백 타입 (단순화)
export type StoreUpdateCallback = {
  updateBatteryData?: (data: { level: number; percentage: number; timestamp: number; status: 'high' | 'medium' | 'low' }) => void;
  updatePerformanceMetrics?: (metrics: PerformanceMetrics) => void;
  onError?: (message: string, source: string) => void;
};

// SystemControlService용 콜백 타입
export interface SystemCallbacks {
  onEEGData?: (data: EEGDataPoint[]) => void;
  onPPGData?: (data: PPGDataPoint[]) => void;
  onACCData?: (data: ACCDataPoint[]) => void;
  onProcessedEEG?: (data: any) => void;
  onProcessedPPG?: (data: any) => void;
  onProcessedACC?: (data: any) => void;
  onError?: (error: Error) => void;
  onStoreUpdate?: (action: string, ...args: unknown[]) => void;
}

export interface PerformanceMetrics {
  processingTime: number;
  memoryUsage: number;
  bufferSizes: {
    eeg: number;
    ppg: number;
    acc: number;
  };
  droppedPackets: number;
  timestampSyncQuality: number;
  timestampDriftRate: number;
}

/**
 * 단순화된 스트림 처리기
 * 
 * 개선된 구조:
 * - Bluetooth → StreamProcessor → Store → React
 * - 복잡한 이벤트 시스템 제거
 * - Store 중심 데이터 관리
 */
export class StreamProcessor {
  private storeCallbacks: StoreUpdateCallback = {};
  private systemCallbacks: SystemCallbacks = {};
  private isProcessing: boolean = false;
  private isProcessingPPG: boolean = false; // PPG 전용 처리 플래그
  private performanceMetrics: PerformanceMetrics;
  private bluetoothService: any = null;
  private isStarted: boolean = false;

  // 타임스탬프 동기화
  private timestampSynchronizer: TimestampSynchronizer;
  
  // 센서별 버퍼
  private eegBuffer: EEGCircularBuffer;
  private ppgBuffer: PPGCircularBuffer;
  private accBuffer: ACCCircularBuffer;
  
  // 센서별 신호 처리기
  private eegProcessor: EEGSignalProcessor;
  private ppgProcessor: PPGSignalProcessor;
  private accProcessor: ACCSignalProcessor;
  
  // 🔧 분석 지표 서비스
  private analysisMetricsService: AnalysisMetricsService;

  constructor() {
    this.timestampSynchronizer = new TimestampSynchronizer();
    
    // 버퍼 초기화 (스마트 버퍼 시스템)
    // 🔧 EEG: 1000초 * 250Hz = 250,000 샘플 (아니다, 1000은 초가 아니라 고정 크기)
    // 실제로는 5초 분량: 5 * 250 = 1250 샘플이 되어야 함
    this.eegBuffer = new EEGCircularBuffer(5, 250); // 5초, 250Hz = 1250 샘플
    this.ppgBuffer = new PPGCircularBuffer(10, 50); // 32초, 50Hz = 1600 샘플
    this.accBuffer = new ACCCircularBuffer(5, 30); // 5초, 30Hz = 150 샘플
    
    // 신호 처리기 초기화
    this.eegProcessor = new EEGSignalProcessor();
    this.ppgProcessor = new PPGSignalProcessor();
    this.accProcessor = new ACCSignalProcessor();
    
    // 🔧 분석 지표 서비스 초기화
    this.analysisMetricsService = AnalysisMetricsService.getInstance();
    
    // 성능 메트릭 초기화
    this.performanceMetrics = {
      processingTime: 0,
      memoryUsage: 0,
      bufferSizes: { eeg: 0, ppg: 0, acc: 0 },
      droppedPackets: 0,
      timestampSyncQuality: 1.0,
      timestampDriftRate: 0
    };
    
    // PPG 처리 플래그 강제 리셋 타이머 (5초마다로 단축)
    setInterval(() => {
      if (this.isProcessingPPG) {
        // PPG processing flag force-reset (5s timeout)
        this.isProcessingPPG = false;
      }
    }, 5000);
  }

  /**
   * SystemControlService용 콜백 설정 (병합 방식)
   */
  setCallbacks(callbacks: SystemCallbacks): void {
    this.systemCallbacks = { ...this.systemCallbacks, ...callbacks };
  }

  /**
   * BluetoothService 연결
   */
  setBluetoothService(bluetoothService: any): void {
    this.bluetoothService = bluetoothService;
  }

  /**
   * 스트림 처리 시작
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      logger.debug('StreamProcessor already started');
      return;
    }

    try {
      // BluetoothService 데이터 리스너 설정
      if (this.bluetoothService) {
        this.bluetoothService.onDataReceived = (data: any) => {
          this.handleBluetoothData(data);
        };
      }

      this.isStarted = true;
      logger.debug('StreamProcessor started successfully');
    } catch (error) {
      logger.error('StreamProcessor start failed:', error);
      throw error;
    }
  }

  /**
   * 스트림 처리 중지
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    try {
      // BluetoothService 리스너 제거
      if (this.bluetoothService) {
        this.bluetoothService.onDataReceived = null;
      }

      this.isStarted = false;
      logger.debug('StreamProcessor stopped successfully');
    } catch (error) {
      logger.error('StreamProcessor stop failed:', error);
      throw error;
    }
  }

  /**
   * 정리
   */
  cleanup(): void {
    this.stop();
    this.clearBuffers();
    this.bluetoothService = null;
    this.systemCallbacks = {};
    this.storeCallbacks = {};
  }

  /**
   * Bluetooth 데이터 처리
   */
  private handleBluetoothData(data: any): void {
    try {
      console.log(`[DIAG:handleBT] type=${data?.type} samples=${data?.samples?.length} isStarted=${this.isStarted}`);
      // 청크 메타데이터(ChunkMetadata): 2-Pass 정밀 보정용. 1-Pass에선 전달만 한다.
      const metadata: ChunkMetadata | undefined = data.metadata;
      // 데이터 타입에 따라 처리
      if (data.type === 'eeg' && data.samples) {
        this.processEEGData(data.samples, metadata);
      } else if (data.type === 'ppg' && data.samples) {
        this.processPPGData(data.samples, metadata);
      } else if (data.type === 'acc' && data.samples) {
        this.processACCData(data.samples, metadata);
      } else if (data.type === 'battery' && data.samples) {
        this.processBatteryData(data.samples[0]); // 배터리는 단일 샘플
      } else {
        logger.warn('알 수 없는 데이터 타입 또는 샘플 없음:', data?.type);
      }
    } catch (error) {
      logger.error('handleBluetoothData 오류:', error);
      this.handleError(
        error instanceof Error ? error.message : '알 수 없는 오류',
        'StreamProcessor.handleBluetoothData'
      );
    }
  }

  /**
   * Store 콜백 관리 (단순화된 시스템)
   */
  setStoreCallbacks(callbacks: StoreUpdateCallback): void {
    this.storeCallbacks = callbacks;
  }

  private handleError(message: string, source: string): void {
    const error = new Error(`[${source}] ${message}`);
    
    if (this.systemCallbacks.onError) {
      this.systemCallbacks.onError(error);
    } else if (this.storeCallbacks.onError) {
      this.storeCallbacks.onError(message, source);
    } else {
      console.error(error.message);
    }
  }

  /**
   * EEG 데이터 독립 처리
   */
  processEEGData(data: any[], metadata?: ChunkMetadata): void {
    const startTime = performance.now();
    
    if (this.isProcessing) {
      this.performanceMetrics.droppedPackets++;
      return;
    }
    
    this.isProcessing = true;
    
    try {
      // 1) EEG CircularBuffer에 데이터 추가
      const eegDataPoints: EEGDataPoint[] = [];
      data.forEach(sample => {
        const dataPoint: EEGDataPoint = {
          timestamp: sample.timestamp,
          fp1: sample.ch1,
          fp2: sample.ch2,
          signalQuality: this.calculateEEGSignalQuality(sample.leadoff_ch1, sample.leadoff_ch2),
          leadOff: {
            ch1: sample.leadoff_ch1,
            ch2: sample.leadoff_ch2
          }
        };
        this.eegBuffer.push(dataPoint);
        eegDataPoints.push(dataPoint);
      });
      
      // 2) SystemCallbacks로 원시 데이터 전달
      if (this.systemCallbacks.onEEGData) {
        this.systemCallbacks.onEEGData(eegDataPoints);
      }
      
      // 3) 충분한 데이터가 있을 때 비동기로 고급 신호 처리
      const bufferData = this.eegBuffer.toArray();
      
      if (bufferData.length >= 500) {
        this.performAdvancedEEGProcessing(bufferData);
      }
      
      // 성능 메트릭 업데이트
      this.updatePerformanceMetrics(startTime);
      
    } catch (error) {
      this.handleError(
        error instanceof Error ? error.message : '알 수 없는 오류',
        'StreamProcessor.processEEGData'
      );
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * PPG 데이터 독립 처리
   */
  processPPGData(data: any[], metadata?: ChunkMetadata): void {
    const startTime = performance.now();
    
    // PPG는 별도 처리 플래그 사용 (EEG와 독립적)
    if (this.isProcessingPPG) {
      this.performanceMetrics.droppedPackets++;
      return;
    }
    
    this.isProcessingPPG = true;
    
    try {
      // 1) PPG CircularBuffer에 데이터 추가
      const ppgDataPoints: PPGDataPoint[] = [];
      data.forEach(sample => {
        const dataPoint: PPGDataPoint = {
          timestamp: sample.timestamp,
          red: sample.red,
          ir: sample.ir,
          leadOff: { ch1: false, ch2: false }
        };
        this.ppgBuffer.push(dataPoint);
        ppgDataPoints.push(dataPoint);
      });
      
      // 2) SystemCallbacks로 원시 데이터 전달
      if (this.systemCallbacks.onPPGData) {
        this.systemCallbacks.onPPGData(ppgDataPoints);
      }
      
      // 3) 충분한 데이터가 있을 때 비동기로 고급 신호 처리
      const bufferData = this.ppgBuffer.toArray();
      
      // PPG 처리 조건: 최소 50개 샘플 필요 (1초 데이터)
      if (bufferData.length >= 50) {
        this.performAdvancedPPGProcessing(bufferData);
      }
      
      // 성능 메트릭 업데이트
      this.updatePerformanceMetrics(startTime);
      
    } catch (error) {
      this.handleError(
        error instanceof Error ? error.message : '알 수 없는 오류',
        'StreamProcessor.processPPGData'
      );
    } finally {
      this.isProcessingPPG = false;
    }
  }

  /**
   * ACC 데이터 독립 처리
   */
  processACCData(data: any[], metadata?: ChunkMetadata): void {
    const startTime = performance.now();
    
    if (this.isProcessing) {
      this.performanceMetrics.droppedPackets++;
      return;
    }
    
    this.isProcessing = true;
    
    try {
      // 1) ACC CircularBuffer에 데이터 추가
      const accDataPoints: ACCDataPoint[] = [];
      data.forEach(sample => {
        const dataPoint: ACCDataPoint = {
          timestamp: sample.timestamp,
          x: sample.x,
          y: sample.y,
          z: sample.z,
          magnitude: Math.sqrt(sample.x ** 2 + sample.y ** 2 + sample.z ** 2)
        };
        this.accBuffer.push(dataPoint);
        accDataPoints.push(dataPoint);
      });
      
      // 2) SystemCallbacks로 원시 데이터 전달
      if (this.systemCallbacks.onACCData) {
        this.systemCallbacks.onACCData(accDataPoints);
      }
      
      // 3) 충분한 데이터가 있을 때 비동기로 고급 신호 처리
      const bufferData = this.accBuffer.toArray();
      if (bufferData.length >= 30) {
        this.performAdvancedACCProcessing(bufferData);
      }
      
      // 성능 메트릭 업데이트
      this.updatePerformanceMetrics(startTime);
      
    } catch (error) {
      this.handleError(
        error instanceof Error ? error.message : '알 수 없는 오류',
        'StreamProcessor.processACCData'
      );
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Battery 데이터 독립 처리
   */
  processBatteryData(batteryData: { level: number; percentage: number; timestamp: number }): void {
    const startTime = performance.now();
    
    try {
      // Battery 데이터는 버퍼링하지 않고 즉시 Store 업데이트
      if (this.storeCallbacks.updateBatteryData) {
        this.storeCallbacks.updateBatteryData({
          level: batteryData.level,
          percentage: batteryData.percentage,
          timestamp: batteryData.timestamp,
          status: this.getBatteryStatus(batteryData.level)
        });
      }
      
      // 성능 메트릭 업데이트
      this.updatePerformanceMetrics(startTime);
      
    } catch (error) {
      this.handleError(
        error instanceof Error ? error.message : '알 수 없는 오류',
        'StreamProcessor.processBatteryData'
      );
    }
  }

  /**
   * 유틸리티 메서드들
   */
  private getBatteryStatus(level: number): 'high' | 'medium' | 'low' {
    if (level >= 70) return 'high';
    if (level >= 30) return 'medium';
    return 'low';
  }

  private calculateEEGSignalQuality(leadoff_ch1: boolean, leadoff_ch2: boolean): number {
    if (leadoff_ch1 && leadoff_ch2) return 0;
    if (leadoff_ch1 || leadoff_ch2) return 0.5;
    return 1.0;
  }

  private updatePerformanceMetrics(startTime: number): void {
    const endTime = performance.now();
    this.performanceMetrics.processingTime = endTime - startTime;
    this.performanceMetrics.memoryUsage = 0; // 메모리 API 미지원 시 0
    this.performanceMetrics.bufferSizes = {
      eeg: this.eegBuffer.getSize(),
      ppg: this.ppgBuffer.getSize(),
      acc: this.accBuffer.getSize()
    };
    this.performanceMetrics.timestampSyncQuality = 1.0; // 기본값
    this.performanceMetrics.timestampDriftRate = 0; // 기본값
    
    // 성능 메트릭을 Store에 업데이트
    if (this.storeCallbacks.updatePerformanceMetrics) {
      this.storeCallbacks.updatePerformanceMetrics(this.performanceMetrics);
    }
  }

  /**
   * 공개 메서드들
   */
  getPerformanceMetrics(): PerformanceMetrics {
    return { ...this.performanceMetrics };
  }

  // 차트에서 버퍼 데이터에 접근할 수 있는 메서드들
  getEEGBufferData(): EEGDataPoint[] {
    return this.eegBuffer.toArray();
  }

  getPPGBufferData(): PPGDataPoint[] {
    return this.ppgBuffer.toArray();
  }

  getACCBufferData(): ACCDataPoint[] {
    return this.accBuffer.toArray();
  }

  clearBuffers(): void {
    this.eegBuffer.clear();
    this.ppgBuffer.clear();
    this.accBuffer.clear();
  }

  dispose(): void {
    this.clearBuffers();
    this.storeCallbacks = {};
  }

  /**
   * 고급 EEG 처리 (비동기) - 직접 ProcessedDataStore 업데이트
   */
  private async performAdvancedEEGProcessing(bufferData: EEGDataPoint[]): Promise<void> {
    try {
      // bufferData는 이미 EEGDataPoint[]이므로 직접 사용
      const result = await this.eegProcessor.processEEGData(bufferData);
      
      // 콜백을 통해 ProcessedDataStore 업데이트
      {
        const eegData = {
          // 필터링된 EEG 데이터
          filteredData: result.filteredData,
          
          // 신호 품질 정보
          signalQuality: result.signalQuality,
          
          // 밴드 파워 정보
          bandPowers: result.bandPowers,
          
          // 뇌파 상태 분석
          brainState: result.brainState,
          
          // 주파수 스펙트럼
          frequencySpectrum: result.frequencySpectrum,
          
          // EEG 지수들
          indices: result.indices,
          
          // 원시 분석 결과 (SQI 등)
          rawAnalysis: result.rawAnalysis,
          
          // 타임스탬프
          timestamp: Date.now()
        };
        
        // EEG 그래프 데이터 변환 및 업데이트
        if (result.filteredData && result.filteredData.length > 0) {
          const fp1GraphData = result.filteredData.map(point => ({
            timestamp: point.timestamp,
            value: point.fp1
          }));
          
          const fp2GraphData = result.filteredData.map(point => ({
            timestamp: point.timestamp,
            value: point.fp2
          }));
          
          // EEG 그래프 데이터 업데이트
          this.systemCallbacks.onStoreUpdate?.("updateEEGGraphData", fp1GraphData, fp2GraphData);
        }
        
        // ProcessedDataStore에 EEG 분석 결과 직접 업데이트
        // frequencySpectrum 데이터 구조 변환 (ch1Power, ch2Power → power)

        const transformedEEGData = {
          ...eegData,
          frequencySpectrum: result.frequencySpectrum ? {
            frequencies: result.frequencySpectrum.frequencies,
            ch1Power: result.frequencySpectrum.ch1Power,
            ch2Power: result.frequencySpectrum.ch2Power,
            dominantFrequency: result.frequencySpectrum.frequencies[
              result.frequencySpectrum.ch1Power.indexOf(Math.max(...result.frequencySpectrum.ch1Power))
            ] || 0
          } : null
        };

        this.systemCallbacks.onStoreUpdate?.("updateEEGAnalysis", transformedEEGData);
        
        // EEG 신호 품질 정보 업데이트 (ProcessedDataStore.signalQuality)
        if (result.signalQuality && result.signalQuality.overall !== undefined) {
          const eegQualityScore = result.signalQuality.overall; // 0-100 범위
          const qualityLevel = eegQualityScore >= 90 ? 'excellent' : 
                              eegQualityScore >= 80 ? 'good' : 
                              eegQualityScore >= 60 ? 'fair' : 
                              eegQualityScore > 0 ? 'poor' : 'unknown';
          
          this.systemCallbacks.onStoreUpdate?.("updateSignalQuality", {
            eegQuality: eegQualityScore,
            overall: qualityLevel,
            lastUpdated: Date.now()
          });
        }
        
        // EEG SQI 데이터 업데이트

        if (result.rawAnalysis?.ch1SQI && result.rawAnalysis?.ch2SQI) {
          const eegSQI = {
            ch1SQI: result.rawAnalysis.ch1SQI.map((value, index) => ({
            timestamp: result.filteredData[index]?.timestamp || Date.now(),
            value: value
            })),
            ch2SQI: result.rawAnalysis.ch2SQI.map((value, index) => ({
            timestamp: result.filteredData[index]?.timestamp || Date.now(),
            value: value
            }))
          };
          
          this.systemCallbacks.onStoreUpdate?.("updateEEGSQI", eegSQI);
        }
        
        // EEG 분석 지표 생성 및 저장 (SQI 값 포함)
        if (result.indices && result.bandPowers) {
          try {
            // EEG SQI 값 계산 (overall SQI 사용)
            const eegSQI = result.signalQuality?.overall || 0;
            
            await this.analysisMetricsService.processEEGAnalysisMetrics(
              {
                timestamp: Date.now(),
                bandPowers: result.bandPowers,
                signalQuality: {
                  overall: result.signalQuality.overall,
                  channels: [result.signalQuality.fp1, result.signalQuality.fp2],
                  artifacts: {
                    movement: false,
                    eyeBlink: false,
                    muscleNoise: false
                  }
                },
                brainState: result.brainState
              } as ProcessedEEGData,
              {
                focusIndex: result.indices.focusIndex,
                relaxationIndex: result.indices.relaxationIndex,
                stressIndex: result.indices.stressIndex,
                hemisphericBalance: result.indices.hemisphericBalance,
                cognitiveLoad: result.indices.cognitiveLoad,
                emotionalStability: result.indices.emotionalStability,
                attentionLevel: result.indices.focusIndex, // focusIndex를 attentionLevel로 사용
                meditationLevel: result.indices.relaxationIndex // relaxationIndex를 meditationLevel로 사용
              }
            );
          } catch (error) {
            logger.error('❌ EEG 분석 지표 생성 실패:', error);
          }
        }
        
        // SystemCallbacks로 processed EEG 데이터 전달 (S3CloudStorageService 등)
        if (this.systemCallbacks.onProcessedEEG) {
          this.systemCallbacks.onProcessedEEG(transformedEEGData);
        }
      }
      
    } catch (error) {
      this.handleError(
        error instanceof Error ? error.message : '고급 EEG 처리 오류',
        'StreamProcessor.performAdvancedEEGProcessing'
      );
    }
  }

  /**
   * 고급 PPG 처리 (비동기) - 직접 ProcessedDataStore 업데이트
   */
  private async performAdvancedPPGProcessing(bufferData: PPGDataPoint[]): Promise<void> {
    // 처리 플래그 체크 및 타임아웃 관리
    if (this.isProcessingPPG) {
      // 즉시 리셋: 강제로 플래그를 리셋하고 다시 시도
      // PPG processing in progress, resetting flag for retry (normal under load)
      this.isProcessingPPG = false;
      
      // 리셋 후 바로 다시 처리 시도
      return this.performAdvancedPPGProcessing(bufferData);
    }
    
    // 처리 플래그 설정
    this.isProcessingPPG = true;
    
    // 안전장치: 1초 후 강제로 플래그 리셋 (더 빠른 복구)
    const timeoutId = setTimeout(() => {
      if (this.isProcessingPPG) {
        // PPG processing timed out, forcing flag reset
        this.isProcessingPPG = false;
      }
    }, 1000);
    
    try {
      // bufferData는 이미 PPGDataPoint[]이므로 직접 사용
      const result = await this.ppgProcessor.processPPGData(bufferData);
      
      // PPG 그래프 데이터 업데이트 (Visualizer용)
      if (result.filteredData && result.filteredData.length > 0) {
        const redGraphData = result.filteredData.map(point => ({
          timestamp: point.timestamp,
          value: point.red
        }));
        
        const irGraphData = result.filteredData.map(point => ({
          timestamp: point.timestamp,
          value: point.ir
        }));
        
        // PPG 그래프 데이터 업데이트
        this.systemCallbacks.onStoreUpdate?.("updatePPGGraphData", redGraphData, irGraphData);
      }

      // 콜백을 통해 ProcessedDataStore 업데이트
      {
        const ppgData = {
          // 필터링된 PPG 데이터
          filteredData: result.filteredData,
          
          // 생체 신호 정보
          vitals: result.vitals,
          
          // 신호 품질 정보
          signalQuality: result.signalQuality,
          
          // 피크 정보
          peakInfo: result.peakInfo,
          
          // 타임스탬프
          timestamp: Date.now()
        };
        
        // ProcessedDataStore에 PPG 분석 결과 직접 업데이트
        const transformedPPGData = {
          ...ppgData,
          indices: result.vitals ? {
            heartRate: result.vitals.heartRate || 0,
            hrv: result.vitals.hrv || 0,
            spo2: result.vitals.spo2 || 0,
            rmssd: result.vitals.hrv || 0, // HRV와 동일
            // 🔧 실제 고급 HRV 값들 사용 (advancedHRV에서 가져오기)
            sdnn: result.advancedHRV?.sdnn || 0,
            pnn50: result.advancedHRV?.pnn50 || 0,
            lfPower: result.advancedHRV?.lfPower || 0,
            hfPower: result.advancedHRV?.hfPower || 0,
            lfHfRatio: result.advancedHRV?.lfHfRatio || 0,
            stressIndex: result.advancedHRV?.stressIndex || 0,
            // 🔧 새로운 HRV 지표들 추가
            avnn: result.advancedHRV?.avnn || 0,
            pnn20: result.advancedHRV?.pnn20 || 0,
            sdsd: result.advancedHRV?.sdsd || 0,
            hrMax: result.advancedHRV?.hrMax || 0,
            hrMin: result.advancedHRV?.hrMin || 0,
            triangularIndex: 0, // 아직 구현되지 않음
            // 🔧 호흡 분석 기본값들 (아직 구현되지 않음)
            respiratoryRate: 0,
            respiratoryVariability: 0,
            respiratoryDepth: 0,
            respiratoryRegularity: 0,
            respiratoryEffort: 0,
            apneaEvents: 0,
            respiratoryLfPower: 0,
            respiratoryHfPower: 0,
            respiratoryTotalPower: 0,
            respiratorySpectralEntropy: 0
          } : {
            heartRate: 0,
            hrv: 0,
            spo2: 0,
            rmssd: 0,
            sdnn: 0,
            pnn50: 0,
            lfPower: 0,
            hfPower: 0,
            lfHfRatio: 0,
            stressIndex: 0,
            // 🔧 새로운 HRV 지표들 기본값
            avnn: 0,
            pnn20: 0,
            sdsd: 0,
            hrMax: 0,
            hrMin: 0,
            triangularIndex: 0,
            respiratoryRate: 0,
            respiratoryVariability: 0,
            respiratoryDepth: 0,
            respiratoryRegularity: 0,
            respiratoryEffort: 0,
            apneaEvents: 0,
            respiratoryLfPower: 0,
            respiratoryHfPower: 0,
            respiratoryTotalPower: 0,
            respiratorySpectralEntropy: 0
          }
        };
        
        this.systemCallbacks.onStoreUpdate?.("updatePPGAnalysis", transformedPPGData);
        
        // PPG SQI 데이터도 별도로 업데이트
        // PPGSignalProcessor에서 개별 SQI 배열을 직접 사용
        if (result.signalQuality?.redSQI && result.signalQuality?.irSQI && result.signalQuality?.overallSQI && result.filteredData) {
          // PPG SQI는 400개로 제한 (PPG 처리 결과와 일치)
          const maxLength = Math.min(400, result.signalQuality.redSQI.length);
          
          const redSQIData = result.signalQuality.redSQI.slice(0, maxLength).map((value, index) => ({
            timestamp: result.filteredData[index]?.timestamp || (Date.now() - (maxLength - index) * 20), // 20ms 간격
            value: value // 이미 퍼센트로 변환됨 (0-100%)
          }));
          
          const irSQIData = result.signalQuality.irSQI.slice(0, maxLength).map((value, index) => ({
            timestamp: result.filteredData[index]?.timestamp || (Date.now() - (maxLength - index) * 20), // 20ms 간격
            value: value // 이미 퍼센트로 변환됨 (0-100%)
          }));
          
          const overallSQIData = result.signalQuality.overallSQI.slice(0, maxLength).map((value, index) => ({
            timestamp: result.filteredData[index]?.timestamp || (Date.now() - (maxLength - index) * 20), // 20ms 간격
            value: value // 이미 퍼센트로 변환됨 (0-100%)
          }));
          
          this.systemCallbacks.onStoreUpdate?.("updatePPGSQI", {
            redSQI: redSQIData,
            irSQI: irSQIData,
            overallSQI: overallSQIData
          });
        }
        
        // PPG 분석 지표 생성 및 저장 (SQI 값 포함) - EEG 방식과 동일한 조건 적용
        if (result.vitals && result.advancedHRV) {
          try {
            // 현재 SQI 값 계산 (overallSQI 배열의 최신 평균값)
            let currentSQI = 0;
            if (result.signalQuality?.overallSQI && result.signalQuality.overallSQI.length > 0) {
              // EEG와 동일: 최근 10개 샘플의 평균 SQI 값 사용
              const recentSQI = result.signalQuality.overallSQI.slice(-10);
              currentSQI = recentSQI.reduce((sum, val) => sum + val, 0) / recentSQI.length;
            }
            
            // EEG와 동일한 품질 조건: SQI 80% 이상
            const isQualityGood = currentSQI >= 80;
            
            await this.analysisMetricsService.processPPGAnalysisMetrics(
              {
                vitals: result.vitals,
                advancedHRV: result.advancedHRV
              },
              Date.now(),
              currentSQI, // SQI 값 전달
              isQualityGood, // 품질 상태 전달 (EEG와 동일한 조건)
              result.rrIntervals // RR 간격 전달 (LF/HF 계산용)
            );
          } catch (error) {
            logger.error('❌ PPG 분석 지표 생성 실패:', error);
          }
        }
        
        // SystemCallbacks로 processed PPG 데이터 전달 (S3CloudStorageService 등)
        if (this.systemCallbacks.onProcessedPPG) {
          this.systemCallbacks.onProcessedPPG(transformedPPGData);
        }
      }
      
      
    } catch (error) {
      logger.error('❌ PPG 고급 처리 중 치명적 에러 발생:', error);
      
      this.handleError(
        error instanceof Error ? error.message : '고급 PPG 처리 오류',
        'StreamProcessor.performAdvancedPPGProcessing'
      );
      
    } finally {
      // 정상/에러 완료 관계없이 항상 플래그 리셋
      clearTimeout(timeoutId); // 타임아웃 클리어
      this.isProcessingPPG = false;
    }
  }

  /**
   * ACC 고급 처리 수행
   */
  private async performAdvancedACCProcessing(accData: ACCDataPoint[]): Promise<void> {
    if (!accData || accData.length === 0) {
      return;
    }

    try {
      // ACC 신호 처리
      const result = await this.accProcessor.processACCData(accData);

      // 콜백을 통해 ACC 분석 결과 업데이트
      {
        // 가속도 크기 데이터를 그래프용으로 변환
        const magnitudeGraphData = result.magnitude.map(m => ({
          timestamp: m.timestamp,
          value: m.value
        }));

        // ProcessedDataStore 업데이트
        this.systemCallbacks.onStoreUpdate?.("updateACCAnalysis", {
          magnitude: magnitudeGraphData,
          indices: {
            activity: result.activity.intensity,
            stability: result.posture.stability,
            intensity: result.activity.intensity,
            balance: result.posture.balance,
            activityState: result.activity.type,
            avgMovement: result.movement.avgMovement,
            stdMovement: result.movement.stdMovement,
            maxMovement: result.movement.maxMovement
          },
          lastUpdated: Date.now(),
          // ACC 원시 버퍼 데이터 추가
          rawBufferData: accData
        });

        // ACC 분석 지표 생성 및 저장
        if (result.activity && result.movement && result.posture) {
          try {
            await this.analysisMetricsService.processACCAnalysisMetrics(
              {
                activity: result.activity,
                movement: result.movement,
                posture: result.posture
              },
              Date.now()
            );
          } catch (error) {
            logger.error('❌ ACC 분석 지표 생성 실패:', error);
          }
        }
        
        // SystemCallbacks로 processed ACC 데이터 전달 (S3CloudStorageService 등)
        const accAnalysisData = {
          magnitude: magnitudeGraphData,
          indices: {
            activity: result.activity.intensity,
            stability: result.posture.stability,
            intensity: result.activity.intensity,
            balance: result.posture.balance,
            activityState: result.activity.type,
            avgMovement: result.movement.avgMovement,
            stdMovement: result.movement.stdMovement,
            maxMovement: result.movement.maxMovement
          },
          lastUpdated: Date.now(),
          rawBufferData: accData
        };
        
        if (this.systemCallbacks.onProcessedACC) {
          this.systemCallbacks.onProcessedACC(accAnalysisData);
        }
      }

    } catch (error) {
      logger.error('❌ ACC 고급 처리 오류:', error);

      // 오류 시 기본값으로 업데이트
      this.systemCallbacks.onStoreUpdate?.("updateACCAnalysis", {
        magnitude: [],
        indices: {
          activity: 0,
          stability: 0,
          intensity: 0,
          balance: 0,
          activityState: 'stationary',
          avgMovement: 0,
          stdMovement: 0,
          maxMovement: 0
        },
        lastUpdated: Date.now(),
        rawBufferData: accData || []
      });
    }
  }
} 
