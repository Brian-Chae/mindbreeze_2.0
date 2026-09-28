// STT 발화자 구분 기록지 — counselor 리포트 전용 (SDD-013 diarization 결과)
import type { TranscriptSegment } from '../../lib/api/report';

function formatTimestamp(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00';
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(Math.floor(sec % 60)).padStart(2, '0');
  return `${mm}:${ss}`;
}

function speakerLabel(speaker: string): { label: string; tone: string; color: string } {
  if (speaker === 'counselor') {
    return { label: '상담사', tone: 'text-[#5F0080]', color: 'bg-[#F5EDFC] border-[#E8D9F5]' };
  }
  if (speaker === 'client') {
    return { label: '내담자', tone: 'text-[#26724B]', color: 'bg-[#F0F9F5] border-[#D8EFE3]' };
  }
  return { label: '발화자', tone: 'text-[#6F6F6F]', color: 'bg-[#F9F9F9] border-[#EFEFEF]' };
}

export default function TranscriptTimeline({
  segments,
  onSeek,
}: {
  segments: TranscriptSegment[];
  onSeek?: (sec: number) => void;
}) {
  return (
    <div className="space-y-2" data-testid="transcript-timeline">
      {segments.map((seg, i) => {
        const meta = speakerLabel(seg.speaker);
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSeek?.(seg.start)}
            disabled={!onSeek}
            className={`flex w-full gap-3 rounded-xl border px-4 py-2.5 text-left ${meta.color} ${
              onSeek ? 'cursor-pointer transition hover:opacity-80' : 'cursor-default'
            }`}
          >
            <div className="flex w-16 shrink-0 flex-col items-start gap-0.5">
              <span className={`text-[12px] font-bold ${meta.tone}`}>{meta.label}</span>
              <span className="font-mono text-[11px] text-[#9B9B9B]">
                {formatTimestamp(seg.start)}
              </span>
            </div>
            <p className="min-w-0 flex-1 text-[14px] leading-relaxed text-[#1F1F1F] whitespace-pre-wrap">
              {seg.text}
            </p>
          </button>
        );
      })}
    </div>
  );
}
