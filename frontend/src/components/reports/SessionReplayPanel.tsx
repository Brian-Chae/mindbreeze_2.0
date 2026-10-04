// 세션 영상 플레이어 + 상담 기록지 결합 뷰 (counselor 리포트 전용)
// 좌측 = 영상 플레이어, 우측 = 발화자 구분 기록지 (기록지 클릭 → 영상 seek)
import { useRef } from 'react';
import { VideoPlayer, type VideoPlayerHandle } from './VideoPlayer';
import TranscriptTimeline from './TranscriptTimeline';
import type { TranscriptSegment } from '../../lib/api/report';
import { ENABLE_STT_AI_RECORD } from '../../lib/features';

export default function SessionReplayPanel({
  sessionId,
  segments,
}: {
  sessionId: string;
  segments: TranscriptSegment[] | null;
}) {
  const videoRef = useRef<VideoPlayerHandle>(null);
  // STT AI 기록 MVP 비활성 — 전사 기록지를 노출하지 않고 영상 재생만 남긴다.
  const hasTranscript =
    ENABLE_STT_AI_RECORD && Boolean(segments && segments.length > 0);

  return (
    <div
      className={`grid gap-4 ${
        hasTranscript ? 'lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]' : ''
      }`}
      data-testid="session-replay-panel"
    >
      {/* 좌측 — 영상 플레이어 */}
      <div className="min-w-0">
        <VideoPlayer ref={videoRef} sessionId={sessionId} />
      </div>

      {/* 우측 — 상담 기록지 (스크롤) */}
      {hasTranscript && (
        <div className="min-h-0 lg:max-h-[520px] lg:overflow-y-auto lg:pr-1">
          <TranscriptTimeline
            segments={segments as TranscriptSegment[]}
            onSeek={(sec) => videoRef.current?.seekTo(sec)}
          />
        </div>
      )}
    </div>
  );
}
