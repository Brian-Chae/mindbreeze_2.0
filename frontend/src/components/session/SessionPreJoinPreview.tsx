// SDD-083 T1 — 세션 시작 전 카메라/마이크 프리뷰 (zoom 프리조인 형태)
// LiveKit 접속 전 getUserMedia 로컬 프리뷰 (토큰 불필요, 서버 전송·저장 없음)
// SDD-085 — 카메라/마이크 개별 오프 토글 + 오프 안내 UX + onStart({cameraOn, micOn})
//   - getUserMedia 비디오/오디오 분리 요청 → 부분 권한 거부를 개별 상태로 매핑
//   - 오프 시 트랙 실제 stop (브라우저 캡처 표시등 꺼짐 — NFR-2)
//   - 마이크 오프 = AI 분석(전사·요약) 미제공 경고, 카메라 오프 = 정보 톤 (§7)

import { useCallback, useEffect, useRef, useState } from 'react';

type FacingMode = 'user' | 'environment';
/** SDD-085: 장치별 상태 — denied/unsupported 는 동작상 off 와 동일, 안내만 다름 (§4.3) */
type DeviceState = 'pending' | 'on' | 'off' | 'denied' | 'unsupported';

/** SDD-085: 프리뷰에서 확정한 장치 사용 여부 — 세션 전체(녹음·녹화)에 적용 */
export interface PreJoinMediaPrefs {
  cameraOn: boolean;
  micOn: boolean;
}

interface SessionPreJoinPreviewProps {
  /** "세션 시작" 확정 — 토글 확정 값과 함께 transitionSession(id, 'start') 호출 */
  onStart: (prefs: PreJoinMediaPrefs) => void;
  /** 시작 전이 중 */
  starting: boolean;
  /** 참가자 조건 등으로 시작 가능 여부 */
  canStart: boolean;
  /** canStart=false 사유 (버튼 title) */
  startDisabledReason?: string;
}

/** getUserMedia 오류 → 사용자 안내 문구 */
function mediaErrorMessage(err: unknown, device: '카메라' | '마이크'): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return `${device} 권한이 거부되었습니다. 브라우저 주소창의 권한 설정을 확인해주세요.`;
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return `사용 가능한 ${device}를 찾지 못했습니다. 장치 연결을 확인해주세요.`;
  }
  if (name === 'NotReadableError') {
    return `다른 앱이 ${device}를 사용 중입니다. 종료 후 다시 시도해주세요.`;
  }
  return err instanceof Error ? err.message : `${device}를 열지 못했습니다.`;
}

/** 조합별 시작 요약 라인 (§7 S-1~S-4) */
function startSummaryLine(cameraOn: boolean, micOn: boolean): string {
  if (cameraOn && micOn) return '🎥 영상 녹화 · 🎤 음성 녹음 + AI 자동 기록으로 진행됩니다';
  if (!cameraOn && micOn) return '🎥 영상 녹화 안 함 · 🎤 음성 녹음 + AI 자동 기록은 정상 제공됩니다';
  if (cameraOn && !micOn) return '🎤 음성 녹음·AI 분석 안 함(수동 기록) · 🎥 영상은 무음으로 녹화됩니다';
  return '녹화·녹음·AI 분석 없이 수동 기록 모드로 진행됩니다';
}

export function SessionPreJoinPreview({
  onStart,
  starting,
  canStart,
  startDisabledReason,
}: SessionPreJoinPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);
  const [facingMode, setFacingMode] = useState<FacingMode>('user');
  const mediaSupported = Boolean(
    typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia,
  );
  const [cameraState, setCameraState] = useState<DeviceState>(
    mediaSupported ? 'pending' : 'unsupported',
  );
  const [micState, setMicState] = useState<DeviceState>(
    mediaSupported ? 'pending' : 'unsupported',
  );
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  /** 마이크 입력 레벨 0~1 (RMS) */
  const [micLevel, setMicLevel] = useState(0);
  /** SDD-085: 마이크 OFF 상태로 시작 클릭 시 확인 다이얼로그 (§7 M-2) */
  const [micOffConfirmOpen, setMicOffConfirmOpen] = useState(false);

  const stopVideoStream = useCallback(() => {
    videoStreamRef.current?.getTracks().forEach((track) => track.stop());
    videoStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stopAudioStream = useCallback(() => {
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    setMicLevel(0);
  }, []);

  /** 마이크 레벨 미터 — AnalyserNode RMS */
  const startMeter = useCallback((stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
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
      // 레벨 미터 실패는 프리뷰 자체를 막지 않음
    }
  }, []);

  /** 카메라 열기 — 오디오와 분리 요청 (부분 권한 거부를 개별 상태로 매핑) */
  const openCamera = useCallback(
    async (mode: FacingMode): Promise<void> => {
      stopVideoStream();
      setCameraState('pending');
      setCameraError(null);
      try {
        // facingMode 는 ideal 취급 — 후면 카메라가 없는 데스크톱에서도 실패하지 않음
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: mode },
        });
        videoStreamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraState('on');
      } catch (err) {
        setCameraState('denied');
        setCameraError(mediaErrorMessage(err, '카메라'));
      }
    },
    [stopVideoStream],
  );

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
  }, [stopAudioStream, startMeter]);

  // 최초 마운트 시 카메라/마이크 분리 요청 + 언마운트 정리
  useEffect(() => {
    if (!mediaSupported) return undefined;
    void openCamera('user');
    void openMic();
    return () => {
      stopVideoStream();
      stopAudioStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 1회
  }, [mediaSupported]);

  /** 카메라 토글 — 오프 시 트랙 실제 stop (캡처 표시등 꺼짐), 재켜기 시 스트림 재요청 */
  const toggleCamera = (): void => {
    if (cameraState === 'on') {
      stopVideoStream();
      setCameraState('off');
      return;
    }
    void openCamera(facingMode);
  };

  /** 마이크 토글 */
  const toggleMic = (): void => {
    if (micState === 'on') {
      stopAudioStream();
      setMicState('off');
      return;
    }
    void openMic();
  };

  /** 전면/후면 전환 — 카메라 ON일 때만 재요청 */
  const handleFacingSwitch = (): void => {
    const next: FacingMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    if (cameraState === 'on') void openCamera(next);
  };

  const cameraOn = cameraState === 'on';
  const micOn = micState === 'on';
  const cameraBlocked = cameraState === 'denied' || cameraState === 'unsupported';
  const micBlocked = micState === 'denied' || micState === 'unsupported';
  /** 둘 다 거부/미지원 — 기존 폴백 화면 유지 (D 조합으로 시작, §4.3) */
  const allBlocked = cameraBlocked && micBlocked;

  /** 시작 확정 — 프리뷰 스트림 정리 후 토글 확정 값 전달 */
  const confirmStart = (): void => {
    setMicOffConfirmOpen(false);
    stopVideoStream();
    stopAudioStream();
    onStart({ cameraOn, micOn });
  };

  /** 시작 버튼 — 마이크 OFF면 확인 다이얼로그 1회 (§7 M-2, 실수 방지) */
  const handleStart = (): void => {
    if (!micOn) {
      setMicOffConfirmOpen(true);
      return;
    }
    confirmStart();
  };

  const startButton = (
    <button
      type="button"
      onClick={handleStart}
      disabled={!canStart || starting}
      title={!canStart && !starting ? startDisabledReason : undefined}
      className="mb-btn disabled:cursor-not-allowed"
    >
      {starting ? '시작 중...' : '세션 시작'}
    </button>
  );

  /** 마이크 OFF 확인 다이얼로그 (§7 M-2) */
  const micOffConfirmDialog = micOffConfirmOpen ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h4 className="text-lg font-semibold text-[#1F1F1F]">
          마이크가 꺼진 상태로 시작합니다
        </h4>
        <p className="mt-3 text-sm text-[#6F6F6F]">
          이 세션에서는 음성 녹음과 AI 자동 기록·요약이 제공되지 않으며, 기록지는 직접
          작성해야 합니다. 계속할까요?
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setMicOffConfirmOpen(false);
              toggleMic();
            }}
            className="mb-btn mb-btn--ghost"
          >
            마이크 켜기
          </button>
          <button type="button" onClick={confirmStart} className="mb-btn">
            그대로 시작
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <section className="rounded-2xl border border-[#EFEFEF] bg-white p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-[#5F0080]/70">
            pre-join preview
          </p>
          <h3 className="mt-1 text-[15px] font-bold text-[#1F1F1F]">
            시작 전 카메라·마이크 확인
          </h3>
          <p className="mt-1 text-[12px] text-[#6F6F6F]">
            내 모습과 마이크 입력을 확인한 뒤 세션을 시작하세요. 프리뷰 영상은
            저장·전송되지 않습니다.
          </p>
        </div>
      </div>

      {micOffConfirmDialog}

      {micState === 'unsupported' && cameraState === 'unsupported' ? (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[#E5E5E5] bg-[#F9F9F9] p-6 text-center">
          <p className="text-sm text-[#6F6F6F]">
            이 브라우저는 카메라/마이크 미리보기를 지원하지 않습니다 (Chrome/Edge 권장).
          </p>
          <p className="text-xs text-[#9B9B9B]">
            프리뷰 없이도 세션은 시작할 수 있습니다.
          </p>
          <button
            type="button"
            onClick={confirmStart}
            disabled={!canStart || starting}
            title={!canStart && !starting ? startDisabledReason : undefined}
            className="mb-btn mb-btn--soft disabled:cursor-not-allowed"
          >
            {starting ? '시작 중...' : '그래도 시작'}
          </button>
        </div>
      ) : allBlocked ? (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[#E5E5E5] bg-[#F9F9F9] p-6 text-center">
          <p className="text-sm text-[#6F6F6F]">{cameraError ?? micError}</p>
          <p className="text-xs text-[#9B9B9B]">
            브라우저 주소창의 권한 설정에서 카메라/마이크를 허용한 뒤 새로고침하거나,
            프리뷰 없이 시작할 수 있습니다 (녹화·녹음·AI 분석 없이 수동 기록 모드).
          </p>
          <button
            type="button"
            onClick={confirmStart}
            disabled={!canStart || starting}
            title={!canStart && !starting ? startDisabledReason : undefined}
            className="mb-btn mb-btn--soft disabled:cursor-not-allowed"
          >
            {starting ? '시작 중...' : '그래도 시작'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="flex flex-1 flex-col gap-3">
            <div className="relative min-h-[240px] overflow-hidden rounded-2xl bg-[#111]">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`h-full max-h-[380px] w-full object-cover ${
                  facingMode === 'user' ? '-scale-x-100' : ''
                } ${cameraOn ? '' : 'invisible'}`}
              />
              {!cameraOn && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-2xl">
                    🎥
                  </span>
                  <p className="text-sm text-[#9CA3AF]">
                    {cameraState === 'pending'
                      ? '카메라 권한 확인 중...'
                      : '카메라가 꺼져 있습니다'}
                  </p>
                </div>
              )}
              {cameraOn && (
                <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white">
                  {facingMode === 'user' ? '전면 카메라' : '후면 카메라'}
                </span>
              )}
              {!micOn && (
                <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white">
                  🎤 꺼짐
                </span>
              )}

              {/* SDD-085: 카메라/마이크 개별 토글 — 타일 하단 중앙 (프리조인 관례) */}
              <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-3">
                <button
                  type="button"
                  onClick={toggleCamera}
                  aria-pressed={cameraOn}
                  aria-label={cameraOn ? '카메라 끄기' : '카메라 켜기'}
                  title={cameraOn ? '카메라 끄기' : '카메라 켜기'}
                  className={`relative flex h-11 w-11 items-center justify-center rounded-full text-lg transition ${
                    cameraOn
                      ? 'bg-[#5F0080] text-white hover:bg-[#4A0066]'
                      : 'bg-[#3A3A3A] text-white/70 hover:bg-[#4A4A4A]'
                  }`}
                >
                  {cameraOn ? '🎥' : '🚫'}
                  {!cameraOn && (
                    <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-[#B3261E]" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={toggleMic}
                  aria-pressed={micOn}
                  aria-label={micOn ? '마이크 끄기' : '마이크 켜기'}
                  title={micOn ? '마이크 끄기' : '마이크 켜기'}
                  className={`relative flex h-11 w-11 items-center justify-center rounded-full text-lg transition ${
                    micOn
                      ? 'bg-[#5F0080] text-white hover:bg-[#4A0066]'
                      : 'bg-[#3A3A3A] text-white/70 hover:bg-[#4A4A4A]'
                  }`}
                >
                  {micOn ? '🎤' : '🔇'}
                  {!micOn && (
                    <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-[#B3261E]" />
                  )}
                </button>
              </div>
            </div>

            {/* SDD-085: 마이크 OFF 경고 배너 (§7 M-1) — AI 분석 제한 즉시 안내 */}
            {!micOn && micState !== 'pending' && (
              <div className="rounded-xl border border-[#F5E2B8] bg-amber-50 p-3.5 text-sm text-[#8A6B1F]">
                <p className="font-semibold">마이크를 끄면 AI 분석이 제한됩니다.</p>
                <p className="mt-1">
                  음성이 녹음되지 않아 자동 전사(STT)·AI 요약·AI 기록지가 생성되지
                  않습니다. 세션 기록은 수동 작성 모드로 진행됩니다.
                </p>
                {micBlocked && (
                  <p className="mt-1 text-[12px]">
                    {micState === 'unsupported'
                      ? '이 브라우저는 마이크를 지원하지 않습니다 (Chrome/Edge 권장).'
                      : micError ??
                        '마이크 권한이 거부되었습니다. 브라우저 주소창의 권한 설정을 확인해주세요.'}
                  </p>
                )}
              </div>
            )}

            {/* SDD-085: 카메라 OFF 정보 배너 (§7 C-1) — AI 분석 무관, 경고 톤 미사용 */}
            {!cameraOn && cameraState !== 'pending' && (
              <div className="rounded-xl border border-[#E5E5E5] bg-[#F9F9F9] p-3.5 text-sm text-[#6F6F6F]">
                <p>
                  카메라를 끄면 이 세션의 영상이 녹화되지 않습니다. 음성 녹음과 AI 분석은
                  정상 제공됩니다.
                </p>
                {cameraBlocked && (
                  <p className="mt-1 text-[12px] text-[#9B9B9B]">
                    {cameraState === 'unsupported'
                      ? '이 브라우저는 카메라를 지원하지 않습니다 (Chrome/Edge 권장).'
                      : cameraError ??
                        '카메라 권한이 거부되었습니다. 브라우저 주소창의 권한 설정을 확인해주세요.'}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex w-full flex-col justify-between gap-4 lg:w-64">
            <div className="space-y-3">
              <div>
                <p className="text-[12px] font-medium text-[#6F6F6F]">마이크 입력</p>
                {micOn ? (
                  <>
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[#F2F3F8]">
                      <div
                        className="h-full rounded-full bg-[#59CE90] transition-[width] duration-100"
                        style={{ width: `${Math.round(micLevel * 100)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-[#9B9B9B]">
                      말해보면 초록 막대가 움직입니다
                    </p>
                  </>
                ) : (
                  <>
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[#E5E5E5]" />
                    <p className="mt-1 text-[11px] text-[#9B9B9B]">마이크 꺼짐</p>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={handleFacingSwitch}
                disabled={!cameraOn}
                className="mb-btn mb-btn--ghost w-full disabled:cursor-not-allowed"
              >
                {facingMode === 'user' ? '후면 카메라로 전환' : '전면 카메라로 전환'}
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {/* SDD-085: 현재 조합 요약 라인 (§7 S-1~S-4) */}
              <p className="text-center text-[11px] leading-relaxed text-[#6F6F6F]">
                {startSummaryLine(cameraOn, micOn)}
              </p>
              {startButton}
              {!canStart && !starting && startDisabledReason && (
                <p className="text-center text-[11px] text-[#9B9B9B]">
                  {startDisabledReason}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
