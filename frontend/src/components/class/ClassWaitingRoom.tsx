// SDD-105: 설문·링크밴드·기기 준비를 한 대기실에서 유지한다.
// 입장 게이트는 이름 확인 + 3단계 준비 완료(각 단계 건너뛰기 포함)다.

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { WaitingRoomBandCheck } from './WaitingRoomBandCheck';
import { PreCheckinPanel } from './PreCheckinPanel';
import { EMPTY_CHECKIN_DRAFT, type CheckinDraft } from '../../lib/api/checkin';
import { WaitingRoomReminder } from './waiting-room-reminder';
import { LobbyBgmBar } from './LobbyBgmBar';
import { WaitingForStart } from './WaitingForStart';
import { useWaitingRoomPresence } from '../../hooks/useWaitingRoomPresence';
import { useLobbyBgm } from '../../hooks/useLobbyBgm';
import { useAuthStore } from '../../stores/authStore';
import type { WaitingRoomCheckin } from '../../lib/socket';
import {
  deviceStateLabel,
  isNicknameValid,
  mediaErrorMessage,
  normalizeNickname,
  readStoredNickname,
  resolveWaitingRoomGate,
  storeNickname,
  type WaitingRoomDeviceState,
} from '../../lib/class/class-waiting-room';

/** 입장 확정 값 — 라이브 뷰가 참고할 이름·기기 사용 여부 */
export interface ClassWaitingRoomEnterPayload {
  nickname: string;
  cameraOn: boolean;
  micOn: boolean;
}

export interface ClassWaitingRoomProps {
  sessionLive?: boolean;
  error?: string | null;
  title: string | null;
  classCode: string;
  statusLabel: string;
  sessionId: string;
  participantId: string | null;
  /** 로그인 회원 이름 — 있으면 닉네임 입력 없이 고정한다(게스트는 null) */
  memberName: string | null;
  /** 게스트가 참여 단계에서 입력한 이름(초기값) */
  initialNickname: string;
  /** 게스트 체크인 소유 증명 — participant_token(회원은 null) */
  participantToken: string | null;
  /** 로그인 회원 여부 — 체크인 인증 분기(회원 액세스 토큰 / 게스트 토큰) */
  isLoggedIn: boolean;
  /** [입장] 클릭 — 확정 값과 함께 라이브 뷰로 진입 */
  onEnter: (payload: ClassWaitingRoomEnterPayload) => void;
  /** [나가기] — 코드 입력 단계로 복귀 */
  onLeave: () => void;
}

export function ClassWaitingRoom({
  title,
  classCode,
  statusLabel,
  sessionId,
  participantId,
  memberName,
  initialNickname,
  participantToken,
  isLoggedIn,
  onEnter,
  onLeave,
  sessionLive = false,
  error = null,
}: ClassWaitingRoomProps): React.ReactElement {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isGuest = !isAuthenticated && !memberName;

  const mediaActiveRef = useRef(true);
  const cameraRequestRef = useRef(0);
  const micRequestRef = useRef(0);
  const autoEnteredRef = useRef(false);
  const [activeStep, setActiveStep] = useState(0);
  const [readiness, setReadiness] = useState({ surveyDone: false, bandDone: false, deviceDone: false });
  /** 대기 화면에서 [준비 다시 확인]으로 3단계 준비 화면에 돌아온 상태 */
  const [recheckingPrep, setRecheckingPrep] = useState(false);
  /** 설문 초안·밴드 스킵 — 대기 화면(WaitingForStart) 왕복에도 선택·입력 값을 유지한다 */
  const [surveyDraft, setSurveyDraft] = useState<CheckinDraft>(EMPTY_CHECKIN_DRAFT);
  const [bandSkipped, setBandSkipped] = useState(false);
  const completeSurvey = useCallback(() => {
    setReadiness((value) => ({ ...value, surveyDone: true }));
    setActiveStep(1);
  }, []);
  const completeBand = useCallback(() => {
    setReadiness((value) => ({ ...value, bandDone: true }));
    setActiveStep((current) => current === 1 ? 2 : current);
  }, []);
  const completeDevices = (): void => setReadiness((value) => ({ ...value, deviceDone: true }));

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const meterCtxRef = useRef<AudioContext | null>(null);
  const toneCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);
  const lastMeterSetRef = useRef(0);

  const mediaSupported = Boolean(
    typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia,
  );
  const speakerSupported =
    typeof window !== 'undefined' && typeof window.AudioContext === 'function';

  /** 게스트 닉네임 — 참여 단계 이름 또는 이전 대기실에서 확정한 값 */
  const [nickname, setNickname] = useState(() =>
    normalizeNickname(initialNickname || readStoredNickname() || ''),
  );
  const [cameraState, setCameraState] = useState<WaitingRoomDeviceState>('off');
  const [micState, setMicState] = useState<WaitingRoomDeviceState>(
    mediaSupported ? 'pending' : 'unsupported',
  );
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  /** 마이크 입력 레벨 0~1 (RMS) */
  const [micLevel, setMicLevel] = useState(0);
  /** 입장 전 체크인 요약 — 저장되면 대기실 WS 로 상담사 화면에 흘린다 */
  const [checkin, setCheckin] = useState<WaitingRoomCheckin | null>(null);

  // 상담사 대기 인원 표시용 참여 알림(입장·퇴장) — 라이브 뷰로 넘어가면 해제된다.
  // 체크인 요약을 실어 보내 상담사가 입장 전에 기분·전달 말을 실시간으로 본다.
  useWaitingRoomPresence({
    sessionId,
    participantId,
    nickname: memberName ?? (isNicknameValid(nickname) ? normalizeNickname(nickname) : null),
    checkin,
    readiness,
    enabled: Boolean(sessionId && participantId),
    skipAuth: !isAuthenticated,
  });

  // 대기실 BGM — 대기 중 플랫폼이 기본 트랙을 자동 재생(회원은 볼륨/음소거만 조절)
  const lobbyBgm = useLobbyBgm(true);

  const stopVideoStream = useCallback((): void => {
    cameraRequestRef.current += 1;
    videoStreamRef.current?.getTracks().forEach((track) => track.stop());
    videoStreamRef.current = null;
    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch {
        /* jsdom 등 srcObject 미지원 환경 무시 */
      }
    }
  }, []);

  const stopMeter = useCallback((): void => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    void meterCtxRef.current?.close().catch(() => undefined);
    meterCtxRef.current = null;
    setMicLevel(0);
  }, []);

  const stopAudioStream = useCallback((): void => {
    micRequestRef.current += 1;
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = null;
    stopMeter();
  }, [stopMeter]);

  /** 마이크 입력 레벨 — AnalyserNode RMS (실패해도 프리뷰를 막지 않는다) */
  const startMeter = useCallback((stream: MediaStream): void => {
    try {
      const ctx = new AudioContext();
      meterCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = (): void => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i += 1) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const level = Math.min(1, Math.sqrt(sum / buf.length) * 3);
        // SDD-130: setState를 10Hz로 하향 — 매 프레임(60fps) 전체 리렌더 방지
        const now = performance.now();
        if (now - lastMeterSetRef.current >= 100) {
          lastMeterSetRef.current = now;
          setMicLevel(level);
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      /* 레벨 미터 실패는 무시 — 미리보기 자체는 유지 */
    }
  }, []);

  /** 카메라 열기 — 오디오와 분리 요청해 부분 권한 거부를 개별 상태로 매핑 (선택·비강제) */
  const openCamera = useCallback(async (): Promise<void> => {
    stopVideoStream();
    const requestId = cameraRequestRef.current;
    setCameraState('pending');
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (!mediaActiveRef.current || requestId !== cameraRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      videoStreamRef.current = stream;
      if (videoRef.current) {
        try {
          videoRef.current.srcObject = stream;
        } catch {
          /* jsdom 등 srcObject 미지원 환경 — 상태만 on 으로 유지 */
        }
      }
      setCameraState('on');
    } catch (err) {
      if (!mediaActiveRef.current || requestId !== cameraRequestRef.current) return;
      setCameraState('denied');
      setCameraError(mediaErrorMessage(err, '카메라'));
    }
  }, [stopVideoStream]);

  /** 마이크 열기 — 비디오와 분리 요청 (필수 자동 확인) */
  const openMic = useCallback(async (): Promise<void> => {
    stopAudioStream();
    const requestId = micRequestRef.current;
    setMicState('pending');
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mediaActiveRef.current || requestId !== micRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      audioStreamRef.current = stream;
      setMicState('on');
      startMeter(stream);
    } catch (err) {
      if (!mediaActiveRef.current || requestId !== micRequestRef.current) return;
      setMicState('denied');
      setMicError(mediaErrorMessage(err, '마이크'));
    }
  }, [startMeter, stopAudioStream]);

  // 최초 마운트 시 마이크만 자동 확인한다 — 카메라는 선택(명상·상담은 오디오 중심)이므로
  // 불필요한 권한 요청을 피하고, 문제(거부·미탐지)가 있을 때만 안내한다.
  useEffect(() => {
    mediaActiveRef.current = true;
    const startId = window.setTimeout(() => {
      if (mediaSupported && mediaActiveRef.current) void openMic();
    }, 0);
    return () => {
      mediaActiveRef.current = false;
      window.clearTimeout(startId);
      stopAudioStream();
      stopVideoStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 1회
  }, [mediaSupported]);

  // 대기실을 벗어나면 테스트 톤 AudioContext 정리
  useEffect(() => {
    return () => {
      void toneCtxRef.current?.close().catch(() => undefined);
      toneCtxRef.current = null;
    };
  }, []);

  const toggleCamera = (): void => {
    if (cameraState === 'on') {
      stopVideoStream();
      setCameraState('off');
      return;
    }
    void openCamera();
  };

  const toggleMic = (): void => {
    if (micState === 'on') {
      stopAudioStream();
      setMicState('off');
      return;
    }
    void openMic();
  };

  /** 스피커 테스트 톤 — C5(523.25Hz) 0.9초, 부드러운 fade in/out (선택·비강제) */
  const playTestTone = useCallback(async (): Promise<void> => {
    try {
      if (!speakerSupported) return;
      const ctx = toneCtxRef.current ?? new AudioContext();
      toneCtxRef.current = ctx;
      if (ctx.state === 'suspended') await ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 1);
    } catch {
      /* 재생 실패는 입장을 막지 않는다 */
    }
  }, [speakerSupported]);

  const cameraOn = cameraState === 'on';
  const micOn = micState === 'on';

  /** 회원은 프로필 이름 고정 — 게스트만 입력한 이름을 확정한다 */
  const effectiveNickname = memberName ?? normalizeNickname(nickname);
  const gate = resolveWaitingRoomGate({ nickname: effectiveNickname, readiness });

  /** 시작 전에는 대기를 유지하고, 실제 라이브 전환에만 미리보기 자원을 정리한다. */
  const handleEnter = useCallback((): void => {
    if (!gate.canEnter) return;
    const finalNickname = normalizeNickname(effectiveNickname);
    storeNickname(finalNickname);
    if (sessionLive) {
      mediaActiveRef.current = false;
      stopVideoStream();
      stopAudioStream();
      void toneCtxRef.current?.close().catch(() => undefined);
      toneCtxRef.current = null;
    }
    onEnter({ nickname: finalNickname, cameraOn, micOn });
  }, [sessionLive, gate.canEnter, effectiveNickname, stopVideoStream, stopAudioStream, onEnter, cameraOn, micOn]);

  useEffect(() => {
    if (sessionLive && gate.canEnter && !autoEnteredRef.current) {
      autoEnteredRef.current = true;
      handleEnter();
    }
  }, [sessionLive, gate.canEnter, handleEnter]);

  useEffect(() => {
    if (videoRef.current && cameraOn) videoRef.current.srcObject = videoStreamRef.current;
  }, [cameraOn]);

  const nicknameDone = isNicknameValid(effectiveNickname);
  const micProblem = micState === 'denied' || micState === 'unsupported';

  // 3단계 준비를 모두 마쳤고 상담사가 아직 시작하지 않았다면 — 자연 배경 대기 화면으로 전환한다.
  // (상담사가 시작하면 아래 auto-enter effect가 meditation으로 바로 넘긴다.)
  const allReady = Object.values(readiness).every(Boolean);
  if (allReady && gate.canEnter && !sessionLive && !recheckingPrep) {
    return (
      <WaitingForStart
        title={title}
        statusLabel={statusLabel}
        onLeave={onLeave}
        onRecheck={() => {
          setRecheckingPrep(true);
          setActiveStep(0);
        }}
        lobbyBgm={lobbyBgm}
      />
    );
  }

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[#12081C] text-[#F7F4F0]" style={{ backgroundImage: 'radial-gradient(ellipse at 65% 20%, #34144255, transparent 60%)' }}>

      <header className="relative z-10 mx-auto flex w-full max-w-[1200px] items-center gap-3 border-b border-white/10 px-4 py-5 sm:px-6">
        <button
          type="button"
          onClick={onLeave}
          className="min-h-11 rounded-lg px-2 py-2 text-xs font-medium text-[#bcaec5] transition-colors hover:bg-white/10"
        >
          나가기
        </button>
        {recheckingPrep && (
          <button
            type="button"
            onClick={() => setRecheckingPrep(false)}
            className="min-h-11 rounded-lg px-2 py-2 text-xs font-medium text-[#dcb5ee] transition-colors hover:bg-white/10"
          >
            대기 화면으로
          </button>
        )}
        <h1 className="truncate border-l border-white/10 px-4 text-sm font-medium text-white/80">
          {title ?? '클래스'}
        </h1>
        <span className="ml-auto shrink-0 rounded-full border border-[#dcb5ee]/20 bg-[#dcb5ee]/5 px-3 py-1 text-[11px] text-[#dcb5ee]">
          {statusLabel}
        </span>
      </header>

      <div className="relative z-10 mx-auto w-full max-w-[1200px] flex-1 px-4 pb-16 sm:px-6">
        <div className="pt-5 text-left">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[#dcb5ee]">
            A MOMENT FOR YOURSELF
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            잠시 후 시작합니다
          </h2>
          <p className="mt-3 text-sm leading-6 text-white/70">
            오늘의 나를 가볍게 살펴보고, 편안하게 참여할 준비를 해주세요.
          </p>
        </div>

        <div className="mt-4"><WaitingRoomReminder sessionId={sessionId} skipAuth={!isAuthenticated} /></div>
        <div className="mt-8 grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_285px]">
          <div className="order-2 min-w-0 space-y-4 md:order-none">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#21132B] to-[#1D1027]">
            <div role="tablist" aria-label="입장 전 준비 단계" className="flex items-center gap-2 border-b border-white/10 px-4 py-5 sm:gap-3 sm:px-7">
              {['설문', '링크밴드', '기기 테스트'].map((label, index) => {
                const done = [readiness.surveyDone, readiness.bandDone, readiness.deviceDone][index];
                return <Fragment key={label}>
                  {index > 0 && <span aria-hidden="true" className="h-px min-w-2 flex-1 bg-white/20" />}
                  <button type="button" role="tab" id={`preparation-tab-${index}`} aria-controls={`preparation-panel-${index}`} aria-selected={activeStep === index}
                    tabIndex={activeStep === index ? 0 : -1}
                    onClick={() => setActiveStep(index)}
                    onKeyDown={(event) => {
                      const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
                      if (next === null) return;
                      event.preventDefault(); setActiveStep(next);
                      document.getElementById(`preparation-tab-${next}`)?.focus();
                    }}
                    className={`flex min-h-11 items-center gap-2 whitespace-nowrap rounded-lg text-xs outline-none focus-visible:ring-2 focus-visible:ring-[#dcb5ee] ${activeStep === index ? 'text-[#F7F4F0]' : 'text-[#bcaec5]'}`}>
                    <span aria-hidden="true" className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs ${done || activeStep === index ? 'border-[#dcb5ee] bg-[#dcb5ee] text-[#12081C]' : 'border-white/20'}`}>{done ? '✓' : index + 1}</span>
                    {label}<span className="sr-only">{done ? ' 완료' : ''}</span>
                  </button>
                </Fragment>;
              })}
            </div>
            <div role="tabpanel" id="preparation-panel-0" aria-labelledby="preparation-tab-0" hidden={activeStep !== 0} className="min-h-[418px] p-4 sm:px-7 sm:py-6">
              <PreCheckinPanel sessionId={sessionId} participantId={participantId} participantToken={participantToken} isLoggedIn={isLoggedIn}
                draft={surveyDraft} onDraftChange={setSurveyDraft}
                onSubmitted={(value) => { setCheckin(value); completeSurvey(); }} onSkipped={completeSurvey} />
            </div>
            <div role="tabpanel" id="preparation-panel-1" aria-labelledby="preparation-tab-1" hidden={activeStep !== 1} className="min-h-[418px] p-4 sm:px-7 sm:py-6">
              {/* SDD-133(①-12): 탭 활성일 때만 마운트해 비활성 탭의 자동 BLE 연결을 막는다 */}
              {activeStep === 1 && <WaitingRoomBandCheck sessionId={sessionId} participantId={participantId} skipped={bandSkipped} onSkippedChange={setBandSkipped} onCompleted={completeBand} />}
            </div>
            <div role="tabpanel" id="preparation-panel-2" aria-labelledby="preparation-tab-2" hidden={activeStep !== 2} className="min-h-[418px] space-y-4 p-4 sm:px-7 sm:py-6">
              <h2 className="text-xl font-semibold tracking-tight text-[#F7F4F0]">목소리와 소리를 확인해요</h2>
              <p className="text-xs text-[#bcaec5]">마이크는 자동으로 확인해요. 카메라와 스피커 테스트는 선택입니다.</p>
          {/* (3) 마이크 — 시스템 자동 확인. 문제가 있을 때만 안내한다. */}
          <section className="border-b border-white/10 pb-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold text-white">마이크</h2>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  micOn
                    ? 'bg-[#59CE9026] text-[#B8F5D6]'
                    : micProblem
                      ? 'bg-[#F2212133] text-[#F7C6C6]'
                      : 'bg-white/10 text-white/70'
                }`}
              >
                {micOn ? '정상' : micState === 'pending' ? '확인 중' : deviceStateLabel(micState, '마이크')}
              </span>
            </div>
            <div className="mt-3">
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-white/10"
                aria-hidden="true"
              >
                <div
                  className="h-full rounded-full bg-[#59CE90] transition-[width] duration-100"
                  style={{ width: `${Math.round(micLevel * 100)}%` }}
                />
              </div>
              {/* SDD-132(①-15): 매 tick 변하는 미터는 SR에서 분리, 상태 전이 시에만 안내 */}
              <span className="sr-only" role="status">
                {micOn ? '마이크 입력 정상' : '마이크 꺼짐'}
              </span>
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-[12px] text-white/50">
                  {micOn ? '말해보면 초록 막대가 움직입니다' : '입장하면 상담사와 소통할 수 있어요'}
                </p>
                <button
                  type="button"
                  onClick={toggleMic}
                  aria-pressed={micOn}
                  aria-label={micOn ? '마이크 끄기' : '마이크 켜기'}
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-base transition ${
                    micOn ? 'bg-[#5F0080] text-white' : 'bg-[#3A3A3A] text-white/70'
                  }`}
                >
                  {micOn ? '🎤' : '🔇'}
                </button>
              </div>
            </div>
            {micError && (
              <p role="alert" className="mt-3 rounded-xl bg-[#F2212133] px-4 py-3 text-[12px] leading-5 text-[#F7C6C6]">
                {micError} 입장은 가능하며, 입장 후에도 다시 확인할 수 있어요.
              </p>
            )}
          </section>

          {/* (4) 카메라 — 선택(명상·상담은 오디오 중심). 기본 꺼짐. */}
          <section className="border-b border-white/10 pb-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold text-white">
                카메라 <span className="font-normal text-white/50">(선택)</span>
              </h2>
              <button
                type="button"
                onClick={toggleCamera}
                aria-pressed={cameraOn}
                className={`h-11 rounded-xl px-4 text-sm font-semibold transition ${
                  cameraOn
                    ? 'bg-[#5F0080] text-white'
                    : 'border border-white/20 text-white/80 hover:bg-white/10'
                }`}
              >
                {cameraOn ? '카메라 끄기' : '카메라 켜기'}
              </button>
            </div>
            {cameraOn && (
              <div className="relative mt-3 aspect-video overflow-hidden rounded-xl bg-[#111]">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full -scale-x-100 object-cover"
                />
              </div>
            )}
            {cameraError && (
              <p role="alert" className="mt-3 rounded-xl bg-[#F2212133] px-4 py-3 text-[12px] leading-5 text-[#F7C6C6]">
                {cameraError} 카메라 없이도 참여할 수 있어요.
              </p>
            )}
          </section>

          {/* (5) 스피커 — 선택 테스트(비강제) */}
          <section className="border-b border-white/10 pb-4">
            <h2 className="text-[15px] font-semibold text-white">스피커</h2>
            <p className="mt-2 text-[13px] leading-6 text-white/70">
              입장하면 상담사의 목소리·가이드가 들립니다. 이어폰·헤드셋 착용을 권장해요.
            </p>
            {speakerSupported && (
              <button
                type="button"
                onClick={() => void playTestTone()}
                className="mt-3 h-11 rounded-xl border border-white/20 px-4 text-sm font-semibold text-white/90 transition-colors hover:bg-white/10"
              >
                테스트음 듣기
              </button>
            )}
          </section>

              <div className="flex flex-wrap justify-end gap-3">
                <button type="button" onClick={completeDevices} className="min-h-11 px-3 text-sm text-[#bcaec5]">기기 테스트 건너뛰기</button>
                <button type="button" onClick={completeDevices} className="min-h-11 rounded-xl bg-[#5F0080] px-5 text-sm font-semibold">{readiness.deviceDone ? '확인 완료 ✓' : '기기 확인 완료'}</button>
              </div>
            </div>
          </div>
          <div role="status" className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#1D1027] p-5">
            <div><p className="text-sm text-[#F7F4F0]">{Object.values(readiness).every(Boolean) ? '준비 완료' : '준비 현황'} <strong className="ml-3 text-[#dcb5ee]">{Object.values(readiness).filter(Boolean).length}/3 완료</strong></p>
              <p className="mt-1 text-xs text-[#bcaec5]">상담사가 시작하면 자동으로 입장됩니다</p></div>
            <div aria-hidden="true" className="flex gap-1">{Object.values(readiness).map((done, index) => <span key={index} className={`h-1 w-4 rounded-full sm:w-7 ${done ? 'bg-[#dcb5ee]' : 'bg-white/10'}`} />)}</div>
          </div>

        {/* 입장 게이트 — 이름 + 3단계 준비(설문·링크밴드·기기)를 모두 마쳐야 입장 */}
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.06] p-5">
          {error && <p role="alert" className="mb-3 text-sm text-[#F7C6C6]">{error}</p>}
          {!gate.canEnter && (
            <p className="mb-3 text-[13px] leading-6 text-white/60">
              아직 확인하지 않은 항목이 있어요 · {gate.missing.join(' · ')}
            </p>
          )}
          <button
            type="button"
            onClick={handleEnter}
            disabled={!gate.canEnter}
            title={gate.canEnter ? undefined : `확인 필요: ${gate.missing.join(', ')}`}
            className="mb-btn h-[52px] w-full justify-center rounded-xl px-6 text-base disabled:cursor-not-allowed disabled:opacity-50"
          >
            입장하기
          </button>
          <p className="mt-3 text-center text-[12px] text-white/50">
            설문·링크밴드·기기 테스트를 모두 마치면 입장할 수 있어요. 각 단계는 건너뛰어도 됩니다.
          </p>
        </div>
          </div>
          <aside aria-label="클래스 정보와 참여 설정" className="order-1 space-y-4 md:order-none">
            <section className="rounded-2xl border border-white/10 bg-[#1D1027] p-5">
              <div aria-hidden="true" className="relative mb-5 flex h-28 items-center justify-center overflow-hidden rounded-xl bg-[radial-gradient(ellipse_at_50%_115%,#9163a166,#32203d_55%,#1b1024)]">
                <div className="absolute h-48 w-48 rounded-full border border-[#dcb5ee]/10" />
                <div className="absolute h-36 w-36 rounded-full border border-[#dcb5ee]/15" />
                <div className="flex h-20 w-20 items-center justify-center rounded-full border border-[#dcb5ee]/25 text-4xl font-extralight text-[#dcb5ee]">✧</div>
              </div>
              <p className="text-[9px] tracking-[0.2em] text-[#dcb5ee]">YOUR SESSION</p>
              <h2 className="mt-2 text-lg font-medium text-[#F7F4F0]">{title ?? '클래스'}</h2>
              <p className="mt-2 text-xs text-[#bcaec5]">참여 코드 · {classCode}</p>
            </section>
          {/* (1) 이름 확인 — 회원은 프로필 이름 고정 */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-5">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  nicknameDone ? 'bg-[#5F0080] text-white' : 'bg-white/10 text-white/70'
                }`}
              >
                {nicknameDone ? '✓' : '1'}
              </span>
              <h2 className="text-[15px] font-semibold text-white">참여 이름</h2>
            </div>
            {isGuest ? (
              <>
                <label htmlFor="waiting-room-nickname" className="mt-3 block text-[13px] text-white/70">
                  클래스에서 불릴 이름
                </label>
                <input
                  id="waiting-room-nickname"
                  value={nickname}
                  onChange={(event) => setNickname(normalizeNickname(event.target.value))}
                  maxLength={20}
                  placeholder="예: 김민지"
                  autoComplete="off"
                  className="mt-2 w-full rounded-xl border border-white/20 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-[#B373EF] focus:ring-2 focus:ring-[#5F0080]"
                />
              </>
            ) : (
              <p className="mt-3 text-sm text-white/80">
                <span className="font-semibold text-white">{effectiveNickname}</span> 이름으로
                참여합니다.
              </p>
            )}
          </section>

        {/* 대기실 BGM — 플랫폼이 기본 트랙 자동 재생(회원은 볼륨/음소거만) */}
        <div className="rounded-2xl border border-white/10 bg-[#1D1027] p-4">
          <LobbyBgmBar
            state={lobbyBgm.state}
            onVolumeChange={lobbyBgm.setVolume}
            onToggleMute={lobbyBgm.toggleMute}
            onResume={lobbyBgm.resume}
          />
        </div>


            <p className="px-1 text-xs leading-7 text-[#bcaec5]"><strong className="block font-medium text-[#dcb5ee]">편안한 참여를 위한 작은 준비</strong>조용한 공간에서 참여하고, 휴대폰은 무음으로 두면 몰입에 도움이 됩니다.</p>
          </aside>
        </div>
      </div>
    </main>
  );
}
