// @ts-nocheck — link-band-sdk 이식본 (verbatim/noUnusedLocals 완화)
import type { EEGDevice } from './types/eeg';
import { StreamProcessor } from './StreamProcessor';
import { TimestampSynchronizer } from './TimestampSynchronizer';
import {
  parseEEGPacket,
  parsePPGPacket,
  parseACCPacket,
  parseBatteryPacket,
  type ChunkMetadata,
  type EEGDataSample,
  type PPGDataSample,
  type AccDataSample,
} from './blePacketParser';
import { getBluetoothProvider } from './bluetooth';
import type {
  BluetoothProvider,
  BluetoothDeviceInfo,
} from './bluetooth/BluetoothProvider';
import { createLogger } from "./logger";


const logger = createLogger("Bluetooth");
export type { ChunkMetadata, EEGDataSample, PPGDataSample, AccDataSample };

// LINK BAND EEG 디바이스 블루투스 서비스
// Python SDK device.py를 참고하여 구현

// LINK BAND 실제 UUID (Python SDK에서 확인된 값들)
const LINK_BAND_UUIDs = {
  // EEG 서비스
  EEG_SERVICE: 'df7b5d95-3afe-00a1-084c-b50895ef4f95',
  EEG_CHARACTERISTIC: '00ab4d15-66b4-0d8a-824f-8d6f8966c6e5',
  
  // PPG 서비스  
  PPG_SERVICE: '1cc50ec0-6967-9d84-a243-c2267f924d1f',
  PPG_CHARACTERISTIC: '6c739642-23ba-818b-2045-bfe8970263f6',
  
  // 가속도계 서비스
  ACCELEROMETER_SERVICE: '75c276c3-8f97-20bc-a143-b354244886d4',
  ACCELEROMETER_CHARACTERISTIC: 'd3d46a35-4394-e9aa-5a43-e7921120aaed',
  
  // 배터리 서비스 (표준 BLE)
  BATTERY_SERVICE: '0000180f-0000-1000-8000-00805f9b34fb',
  BATTERY_CHARACTERISTIC: '00002a19-0000-1000-8000-00805f9b34fb'
};

// SAMPLING_RATES / TIMESTAMP_CLOCK은 src/utils/blePacketParser.ts에 정의 (BLE 프로토콜 상수).

/**
 * LINK BAND 디바이스 광고 이름 접두사.
 * Provider.requestDevice() 의 단일 namePrefix 필터로 사용 — Web/Native 공통.
 * (기존 bleConnection 의 NAME_FILTERS 는 LXB/LinkBand/LOOXID 3종이었으나
 *  Provider 인터페이스는 단일 접두사만 받으므로 대표 접두사 'LXB' 를 사용한다.)
 */
const LINK_BAND_NAME_PREFIX = 'LXB';

// 실시간 샘플링 레이트 계산을 위한 추가 상수
const SAMPLING_RATE_CALCULATION = {
  WINDOW_SIZE: 10000,  // 10초 윈도우
  UPDATE_INTERVAL: 1000, // 1초마다 업데이트
  MIN_SAMPLES_FOR_CALCULATION: 10, // 최소 샘플 수
  HISTORY_SIZE: 10 // 최근 10개 측정값 저장
};

/**
 * SDK 코어 → App 계층으로 전달되는 콜백. SDK는 store를 직접 import하지 않고
 * App.tsx 등에서 setCallbacks()로 wiring한다.
 */
export interface BluetoothCallbacks {
  onSensorContactChanged?: (ch1: boolean, ch2: boolean) => void;
  onError?: (message: string) => void;
  onDisconnect?: () => void;
}

export interface BluetoothEEGService {
  scan(): Promise<EEGDevice[]>;
  connect(deviceId: string): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  onConnectionLost(callback: () => void): void;
  getBatteryLevel(): Promise<number>;
  getDeviceName(): string;
  getDeviceId(): string;
  clearDeviceCache(): void;
}

class LinkBandBluetoothService implements BluetoothEEGService {
  // 플랫폼별 BLE 구현(Web Bluetooth / Capacitor Native)을 추상화한 Provider.
  // 첫 scan/connect 시점에 getBluetoothProvider() 로 lazy 초기화한다.
  private provider: BluetoothProvider | null = null;

  // Provider 기준의 연결 식별자/상태 (이전의 BluetoothDevice/GATTServer 직접 보유를 대체).
  private deviceId: string | null = null;
  private deviceName: string | null = null;
  private connected: boolean = false;

  // discoverServices() 로 찾은 characteristic UUID (이전의 Characteristic 객체 보유를 대체).
  private eegCharUuid: string | null = null;
  private ppgCharUuid: string | null = null;
  private accCharUuid: string | null = null;
  private batteryCharUuid: string | null = null;

  private connectionLostCallback: (() => void) | null = null;

  // StreamProcessor 인스턴스
  private streamProcessor: StreamProcessor;

  // 데이터 수신 콜백
  public onDataReceived: ((data: any) => void) | null = null;

  // 배터리 레벨
  private batteryLevel: number = 0;
  
  // 배터리 예측 시스템
  private batteryHistory: Array<{
    level: number;
    timestamp: number;
  }> = [];
  
  private batteryPrediction: {
    mode: 'charging' | 'discharging' | 'unknown';
    ratePerMinute: number; // %/분
    estimatedTimeRemaining: number; // 분 단위
    lastCalculation: number;
  } = {
    mode: 'unknown',
    ratePerMinute: 0,
    estimatedTimeRemaining: 0,
    lastCalculation: 0
  };
  
  // 연결 시작 시간
  private connectionStartTime: number = 0;
  
  // 현재 연결 지속 시간 (실시간 계산)
  private currentConnectionDuration: number = 0;

  // 스캔된 디바이스 캐시
  private scannedDevices: Map<string, BluetoothDeviceInfo> = new Map();

  // ACC timestamp 동기화를 위한 변수들
  private lastAccTimestamp: number = 0;
  private accPacketCount: number = 0;
  /**
   * 센서 타임스탬프를 마스터 클럭 기준으로 정규화.
   * 디바이스 32.768kHz 클럭과 호스트 시간의 드리프트를 흡수.
   */
  private timestampSync: TimestampSynchronizer = new TimestampSynchronizer();

  // 실시간 샘플링 레이트 계산을 위한 변수들
  private samplingRateCounters = {
    eeg: { samples: 0, lastReset: Date.now(), currentRate: 0, history: [] as number[] },
    ppg: { samples: 0, lastReset: Date.now(), currentRate: 0, history: [] as number[] },
    acc: { samples: 0, lastReset: Date.now(), currentRate: 0, history: [] as number[] }
  };
  
  // 샘플링 레이트 모니터링 타이머
  private samplingRateMonitor: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.streamProcessor = new StreamProcessor();
    // Provider 는 첫 scan/connect 시점에 lazy init (플랫폼 감지 + 권한 요청을 그 시점으로 미룸).
  }

  /**
   * 플랫폼에 맞는 BluetoothProvider 를 보장한다.
   * Web 환경은 WebBluetoothProvider, Capacitor 네이티브는 NativeBluetoothProvider 로 해석된다.
   * 최초 1회만 생성·초기화하고 이후 동일 인스턴스를 재사용한다.
   */
  async ensureProvider(): Promise<BluetoothProvider> {
    if (!this.provider) {
      this.provider = await getBluetoothProvider();
      await this.provider.initialize();
    }
    return this.provider;
  }

  /**
   * StreamProcessor에 Store 콜백 설정
   */
  setStoreCallbacks(callbacks: any): void {
    this.streamProcessor.setStoreCallbacks(callbacks);
  }

  /**
   * 실시간 샘플링 레이트 모니터링 시작
   */
  private startSamplingRateMonitoring(): void {
    this.samplingRateMonitor = setInterval(() => {
      this.calculateAndUpdateSamplingRates();
      this.updateConnectionDuration();
    }, SAMPLING_RATE_CALCULATION.UPDATE_INTERVAL);
  }

  /**
   * 실시간 샘플링 레이트 모니터링 중지
   */
  private stopSamplingRateMonitoring(): void {
    if (this.samplingRateMonitor) {
      clearInterval(this.samplingRateMonitor);
      this.samplingRateMonitor = null;
    }
  }

  /**
   * 샘플링 레이트 계산 및 업데이트 (최근 10초 평균)
   */
  private calculateAndUpdateSamplingRates(): void {
    const now = Date.now();
    
    Object.keys(this.samplingRateCounters).forEach(sensor => {
      const counter = this.samplingRateCounters[sensor as keyof typeof this.samplingRateCounters];
      const timeDiff = (now - counter.lastReset) / 1000; // 초 단위
      
      if (timeDiff > 0 && counter.samples >= SAMPLING_RATE_CALCULATION.MIN_SAMPLES_FOR_CALCULATION) {
        // 현재 측정값 계산 (소수점 한자리까지)
        const currentRate = Math.round((counter.samples / timeDiff) * 10) / 10;
        
        // 히스토리에 추가
        counter.history.push(currentRate);
        
        // 히스토리 크기 제한 (최근 10개 측정값만 유지)
        if (counter.history.length > SAMPLING_RATE_CALCULATION.HISTORY_SIZE) {
          counter.history.shift();
        }
        
        // 최근 10초 평균 계산 (소수점 한자리까지)
        const averageRate = counter.history.reduce((sum, rate) => sum + rate, 0) / counter.history.length;
        counter.currentRate = Math.round(averageRate * 10) / 10;
        
        // 카운터 리셋
        counter.samples = 0;
        counter.lastReset = now;
      }
    });
  }

  /**
   * 연결 지속 시간 업데이트
   */
  private updateConnectionDuration(): void {
    if (this.isConnected() && this.connectionStartTime > 0) {
      this.currentConnectionDuration = Date.now() - this.connectionStartTime;
    }
  }

  // SDK ↔ App 계층 콜백 (store 직접 import 대체)
  private callbacks: BluetoothCallbacks = {};

  /**
   * App 계층에서 store wiring용 콜백을 주입한다.
   */
  setCallbacks(callbacks: BluetoothCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  // SystemControlService 콜백 함수들 (배터리 정보만 유지)
  private systemCallbacks: {
    onBatteryUpdate?: (level: number, voltage?: number) => void;
  } = {};

  /**
   * SystemControlService 콜백 설정
   */
  setSystemCallbacks(callbacks: {
    onBatteryUpdate?: (level: number, voltage?: number) => void;
  }): void {
    this.systemCallbacks = callbacks;
  }

  /**
   * 배터리 상태 업데이트 (SystemControlService에 콜백)
   */
  private updateBatteryStatus(level: number, voltage?: number): void {
    if (this.systemCallbacks.onBatteryUpdate) {
      this.systemCallbacks.onBatteryUpdate(level, voltage);
    }
  }

  /**
   * 배터리 히스토리에 새로운 데이터 추가
   */
  private addBatteryHistory(level: number): void {
    const now = Date.now();
    
    // 새로운 히스토리 항목 추가
    this.batteryHistory.push({
      level,
      timestamp: now
    });
    
    // 최근 10개 항목만 유지 (메모리 관리)
    if (this.batteryHistory.length > 10) {
      this.batteryHistory.shift();
    }
    
    // 배터리 예측 계산
    this.calculateBatteryPrediction();
  }

  /**
   * 배터리 사용/충전 패턴 분석 및 예측 계산
   */
  private calculateBatteryPrediction(): void {
    const now = Date.now();
    
    // 최소 2개의 데이터 포인트가 필요
    if (this.batteryHistory.length < 2) {
      this.batteryPrediction = {
        mode: 'unknown',
        ratePerMinute: 0,
        estimatedTimeRemaining: 0,
        lastCalculation: now
      };
      return;
    }
    
    // 가장 최근 2개 데이터 포인트 사용
    const latest = this.batteryHistory[this.batteryHistory.length - 1];
    const previous = this.batteryHistory[this.batteryHistory.length - 2];
    
    // 시간 차이 (분 단위)
    const timeDiffMinutes = (latest.timestamp - previous.timestamp) / (1000 * 60);
    
    // 시간 차이가 너무 작으면 계산하지 않음 (최소 30초)
    if (timeDiffMinutes < 0.5) {
      return;
    }
    
    // 배터리 레벨 변화량
    const levelDiff = latest.level - previous.level;
    
    // 분당 변화율 계산
    const ratePerMinute = levelDiff / timeDiffMinutes;
    
    // 모드 결정 및 예상 시간 계산
    let mode: 'charging' | 'discharging' | 'unknown';
    let estimatedTimeRemaining: number;
    
    if (ratePerMinute > 0.1) {
      // 충전 중 (분당 0.1% 이상 증가)
      mode = 'charging';
      const remainingToFull = 100 - latest.level;
      estimatedTimeRemaining = Math.round(remainingToFull / ratePerMinute);
    } else if (ratePerMinute < -0.1) {
      // 방전 중 (분당 0.1% 이상 감소)
      mode = 'discharging';
      estimatedTimeRemaining = Math.round(latest.level / Math.abs(ratePerMinute));
    } else {
      // 변화가 거의 없음
      mode = 'unknown';
      estimatedTimeRemaining = 0;
    }
    
    // 예측 결과 업데이트
    this.batteryPrediction = {
      mode,
      ratePerMinute: Math.abs(ratePerMinute),
      estimatedTimeRemaining: Math.max(0, estimatedTimeRemaining),
      lastCalculation: now
    };
  }

  /**
   * 배터리 예측 정보 조회
   */
  getBatteryPrediction(): {
    currentLevel: number;
    mode: 'charging' | 'discharging' | 'unknown';
    ratePerMinute: number;
    estimatedTimeRemaining: number;
    timeRemainingFormatted: string;
  } {
    const prediction = this.batteryPrediction;
    
    // 시간을 시:분 형식으로 포맷팅
    let timeRemainingFormatted: string;
    
    if (prediction.mode === 'unknown' || prediction.estimatedTimeRemaining === 0) {
      timeRemainingFormatted = 'Unknown';
    } else {
      const hours = Math.floor(prediction.estimatedTimeRemaining / 60);
      const minutes = Math.round(prediction.estimatedTimeRemaining % 60);
      
      if (hours > 0) {
        timeRemainingFormatted = `${hours}h ${minutes}m`;
      } else {
        timeRemainingFormatted = `${minutes}m`;
      }
      
      // 모드에 따른 설명 추가
      if (prediction.mode === 'charging') {
        timeRemainingFormatted += ' to full';
      } else {
        timeRemainingFormatted += ' remaining';
      }
    }
    
    return {
      currentLevel: this.batteryLevel,
      mode: prediction.mode,
      ratePerMinute: prediction.ratePerMinute,
      estimatedTimeRemaining: prediction.estimatedTimeRemaining,
      timeRemainingFormatted
    };
  }

  async scan(): Promise<EEGDevice[]> {
    try {
      const provider = await this.ensureProvider();
      // Provider 가 플랫폼별 디바이스 선택 UI(Web chooser / Native 스캔)를 띄운다.
      const deviceInfo = await provider.requestDevice({ namePrefix: LINK_BAND_NAME_PREFIX });
      this.scannedDevices.set(deviceInfo.deviceId, deviceInfo);
      const result: EEGDevice = {
        id: deviceInfo.deviceId,
        name: deviceInfo.name || 'LINK BAND',
        connected: false,
        batteryLevel: 0,
        signalQuality: 'good',
      };
      return [result];
    } catch (error) {
      // 사용자가 취소한 경우 특별 처리 (에러로 처리하지 않음)
      if (error instanceof Error && error.name === 'NotFoundError' && 
          error.message.includes('User cancelled')) {
        throw new Error('디바이스 선택이 취소되었습니다');
      }
      
      logger.error('디바이스 스캔 실패:', error);
      logger.error('Error details:', {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      
      throw new Error(`디바이스 스캔에 실패했습니다: ${error instanceof Error ? error.message : error}`);
    }
  }

  async connect(deviceId: string): Promise<void> {
    try {
      const provider = await this.ensureProvider();

      // 같은 디바이스에 이미 연결되어 있다면 그대로 둔다.
      if (this.deviceId === deviceId && this.connected && (await provider.isConnected(deviceId))) {
        return;
      }

      // 다른 디바이스에 연결되어 있다면 해제
      if (this.deviceId && this.deviceId !== deviceId && this.connected) {
        await this.disconnect();
      }

      // 캐시된 디바이스 사용 또는 새로 선택
      // (Web Bluetooth 는 connect 전에 requestDevice 로 디바이스를 한 번 선택해야 한다.)
      let targetId = deviceId;
      const cached = this.scannedDevices.get(deviceId);
      if (cached) {
        this.deviceName = cached.name;
      } else {
        const selected = await provider.requestDevice({ namePrefix: LINK_BAND_NAME_PREFIX });
        this.scannedDevices.set(selected.deviceId, selected);
        targetId = selected.deviceId;
        this.deviceName = selected.name;
      }

      this.deviceId = targetId;

      // 연결 시작 시간 기록
      this.connectionStartTime = Date.now();

      // GATT/CoreBluetooth 연결 (연결 해제 감지는 Provider 내부에서 관리)
      await provider.connect(targetId);

      // 서비스 연결
      await this.connectServices();

      // 데이터 스트림 시작
      await this.startDataStreams();

      // 배터리 모니터링 시작
      await this.startBatteryMonitoring();

      // 샘플링 레이트 모니터링 시작
      this.startSamplingRateMonitoring();

      this.connected = true;

    } catch (error) {
      await this.cleanup();

      // 사용자가 취소한 경우 특별 처리 (에러로 처리하지 않음)
      if (error instanceof Error && error.name === 'NotFoundError' &&
          error.message.includes('User cancelled')) {
        throw new Error('디바이스 연결이 취소되었습니다');
      }

      logger.error('LINK BAND 연결 실패:', error);
      throw new Error(`디바이스 연결에 실패했습니다: ${error instanceof Error ? error.message : error}`);
    }
  }



  private async connectServices(): Promise<void> {
    if (!this.provider || !this.deviceId) {
      throw new Error('Provider/디바이스가 연결되지 않음');
    }

    try {
      const services = await this.provider.discoverServices(this.deviceId);

      // 지정 service UUID 안에서 characteristic UUID 를 찾는다.
      // 정확한 characteristic UUID 우선, 없으면 notify 가능한 첫 characteristic 으로 폴백.
      const findCharUuid = (serviceUuid: string, charUuid: string): string | null => {
        const svc = services.find((s) => s.uuid.toLowerCase() === serviceUuid.toLowerCase());
        if (!svc) return null;
        const exact = svc.characteristics.find((c) => c.uuid.toLowerCase() === charUuid.toLowerCase());
        if (exact) return exact.uuid;
        return svc.characteristics.find((c) => c.properties.notify)?.uuid ?? null;
      };

      this.eegCharUuid = findCharUuid(LINK_BAND_UUIDs.EEG_SERVICE, LINK_BAND_UUIDs.EEG_CHARACTERISTIC);
      this.ppgCharUuid = findCharUuid(LINK_BAND_UUIDs.PPG_SERVICE, LINK_BAND_UUIDs.PPG_CHARACTERISTIC);
      this.accCharUuid = findCharUuid(LINK_BAND_UUIDs.ACCELEROMETER_SERVICE, LINK_BAND_UUIDs.ACCELEROMETER_CHARACTERISTIC);

      // 배터리는 read 특성 (선택적). 정확한 UUID 우선, 없으면 read 가능한 첫 characteristic 폴백.
      const batterySvc = services.find(
        (s) => s.uuid.toLowerCase() === LINK_BAND_UUIDs.BATTERY_SERVICE.toLowerCase()
      );
      this.batteryCharUuid =
        batterySvc?.characteristics.find(
          (c) => c.uuid.toLowerCase() === LINK_BAND_UUIDs.BATTERY_CHARACTERISTIC.toLowerCase()
        )?.uuid ??
        batterySvc?.characteristics.find((c) => c.properties.read)?.uuid ??
        null;

      // EEG 는 필수 — 없으면 연결 실패로 처리 (기존 discoverServices 동작과 동일)
      if (!this.eegCharUuid) {
        throw new Error('EEG characteristic 을 찾을 수 없음');
      }
    } catch (error) {
      logger.error('❌ 서비스 연결 실패:', error);
      throw new Error(`서비스 연결 실패: ${error}`);
    }
  }

  private async startDataStreams(): Promise<void> {
    if (!this.provider || !this.deviceId) {
      throw new Error('Provider/디바이스가 연결되지 않음');
    }
    const provider = this.provider;
    const deviceId = this.deviceId;

    try {
      // EEG 데이터 스트림 시작
      if (this.eegCharUuid) {
        await provider.startNotifications(
          deviceId, LINK_BAND_UUIDs.EEG_SERVICE, this.eegCharUuid,
          (dataView) => this.handleEEGData(dataView)
        );
      }

      // PPG 데이터 스트림 시작
      if (this.ppgCharUuid) {
        await provider.startNotifications(
          deviceId, LINK_BAND_UUIDs.PPG_SERVICE, this.ppgCharUuid,
          (dataView) => this.handlePPGData(dataView)
        );
      } else {
        logger.error('❌ PPG 특성이 없어서 알림을 시작할 수 없음');
      }

      // 가속도계 데이터 스트림 시작
      if (this.accCharUuid) {
        await provider.startNotifications(
          deviceId, LINK_BAND_UUIDs.ACCELEROMETER_SERVICE, this.accCharUuid,
          (dataView) => this.handleAccData(dataView)
        );
      }

    } catch (error) {
      logger.error('❌ 데이터 스트림 시작 실패:', error);
      throw new Error(`데이터 스트림 시작 실패: ${error}`);
    }
  }

  private async startBatteryMonitoring(): Promise<void> {
    if (!this.provider || !this.deviceId || !this.batteryCharUuid) {
      logger.warn('배터리 특성이 없어 모니터링을 건너뜀');
      return;
    }
    const provider = this.provider;
    const deviceId = this.deviceId;

    try {
      // 현재 배터리 레벨 읽기 (Provider 가 Battery Service 0x180F 를 직접 해석)
      this.batteryLevel = await provider.getBatteryLevel(deviceId);

      // 초기 배터리 정보 업데이트
      this.updateBatteryStatus(this.batteryLevel);

      // 배터리 변경 알림 시작
      await provider.startNotifications(
        deviceId, LINK_BAND_UUIDs.BATTERY_SERVICE, this.batteryCharUuid,
        (dataView) => this.handleBatteryData(dataView)
      );

    } catch (error) {
      logger.warn('배터리 모니터링 시작 실패:', error);
    }
  }

  private handleEEGData(dataView: DataView): void {
    if (!dataView || dataView.byteLength < 8) return;

    try {
      const result = parseEEGPacket(dataView, this.timestampSync, this.samplingRateCounters.eeg);
      if (result.samples.length > 0) {
        if (this.onDataReceived) {
          this.onDataReceived({ type: 'eeg', samples: result.samples, metadata: result.chunkMetadata });
        }
        // 최신 샘플의 LeadOff 상태를 콜백으로 전달 (App 계층에서 systemStore에 wiring)
        const latestSample = result.samples[result.samples.length - 1];
        this.callbacks.onSensorContactChanged?.(
          latestSample.leadoff_ch1,
          latestSample.leadoff_ch2
        );
      }
    } catch (error) {
      logger.error('EEG 데이터 처리 오류:', error);
    }
  }

  private handlePPGData(dataView: DataView): void {
    if (!dataView || dataView.byteLength < 8) return;

    try {
      const result = parsePPGPacket(dataView, this.timestampSync, this.samplingRateCounters.ppg);
      if (result.samples.length > 0) {
        // BLE 수신 블록킹 방지를 위해 비동기 디스패치
        setTimeout(() => {
          try {
            if (this.onDataReceived) {
              this.onDataReceived({ type: 'ppg', samples: result.samples, metadata: result.chunkMetadata });
            }
          } catch (asyncError) {
            logger.error('❌ PPG 비동기 처리 중 오류:', asyncError);
          }
        }, 0);
      }
    } catch (error) {
      logger.error('❌ PPG 데이터 파싱 중 오류 발생:', error);
    }
  }

  private handleAccData(dataView: DataView): void {
    if (!dataView || dataView.byteLength < 10) return;

    try {
      const result = parseACCPacket(
        dataView,
        this.timestampSync,
        this.samplingRateCounters.acc,
        this.lastAccTimestamp,
        this.accPacketCount
      );
      this.lastAccTimestamp = result.newLastTimestamp;
      this.accPacketCount = result.newPacketCount;

      if (result.samples.length > 0 && this.onDataReceived) {
        this.onDataReceived({ type: 'acc', samples: result.samples, metadata: result.chunkMetadata });
      }
    } catch (error) {
      logger.error('ACC 데이터 처리 오류:', error);
    }
  }

  private handleBatteryData(dataView: DataView): void {
    if (!dataView) return;
    const parsed = parseBatteryPacket(dataView);
    if (!parsed) return;

    const newBatteryLevel = parsed.level;
    if (newBatteryLevel !== this.batteryLevel) {
      this.batteryLevel = newBatteryLevel;
      this.addBatteryHistory(this.batteryLevel);
      this.updateBatteryStatus(this.batteryLevel);

      if (this.onDataReceived) {
        this.onDataReceived({
          type: 'battery',
          samples: [{
            timestamp: Date.now(),
            level: this.batteryLevel,
            percentage: this.batteryLevel,
          }],
        });
      }
    }
  }

  /**
   * 실제 연결 해제 처리 로직.
   *
   * 이전에는 `gattserverdisconnected` 이벤트에서 호출했으나, 연결 해제 감지는
   * 이제 Provider 내부 책임이다. BluetoothProvider 인터페이스에 연결 해제 콜백
   * 등록 수단이 추가되면 이 메서드를 다시 배선한다(현재는 보존만).
   */
  private performConnectionLossHandling(): void {
    // 정리 작업 수행
    this.cleanup();
    
    // 연결 해제 콜백 호출
    if (this.connectionLostCallback) {
      this.connectionLostCallback();
    }
    
    // App 계층에 연결 해제/에러 알림 (콜백 wiring)
    this.callbacks.onError?.('디바이스 연결이 끊어졌습니다.');
  }

  async disconnect(): Promise<void> {
    try {
      // 1. 샘플링 레이트 모니터링 중지
      this.stopSamplingRateMonitoring();

      const provider = this.provider;
      const deviceId = this.deviceId;

      if (provider && deviceId) {
        // 2. 모든 알림 중지 (에러가 발생해도 계속 진행)
        const notificationPromises: Promise<void>[] = [];

        if (this.eegCharUuid) {
          notificationPromises.push(
            provider.stopNotifications(deviceId, LINK_BAND_UUIDs.EEG_SERVICE, this.eegCharUuid)
              .catch(e => logger.warn('EEG 알림 중지 실패:', e))
          );
        }
        if (this.ppgCharUuid) {
          notificationPromises.push(
            provider.stopNotifications(deviceId, LINK_BAND_UUIDs.PPG_SERVICE, this.ppgCharUuid)
              .catch(e => logger.warn('PPG 알림 중지 실패:', e))
          );
        }
        if (this.accCharUuid) {
          notificationPromises.push(
            provider.stopNotifications(deviceId, LINK_BAND_UUIDs.ACCELEROMETER_SERVICE, this.accCharUuid)
              .catch(e => logger.warn('ACC 알림 중지 실패:', e))
          );
        }
        if (this.batteryCharUuid) {
          notificationPromises.push(
            provider.stopNotifications(deviceId, LINK_BAND_UUIDs.BATTERY_SERVICE, this.batteryCharUuid)
              .catch(e => logger.warn('배터리 알림 중지 실패:', e))
          );
        }

        // 모든 알림 중지 대기 (최대 3초)
        await Promise.race([
          Promise.all(notificationPromises),
          new Promise(resolve => setTimeout(resolve, 3000))
        ]);

        // 3. GATT/CoreBluetooth 연결 해제
        try {
          await provider.disconnect(deviceId);
        } catch (error) {
          logger.warn('GATT 서버 연결 해제 실패:', error);
        }
      }

      // 4. 강제 연결 해제 대기 (실제로 연결을 해제할 시간 제공)
      await new Promise(resolve => setTimeout(resolve, 500));

      // 5. App 계층에 연결 해제 알림 (콜백 wiring)
      this.callbacks.onDisconnect?.();

    } catch (error) {
      logger.error('❌ 연결 해제 중 오류:', error);
      // 에러가 발생해도 cleanup은 실행
    } finally {
      // 7. 완전한 정리 작업
      this.forceCleanup();
    }
  }

  private cleanup(): void {
    // Provider 인스턴스는 재사용을 위해 유지하고, 연결 상태/식별자만 초기화한다.
    this.deviceId = null;
    this.deviceName = null;
    this.connected = false;
    this.eegCharUuid = null;
    this.ppgCharUuid = null;
    this.accCharUuid = null;
    this.batteryCharUuid = null;

    // 연결 시간 초기화
    this.connectionStartTime = 0;
    this.currentConnectionDuration = 0;
    
    // 배터리 히스토리 및 예측 초기화
    this.batteryHistory = [];
    this.batteryPrediction = {
      mode: 'unknown',
      ratePerMinute: 0,
      estimatedTimeRemaining: 0,
      lastCalculation: 0
    };
    
    // ACC timestamp 동기화 변수 초기화
    this.lastAccTimestamp = 0;
    this.accPacketCount = 0;
    
    // 샘플링 레이트 카운터 초기화
    Object.keys(this.samplingRateCounters).forEach(sensor => {
      const counter = this.samplingRateCounters[sensor as keyof typeof this.samplingRateCounters];
      counter.samples = 0;
      counter.lastReset = Date.now();
      counter.currentRate = 0;
      counter.history = [];
    });
    
    // 샘플링 레이트 모니터링 중지
    this.stopSamplingRateMonitoring();
    
    // 캐시는 유지 (재연결을 위해)
    // this.scannedDevices.clear(); // 필요시에만 호출
  }

  /**
   * 강제 정리 - 연결 해제 시 완전한 정리를 위해 사용
   */
  private forceCleanup(): void {
    // 기본 cleanup 실행
    this.cleanup();
    
    // 추가적인 강제 정리 작업
    try {
      // 1. 디바이스 캐시 완전 정리 (재연결 문제 방지)
      this.scannedDevices.clear();
      
      // 2. 콜백 정리
      this.connectionLostCallback = null;
      this.onDataReceived = null;
      this.systemCallbacks = {};
      
      // 3. StreamProcessor 정리
      if (this.streamProcessor) {
        this.streamProcessor.cleanup();
      }
      
      // 4. 배터리 레벨 초기화
      this.batteryLevel = 0;
      
    } catch (error) {
      logger.error('❌ 강제 정리 중 오류:', error);
    }
  }

  /**
   * 디바이스 캐시 강제 정리 - 재연결 문제 해결용
   */
  clearDeviceCache(): void {
    this.scannedDevices.clear();
  }

  /**
   * 연결 시작 시간 가져오기
   */
  getConnectionStartTime(): number {
    return this.connectionStartTime;
  }

  /**
   * 연결 지속 시간 가져오기 (밀리초)
   */
  getConnectionDuration(): number {
    if (this.connectionStartTime === 0) return 0;
    return this.currentConnectionDuration;
  }

  /**
   * 현재 샘플링 레이트 가져오기
   */
  getCurrentSamplingRates(): { eeg: number; ppg: number; acc: number } {
    return {
      eeg: this.samplingRateCounters.eeg.currentRate,
      ppg: this.samplingRateCounters.ppg.currentRate,
      acc: this.samplingRateCounters.acc.currentRate
    };
  }

  isConnected(): boolean {
    // 동기 호출 계약 유지를 위해 내부 연결 플래그를 사용한다
    // (Provider.isConnected 는 비동기라 여기서 직접 호출하지 않음).
    return this.connected && this.deviceId !== null;
  }

  onConnectionLost(callback: () => void): void {
    this.connectionLostCallback = callback;
  }

  async getBatteryLevel(): Promise<number> {
    // 배터리 특성이 사용 불가능한 경우 마지막 알려진 값 반환
    if (!this.provider || !this.deviceId || !this.batteryCharUuid) {
      logger.warn('배터리 특성을 사용할 수 없습니다. 마지막 알려진 값을 반환합니다.');
      return this.batteryLevel;
    }

    try {
      this.batteryLevel = await this.provider.getBatteryLevel(this.deviceId);
      return this.batteryLevel;
    } catch (error) {
      logger.warn('배터리 레벨 읽기 실패:', error);
      return this.batteryLevel; // 마지막 알려진 값 반환
    }
  }

  /**
   * 연결된 디바이스 이름 가져오기
   */
  getDeviceName(): string {
    if (!this.deviceId) {
      return 'Unknown Device';
    }
    return this.deviceName || 'LINK BAND';
  }

  /**
   * 연결된 디바이스 ID 가져오기
   */
  getDeviceId(): string {
    if (!this.deviceId) {
      return '';
    }
    return this.deviceId;
  }
}

// 싱글톤 인스턴스
export const bluetoothService = new LinkBandBluetoothService();

// 실제 서비스 활성화 - 실제 LINK BAND 디바이스 연결
export const eegBluetoothService = bluetoothService; 
