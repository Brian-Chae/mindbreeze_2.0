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
    <div className="bg-white border border-[#DDDEE7] rounded-2xl p-5 space-y-4">
      {record.is_edited && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide bg-[#FFF4DC] text-[#8A6B1F]">
            편집됨 {record.edit_history.length}회
          </span>
        </div>
      )}

      <div className="flex gap-1 border-b border-[#EFEFEF]">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === id
                ? 'border-b-2 border-[#5F0080] text-[#5F0080]'
                : 'text-[#6F6F6F] hover:text-[#1F1F1F]'
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
