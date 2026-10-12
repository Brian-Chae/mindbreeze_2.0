// 개선 5: 상담사 상단 — 무음 시그널 유형별 집계 카운트만 조용히 표시한다.
//
// 개별 참여자 알림(소리·팝업) 없이 "몇 명이 어떤 상태인지"만 남긴다.
// 카운트가 0이면 아무것도 렌더하지 않는다(화면 소음 방지).

import { signalCountParts, type ClassSignalCounts } from '../../lib/class/quiet-signal';

interface QuietSignalSummaryProps {
  counts: ClassSignalCounts;
}

export function QuietSignalSummary({ counts }: QuietSignalSummaryProps) {
  const parts = signalCountParts(counts);
  if (parts.length === 0) return null;

  return (
    <span
      className="inline-flex flex-wrap items-center gap-2 rounded-full bg-[#F2F3F8] px-3 py-1.5 text-[12px] font-medium text-[#6F6F6F]"
      aria-label={`조용한 신호 집계 — ${parts.join(', ')}`}
    >
      <span className="text-[12px] font-mono uppercase tracking-wider text-[#9B9B9B]">
        조용한 신호
      </span>
      {parts.map((part) => (
        <span key={part} className="tabular-nums">
          {part}
        </span>
      ))}
    </span>
  );
}
