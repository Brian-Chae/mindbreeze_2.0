// 전사문 탭 — 화자별 타임라인 + 텍스트 검색

import { useState, useMemo } from 'react';
import type { TranscriptSegment } from '../../lib/api/audio';

interface Props {
  segments: TranscriptSegment[];
  status: string;
}

const SPEAKER_LABELS: Record<string, string> = {
  counselor: '상담사',
  client: '내담자',
  speaker_0: '화자 1',
  speaker_1: '화자 2',
};

export function TranscriptTab({ segments, status }: Props) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return segments;
    const q = search.toLowerCase();
    return segments.filter((s) => s.text.toLowerCase().includes(q));
  }, [segments, search]);

  if (status !== 'completed' && segments.length === 0) {
    return <p className="text-sm text-[#6F6F6F]">전사 처리 중입니다... (status: {status})</p>;
  }
  if (segments.length === 0) {
    return <p className="text-sm text-[#6F6F6F]">전사문이 없습니다.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="전사문 검색..."
          className="w-full rounded-xl border border-[#DDDEE7] py-2 pl-9 pr-3 text-sm text-[#1F1F1F] placeholder:text-[#9B9B9B] focus:outline-none focus:ring-2 focus:ring-[#5F0080]/20 focus:border-[#5F0080]"
        />
        <svg
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9B9B9B]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-[#6F6F6F]">검색 결과가 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((seg, i) => (
            <div
              key={i}
              className="rounded-2xl border border-[#DDDEE7] p-4"
            >
              <div className="flex items-center justify-between text-xs text-[#6F6F6F]">
                <span className="font-semibold text-[#5F0080]">
                  {SPEAKER_LABELS[seg.speaker] ?? seg.speaker}
                </span>
                <span className="font-mono">
                  {seg.start.toFixed(1)}s ~ {seg.end.toFixed(1)}s
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-[#1F1F1F]">
                {seg.text}
              </p>
            </div>
          ))}
        </div>
      )}

      {search && (
        <p className="text-xs text-[#9B9B9B]">
          검색 결과: {filtered.length} / {segments.length}개
        </p>
      )}
    </div>
  );
}
