// SDD-083 T1 — 세션 시작 전 카메라/마이크 프리뷰 (zoom 프리조인 형태)
// LiveKit 접속 전 getUserMedia 로컬 프리뷰 (토큰 불필요, 서버 전송·저장 없음)
// 전면/후면 카메라 전환 + 마이크 입력 레벨 표시 + 권한 거부/미지원 폴백

import { useCallback, useEffect, useRef, useState } from 'react';

type FacingMode = 'user' | 'environment';
type MediaState = 'pending' | 'granted' | 'denied' | 'unsupported';

interface SessionPreJoinPreviewProps {
  /** "세션 시작" 확정 — 기존 transitionSession(id, 'start') 호출 */
  onStart: () => void;
  /** 시작 전이 중 */
  starting: boolean;
  /** 참가자 조건 등으로 시작 가능 여부 */
  canStart: boolean;
  /** canStart=false 사유 (버튼 title) */
  startDisabledReason?: string;
}

/** getUserMedia 오류 → 사용자 안내 문구 */
function mediaErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '카메라/마이크 권한이 거부되었습니다. 브라우저 주소창의 권한 설정을 확인해주세요.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return '사용 가능한 카메라/마이크를 찾지 못했습니다. 장치 연결을 확인해주세요.';
  }
  if (name === 'NotReadableError') {
    return '다른 앱이 카메라/마이크를 사용 중입니다. 종료 후 다시 시도해주세요.';
  }
  return err instanceof Error ? err.message : '카메라/마이크를 열지 못했습니다.';
}

export function SessionPreJoinPreview({
  onStart,
  starting,
  canStart,
  startDisabledReason,
}: SessionPreJoinPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);
  const [facingMode, setFacingMode] = useState<FacingMode>('user');
  const mediaSupported = Boolean(
    typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia,
  );
  const [mediaState, setMediaState] = useState<MediaState>(
    mediaSupported ? 'pending' : 'unsupported',
  );
  const [mediaError, setMediaError] = useState<string | null>(null);
  /** 마이크 입력 레벨 0~1 (RMS) */
  const [micLevel, setMicLevel] = useState(0);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
  }, []);

  // facingMode 변경 시 프리뷰 스트림 재요청
  useEffect(() => {
    if (!mediaSupported) return undefined;

    let cancelled = false;

    const open = async (): Promise<void> => {
      setMediaState('pending');
      setMediaError(null);
      try {
        // facingMode 는 ideal 취급 — 후면 카메라가 없는 데스크톱에서도 실패하지 않음
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode },
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setMediaState('granted');

        // 마이크 레벨 미터 — AnalyserNode RMS
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
      } catch (err) {
        if (cancelled) return;
        setMediaState('denied');
        setMediaError(mediaErrorMessage(err));
      }
    };

    void open();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [facingMode, stopStream, mediaSupported]);

  /** 시작 확정 — 프리뷰 스트림을 정리한 뒤 시작 (LiveKit 이 장치를 다시 연다) */
  const handleStart = (): void => {
    stopStream();
    onStart();
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

      {mediaState === 'unsupported' || mediaState === 'denied' ? (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[#E5E5E5] bg-[#F9F9F9] p-6 text-center">
          <p className="text-sm text-[#6F6F6F]">
            {mediaState === 'unsupported'
              ? '이 브라우저는 카메라/마이크 미리보기를 지원하지 않습니다 (Chrome/Edge 권장).'
              : mediaError}
          </p>
          <p className="text-xs text-[#9B9B9B]">
            프리뷰 없이도 세션은 시작할 수 있습니다.
          </p>
          <button
            type="button"
            onClick={handleStart}
            disabled={!canStart || starting}
            title={!canStart && !starting ? startDisabledReason : undefined}
            className="mb-btn mb-btn--soft disabled:cursor-not-allowed"
          >
            {starting ? '시작 중...' : '그래도 시작'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="relative min-h-[240px] flex-1 overflow-hidden rounded-2xl bg-[#111]">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`h-full max-h-[380px] w-full object-cover ${
                facingMode === 'user' ? '-scale-x-100' : ''
              }`}
            />
            {mediaState === 'pending' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-sm text-[#9CA3AF]">
                  카메라/마이크 권한 확인 중...
                </p>
              </div>
            )}
            <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white">
              {facingMode === 'user' ? '전면 카메라' : '후면 카메라'}
            </span>
          </div>

          <div className="flex w-full flex-col justify-between gap-4 lg:w-64">
            <div className="space-y-3">
              <div>
                <p className="text-[12px] font-medium text-[#6F6F6F]">
                  마이크 입력
                </p>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[#F2F3F8]">
                  <div
                    className="h-full rounded-full bg-[#59CE90] transition-[width] duration-100"
                    style={{ width: `${Math.round(micLevel * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-[#9B9B9B]">
                  말해보면 초록 막대가 움직입니다
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setFacingMode((prev) =>
                    prev === 'user' ? 'environment' : 'user',
                  )
                }
                disabled={mediaState !== 'granted'}
                className="mb-btn mb-btn--ghost w-full disabled:cursor-not-allowed"
              >
                {facingMode === 'user' ? '후면 카메라로 전환' : '전면 카메라로 전환'}
              </button>
            </div>
            <div className="flex flex-col gap-2">
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
