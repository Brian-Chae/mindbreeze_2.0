// SDD-209 T2b — 내 영상·소리 점검 훅(회원 FM06d · 상담사 FH05 공용).
// - 마이크/카메라 권한은 start* 를 부를 때만 요청한다(진입 즉시 자동 요청 없음 — 사용자 탭 안에서 호출).
// - AudioContext.resume() 도 같은 사용자 동작 안에서 호출한다(브라우저 자동재생 정책).
// - 레벨은 10Hz 로 갱신한다(SDD-130: 매 프레임 리렌더 방지). 최근 3초 피크로 `조용해요` 를 판정한다.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  MIC_QUIET_WINDOW_MS, classifyMediaError, classifyMicQuality, levelFromRms, peakInWindow, ringSteps, rmsFromTimeDomain,
  type LevelSample, type MediaDeviceUi,
} from '../lib/class/class-media';

const METER_INTERVAL_MS = 100;
const TEST_TONE_MS = 1200;
const TEST_TONE_HZ = 440;

export interface MediaCheck {
  mic: MediaDeviceUi;
  cam: MediaDeviceUi;
  /** 현재 레벨 0~1 */
  level: number;
  /** 5단계 링 채움(0~5) */
  steps: number;
  /** 최근 3초 피크가 임계 미만 */
  quiet: boolean;
  speakerPlaying: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  startMic: () => Promise<void>;
  stopMic: () => void;
  toggleMic: () => Promise<void>;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  toggleCamera: () => Promise<void>;
  /** 권한 변경 후 다시 확인 — 실패했던 장치만 다시 요청한다 */
  recheck: () => Promise<void>;
  playTestTone: () => Promise<void>;
}

function mediaSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function useMediaCheck(): MediaCheck {
  const supported = mediaSupported();
  const [mic, setMic] = useState<MediaDeviceUi>(supported ? 'off' : 'unsupported');
  const [cam, setCam] = useState<MediaDeviceUi>(supported ? 'off' : 'unsupported');
  const [level, setLevel] = useState(0);
  const [quiet, setQuiet] = useState(false);
  const [speakerPlaying, setSpeakerPlaying] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const micRequestRef = useRef(0);
  const camRequestRef = useRef(0);
  const meterCtxRef = useRef<AudioContext | null>(null);
  const meterTimerRef = useRef<number | null>(null);
  const toneCtxRef = useRef<AudioContext | null>(null);
  const toneTimerRef = useRef<number | null>(null);
  const aliveRef = useRef(true);

  const stopMeter = useCallback((): void => {
    if (meterTimerRef.current !== null) window.clearInterval(meterTimerRef.current);
    meterTimerRef.current = null;
    const ctx = meterCtxRef.current;
    meterCtxRef.current = null;
    if (ctx) void ctx.close().catch(() => undefined);
    setLevel(0);
    setQuiet(false);
  }, []);

  const startMeter = useCallback(async (stream: MediaStream): Promise<void> => {
    try {
      const ctx = new AudioContext();
      meterCtxRef.current = ctx;
      // 사용자 동작(탭) 안에서 호출되므로 suspended 상태를 풀 수 있다
      await ctx.resume();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const samples: LevelSample[] = [];
      meterTimerRef.current = window.setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        const next = levelFromRms(rmsFromTimeDomain(buf));
        const now = performance.now();
        samples.push({ t: now, level: next });
        while (samples.length > 0 && now - samples[0].t > MIC_QUIET_WINDOW_MS) samples.shift();
        setLevel(next);
        const peak = peakInWindow(samples, now);
        // 창이 아직 채워지기 전(첫 3초)에는 판정하지 않는다
        const filled = samples.length > 0 && now - samples[0].t >= MIC_QUIET_WINDOW_MS - METER_INTERVAL_MS * 2;
        setQuiet(filled && peak !== null && classifyMicQuality(peak) === 'quiet');
      }, METER_INTERVAL_MS);
    } catch {
      /* 레벨 미터 실패는 무시 — 마이크 상태 자체는 유지 */
    }
  }, []);

  const stopMic = useCallback((): void => {
    micRequestRef.current += 1;
    stopStream(micStreamRef.current);
    micStreamRef.current = null;
    stopMeter();
    setMic((prev) => (prev === 'unsupported' ? prev : 'off'));
  }, [stopMeter]);

  const startMic = useCallback(async (): Promise<void> => {
    if (!mediaSupported()) {
      setMic('unsupported');
      return;
    }
    stopStream(micStreamRef.current);
    micStreamRef.current = null;
    stopMeter();
    micRequestRef.current += 1;
    const requestId = micRequestRef.current;
    setMic('pending');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!aliveRef.current || requestId !== micRequestRef.current) {
        stopStream(stream);
        return;
      }
      micStreamRef.current = stream;
      setMic('on');
      await startMeter(stream);
    } catch (err) {
      if (!aliveRef.current || requestId !== micRequestRef.current) return;
      setMic(classifyMediaError(err));
    }
  }, [startMeter, stopMeter]);

  const stopCamera = useCallback((): void => {
    camRequestRef.current += 1;
    stopStream(camStreamRef.current);
    camStreamRef.current = null;
    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch {
        /* srcObject 미지원 환경 */
      }
    }
    setCam((prev) => (prev === 'unsupported' ? prev : 'off'));
  }, []);

  const startCamera = useCallback(async (): Promise<void> => {
    if (!mediaSupported()) {
      setCam('unsupported');
      return;
    }
    stopStream(camStreamRef.current);
    camStreamRef.current = null;
    camRequestRef.current += 1;
    const requestId = camRequestRef.current;
    setCam('pending');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (!aliveRef.current || requestId !== camRequestRef.current) {
        stopStream(stream);
        return;
      }
      camStreamRef.current = stream;
      if (videoRef.current) {
        try {
          videoRef.current.srcObject = stream;
        } catch {
          /* jsdom 등 srcObject 미지원 환경 — 상태만 on 으로 유지 */
        }
      }
      setCam('on');
    } catch (err) {
      if (!aliveRef.current || requestId !== camRequestRef.current) return;
      setCam(classifyMediaError(err));
    }
  }, []);

  const toggleMic = useCallback(async (): Promise<void> => {
    if (micStreamRef.current) stopMic();
    else await startMic();
  }, [startMic, stopMic]);

  const toggleCamera = useCallback(async (): Promise<void> => {
    if (camStreamRef.current) stopCamera();
    else await startCamera();
  }, [startCamera, stopCamera]);

  const recheck = useCallback(async (): Promise<void> => {
    const failed = (s: MediaDeviceUi): boolean => s === 'denied' || s === 'nodevice' || s === 'inuse';
    const tasks: Promise<void>[] = [];
    if (failed(mic)) tasks.push(startMic());
    if (failed(cam)) tasks.push(startCamera());
    await Promise.all(tasks);
  }, [cam, mic, startCamera, startMic]);

  const playTestTone = useCallback(async (): Promise<void> => {
    try {
      const ctx = toneCtxRef.current ?? new AudioContext();
      toneCtxRef.current = ctx;
      await ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = TEST_TONE_HZ;
      gain.gain.value = 0.15;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + TEST_TONE_MS / 1000);
      setSpeakerPlaying(true);
      if (toneTimerRef.current !== null) window.clearTimeout(toneTimerRef.current);
      toneTimerRef.current = window.setTimeout(() => {
        toneTimerRef.current = null;
        if (aliveRef.current) setSpeakerPlaying(false);
      }, TEST_TONE_MS);
    } catch {
      setSpeakerPlaying(false);
    }
  }, []);

  // 카메라 프리뷰 요소가 스트림보다 늦게 붙는 경우(상태 on 이후 렌더)를 위해 매 렌더 후 연결을 보정한다
  useEffect(() => {
    const video = videoRef.current;
    const stream = camStreamRef.current;
    if (!video || !stream || video.srcObject === stream) return;
    try {
      video.srcObject = stream;
    } catch {
      /* ignore */
    }
  });

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      micRequestRef.current += 1;
      camRequestRef.current += 1;
      stopStream(micStreamRef.current);
      stopStream(camStreamRef.current);
      micStreamRef.current = null;
      camStreamRef.current = null;
      if (meterTimerRef.current !== null) window.clearInterval(meterTimerRef.current);
      if (toneTimerRef.current !== null) window.clearTimeout(toneTimerRef.current);
      void meterCtxRef.current?.close().catch(() => undefined);
      void toneCtxRef.current?.close().catch(() => undefined);
      meterCtxRef.current = null;
      toneCtxRef.current = null;
    };
  }, []);

  return {
    mic, cam, level, steps: ringSteps(level), quiet, speakerPlaying, videoRef,
    startMic, stopMic, toggleMic, startCamera, stopCamera, toggleCamera, recheck, playTestTone,
  };
}
