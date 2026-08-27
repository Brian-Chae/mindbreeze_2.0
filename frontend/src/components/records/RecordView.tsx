// AI 기록지 3탭 통합 뷰어 (SDD-013)

import { useState } from 'react';
import type { RecordResponse, TranscriptResponse } from '../../lib/api/audio';
import { AISummaryTab } from './AISummaryTab';
import { TranscriptTab } from './TranscriptTab';
import { CounselorNotesTab } from './CounselorNotesTab';

type TabId = 'summary' | 'transcript' | 'notes';

interface Props {
  record: RecordResponse;
  transcript: TranscriptResponse | null;
  onUpdated: (r: RecordResponse) => void;
}

export function RecordView({ record, transcript, onUpdated }: Props) {
  const [tab, setTab] = useState<TabId>('summary');

  const tabs: { id: TabId; label: string }[] = [
    { id: 'summary', label: 'AI 요약' },
    { id: 'transcript', label: '전사문' },
    { id: 'notes', label: '상담사 메모' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            record.status === 'completed'
              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
              : record.status === 'processing'
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
          }`}
        >
          상태: {record.status}
        </span>
        {record.is_edited && (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            편집됨 ({record.edit_history.length}회)
          </span>
        )}
      </div>

      <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === id
                ? 'border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-[200px]">
        {tab === 'summary' && (
          <AISummaryTab aiSummary={record.ai_summary} />
        )}
        {tab === 'transcript' && (
          <TranscriptTab
            segments={transcript?.segments ?? []}
            status={transcript?.status ?? record.status}
          />
        )}
        {tab === 'notes' && (
          <CounselorNotesTab record={record} onUpdated={onUpdated} />
        )}
      </div>
    </div>
  );
}
