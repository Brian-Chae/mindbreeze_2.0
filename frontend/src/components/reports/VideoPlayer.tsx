// 리포트 영상 리플레이어 — presigned URL/stream 조회 + 기록지 타임스탬프 seek 동기화
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { getSessionVideoUrl, resolveVideoUrl } from '../../lib/api/video';
import { tokenStorage } from '../../lib/api/client';

export interface VideoPlayerHandle {
  seekTo: (sec: number) => void;
}

interface VideoPlayerProps {
  sessionId: string;
}

/** 로컬 폴백 stream endpoint는 인증 필요 → fetch로 blob URL 변환 */
async function fetchVideoAsBlobUrl(url: string): Promise<string> {
  const token = tokenStorage.getAccess();
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('영상을 불러오지 못했습니다.');
  const blob = await res.blob();
  return URL.createObjectURL(blob);
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
          if (!res.url) {
            setError('녹화된 영상이 없습니다.');
            return;
          }
          // 로컬 폴백 stream endpoint는 Authorization 필요 → blob URL로 변환
          const playableUrl = res.url.includes('/video/stream')
            ? await fetchVideoAsBlobUrl(resolveVideoUrl(res.url))
            : res.url;
          if (cancelled) return;
          setUrl(playableUrl);
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
