// 세션 진행 중 상담사 본인 영상(셀프뷰) — 프리뷰(SessionPreJoinPreview) 종료 후에도
// 상담사가 자기 영상을 계속 확인할 수 있게 한다.
// - 녹화 중이면 useVideoRecorder 의 스트림을 그대로 표시(실제 저장되는 화면과 동일)
// - 녹화 전이면 로컬 프리뷰 스트림을 자체로 연다(영상만, 서버 전송·저장 없음)

import { useEffect, useRef, useState } from 'react';
import type { FacingMode } from '../../hooks/useVideoRecorder';

interface SessionHostVideoViewProps {
  /** 녹화 중인 카메라 스트림 — null 이면 자체 프리뷰 스트림을 연다 */
  stream: MediaStream | null;
  facingMode: FacingMode;
  /** 녹화 중 여부 — 배지 표시용 */
  recording: boolean;
}

export function SessionHostVideoView({ stream, facingMode, recording }: SessionHostVideoViewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ownStreamRef = useRef<MediaStream | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const stopOwn = (): void => {
      ownStreamRef.current?.getTracks().forEach((t) => t.stop());
      ownStreamRef.current = null;
    };

    if (stream) {
      // 녹화 스트림이 있으면 자체 프리뷰는 닫고 녹화 스트림을 표시
      stopOwn();
      if (videoRef.current) videoRef.current.srcObject = stream;
      setPreviewError(null);
      return undefined;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setPreviewError('이 브라우저는 카메라 미리보기를 지원하지 않습니다 (Chrome/Edge 권장)');
      return undefined;
    }

    // 녹화 전 자체 프리뷰 — 영상만 연다(마이크 점유 방지). facingMode 는 ideal 취급.
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode } })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        ownStreamRef.current = s;
        if (videoRef.current) videoRef.current.srcObject = s;
        setPreviewError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPreviewError(
          err instanceof Error ? err.message : '카메라를 열지 못했습니다',
        );
      });

    return () => {
      cancelled = true;
      stopOwn();
    };
  }, [stream, facingMode]);

  return (
    <div className="relative min-h-[200px] overflow-hidden rounded-2xl bg-[#111]">
      {previewError ? (
        <div className="flex min-h-[200px] items-center justify-center p-6 text-center">
          <p className="text-sm text-[#9CA3AF]">{previewError}</p>
        </div>
      ) : (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full max-h-[320px] w-full object-contain ${
            facingMode === 'user' ? '-scale-x-100' : ''
          }`}
        />
      )}
      <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white">
        {recording && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FF5449]" />}
        {recording ? '녹화 중 · 내 영상' : '내 영상'}
      </span>
    </div>
  );
}
