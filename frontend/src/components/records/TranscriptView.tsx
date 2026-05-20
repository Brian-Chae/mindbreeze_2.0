// STT 전사문 뷰어

import type { TranscriptResponse } from '../../lib/api/audio';

interface Props {
  data: TranscriptResponse | null;
}

const SPEAKER_LABELS: Record<string, string> = {
  counselor: '상담사',
  client: '내담자',
};

export function TranscriptView({ data }: Props) {
  if (!data) return <p className="text-sm text-neutral-500">전사문이 없습니다.</p>;
  if (data.status !== 'completed' && data.segments.length === 0) {
    return <p className="text-sm text-neutral-500">전사 처리 중입니다... (status: {data.status})</p>;
  }
  return (
    <div className="space-y-2">
      {data.segments.map((seg, i) => (
        <div key={i} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span className="font-medium text-indigo-600 dark:text-indigo-400">
              {SPEAKER_LABELS[seg.speaker] ?? seg.speaker}
            </span>
            <span>
              {seg.start.toFixed(1)}s ~ {seg.end.toFixed(1)}s
            </span>
          </div>
          <p className="mt-1 text-sm text-neutral-800 dark:text-neutral-200">{seg.text}</p>
        </div>
      ))}
    </div>
  );
}
