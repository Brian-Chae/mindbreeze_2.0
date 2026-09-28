// 리포트 영상 리플레이어 — presigned URL 조회 + 기록지 타임스탬프 seek 동기화
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { getSessionVideoUrl } from '../../lib/api/video';

export interface VideoPlayerHandle {
  seekTo: (sec: number) => void;
}

interface VideoPlayerProps {
  sessionId: string;
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer({ sessionId }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [url, setUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useImperativeHandle(ref, () => ({
      seekTo: (sec: number) => {
        const video = videoRef.current;
        if (video && Number.isFinite(sec)) {
          video.currentTime = sec;
          void video.play().catch(() => {});
        }
      },
    }));

    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const res = await getSessionVideoUrl(sessionId);
          if (cancelled) return;
          if (res.url) setUrl(res.url);
          else setError('녹화된 영상이 없습니다.');
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : '영상을 불러오지 못했습니다.');
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [sessionId]);

    if (loading) {
      return (
        <div className="flex min-h-[180px] items-center justify-center rounded-xl bg-[#111] text-sm text-[#9B9B9B]">
          영상 로드 중...
        </div>
      );
    }
    if (error || !url) {
      return (
        <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl bg-[#111] text-sm text-[#9B9B9B]">
          <span>🎥</span>
          <span>{error ?? '녹화된 영상이 없습니다.'}</span>
        </div>
      );
    }
    return (
      <video
        ref={videoRef}
        src={url}
        controls
        preload="metadata"
        playsInline
        className="w-full rounded-xl bg-black"
      />
    );
  },
);
