/**
 * useBand — LINK BAND BLE 연결 → StreamProcessor → 1초 feature
 *
 * SDD-024: WS `/session-live` 로 1초 feature emit + eeg_feature 구독.
 * WS 미연결 시 기존 REST 5초 배치 업로드를 폴백으로 유지한다.
 *
 * Web Bluetooth 미지원 시 unsupported 상태를 반환한다.
 * VITE_USE_MOCK_EEG=true 이면 mockDataGenerator 시뮬레이션 모드.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  postSessionFeatures,
  type DeviceStatus,
  type EegFeatureItem,
  type UploadStatus,
} from '../lib/api/session';
import { tokenStorage } from '../lib/api/client';
import { AnalysisMetricsService } from '../lib/eeg/AnalysisMetricsService';
import { bluetoothService } from '../lib/eeg/bluetoothService';
import { mockDataGenerator } from '../lib/eeg/mockDataGenerator';
import { StreamProcessor } from '../lib/eeg/StreamProcessor';
import type { BandPowers } from '../lib/eeg/types/eeg';
import type { EEGAnalysisMetrics } from '../lib/eeg/types/processed-data';
import { createLogger } from '../lib/eeg/logger';
import {
  emitSessionLiveFeature,
  getSessionLiveSocket,
  joinSessionLive,
  subscribeSessionLiveEegFeature,
  type SessionLiveEegFeatureEvent,
} from '../lib/socket';

const logger = createLogger('useBand');

const FEATURE_FLUSH_MS = 5000;
const MOCK_TICK_MS = 1000;
const CHART_MAX_POINTS = 60;

export type BandConnectionState =
  | 'unsupported'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export interface BandChartPoint {
  t: number;
  relaxation: number;
}

export interface UseBandOptions {
  sessionId: string;
  participantId: string | null;
  /** false면 연결/업로드 비활성 (명상 단계 진입 전 등) */
  enabled?: boolean;
  /** 게스트 등 비인증 업로드 시 true */
  skipAuth?: boolean;
}

export interface UseBandResult {
  isSupported: boolean;
  isMock: boolean;
  connectionState: BandConnectionState;
  battery: number | null;
  signalQuality: number | null;
  deviceStatus: DeviceStatus | null;
  /** 두뇌휴식도 = relaxation_index (0~100 스케일 가정) */
  currentEfficiency: number | null;
  focusIndex: number | null;
  stressIndex: number | null;
  bandPowers: BandPowers | null;
  chartPoints: BandChartPoint[];
  uploadStatus: UploadStatus;
  /** `/session-live` WS 연결 여부 — UI 폴링 폴백 전환용 */
  isWsConnected: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

function useMockEeg(): boolean {
  return import.meta.env.VITE_USE_MOCK_EEG === 'true';
}

/** SDK SQI(0~100) → API signal_quality(0~1) */
function toApiSignalQuality(sqi0to100: number): number {
  return Math.min(1, Math.max(0, sqi0to100 / 100));
}

function metricsToFeature(
  metrics: EEGAnalysisMetrics,
  secondOffset: number,
  bandPowers: BandPowers | null,
  signalQuality0to100: number,
): EegFeatureItem {
  return {
    second_offset: secondOffset,
    timestamp: metrics.timestamp,
    delta_power: bandPowers?.delta ?? null,
    theta_power: bandPowers?.theta ?? null,
    alpha_power: bandPowers?.alpha ?? null,
    beta_power: bandPowers?.beta ?? null,
    gamma_power: bandPowers?.gamma ?? null,
    total_power: metrics.totalPower,
    focus_index: metrics.focusIndex,
    relaxation_index: metrics.relaxationIndex,
    stress_index: metrics.stressIndex,
    meditation_level: metrics.meditationLevel,
    attention_level: metrics.attentionLevel,
    cognitive_load: metrics.cognitiveLoad,
    emotional_stability: metrics.emotionalStability,
    hemispheric_balance: metrics.hemisphericBalance,
    signal_quality: toApiSignalQuality(signalQuality0to100),
  };
}

function deviceStatusFromQuality(
  connected: boolean,
  signalQuality0to100: number | null,
): DeviceStatus {
  if (!connected) return 'disconnected';
  if (signalQuality0to100 === null) return 'unknown';
  if (signalQuality0to100 < 40) return 'lead_off';
  return 'ok';
}

/** eeg_feature 이벤트에서 두뇌휴식도 추출 */
function efficiencyFromEvent(event: SessionLiveEegFeatureEvent): number | null {
  if (typeof event.current_efficiency === 'number') return event.current_efficiency;
  if (typeof event.relaxation_index === 'number') return event.relaxation_index;
  const nested = event.feature?.relaxation_index;
  return typeof nested === 'number' ? nested : null;
}

export function useBand({
  sessionId,
  participantId,
  enabled = true,
  skipAuth = false,
}: UseBandOptions): UseBandResult {
  const isMock = useMockEeg();
  const isSupported = isMock || isWebBluetoothSupported();

  const [connectionState, setConnectionState] = useState<BandConnectionState>(() =>
    isSupported ? 'disconnected' : 'unsupported',
  );
  const [battery, setBattery] = useState<number | null>(null);
  const [signalQuality, setSignalQuality] = useState<number | null>(null);
  const [currentEfficiency, setCurrentEfficiency] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [stressIndex, setStressIndex] = useState<number | null>(null);
  const [bandPowers, setBandPowers] = useState<BandPowers | null>(null);
  const [chartPoints, setChartPoints] = useState<BandChartPoint[]>([]);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [isWsConnected, setIsWsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<StreamProcessor | null>(null);
  const featureBufferRef = useRef<EegFeatureItem[]>([]);
  const secondOffsetRef = useRef(0);
  const bandPowersRef = useRef<BandPowers | null>(null);
  const signalQualityRef = useRef<number | null>(null);
  const batteryRef = useRef<number | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const wsConnectedRef = useRef(false);
  const participantIdRef = useRef(participantId);
  participantIdRef.current = participantId;

  const deviceStatus = deviceStatusFromQuality(
    connectionState === 'connected',
    signalQuality,
  );

  const pushChartPoint = useCallback((relaxation: number) => {
    setChartPoints((prev) => {
      const next = [...prev, { t: Date.now(), relaxation }];
      return next.length > CHART_MAX_POINTS ? next.slice(-CHART_MAX_POINTS) : next;
    });
  }, []);

  const flushFeatures = useCallback(async () => {
    // WS가 살아 있으면 REST 배치는 생략 (폴백만)
    if (wsConnectedRef.current) return;
    if (!sessionId || featureBufferRef.current.length === 0) return;
    const batch = featureBufferRef.current.splice(0, featureBufferRef.current.length);
    try {
      setUploadStatus('streaming');
      await postSessionFeatures(
        sessionId,
        {
          participant_id: participantId,
          features: batch,
        },
        { skipAuth },
      );
      if (mountedRef.current) setUploadStatus('streaming');
    } catch (err) {
      logger.error('feature 업로드 실패', err);
      // 실패 분량은 버퍼 앞에 되돌려 재시도
      featureBufferRef.current = [...batch, ...featureBufferRef.current];
      if (mountedRef.current) {
        setUploadStatus('failed');
        setError(err instanceof Error ? err.message : 'EEG feature 업로드 실패');
      }
    }
  }, [sessionId, participantId, skipAuth]);

  const ingestMetrics = useCallback(
    (metrics: EEGAnalysisMetrics, powers: BandPowers | null, sqi: number) => {
      const offset = secondOffsetRef.current++;
      const feature = metricsToFeature(metrics, offset, powers, sqi);

      // WS 연결 시 1초 feature emit, 미연결 시 REST 버퍼에 적재
      const socket = getSessionLiveSocket(skipAuth ? null : tokenStorage.getAccess());
      const emitted =
        wsConnectedRef.current &&
        emitSessionLiveFeature(socket, {
          session_id: sessionId,
          participant_id: participantIdRef.current,
          feature,
          band_battery: batteryRef.current,
          device_status: deviceStatusFromQuality(true, sqi),
        });

      if (emitted) {
        if (mountedRef.current) setUploadStatus('streaming');
      } else {
        featureBufferRef.current.push(feature);
      }

      if (!mountedRef.current) return;
      setCurrentEfficiency(metrics.relaxationIndex);
      setFocusIndex(metrics.focusIndex);
      setStressIndex(metrics.stressIndex);
      setSignalQuality(sqi);
      signalQualityRef.current = sqi;
      if (powers) {
        setBandPowers(powers);
        bandPowersRef.current = powers;
      }
      pushChartPoint(metrics.relaxationIndex);
    },
    [pushChartPoint, sessionId, skipAuth],
  );

  const stopMock = useCallback(() => {
    if (mockTimerRef.current) {
      clearInterval(mockTimerRef.current);
      mockTimerRef.current = null;
    }
  }, []);

  const startMock = useCallback(() => {
    stopMock();
    mockTimerRef.current = setInterval(() => {
      const analysis = mockDataGenerator.generateEEGAnalysis();
      // mock은 밴드파워를 직접 주지 않으므로 합성
      const powers: BandPowers = {
        delta: 20 + Math.random() * 10,
        theta: 15 + Math.random() * 10,
        alpha: 25 + Math.random() * 15,
        beta: 20 + Math.random() * 10,
        gamma: 10 + Math.random() * 5,
      };
      const sqi = 80 + Math.random() * 20;
      ingestMetrics(analysis, powers, sqi);
      setBattery((prev) => {
        const next = prev === null ? 85 : Math.max(5, prev - 0.01);
        batteryRef.current = next;
        return next;
      });
    }, MOCK_TICK_MS);
  }, [ingestMetrics, stopMock]);

  const disconnect = useCallback(async () => {
    stopMock();
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    await flushFeatures();

    if (streamRef.current) {
      streamRef.current.cleanup();
      streamRef.current = null;
    }
    try {
      if (bluetoothService.isConnected()) {
        await bluetoothService.disconnect();
      }
    } catch (err) {
      logger.warn('disconnect 중 오류', err);
    }

    if (mountedRef.current) {
      setConnectionState(isSupported ? 'disconnected' : 'unsupported');
      setUploadStatus('idle');
    }
  }, [flushFeatures, isSupported, stopMock]);

  const connect = useCallback(async () => {
    if (!enabled) return;
    if (!isSupported) {
      setConnectionState('unsupported');
      setError('이 브라우저는 Web Bluetooth를 지원하지 않습니다. Chrome/Edge를 사용해 주세요.');
      return;
    }

    setError(null);
    setConnectionState('connecting');

    try {
      // REST 폴백 플러시 타이머 (WS 연결 중에는 flushFeatures 내부에서 no-op)
      if (flushTimerRef.current) clearInterval(flushTimerRef.current);
      flushTimerRef.current = setInterval(() => {
        void flushFeatures();
      }, FEATURE_FLUSH_MS);

      if (isMock) {
        setConnectionState('connected');
        setBattery(88);
        batteryRef.current = 88;
        setUploadStatus('streaming');
        startMock();
        return;
      }

      const analysis = AnalysisMetricsService.getInstance();
      analysis.setCallbacks({
        onMetricsUpdate: (action, data) => {
          if (action !== 'eeg') return;
          const metrics = data as EEGAnalysisMetrics;
          const latest = analysis.getLatestEegFeature();
          ingestMetrics(
            metrics,
            latest?.bandPowers ?? bandPowersRef.current,
            latest?.signalQuality ?? signalQualityRef.current ?? 0,
          );
        },
      });

      const stream = new StreamProcessor();
      streamRef.current = stream;
      stream.setBluetoothService(bluetoothService);
      stream.setCallbacks({
        onError: (err) => {
          if (mountedRef.current) setError(err.message);
        },
      });
      stream.setStoreCallbacks({
        updateBatteryData: (data) => {
          if (mountedRef.current) {
            setBattery(data.percentage);
            batteryRef.current = data.percentage;
          }
        },
      });
      await stream.start();

      const devices = await bluetoothService.scan();
      if (devices.length === 0) {
        throw new Error('LINK BAND 디바이스를 찾지 못했습니다');
      }
      await bluetoothService.connect(devices[0].id);

      try {
        const level = await bluetoothService.getBatteryLevel();
        setBattery(level);
        batteryRef.current = level;
      } catch {
        // 배터리 실패는 연결을 막지 않음
      }

      bluetoothService.onConnectionLost(() => {
        if (mountedRef.current) {
          setConnectionState('disconnected');
          setError('LINK BAND 연결이 끊어졌습니다');
        }
      });

      setConnectionState('connected');
      setUploadStatus('streaming');
    } catch (err) {
      logger.error('연결 실패', err);
      await disconnect();
      if (mountedRef.current) {
        setConnectionState('error');
        setError(err instanceof Error ? err.message : 'LINK BAND 연결 실패');
      }
    }
  }, [
    disconnect,
    enabled,
    flushFeatures,
    ingestMetrics,
    isMock,
    isSupported,
    startMock,
  ]);

  // `/session-live` 연결 + join + 본인 eeg_feature 구독
  useEffect(() => {
    if (!enabled || !sessionId) {
      wsConnectedRef.current = false;
      setIsWsConnected(false);
      return undefined;
    }

    const token = skipAuth ? null : tokenStorage.getAccess();
    const socket = getSessionLiveSocket(token);

    const onConnect = (): void => {
      wsConnectedRef.current = true;
      if (mountedRef.current) setIsWsConnected(true);
      joinSessionLive(socket, sessionId);
      // 재연결 직후 REST 버퍼에 쌓인 분량이 있으면 한 번 비움(이중 저장 완화)
      if (featureBufferRef.current.length > 0) {
        featureBufferRef.current = [];
      }
    };

    const onDisconnect = (): void => {
      wsConnectedRef.current = false;
      if (mountedRef.current) setIsWsConnected(false);
    };

    const onEegFeature = (event: SessionLiveEegFeatureEvent): void => {
      const selfId = participantIdRef.current;
      if (!selfId || event.participant_id !== selfId) return;
      if (!mountedRef.current) return;

      const efficiency = efficiencyFromEvent(event);
      if (efficiency !== null) {
        setCurrentEfficiency(efficiency);
        pushChartPoint(efficiency);
      }
      const focus = event.focus_index ?? event.feature?.focus_index;
      if (typeof focus === 'number') setFocusIndex(focus);
      const stress = event.stress_index ?? event.feature?.stress_index;
      if (typeof stress === 'number') setStressIndex(stress);
      const sq = event.signal_quality ?? event.feature?.signal_quality;
      if (typeof sq === 'number') {
        // API는 0~1, UI는 0~100 스케일 유지
        const sqi = sq <= 1 ? sq * 100 : sq;
        setSignalQuality(sqi);
        signalQualityRef.current = sqi;
      }
      if (typeof event.band_battery === 'number') {
        setBattery(event.band_battery);
        batteryRef.current = event.band_battery;
      }
      if (event.upload_status) setUploadStatus(event.upload_status);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    const unsubscribe = subscribeSessionLiveEegFeature(socket, onEegFeature);

    if (socket.connected) {
      onConnect();
    }

    return () => {
      // room leave 는 useSessionLiveSocket(UI)가 담당 — 싱글톤 공유 시 조기 leave 방지
      unsubscribe();
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      wsConnectedRef.current = false;
      if (mountedRef.current) setIsWsConnected(false);
    };
  }, [enabled, sessionId, skipAuth, pushChartPoint]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopMock();
      if (flushTimerRef.current) {
        clearInterval(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.cleanup();
        streamRef.current = null;
      }
      void bluetoothService.disconnect().catch(() => undefined);
    };
  }, [stopMock]);

  // enabled 해제 시 자동 해제
  useEffect(() => {
    if (!enabled && connectionState === 'connected') {
      void disconnect();
    }
  }, [enabled, connectionState, disconnect]);

  return {
    isSupported,
    isMock,
    connectionState,
    battery,
    signalQuality,
    deviceStatus,
    currentEfficiency,
    focusIndex,
    stressIndex,
    bandPowers,
    chartPoints,
    uploadStatus,
    isWsConnected,
    error,
    connect,
    disconnect,
  };
}
