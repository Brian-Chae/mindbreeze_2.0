/**
 * useBand — LINK BAND BLE 연결 → StreamProcessor → 1초 feature
 *
 * SDD-024: WS `/session-live` 로 1초 feature emit + eeg_feature 구독.
 * SDD-026: IndexedDB 영속 미확정 큐 → ACK 삭제, 재연결 재전송, offset 복구,
 *          LeadOff/SQI 분리, 배터리·last_eeg_at 전달.
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
import type { BandPowers, LeadOffStatus } from '../lib/eeg/types/eeg';
import type { EEGAnalysisMetrics } from '../lib/eeg/types/processed-data';
import { createLogger } from '../lib/eeg/logger';
import {
  enqueueFeature,
  listPendingFeatures,
  loadStreamCursor,
  removeAckedFeature,
  type QueuedFeatureItem,
} from '../lib/session-live/feature-queue';
import {
  encodeRawChunk,
  RAW_SAMPLES_PER_CHUNK,
  type RawEegSample,
} from '../lib/session-live/raw-encoder';
import { useEegRawUpload } from './useEegRawUpload';
import {
  deviceStatusFromLeadOff,
  normalizeSignalQuality01,
  signalQualityLevel,
  toApiSignalQuality,
  type SignalQualityLevel,
} from '../lib/session-live/signal-status';
import {
  emitSessionLiveFeature,
  getSessionLiveSocket,
  joinSessionLive,
  subscribeSessionLiveEegFeature,
  subscribeSessionLiveFeatureAck,
  type SessionLiveEegFeatureEvent,
  type SessionLiveFeatureAck,
} from '../lib/socket';
import type {
  BandAccSnapshot,
  BandEegWaveform,
  BandPpgWaveform,
  BandRawIndices,
  BandSensors,
  BandSensorState,
  BandSpectrum,
  WaveformPoint,
} from '../types/playground';
import { refreshActiveModel, scoreIndices } from '../lib/eeg/eegPersonalScore';

const logger = createLogger('useBand');

/**
 * FE-BAND-001: useBand 중복 mount 감지용 모듈 레벨 가드.
 *
 * BLE 연결(bluetoothService)은 singleton 을 재사용하지만 훅 상태(스트림·큐·타이머)는
 * 인스턴스마다 따로 산다. WaitingRoomBandCheck / GuestMeditationPanel / PlaygroundPage /
 * ClassPlayerPage 가 각각 호출하므로, 두 인스턴스가 동시에 살아 있으면 연결·업로드가
 * 이중화된다. 활성 소유자 수를 추적해 중복 mount 를 경고하고, 동시 connect() 는 1건만
 * 진행되게 차단한다.
 */
let activeBandOwners = 0;
let bandConnectInFlight = false;

/** raw indices → 표시용 0~100 정규화 (활성 모델 > 코호트 B0) */
function toScoredIndices(raw: BandRawIndices): BandRawIndices {
  const scores = scoreIndices({
    focusIndex: raw.focusIndex,
    relaxationIndex: raw.relaxationIndex,
    stressIndex: raw.stressIndex,
    totalNeuralActivity: raw.totalNeuralActivity,
    cognitiveLoad: raw.cognitiveLoad,
    emotionalStability: raw.emotionalStability,
    hemisphericBalance: raw.hemisphericBalance,
    faa: raw.hemisphericBalance,
  });
  return {
    focusIndex: scores.focusIndex,
    relaxationIndex: scores.relaxationIndex,
    stressIndex: scores.stressIndex,
    cognitiveLoad: scores.cognitiveLoad,
    emotionalStability: scores.emotionalStability,
    hemisphericBalance: scores.hemisphericBalance,
    totalNeuralActivity: scores.totalPower,
  };
}

const FEATURE_FLUSH_MS = 5000;
/** SDD-112: REST 폴백 재전송 배치 상한(1분치) — 거대 큐를 5초 주기로 나눠 drain */
const RETRANSMIT_BATCH_MAX = 60;
/** SDD-113: 세션 경과시간 기반 window_index 영속 base 키 */
const EEG_OFFSET_BASE_KEY = 'mindbreeze:eeg-offset-base:';

function eegOffsetBaseKey(sessionId: string, participantId: string | null): string {
  return `${EEG_OFFSET_BASE_KEY}${sessionId}:${participantId ?? 'anon'}`;
}
const MOCK_TICK_MS = 1000;
const CHART_MAX_POINTS = 60;
/** 종료 drain 최대 대기 */
const DRAIN_MAX_MS = 15_000;
const DRAIN_POLL_MS = 200;
/** playground 파형 보관 상한 — EEG 5초@250Hz / PPG 4초@50Hz / ACC 5초@30Hz */
const EEG_WAVEFORM_MAX = 1250;
const PPG_WAVEFORM_MAX = 200;
const ACC_WAVEFORM_MAX = 150;
/** 고빈도 파형 state 플러시 주기 (ms) */
const PLAYGROUND_FLUSH_MS = 200;

const INITIAL_SENSORS: BandSensors = {
  leftElectrode: 'loading',
  rightElectrode: 'loading',
  ppgSensor: 'loading',
  signalQuality: 'loading',
};

const INITIAL_ACC: BandAccSnapshot = {
  magnitude: [],
  magnitudeWaveform: [],
  movement: 0,
  intensity: 0,
  activityType: 'stationary',
  tiltAngle: 0,
  stability: 0,
  avgMovement: 0,
  maxMovement: 0,
};

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
  /**
   * playground 관찰 전용 — IndexedDB 큐·WS 업로드 없이 로컬 스트림만.
   * sessionId가 비어 있어도 연결·지표 갱신이 동작한다.
   */
  observationOnly?: boolean;
  /** true면 VITE_USE_MOCK_EEG와 무관하게 mockDataGenerator 경로 사용 */
  forceMock?: boolean;
}

export interface UseBandResult {
  isSupported: boolean;
  isMock: boolean;
  connectionState: BandConnectionState;
  battery: number | null;
  /** SDK 스케일 0~100 */
  signalQuality: number | null;
  /** SQI 레벨 — unknown을 ok로 표시하지 않음 */
  signalQualityLevel: SignalQualityLevel;
  /** 접촉(LeadOff) 기반 device_status — SQI로 추정하지 않음 */
  deviceStatus: DeviceStatus | null;
  leadOff: LeadOffStatus | null;
  lastEegAt: string | null;
  /** 두뇌휴식도 = relaxation_index (0~100 스케일 가정) */
  currentEfficiency: number | null;
  focusIndex: number | null;
  stressIndex: number | null;
  /** 몸 지표 — BPM (산출 불가 시 null) */
  heartRate: number | null;
  /** 몸 지표 — 호흡수 breaths/min (산출 불가 시 null) */
  respiratoryRate: number | null;
  /** HRV SDNN (ms) */
  sdnn: number | null;
  /** HRV RMSSD (ms) */
  rmssd: number | null;
  bandPowers: BandPowers | null;
  chartPoints: BandChartPoint[];
  uploadStatus: UploadStatus;
  /** `/session-live` WS 연결 여부 — UI 폴링 폴백 전환용(참고). 저장 성공과 동일시 금지 */
  isWsConnected: boolean;
  pendingCount: number;
  error: string | null;
  /** playground — EEG 필터 파형 (FP1/FP2) */
  eegWaveform: BandEegWaveform;
  /** playground — 주파수 스펙트럼 */
  spectrum: BandSpectrum | null;
  /** playground — PPG 필터 파형 */
  ppgWaveform: BandPpgWaveform;
  /** playground — ACC 요약 + magnitude */
  acc: BandAccSnapshot;
  /** playground — 7지표 raw */
  rawIndices: BandRawIndices | null;
  /** playground — 정규화 점수 (활성 모델 > 코호트 B0). raw는 유지 */
  scoredIndices: BandRawIndices | null;
  /** playground — 전극/센서 접촉 */
  sensors: BandSensors;
  /** playground — 연결 이후 경과 초 */
  connectedElapsedSec: number;
  /** WaveformCanvas용 — React 리렌더 없이 최신 EEG 샘플 */
  getEegWaveformSamples: () => { fp1: number[]; fp2: number[] };
  /** WaveformCanvas용 — 최신 PPG IR/RED */
  getPpgWaveformSamples: () => BandPpgWaveform;
  /** WaveformCanvas용 — 최신 ACC magnitude */
  getAccWaveformSamples: () => number[];
  clearBuffers: () => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

function envMockEeg(): boolean {
  return import.meta.env.VITE_USE_MOCK_EEG === 'true';
}

function sensorFromLeadOff(leadOff: LeadOffStatus | null, connected: boolean): BandSensors {
  if (!connected) return { ...INITIAL_SENSORS };
  if (!leadOff) {
    return {
      leftElectrode: 'loading',
      rightElectrode: 'loading',
      ppgSensor: 'loading',
      signalQuality: 'loading',
    };
  }
  const left: BandSensorState = leadOff.ch1 ? 'bad' : 'good';
  const right: BandSensorState = leadOff.ch2 ? 'bad' : 'good';
  const quality: BandSensorState = leadOff.ch1 || leadOff.ch2 ? 'bad' : 'good';
  return {
    leftElectrode: left,
    rightElectrode: right,
    ppgSensor: 'good',
    signalQuality: quality,
  };
}

function trimWaveform(points: WaveformPoint[], max: number): WaveformPoint[] {
  return points.length > max ? points.slice(points.length - max) : points;
}

function trimNumbers(values: number[], max: number): number[] {
  return values.length > max ? values.slice(values.length - max) : values;
}

function metricsToFeature(
  metrics: EEGAnalysisMetrics,
  secondOffset: number,
  bandPowers: BandPowers | null,
  signalQuality0to100: number | null,
  battery: number | null,
): EegFeatureItem {
  // HRV는 AnalysisMetricsService RR 버퍼 기반 getter에서 읽음 (null 보존)
  const hrv = AnalysisMetricsService.getInstance();
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
    signal_quality:
      signalQuality0to100 == null ? null : toApiSignalQuality(signalQuality0to100),
    sdnn: hrv.getCurrentSDNN(),
    rmssd: hrv.getCurrentRMSSD(),
    lf_power: hrv.getCurrentLfPower(),
    hf_power: hrv.getCurrentHfPower(),
    lf_hf_ratio: hrv.getCurrentLfHfRatio(),
    heart_rate: hrv.getCurrentHeartRate(),
    respiratory_rate: hrv.getCurrentRespiratoryRate(),
    motion: hrv.getCurrentMotion(),
    band_battery: battery,
  };
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
  observationOnly = false,
  forceMock = false,
}: UseBandOptions): UseBandResult {
  const isMock = forceMock || envMockEeg();
  const isSupported = isMock || isWebBluetoothSupported();

  const [connectionState, setConnectionState] = useState<BandConnectionState>(() => {
    if (!isSupported) return 'unsupported';
    // 전역(singleton) BLE 연결이 이미 살아있으면 'connected'로 시작한다.
    // waiting→meditation 전환 등 컴포넌트 unmount/remount에도 연결이 유지되도록.
    return bluetoothService.isConnected() ? 'connected' : 'disconnected';
  });
  const [battery, setBattery] = useState<number | null>(null);
  const [signalQuality, setSignalQuality] = useState<number | null>(null);
  const [leadOff, setLeadOff] = useState<LeadOffStatus | null>(null);
  const [lastEegAt, setLastEegAt] = useState<string | null>(null);
  const [currentEfficiency, setCurrentEfficiency] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [stressIndex, setStressIndex] = useState<number | null>(null);
  const [heartRate, setHeartRate] = useState<number | null>(null);
  const [respiratoryRate, setRespiratoryRate] = useState<number | null>(null);
  const [sdnn, setSdnn] = useState<number | null>(null);
  const [rmssd, setRmssd] = useState<number | null>(null);
  const [bandPowers, setBandPowers] = useState<BandPowers | null>(null);
  const [chartPoints, setChartPoints] = useState<BandChartPoint[]>([]);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [isWsConnected, setIsWsConnected] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [eegWaveform, setEegWaveform] = useState<BandEegWaveform>({ fp1: [], fp2: [] });
  const [spectrum, setSpectrum] = useState<BandSpectrum | null>(null);
  const [ppgWaveform, setPpgWaveform] = useState<BandPpgWaveform>({ red: [], ir: [] });
  const [acc, setAcc] = useState<BandAccSnapshot>(INITIAL_ACC);
  const [rawIndices, setRawIndices] = useState<BandRawIndices | null>(null);
  const [sensors, setSensors] = useState<BandSensors>(INITIAL_SENSORS);
  const [connectedElapsedSec, setConnectedElapsedSec] = useState(0);

  const streamRef = useRef<StreamProcessor | null>(null);
  const secondOffsetRef = useRef(0);
  /** SDD-113: 경과시간 base(첫 샘플 wall-clock) — remount에도 유지 */
  const baseOffsetRef = useRef<number | null>(null);
  const streamIdRef = useRef<string>('');
  const cursorReadyRef = useRef(false);
  const collectingRef = useRef(false);
  const bandPowersRef = useRef<BandPowers | null>(null);
  const signalQualityRef = useRef<number | null>(null);
  const batteryRef = useRef<number | null>(null);
  const leadOffRef = useRef<LeadOffStatus | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playgroundFlushRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectedAtRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  /** SDD-120 후속: 밴드 끊김(gattserverdisconnected) 시 자동 재연결 */
  const autoReconnectRef = useRef(true);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsConnectedRef = useRef(false);
  const drainingRef = useRef(false);
  /** SDD-112: 재전송 in-flight 가드 — 5초 타이머·재연결 중복 호출 방지 */
  const retransmitInFlightRef = useRef(false);
  const observationOnlyRef = useRef(observationOnly);
  observationOnlyRef.current = observationOnly;
  const participantIdRef = useRef(participantId);
  participantIdRef.current = participantId;

  // FE-BAND-001: 활성 소유자 등록 — 동시에 둘 이상 mount 되면 경고한다.
  useEffect(() => {
    activeBandOwners += 1;
    if (import.meta.env.DEV && activeBandOwners > 1) {
      console.warn(
        `[useBand] 중복 인스턴스 감지(${activeBandOwners}) — BLE singleton 을 공유하므로 연결/업로드가 이중화될 수 있습니다.`,
      );
    }
    return () => {
      activeBandOwners = Math.max(0, activeBandOwners - 1);
    };
  }, []);

  // SDD-117: raw EEG → S3 업로드 배선.
  // 샘플을 1초(250샘플) 청크로 버퍼링 → interleaved float32 인코딩 → 영속 큐 → presign/S3/ack.
  const rawUpload = useEegRawUpload({
    sessionId,
    participantId,
    enabled: !observationOnly && Boolean(sessionId && participantId),
    skipAuth,
  });
  const rawEnqueueRef = useRef(rawUpload.enqueueChunk);
  rawEnqueueRef.current = rawUpload.enqueueChunk;
  const rawDrainRef = useRef(rawUpload.drain);
  rawDrainRef.current = rawUpload.drain;

  const rawSamplesRef = useRef<RawEegSample[]>([]);
  const rawChunkIndexRef = useRef(0);
  const rawChunkStartMsRef = useRef<number | null>(null);

  const flushRawChunk = useCallback(() => {
    const samples = rawSamplesRef.current;
    if (samples.length === 0 || !streamIdRef.current) return;
    const startMs = rawChunkStartMsRef.current ?? Date.now();
    const endMs = Date.now();
    const payload = encodeRawChunk(samples);
    void rawEnqueueRef
      .current({
        streamId: streamIdRef.current,
        chunkIndex: rawChunkIndexRef.current,
        startedAt: new Date(startMs).toISOString(),
        endedAt: new Date(endMs).toISOString(),
        payload,
      })
      .catch((err) => logger.warn('raw chunk 적재 실패', err));
    rawChunkIndexRef.current += 1;
    rawSamplesRef.current = [];
    rawChunkStartMsRef.current = null;
  }, []);

  const handleRawEegData = useCallback(
    (data: { fp1: number; fp2: number }[]) => {
      if (observationOnlyRef.current || !streamIdRef.current) return;
      if (rawChunkStartMsRef.current == null) rawChunkStartMsRef.current = Date.now();
      for (const s of data) {
        rawSamplesRef.current.push({ fp1: s.fp1, fp2: s.fp2 });
      }
      if (rawSamplesRef.current.length >= RAW_SAMPLES_PER_CHUNK) {
        flushRawChunk();
      }
    },
    [flushRawChunk],
  );

  const eegWaveformRef = useRef<BandEegWaveform>({ fp1: [], fp2: [] });
  const ppgWaveformRef = useRef<BandPpgWaveform>({ red: [], ir: [] });
  const spectrumRef = useRef<BandSpectrum | null>(null);
  const accRef = useRef<BandAccSnapshot>(INITIAL_ACC);
  const playgroundDirtyRef = useRef(false);

  const sqLevel = signalQualityLevel(
    signalQuality == null ? null : toApiSignalQuality(signalQuality),
  );
  const deviceStatus = deviceStatusFromLeadOff(
    connectionState === 'connected',
    leadOff,
  );

  const refreshPendingCount = useCallback(async () => {
    if (!sessionId) return;
    try {
      const pending = await listPendingFeatures(sessionId, participantIdRef.current);
      if (mountedRef.current) setPendingCount(pending.length);
    } catch (err) {
      logger.warn('pending 카운트 조회 실패', err);
    }
  }, [sessionId]);

  const pushChartPoint = useCallback((relaxation: number) => {
    setChartPoints((prev) => {
      const next = [...prev, { t: Date.now(), relaxation }];
      return next.length > CHART_MAX_POINTS ? next.slice(-CHART_MAX_POINTS) : next;
    });
  }, []);

  /** 큐 항목 1건 WS emit — 성공해도 ACK 전까지 삭제하지 않음 */
  const emitQueuedItem = useCallback(
    (item: QueuedFeatureItem): boolean => {
      const socket = getSessionLiveSocket(skipAuth ? null : tokenStorage.getAccess());
      if (!wsConnectedRef.current || !socket.connected) return false;
      return emitSessionLiveFeature(socket, {
        session_id: item.sessionId,
        participant_id: item.participantId,
        stream_id: item.streamId,
        sequence: item.sequence,
        feature: item.feature,
        band_battery: item.bandBattery,
        device_status: item.deviceStatus,
        lead_off: item.leadOff,
        signal_quality: item.signalQuality,
        signal_quality_level: signalQualityLevel(item.signalQuality),
      });
    },
    [skipAuth],
  );

  /** 미확정 큐 REST 배치 flush (재연결·주기 flush).
   *
   * SDD-108 이후 게스트도 feature_ack를 직접 수신하므로 WS 정상 연결 시에는
   * 1초 실시간 emit + ack로 큐가 drain된다. REST 배치는 WS 미연결(오프라인 폴백)
   * 시에만 주기 flush하여 이중 전송을 막는다(타이머 호출부 가드 참조).
   */
  const retransmitPending = useCallback(async (): Promise<void> => {
    // SDD-112: in-flight 가드 — 5초 타이머·재연결 중복 호출이 동시 재전송하지 않게 한다.
    if (!sessionId || drainingRef.current || retransmitInFlightRef.current) return;
    retransmitInFlightRef.current = true;
    try {
      const pending = await listPendingFeatures(sessionId, participantIdRef.current);
      if (mountedRef.current) setPendingCount(pending.length);
      if (pending.length === 0) return;

      // SDD-112: 배치 상한 — 거대 큐를 한 번에 보내지 않고 5초 주기로 나눠 drain한다.
      const chunk = pending.slice(0, RETRANSMIT_BATCH_MAX);
      const batch = chunk.map((p) => p.feature);
      if (!wsConnectedRef.current) setUploadStatus('delayed');
      await postSessionFeatures(
        sessionId,
        {
          participant_id: participantIdRef.current,
          features: batch,
        },
        { skipAuth },
      );
      for (const item of chunk) {
        await removeAckedFeature(
          {
            stream_id: item.streamId,
            sequence: item.sequence,
            second_offset: item.feature.second_offset,
            feature: item.feature,
          },
          sessionId,
        );
      }
      await refreshPendingCount();
      if (mountedRef.current) setUploadStatus('streaming');
    } catch (err) {
      logger.error('미확정 큐 재전송/REST 실패', err);
      if (mountedRef.current) {
        setUploadStatus('failed');
        setError(err instanceof Error ? err.message : 'EEG feature 업로드 실패');
      }
    } finally {
      retransmitInFlightRef.current = false;
    }
  }, [refreshPendingCount, sessionId, skipAuth]);

  /** 종료 시 새 수집 중단 + 큐 drain */
  const drainPendingQueue = useCallback(async (): Promise<void> => {
    if (!sessionId) return;
    drainingRef.current = true;
    collectingRef.current = false;
    const started = Date.now();
    try {
      while (Date.now() - started < DRAIN_MAX_MS) {
        const pending = await listPendingFeatures(sessionId, participantIdRef.current);
        if (mountedRef.current) setPendingCount(pending.length);
        if (pending.length === 0) break;

        // WS ACK는 게스트에게 오지 않으므로(호스트 룸 전용 브로드캐스트) REST로만 drain한다.
        try {
          await postSessionFeatures(
            sessionId,
            {
              participant_id: participantIdRef.current,
              features: pending.map((p) => p.feature),
            },
            { skipAuth },
          );
          for (const item of pending) {
            await removeAckedFeature(
              {
                stream_id: item.streamId,
                sequence: item.sequence,
                second_offset: item.feature.second_offset,
                feature: item.feature,
              },
              sessionId,
            );
          }
        } catch (err) {
          logger.error('drain REST 실패', err);
          await new Promise((r) => setTimeout(r, DRAIN_POLL_MS));
        }
      }
    } finally {
      drainingRef.current = false;
      await refreshPendingCount();
    }
  }, [refreshPendingCount, sessionId, skipAuth]);

  const handleFeatureAck = useCallback(
    async (ack: SessionLiveFeatureAck): Promise<void> => {
      if (ack.session_id && ack.session_id !== sessionId) return;
      // SDD-128(②-22): 실패 ACK(saved=0)는 큐에서 제거하지 않아 REST 폴백이 재시도하게 한다.
      if (ack.saved === 0) return;
      try {
        const removed = await removeAckedFeature(
          {
            stream_id: ack.stream_id,
            sequence: ack.sequence,
            second_offset: ack.second_offset,
            feature: ack.feature,
          },
          sessionId,
        );
        if (removed) {
          await refreshPendingCount();
          if (mountedRef.current) setUploadStatus('streaming');
        }
      } catch (err) {
        logger.warn('ACK 처리 실패', err);
      }
    },
    [refreshPendingCount, sessionId],
  );

  const ingestMetrics = useCallback(
    (metrics: EEGAnalysisMetrics, powers: BandPowers | null, sqi: number | null) => {
      if (!collectingRef.current || drainingRef.current) {
        return;
      }

      const observation = observationOnlyRef.current;
      if (!observation && (!cursorReadyRef.current || !sessionId || !streamIdRef.current)) {
        return;
      }

      const nowIso = new Date(metrics.timestamp || Date.now()).toISOString();
      const contactStatus = deviceStatusFromLeadOff(true, leadOffRef.current);
      const signal01 = sqi == null ? null : toApiSignalQuality(sqi);

      if (!observation && sessionId && streamIdRef.current && cursorReadyRef.current) {
        // SDD-113: 세션 경과시간 기반 window_index — remount 시 0으로 재시작해
        // 이전 구간과 window_index가 충돌(서버 멱등 폐기)하던 것을 방지.
        if (baseOffsetRef.current == null) {
          const key = eegOffsetBaseKey(sessionId, participantIdRef.current);
          const stored = Number(localStorage.getItem(key));
          const base = Number.isFinite(stored) && stored > 0 ? stored : Date.now();
          localStorage.setItem(key, String(base));
          baseOffsetRef.current = base;
        }
        const elapsedOffset = Math.max(0, Math.floor((Date.now() - baseOffsetRef.current) / 1000));
        const offset = Math.max(elapsedOffset, secondOffsetRef.current);
        secondOffsetRef.current = offset + 1;
        const feature = metricsToFeature(metrics, offset, powers, sqi, batteryRef.current);

        // 전송 전 IndexedDB 큐 적재 (emit 성공 ≠ 저장 성공)
        void (async () => {
          try {
            const item = await enqueueFeature({
              sessionId,
              participantId: participantIdRef.current,
              streamId: streamIdRef.current,
              sequence: offset,
              feature,
              bandBattery: batteryRef.current,
              deviceStatus: contactStatus,
              leadOff: leadOffRef.current,
              signalQuality: signal01,
              createdAt: Date.now(),
            });
            if (mountedRef.current) {
              setPendingCount((c) => c + 1);
              setUploadStatus('streaming');
            }
            if (wsConnectedRef.current) {
              emitQueuedItem(item);
            }
          } catch (err) {
            logger.error('영속 큐 적재 실패', err);
            if (mountedRef.current) {
              setUploadStatus('failed');
              setError(err instanceof Error ? err.message : 'EEG 큐 저장 실패');
            }
          }
        })();
      }

      if (!mountedRef.current) return;
      // raw indices 저장 후, 표준 모델 정규화(scored)로 화면 표시용 지표를 갱신한다.
      const raw = {
        focusIndex: metrics.focusIndex,
        relaxationIndex: metrics.relaxationIndex,
        stressIndex: metrics.stressIndex,
        cognitiveLoad: metrics.cognitiveLoad,
        emotionalStability: metrics.emotionalStability,
        hemisphericBalance: metrics.hemisphericBalance,
        totalNeuralActivity: metrics.totalPower,
      };
      setRawIndices(raw);
      const scored = toScoredIndices(raw);
      setCurrentEfficiency(scored.relaxationIndex);
      setFocusIndex(scored.focusIndex);
      setStressIndex(scored.stressIndex);
      // 몸 지표 — AnalysisMetricsService 싱글톤에서 null 보존 읽기
      const body = AnalysisMetricsService.getInstance();
      setHeartRate(body.getCurrentHeartRate());
      setRespiratoryRate(body.getCurrentRespiratoryRate());
      setSdnn(body.getCurrentSDNN());
      setRmssd(body.getCurrentRMSSD());
      setSignalQuality(sqi);
      signalQualityRef.current = sqi;
      setLastEegAt(nowIso);
      if (powers) {
        setBandPowers(powers);
        bandPowersRef.current = powers;
      }
      setSensors(sensorFromLeadOff(leadOffRef.current, true));
      // 차트도 표시 지표와 동일한 정규화 점수(0~100)로 축적한다 (raw 비율 혼용 금지)
      pushChartPoint(scored.relaxationIndex);
    },
    [emitQueuedItem, pushChartPoint, sessionId],
  );

  const stopMock = useCallback(() => {
    if (mockTimerRef.current) {
      clearInterval(mockTimerRef.current);
      mockTimerRef.current = null;
    }
  }, []);

  const applyMockWaveforms = useCallback(() => {
    const now = Date.now();
    const eegRaw = mockDataGenerator.generateEEGRaw(250);
    const nextEeg: BandEegWaveform = {
      fp1: trimWaveform(
        [
          ...eegWaveformRef.current.fp1,
          ...eegRaw.map((p) => ({ timestamp: p.timestamp, value: p.fp1 })),
        ],
        EEG_WAVEFORM_MAX,
      ),
      fp2: trimWaveform(
        [
          ...eegWaveformRef.current.fp2,
          ...eegRaw.map((p) => ({ timestamp: p.timestamp, value: p.fp2 })),
        ],
        EEG_WAVEFORM_MAX,
      ),
    };
    eegWaveformRef.current = nextEeg;

    const ppgRaw = mockDataGenerator.generatePPGRaw(50);
    const nextPpg: BandPpgWaveform = {
      red: trimNumbers(
        [...ppgWaveformRef.current.red, ...ppgRaw.map((p) => p.red)],
        PPG_WAVEFORM_MAX,
      ),
      ir: trimNumbers(
        [...ppgWaveformRef.current.ir, ...ppgRaw.map((p) => p.ir)],
        PPG_WAVEFORM_MAX,
      ),
    };
    ppgWaveformRef.current = nextPpg;

    const freqs = Array.from({ length: 64 }, (_, i) => i * 0.5 + 0.5);
    const ch1 = freqs.map((f) => 20 + Math.sin(f) * 8 + Math.random() * 5);
    const ch2 = freqs.map((f) => 18 + Math.cos(f) * 8 + Math.random() * 5);
    const domIdx = ch1.indexOf(Math.max(...ch1));
    spectrumRef.current = {
      frequencies: freqs,
      ch1Power: ch1,
      ch2Power: ch2,
      dominantFrequency: freqs[domIdx] ?? 10,
    };

    const accRaw = mockDataGenerator.generateACCRaw(30);
    const accMetrics = mockDataGenerator.generateACCAnalysis();
    const magPoints: WaveformPoint[] = accRaw.map((p) => ({
      timestamp: p.timestamp,
      value: p.magnitude,
    }));
    const mergedMag = trimWaveform(
      [...accRef.current.magnitudeWaveform, ...magPoints],
      ACC_WAVEFORM_MAX,
    );
    accRef.current = {
      magnitude: mergedMag.map((p) => p.value),
      magnitudeWaveform: mergedMag,
      movement: accMetrics.avgMovement,
      intensity: accMetrics.intensity,
      activityType: accMetrics.activityState,
      tiltAngle: 0,
      stability: accMetrics.stability,
      avgMovement: accMetrics.avgMovement,
      maxMovement: accMetrics.maxMovement,
    };
    playgroundDirtyRef.current = true;
    void now;
  }, []);

  const startMock = useCallback(() => {
    stopMock();
    collectingRef.current = true;
    if (observationOnlyRef.current) {
      cursorReadyRef.current = true;
      streamIdRef.current = streamIdRef.current || 'playground-mock';
    }
    mockTimerRef.current = setInterval(() => {
      const analysis = mockDataGenerator.generateEEGAnalysis();
      const ppgAnalysis = mockDataGenerator.generatePPGAnalysis();
      const powers: BandPowers = {
        delta: 20 + Math.random() * 10,
        theta: 15 + Math.random() * 10,
        alpha: 25 + Math.random() * 15,
        beta: 20 + Math.random() * 10,
        gamma: 10 + Math.random() * 5,
      };
      const sqi = 80 + Math.random() * 20;
      // mock: 접촉 정상
      leadOffRef.current = { ch1: false, ch2: false };
      if (mountedRef.current) setLeadOff({ ch1: false, ch2: false });
      applyMockWaveforms();
      ingestMetrics(analysis, powers, sqi);
      // mock PPG 몸 지표 — AnalysisMetricsService 버퍼가 비어 있을 때 직접 승격
      if (mountedRef.current) {
        setHeartRate(ppgAnalysis.bpm);
        setSdnn(ppgAnalysis.sdnn);
        setRmssd(ppgAnalysis.rmssd);
        setRespiratoryRate(12 + Math.random() * 6);
      }
      setBattery((prev) => {
        const next = prev === null ? 85 : Math.max(5, prev - 0.01);
        batteryRef.current = next;
        return next;
      });
    }, MOCK_TICK_MS);
  }, [applyMockWaveforms, ingestMetrics, stopMock]);

  const clearBuffers = useCallback(() => {
    eegWaveformRef.current = { fp1: [], fp2: [] };
    ppgWaveformRef.current = { red: [], ir: [] };
    spectrumRef.current = null;
    accRef.current = INITIAL_ACC;
    setEegWaveform({ fp1: [], fp2: [] });
    setPpgWaveform({ red: [], ir: [] });
    setSpectrum(null);
    setAcc(INITIAL_ACC);
    streamRef.current?.clearBuffers();
  }, []);

  const getEegWaveformSamples = useCallback(
    () => ({
      fp1: eegWaveformRef.current.fp1.map((p) => p.value),
      fp2: eegWaveformRef.current.fp2.map((p) => p.value),
    }),
    [],
  );

  const getPpgWaveformSamples = useCallback(() => ({ ...ppgWaveformRef.current }), []);

  const getAccWaveformSamples = useCallback(() => accRef.current.magnitude, []);

  const handleStoreUpdate = useCallback((action: string, ...args: unknown[]) => {
    if (action === 'updateEEGGraphData') {
      const fp1 = (args[0] as WaveformPoint[] | undefined) ?? [];
      const fp2 = (args[1] as WaveformPoint[] | undefined) ?? [];
      eegWaveformRef.current = {
        fp1: trimWaveform([...eegWaveformRef.current.fp1, ...fp1], EEG_WAVEFORM_MAX),
        fp2: trimWaveform([...eegWaveformRef.current.fp2, ...fp2], EEG_WAVEFORM_MAX),
      };
      playgroundDirtyRef.current = true;
      return;
    }
    if (action === 'updatePPGGraphData') {
      const red = ((args[0] as WaveformPoint[] | undefined) ?? []).map((p) => p.value);
      const ir = ((args[1] as WaveformPoint[] | undefined) ?? []).map((p) => p.value);
      ppgWaveformRef.current = {
        red: trimNumbers([...ppgWaveformRef.current.red, ...red], PPG_WAVEFORM_MAX),
        ir: trimNumbers([...ppgWaveformRef.current.ir, ...ir], PPG_WAVEFORM_MAX),
      };
      playgroundDirtyRef.current = true;
      return;
    }
    if (action === 'updateEEGAnalysis') {
      const payload = args[0] as {
        frequencySpectrum?: BandSpectrum | null;
        indices?: Partial<BandRawIndices> | null;
        bandPowers?: BandPowers | null;
      };
      if (payload?.frequencySpectrum) {
        spectrumRef.current = payload.frequencySpectrum;
        playgroundDirtyRef.current = true;
      }
      if (payload?.bandPowers) {
        bandPowersRef.current = payload.bandPowers;
        if (mountedRef.current) setBandPowers(payload.bandPowers);
      }
      if (payload?.indices && mountedRef.current) {
        const raw: BandRawIndices = {
          focusIndex: Number(payload.indices.focusIndex ?? 0),
          relaxationIndex: Number(payload.indices.relaxationIndex ?? 0),
          stressIndex: Number(payload.indices.stressIndex ?? 0),
          cognitiveLoad: Number(payload.indices.cognitiveLoad ?? 0),
          emotionalStability: Number(payload.indices.emotionalStability ?? 0),
          hemisphericBalance: Number(payload.indices.hemisphericBalance ?? 0),
          totalNeuralActivity: Number(payload.indices.totalNeuralActivity ?? 0),
        };
        setRawIndices(raw);
        const scored = toScoredIndices(raw);
        setCurrentEfficiency(scored.relaxationIndex);
        setFocusIndex(scored.focusIndex);
        setStressIndex(scored.stressIndex);
      }
      return;
    }
    if (action === 'updateACCAnalysis') {
      const payload = args[0] as {
        magnitude?: WaveformPoint[];
        indices?: {
          activity?: number;
          stability?: number;
          intensity?: number;
          activityState?: string;
          avgMovement?: number;
          maxMovement?: number;
        };
      };
      const mag = payload?.magnitude ?? [];
      const merged = trimWaveform(
        [...accRef.current.magnitudeWaveform, ...mag],
        ACC_WAVEFORM_MAX,
      );
      const idx = payload?.indices;
      accRef.current = {
        magnitude: merged.map((p) => p.value),
        magnitudeWaveform: merged,
        movement: idx?.avgMovement ?? accRef.current.movement,
        intensity: idx?.intensity ?? accRef.current.intensity,
        activityType: idx?.activityState ?? accRef.current.activityType,
        tiltAngle: 0,
        stability: idx?.stability ?? accRef.current.stability,
        avgMovement: idx?.avgMovement ?? accRef.current.avgMovement,
        maxMovement: idx?.maxMovement ?? accRef.current.maxMovement,
      };
      playgroundDirtyRef.current = true;
    }
  }, []);

  const disconnect = useCallback(async () => {
    // 새 수집 중단 후 기존 큐 drain
    collectingRef.current = false;
    stopMock();
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    // 자동 재연결 타이머 정리 (SDD-120 후속)
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    // 수동 해제 시 자동 재연결 중단 — 예기치 않은 끊김(gattserverdisconnected)만 자동 재연결한다.
    autoReconnectRef.current = false;
    connectedAtRef.current = null;

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

    if (!observationOnlyRef.current) {
      flushRawChunk();
      await drainPendingQueue();
      await rawDrainRef.current(15_000);
    }

    if (mountedRef.current) {
      setConnectionState(isSupported ? 'disconnected' : 'unsupported');
      setUploadStatus('idle');
      setConnectedElapsedSec(0);
      setSensors(INITIAL_SENSORS);
    }
  }, [drainPendingQueue, isSupported, stopMock]);

  const markConnected = useCallback(() => {
    connectedAtRef.current = Date.now();
    setConnectedElapsedSec(0);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = setInterval(() => {
      if (!connectedAtRef.current || !mountedRef.current) return;
      setConnectedElapsedSec(Math.floor((Date.now() - connectedAtRef.current) / 1000));
    }, 1000);
  }, []);

  const connect = useCallback(async () => {
    // BLE 연결 자체는 세션/참가자 정보와 무관하게 가능해야 한다.
    // (participantId가 아직 없어도 웹블루투스 다이얼로그는 떠야 함)
    if (!isSupported) {
      setConnectionState('unsupported');
      setError('이 브라우저는 Web Bluetooth를 지원하지 않습니다. Chrome/Edge를 사용해 주세요.');
      return;
    }

    // FE-BAND-001: 동시 connect 차단 — 중복 인스턴스가 각자 스트림을 시작하는 것을 막는다.
    // (싱글톤 BLE 연결에 다중 StreamProcessor/큐가 붙으면 업로드가 이중화된다.)
    if (bandConnectInFlight) {
      logger.warn('중복 connect 무시 — 연결 시도가 이미 진행 중입니다');
      return;
    }
    bandConnectInFlight = true;

    setError(null);
    // 연결 시도 시 자동 재연결 재활성화 (수동 해제로 꺼진 플래그 복원)
    autoReconnectRef.current = true;
    setConnectionState('connecting');

    try {
      // Web Bluetooth requestDevice는 사용자 제스처(클릭) 내에서 즉시 호출해야 하므로
      // 디바이스 선택(scan)을 맨 앞에서 수행해 다이얼로그가 정상적으로 뜨도록 한다.
      let selectedDeviceId: string | null = null;
      // 전역(singleton) BLE 연결이 이미 살아있으면 scan/connect를 건너뛰고 스트림만 재시작한다.
      const alreadyConnected = !isMock && bluetoothService.isConnected();
      if (!isMock && !alreadyConnected) {
        // 재연결(SDD-120): 예기치 않은 끊김 후 캐시된 디바이스가 있으면
        // 재선택 다이얼로그(requestDevice)를 건너뛰고 같은 디바이스로 재연결한다.
        const cachedId = bluetoothService.getCachedDeviceId();
        if (cachedId) {
          selectedDeviceId = cachedId;
        } else {
          const devices = await bluetoothService.scan();
          if (devices.length === 0) {
            throw new Error('LINK BAND 디바이스를 찾지 못했습니다');
          }
          selectedDeviceId = devices[0].id;
        }
      }

      if (observationOnly) {
        streamIdRef.current = 'playground-observation';
        secondOffsetRef.current = 0;
        cursorReadyRef.current = true;
      } else {
        // 확정 cursor 복구 — offset 0 재시작 금지
        const cursor = await loadStreamCursor(sessionId, participantId);
        streamIdRef.current = cursor.streamId;
        secondOffsetRef.current = cursor.nextSequence;
        cursorReadyRef.current = true;
        await refreshPendingCount();

        // REST 폴백 플러시 타이머 (미확정 큐 재전송)
        if (flushTimerRef.current) clearInterval(flushTimerRef.current);
        flushTimerRef.current = setInterval(() => {
          // SDD-128(②-22): WS 정상 연결 시 REST 주기 flush 중지(이중 전송 제거).
          // 오프라인 폴백은 재연결 시 직접 retransmitPending이 처리한다.
          if (!wsConnectedRef.current) void retransmitPending();
        }, FEATURE_FLUSH_MS);
      }

      if (isMock) {
        setConnectionState('connected');
        setBattery(88);
        batteryRef.current = 88;
        leadOffRef.current = { ch1: false, ch2: false };
        setLeadOff({ ch1: false, ch2: false });
        setSensors(sensorFromLeadOff({ ch1: false, ch2: false }, true));
        setUploadStatus(observationOnly ? 'idle' : 'streaming');
        markConnected();
        startMock();
        return;
      }

      bluetoothService.setCallbacks({
        onSensorContactChanged: (ch1, ch2) => {
          const next: LeadOffStatus = { ch1, ch2 };
          leadOffRef.current = next;
          if (mountedRef.current) {
            setLeadOff(next);
            setSensors(sensorFromLeadOff(next, true));
          }
        },
      });

      const analysis = AnalysisMetricsService.getInstance();
      analysis.setCallbacks({
        onMetricsUpdate: (action, data) => {
          if (action !== 'eeg') return;
          const metrics = data as EEGAnalysisMetrics;
          const latest = analysis.getLatestEegFeature();
          // SQI null을 0(ok 경계)으로 승격하지 않음
          const sqi = latest?.signalQuality ?? signalQualityRef.current ?? null;
          ingestMetrics(metrics, latest?.bandPowers ?? bandPowersRef.current, sqi);
        },
      });

      const stream = new StreamProcessor();
      streamRef.current = stream;
      stream.setBluetoothService(bluetoothService);
      stream.setCallbacks({
        onError: (err) => {
          if (mountedRef.current) setError(err.message);
        },
        onStoreUpdate: handleStoreUpdate,
        onEEGData: handleRawEegData,
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

      if (!alreadyConnected) {
        await bluetoothService.connect(selectedDeviceId!);
      }

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
          collectingRef.current = false;
          setError('LINK BAND 연결이 끊어졌습니다 — 자동 재연결 시도 중');
          setSensors(INITIAL_SENSORS);
        }
        // 예기치 않은 끊김에도 raw/feature 데이터 보존 (SDD-120):
        // in-memory raw 버퍼 flush + pending 큐 drain — 재연결/재접속 시 재전송된다.
        if (!observationOnlyRef.current) {
          flushRawChunk();
          void drainPendingQueue();
          void rawDrainRef.current(15_000);
        }
        // SDD-120 후속: 자동 재연결 — 캐시된 디바이스로 재선택 다이얼로그 없이 gatt.connect() 재호출.
        if (autoReconnectRef.current && mountedRef.current) {
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = setTimeout(() => {
            void connect();
          }, 1500);
        }
      });

      collectingRef.current = true;
      setConnectionState('connected');
      setUploadStatus(observationOnly ? 'idle' : 'streaming');
      markConnected();
    } catch (err) {
      logger.error('연결 실패', err);
      await disconnect();
      if (mountedRef.current) {
        setConnectionState('error');
        setError(err instanceof Error ? err.message : 'LINK BAND 연결 실패');
      }
    } finally {
      // FE-BAND-001: 성공/실패와 무관하게 in-flight 가드를 해제한다.
      bandConnectInFlight = false;
    }
  }, [
    disconnect,
    enabled,
    handleStoreUpdate,
    ingestMetrics,
    isMock,
    isSupported,
    markConnected,
    observationOnly,
    participantId,
    refreshPendingCount,
    retransmitPending,
    sessionId,
    startMock,
  ]);

  // 표시용 정규화에 쓸 활성 표준 모델을 1회 로드한다 (playground 외 화면도 표준모델 적용).
  // 실패 시 코호트(B0) fallback — scoreIndices 내부에서 처리된다.
  useEffect(() => {
    void refreshActiveModel();
  }, []);

  // mount 시 전역(singleton) BLE 연결이 이미 살아있으면 스트림을 재시작한다.
  // (waiting→meditation 전환 시 컴포넌트 remount로 StreamProcessor가 새로 생성되므로)
  const connectRef = useRef(connect);
  connectRef.current = connect;
  useEffect(() => {
    if (bluetoothService.isConnected() && !isMock) {
      void connectRef.current();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `/session-live` 연결 + join + ACK/본인 eeg_feature 구독
  useEffect(() => {
    if (observationOnly || !enabled || !sessionId) {
      wsConnectedRef.current = false;
      setIsWsConnected(false);
      return undefined;
    }

    const token = skipAuth ? null : tokenStorage.getAccess();
    const socket = getSessionLiveSocket(token);

    const onConnect = (): void => {
      wsConnectedRef.current = true;
      if (mountedRef.current) setIsWsConnected(true);
      joinSessionLive(socket, sessionId, participantIdRef.current);
      // 재연결: 큐 폐기 금지 → 재전송
      void retransmitPending();
    };

    const onDisconnect = (): void => {
      // 단절 시 큐 유지
      wsConnectedRef.current = false;
      if (mountedRef.current) setIsWsConnected(false);
    };

    const onAck = (ack: SessionLiveFeatureAck): void => {
      void handleFeatureAck(ack);
    };

    const onEegFeature = (event: SessionLiveEegFeatureEvent): void => {
      const selfId = participantIdRef.current;
      if (!selfId || event.participant_id !== selfId) return;

      // saved=0 은 저장 실패 — ACK로 취급하지 않음
      if (event.saved !== 0) {
        if (event.stream_id != null && typeof event.sequence === 'number') {
          void handleFeatureAck({
            session_id: event.session_id,
            stream_id: event.stream_id,
            sequence: event.sequence,
            participant_id: event.participant_id,
            second_offset: event.feature?.second_offset ?? event.sequence,
            feature: event.feature,
            saved: event.saved,
          });
        } else if (
          streamIdRef.current &&
          typeof event.feature?.second_offset === 'number'
        ) {
          // 구 BE 호환: stream_id 없이도 second_offset으로 soft ACK
          void handleFeatureAck({
            session_id: event.session_id,
            stream_id: streamIdRef.current,
            sequence: event.feature.second_offset,
            participant_id: event.participant_id,
            second_offset: event.feature.second_offset,
            feature: event.feature,
            saved: event.saved,
          });
        }
      }

      if (!mountedRef.current) return;

      // 로컬 밴드 수집 중에는 echo(과거 재전송분 포함)로 표시 상태를 덮어쓰지 않는다.
      // ingestMetrics가 매초 정규화 점수와 신선한 lastEegAt을 이미 갱신하고 있으며,
      // echo의 raw 값(비율 0~1)이 scored 값(0~100)을 덮으면 0% 깜빡임이 생긴다.
      if (collectingRef.current) return;

      const efficiency = efficiencyFromEvent(event);
      if (efficiency !== null) {
        // feature 계약은 raw 비율 — 표시 전 표준모델/코호트 정규화(0~100)
        const scored = scoreIndices({ relaxationIndex: efficiency }).relaxationIndex;
        setCurrentEfficiency(scored);
        pushChartPoint(scored);
      }
      const focus = event.focus_index ?? event.feature?.focus_index;
      if (typeof focus === 'number') {
        setFocusIndex(scoreIndices({ focusIndex: focus }).focusIndex);
      }
      const stress = event.stress_index ?? event.feature?.stress_index;
      if (typeof stress === 'number') {
        setStressIndex(scoreIndices({ stressIndex: stress }).stressIndex);
      }
      const sq = event.signal_quality ?? event.feature?.signal_quality;
      const sq01 = normalizeSignalQuality01(sq);
      if (sq01 != null) {
        const sqi = sq01 * 100;
        setSignalQuality(sqi);
        signalQualityRef.current = sqi;
      }
      if (event.lead_off) {
        leadOffRef.current = event.lead_off;
        setLeadOff(event.lead_off);
      }
      if (typeof event.band_battery === 'number') {
        setBattery(event.band_battery);
        batteryRef.current = event.band_battery;
      }
      if (event.last_eeg_at) {
        // 과거 feature 재전송 echo가 lastEegAt을 되돌리면 false stale이 발생 — 최신만 반영
        const nextAt = event.last_eeg_at;
        setLastEegAt((prev) => {
          const prevMs = prev ? new Date(prev).getTime() : 0;
          const nextMs = new Date(nextAt).getTime();
          return Number.isFinite(nextMs) && nextMs > prevMs ? nextAt : prev;
        });
      }
      if (event.upload_status) setUploadStatus(event.upload_status);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    const unsubAck = subscribeSessionLiveFeatureAck(socket, onAck);
    const unsubscribe = subscribeSessionLiveEegFeature(socket, onEegFeature);

    if (socket.connected) {
      onConnect();
    }

    return () => {
      // room leave 는 useSessionLiveSocket(UI)가 담당 — 싱글톤 공유 시 조기 leave 방지
      unsubAck();
      unsubscribe();
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      wsConnectedRef.current = false;
      if (mountedRef.current) setIsWsConnected(false);
    };
  }, [enabled, observationOnly, sessionId, skipAuth, pushChartPoint, retransmitPending, handleFeatureAck]);

  // playground 고빈도 파형 → React state 스로틀 플러시
  useEffect(() => {
    playgroundFlushRef.current = setInterval(() => {
      if (!playgroundDirtyRef.current || !mountedRef.current) return;
      playgroundDirtyRef.current = false;
      setEegWaveform({
        fp1: eegWaveformRef.current.fp1,
        fp2: eegWaveformRef.current.fp2,
      });
      setPpgWaveform({ ...ppgWaveformRef.current });
      setSpectrum(spectrumRef.current);
      setAcc({ ...accRef.current });
    }, PLAYGROUND_FLUSH_MS);
    return () => {
      if (playgroundFlushRef.current) {
        clearInterval(playgroundFlushRef.current);
        playgroundFlushRef.current = null;
      }
    };
  }, []);

  // 훅 마운트 시 커서만 선행 로드 (연결 전 새로고침 복구)
  useEffect(() => {
    if (observationOnly || !enabled || !sessionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const cursor = await loadStreamCursor(sessionId, participantId);
        if (cancelled) return;
        streamIdRef.current = cursor.streamId;
        secondOffsetRef.current = cursor.nextSequence;
        cursorReadyRef.current = true;
        await refreshPendingCount();
      } catch (err) {
        logger.warn('커서 복구 실패', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, observationOnly, sessionId, participantId, refreshPendingCount]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      collectingRef.current = false;
      stopMock();
      if (flushTimerRef.current) {
        clearInterval(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.cleanup();
        streamRef.current = null;
      }
      // BLE 연결은 전역(singleton)으로 유지한다 — waiting→meditation 전환 시
      // 컴포넌트 unmount/remount로 연결이 끊기지 않도록 disconnect를 호출하지 않는다.
      // 명시적 종료(resetJoin)에서 bluetoothService.disconnect()로 정리한다.
    };
  }, [stopMock]);

  // 주의: enabled=false(participantId 미확정) 상태에서도 BLE 연결은 가능해야 한다.
  // 이전에는 여기서 `!enabled && connected → disconnect()`를 호출해, participantId가 null이면
  // 연결되자마자 곧바로 끊기는 문제를 일으켰다. 연결 해제는 컴포넌트 unmount 정리(위 useEffect)와
  // 명시적 연결해제 버튼으로만 수행한다.

  return {
    isSupported,
    isMock,
    connectionState,
    battery,
    signalQuality,
    signalQualityLevel: sqLevel,
    deviceStatus,
    leadOff,
    lastEegAt,
    currentEfficiency,
    focusIndex,
    stressIndex,
    heartRate,
    respiratoryRate,
    sdnn,
    rmssd,
    bandPowers,
    chartPoints,
    uploadStatus,
    isWsConnected,
    pendingCount,
    error,
    eegWaveform,
    spectrum,
    ppgWaveform,
    acc,
    rawIndices,
    scoredIndices: rawIndices ? toScoredIndices(rawIndices) : null,
    sensors,
    connectedElapsedSec,
    getEegWaveformSamples,
    getPpgWaveformSamples,
    getAccWaveformSamples,
    clearBuffers,
    connect,
    disconnect,
  };
}
