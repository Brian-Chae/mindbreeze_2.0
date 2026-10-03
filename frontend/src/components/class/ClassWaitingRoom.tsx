// 입장 전 대기실 — 코드로 참여한 뒤 라이브 뷰로 들어가기 전 준비 단계.
//
// 개선 3 재설계: 기기 단계별 셀프체크(카메라·마이크·스피커·주변)를 강제하던 구조를 걷어내고
// (1) 참여 이름(필수) (2) 입장 전 체크인(기분·상담사 전달 말, 스킵 가능) 만 중심에 둔다.
// 카메라·마이크는 시스템이 자동 확인하고 문제가 있을 때만 안내한다(입장 차단 없음).
// LINK BAND 는 opt-in 유지 — 미연결이어도 항상 입장할 수 있다.
//
// 원칙:
//   · 기기 미비(미지원·권한 거부)는 입장을 영구 차단하지 않는다 — 문제만 알리고 진행 가능.
//   · 미리보기 영상·음성은 저장·전송되지 않는다(입장 시 즉시 중지).
//   · 게스트(user_id NULL)와 로그인 회원 모두 동작한다(회원은 이름 입력 없이 프로필 이름 고정).

import { useCallback, useEffect, useRef, useState } from 'react';
import { FadingImageBackground } from './FadingImageBackground';
import { WaitingRoomBandCheck } from './WaitingRoomBandCheck';
import { PreCheckinPanel } from './PreCheckinPanel';
import { LobbyBgmBar } from './LobbyBgmBar';
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

interface ClassWaitingRoomProps {
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
}: ClassWaitingRoomProps): React.ReactElement {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isGuest = !isAuthenticated && !memberName;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const meterCtxRef = useRef<AudioContext | null>(null);
  const toneCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);

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
    enabled: Boolean(sessionId && participantId),
    skipAuth: !isAuthenticated,
  });

  // 대기실 BGM — 대기 중 플랫폼이 기본 트랙을 자동 재생(회원은 볼륨/음소거만 조절)
  const lobbyBgm = useLobbyBgm(true);

  const stopVideoStream = useCallback((): void => {
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
        setMicLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3));
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
    setCameraState('pending');
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
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
      setCameraState('denied');
      setCameraError(mediaErrorMessage(err, '카메라'));
    }
  }, [stopVideoStream]);

  /** 마이크 열기 — 비디오와 분리 요청 (필수 자동 확인) */
  const openMic = useCallback(async (): Promise<void> => {
    stopAudioStream();
    setMicState('pending');
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      setMicState('on');
      startMeter(stream);
    } catch (err) {
      setMicState('denied');
      setMicError(mediaErrorMessage(err, '마이크'));
    }
  }, [startMeter, stopAudioStream]);

  // 최초 마운트 시 마이크만 자동 확인한다 — 카메라는 선택(명상·상담은 오디오 중심)이므로
  // 불필요한 권한 요청을 피하고, 문제(거부·미탐지)가 있을 때만 안내한다.
  useEffect(() => {
    if (!mediaSupported) return undefined;
    const startId = window.setTimeout(() => {
      void openMic();
    }, 0);
    return () => {
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
  const gate = resolveWaitingRoomGate({ nickname: effectiveNickname });

  /** 입장 — 미리보기 스트림을 즉시 중지하고 라이브 뷰로 넘긴다 */
  const handleEnter = (): void => {
    if (!gate.canEnter) return;
    const finalNickname = normalizeNickname(effectiveNickname);
    storeNickname(finalNickname);
    stopVideoStream();
    stopAudioStream();
    onEnter({ nickname: finalNickname, cameraOn, micOn });
  };

  const nicknameDone = isNicknameValid(effectiveNickname);
  const micProblem = micState === 'denied' || micState === 'unsupported';

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-black text-white">
      <FadingImageBackground />

      <header className="relative z-10 flex items-center justify-between gap-2 px-4 py-4 sm:px-8">
        <button
          type="button"
          onClick={onLeave}
          className="min-h-11 rounded-xl bg-white/20 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/30"
        >
          나가기
        </button>
        <h1 className="truncate px-3 text-center text-base font-medium text-white/80 sm:text-lg">
          {title ?? '클래스'}
        </h1>
        <span className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white/70">
          {statusLabel}
        </span>
      </header>

      <div className="relative z-10 mx-auto w-full max-w-3xl flex-1 px-4 pb-16 sm:px-6">
        <div className="text-center">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[#B373EF]">
            waiting room · {classCode}
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            입장 전 준비
          </h2>
          <p className="mt-3 text-sm leading-6 text-white/70">
            이름과 지금 기분을 가볍게 남겨 주세요. 마이크는 자동으로 확인하고,
            문제가 있을 때만 알려드려요.
          </p>
        </div>

        {/* 대기실 BGM — 플랫폼이 기본 트랙 자동 재생(회원은 볼륨/음소거만) */}
        <div className="mt-6">
          <LobbyBgmBar
            state={lobbyBgm.state}
            onVolumeChange={lobbyBgm.setVolume}
            onToggleMute={lobbyBgm.toggleMute}
            onResume={lobbyBgm.resume}
          />
        </div>

        <div className="mt-8 space-y-4">
          {/* (1) 이름 확인 — 회원은 프로필 이름 고정 */}
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
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

          {/* (2) 입장 전 체크인 — 기분 + 상담사 전달 말 (스킵 가능) */}
          <PreCheckinPanel
            sessionId={sessionId}
            participantId={participantId}
            participantToken={participantToken}
            isLoggedIn={isLoggedIn}
            onSubmitted={setCheckin}
          />

          {/* (3) 마이크 — 시스템 자동 확인. 문제가 있을 때만 안내한다. */}
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
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
                role="meter"
                aria-label="마이크 입력 레벨"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(micLevel * 100)}
              >
                <div
                  className="h-full rounded-full bg-[#59CE90] transition-[width] duration-100"
                  style={{ width: `${Math.round(micLevel * 100)}%` }}
                />
              </div>
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
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
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
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
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

          {/* (6) LINK BAND — 선택(opt-in). 미연결이어도 입장은 항상 가능하다. */}
          <WaitingRoomBandCheck sessionId={sessionId} participantId={participantId} />

          {/* 주변 안내 — 강제 체크 대신 한 줄 권장 */}
          <p className="px-1 text-[13px] leading-6 text-white/60">
            🤫 조용한 공간에서 참여하고, 휴대폰은 무음으로 두면 몰입에 도움이 됩니다.
          </p>
        </div>

        {/* 입장 게이트 — 이름만 필수(체크인·기기는 스킵 가능) */}
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
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
            체크인과 LINK BAND는 선택 사항입니다 — 건너뛰고 바로 입장할 수 있어요.
          </p>
        </div>
      </div>
    </main>
  );
}
