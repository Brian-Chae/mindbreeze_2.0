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
    return <p className="text-sm text-neutral-500">전사 처리 중입니다... (status: {status})</p>;
  }
  if (segments.length === 0) {
    return <p className="text-sm text-neutral-500">전사문이 없습니다.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="전사문 검색..."
          className="w-full rounded-lg border border-neutral-300 py-2 pl-9 pr-3 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
        <svg
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-neutral-500">검색 결과가 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((seg, i) => (
            <div
              key={i}
              className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
            >
              <div className="flex items-center justify-between text-xs text-neutral-500">
                <span className="font-medium text-indigo-600 dark:text-indigo-400">
                  {SPEAKER_LABELS[seg.speaker] ?? seg.speaker}
                </span>
                <span>
                  {seg.start.toFixed(1)}s ~ {seg.end.toFixed(1)}s
                </span>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
                {seg.text}
              </p>
            </div>
          ))}
        </div>
      )}

      {search && (
        <p className="text-xs text-neutral-400">
          검색 결과: {filtered.length} / {segments.length}개
        </p>
      )}
    </div>
  );
}
