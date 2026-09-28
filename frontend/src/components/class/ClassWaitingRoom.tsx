// 개선 3: 클래스 입장 전 대기실 — 코드로 참여한 뒤 라이브 뷰로 들어가기 전 준비 단계.
//
// 코드 입력 직후 바로 라이브로 들어가 기기 문제를 진행 중에 발견하던 불편을 없앤다.
// 여기서 (1) 닉네임 확정 (2) 카메라·마이크 미리보기 (3) 마이크 입력 레벨 (4) 스피커 테스트 톤
// (5) LINK BAND 연결 상태(선택) (6) 조용한 공간·이어폰 셀프체크를 모두 확인해야 [입장]이 열린다.
//
// 원칙:
//   · 기기 미비(미지원·권한 거부)는 입장을 영구 차단하지 않는다 — 사실을 확인하면 진행 가능.
//   · LINK BAND 는 opt-in 유지 — 미연결이어도 항상 입장할 수 있다.
//   · 미리보기 영상·음성은 저장·전송되지 않는다(입장 시 즉시 중지).
//   · 게스트(user_id NULL)와 로그인 회원 모두 동작한다(회원은 이름 입력 없이 프로필 이름 고정).

import { useCallback, useEffect, useRef, useState } from 'react';
import { FadingImageBackground } from './FadingImageBackground';
import { WaitingRoomBandCheck } from './WaitingRoomBandCheck';
import { useWaitingRoomPresence } from '../../hooks/useWaitingRoomPresence';
import { useAuthStore } from '../../stores/authStore';
import {
  areDevicesResolved,
  deviceStateLabel,
  emptyCheckState,
  isNicknameValid,
  mediaErrorMessage,
  normalizeNickname,
  readStoredNickname,
  resolveWaitingRoomGate,
  storeNickname,
  WAITING_ROOM_CHECKLIST,
  type WaitingRoomCheckState,
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
  /** [입장] 클릭 — 확정 값과 함께 라이브 뷰로 진입 */
  onEnter: (payload: ClassWaitingRoomEnterPayload) => void;
  /** [나가기] — 코드 입력 단계로 복귀 */
  onLeave: () => void;
}

/** 단계 제목 — 차분한 톤 유지 */
function StepHeading({ index, title, done }: { index: number; title: string; done: boolean }): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
          done ? 'bg-[#5F0080] text-white' : 'bg-white/10 text-white/70'
        }`}
      >
        {done ? '✓' : index}
      </span>
      <h2 className="text-[15px] font-semibold text-white">{title}</h2>
    </div>
  );
}

export function ClassWaitingRoom({
  title,
  classCode,
  statusLabel,
  sessionId,
  participantId,
  memberName,
  initialNickname,
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
  const [cameraState, setCameraState] = useState<WaitingRoomDeviceState>(
    mediaSupported ? 'pending' : 'unsupported',
  );
  const [micState, setMicState] = useState<WaitingRoomDeviceState>(
    mediaSupported ? 'pending' : 'unsupported',
  );
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  /** 마이크 입력 레벨 0~1 (RMS) */
  const [micLevel, setMicLevel] = useState(0);
  /** [기기 확인 완료] — 프리뷰(또는 미지원 사실)를 확인했음 */
  const [devicesChecked, setDevicesChecked] = useState(false);
  /** 스피커 테스트 톤 재생 완료 */
  const [speakerVerified, setSpeakerVerified] = useState(false);
  const [checks, setChecks] = useState<WaitingRoomCheckState>(emptyCheckState);

  // 상담사 대기 인원 표시용 참여 알림(입장·퇴장) — 라이브 뷰로 넘어가면 해제된다.
  useWaitingRoomPresence({
    sessionId,
    participantId,
    nickname: memberName ?? (isNicknameValid(nickname) ? normalizeNickname(nickname) : null),
    enabled: Boolean(sessionId && participantId),
    skipAuth: !isAuthenticated,
  });

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

  /** 카메라 열기 — 오디오와 분리 요청해 부분 권한 거부를 개별 상태로 매핑 */
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

  /** 마이크 열기 — 비디오와 분리 요청 */
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

  // 최초 마운트 시 미리보기 시작 + 언마운트 정리(캡처 표시등 끄기).
  // 시작 호출은 다음 태스크로 미룬다 — effect 본문에서 동기 setState(pending)를 피해
  // cascading render 를 만들지 않는다(react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!mediaSupported) return undefined;
    const startId = window.setTimeout(() => {
      void openCamera();
      void openMic();
    }, 0);
    return () => {
      window.clearTimeout(startId);
      stopVideoStream();
      stopAudioStream();
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

  /** 스피커 테스트 톤 — C5(523.25Hz) 0.9초, 부드러운 fade in/out */
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
      setSpeakerVerified(true);
    } catch {
      // 재생 실패는 입장을 막지 않는다(다음 단계에서 다시 확인 가능)
      setSpeakerVerified(true);
    }
  }, [speakerSupported]);

  const toggleCheck = (id: (typeof WAITING_ROOM_CHECKLIST)[number]['id']): void => {
    setChecks((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const cameraOn = cameraState === 'on';
  const micOn = micState === 'on';
  const devicesResolved = areDevicesResolved(cameraState, micState);

  /** 회원은 프로필 이름 고정 — 게스트만 입력한 이름을 확정한다 */
  const effectiveNickname = memberName ?? normalizeNickname(nickname);
  const gate = resolveWaitingRoomGate({
    nickname: effectiveNickname,
    devicesChecked,
    speakerVerified,
    speakerSupported,
    checks,
  });

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
  const speakerDone = !speakerSupported || speakerVerified;

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-black text-white">
      <FadingImageBackground />

      <header className="relative z-10 flex items-center justify-between gap-2 px-4 py-4 sm:px-8">
        <button
          type="button"
          onClick={onLeave}
          className="rounded-xl bg-white/20 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/30"
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
            기기와 주변을 확인한 뒤 입장하세요. 확인하는 동안 미리보기 영상·음성은 저장되지 않고,
            입장하면 바로 정리됩니다.
          </p>
        </div>

        <div className="mt-8 space-y-4">
          {/* (1) 이름 확인 — 회원은 프로필 이름 고정 */}
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <StepHeading index={1} title="참여 이름" done={nicknameDone} />
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
                <p className="mt-2 text-[12px] text-white/50">
                  참여 단계에서 입력한 이름을 그대로 쓰거나, 여기서 확정할 수 있어요.
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm text-white/80">
                <span className="font-semibold text-white">{effectiveNickname}</span> 이름으로
                참여합니다.
              </p>
            )}
          </section>

          {/* (2)(3) 카메라·마이크 미리보기 + 마이크 입력 레벨 */}
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <StepHeading index={2} title="카메라·마이크 확인" done={devicesChecked} />

            {mediaSupported ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
                <div className="relative aspect-video overflow-hidden rounded-xl bg-[#111]">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`h-full w-full -scale-x-100 object-cover ${cameraOn ? '' : 'invisible'}`}
                  />
                  {!cameraOn && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
                      <span aria-hidden="true" className="text-2xl">
                        🎥
                      </span>
                      <p className="text-[13px] text-white/60">
                        {cameraState === 'pending'
                          ? '카메라 권한 확인 중…'
                          : deviceStateLabel(cameraState, '카메라')}
                      </p>
                    </div>
                  )}
                  <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
                    <button
                      type="button"
                      onClick={toggleCamera}
                      aria-pressed={cameraOn}
                      aria-label={cameraOn ? '카메라 끄기' : '카메라 켜기'}
                      className={`flex h-10 w-10 items-center justify-center rounded-full text-base transition ${
                        cameraOn ? 'bg-[#5F0080] text-white' : 'bg-[#3A3A3A] text-white/70'
                      }`}
                    >
                      {cameraOn ? '🎥' : '🚫'}
                    </button>
                    <button
                      type="button"
                      onClick={toggleMic}
                      aria-pressed={micOn}
                      aria-label={micOn ? '마이크 끄기' : '마이크 켜기'}
                      className={`flex h-10 w-10 items-center justify-center rounded-full text-base transition ${
                        micOn ? 'bg-[#5F0080] text-white' : 'bg-[#3A3A3A] text-white/70'
                      }`}
                    >
                      {micOn ? '🎤' : '🔇'}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-medium text-white/70">마이크 입력</p>
                    <div
                      className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/10"
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
                    <p className="mt-1 text-[11px] text-white/50">
                      {micOn ? '말해보면 초록 막대가 움직입니다' : deviceStateLabel(micState, '마이크')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDevicesChecked(true)}
                    disabled={!devicesResolved || devicesChecked}
                    aria-pressed={devicesChecked}
                    className={`h-11 w-full rounded-xl px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${
                      devicesChecked
                        ? 'bg-white/10 text-white/70'
                        : 'bg-[#5F0080] text-white hover:bg-[#4C0066] disabled:opacity-50'
                    }`}
                  >
                    기기 확인 완료
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-xl bg-white/5 p-4 text-[13px] leading-6 text-white/70">
                이 브라우저는 카메라·마이크 미리보기를 지원하지 않습니다(Chrome/Edge 권장). 미리보기
                없이도 입장할 수 있어요.
                <button
                  type="button"
                  onClick={() => setDevicesChecked(true)}
                  disabled={devicesChecked}
                  aria-pressed={devicesChecked}
                  className="mb-btn mt-3 h-11 w-full justify-center rounded-xl px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  기기 확인 완료
                </button>
              </div>
            )}

            {cameraError && (
              <p role="alert" className="mt-3 text-[12px] text-[#F7C6C6]">
                {cameraError}
              </p>
            )}
            {micError && (
              <p role="alert" className="mt-3 text-[12px] text-[#F7C6C6]">
                {micError}
              </p>
            )}
            {devicesChecked && (
              <p className="mt-3 text-[12px] text-[#B8F5D6]">
                확인 완료 · 카메라 {cameraOn ? '켜짐' : '꺼짐'} · 마이크 {micOn ? '켜짐' : '꺼짐'}
              </p>
            )}
          </section>

          {/* (4) 스피커 테스트 톤 */}
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <StepHeading index={3} title="스피커 확인" done={speakerDone} />
            {speakerSupported ? (
              <>
                <p className="mt-3 text-[13px] leading-6 text-white/70">
                  테스트음을 재생해 소리가 들리는지 확인하세요. 이어폰·헤드셋을 착용했다면 이 상태로
                  재생됩니다.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void playTestTone()}
                    className="h-11 rounded-xl border border-white/20 px-4 text-sm font-semibold text-white/90 transition-colors hover:bg-white/10"
                  >
                    {speakerVerified ? '테스트음 다시 듣기' : '테스트음 재생'}
                  </button>
                  {speakerVerified && <span className="text-[12px] text-[#B8F5D6]">재생 완료</span>}
                </div>
              </>
            ) : (
              <p className="mt-3 text-[13px] leading-6 text-white/60">
                이 브라우저에서는 테스트음을 재생할 수 없습니다. 이 단계는 건너뛸 수 있습니다.
              </p>
            )}
          </section>

          {/* (5) LINK BAND — 선택(opt-in). 미연결이어도 입장은 항상 가능하다. */}
          <WaitingRoomBandCheck sessionId={sessionId} participantId={participantId} />

          {/* (6) 조용한 공간·이어폰 셀프체크 */}
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <StepHeading
              index={4}
              title="주변 점검"
              done={WAITING_ROOM_CHECKLIST.every((item) => checks[item.id])}
            />
            <ul className="mt-3 space-y-3">
              {WAITING_ROOM_CHECKLIST.map((item) => (
                <li key={item.id}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-black/20 p-3">
                    <input
                      type="checkbox"
                      checked={checks[item.id]}
                      onChange={() => toggleCheck(item.id)}
                      className="mt-1 h-4 w-4 accent-[#B373EF]"
                    />
                    <span>
                      <span className="block text-sm font-medium text-white">
                        <span aria-hidden="true" className="mr-1.5">
                          {item.icon}
                        </span>
                        {item.label}
                      </span>
                      <span className="mt-1 block text-[12px] leading-5 text-white/60">
                        {item.hint}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* 입장 게이트 — 모두 확인해야 활성화 */}
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
            LINK BAND는 선택 사항입니다 — 미연결이어도 입장할 수 있어요.
          </p>
        </div>
      </div>
    </main>
  );
}
