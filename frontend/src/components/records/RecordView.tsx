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
  // SDD-085: 수동 기록 모드(마이크 오프)는 전사·요약이 없으므로 상담사 메모 탭만 노출
  const isManual = record.status === 'manual';
  const [tab, setTab] = useState<TabId>(isManual ? 'notes' : 'summary');

  const tabs: { id: TabId; label: string }[] = isManual
    ? [{ id: 'notes', label: '상담사 메모' }]
    : [
        { id: 'summary', label: 'AI 요약' },
        { id: 'transcript', label: '전사문' },
        { id: 'notes', label: '상담사 메모' },
      ];

  // 상태가 나중에 manual 로 갱신돼도 존재하지 않는 탭이 남지 않도록 보정
  const activeTab: TabId = isManual ? 'notes' : tab;

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
              activeTab === id
                ? 'border-b-2 border-[#5F0080] text-[#5F0080]'
                : 'text-[#6F6F6F] hover:text-[#1F1F1F]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-[200px]">
        {activeTab === 'summary' && (
          <AISummaryTab aiSummary={record.ai_summary} />
        )}
        {activeTab === 'transcript' && (
          <TranscriptTab
            segments={transcript?.segments ?? []}
            status={transcript?.status ?? record.status}
          />
        )}
        {activeTab === 'notes' && (
          <CounselorNotesTab record={record} onUpdated={onUpdated} />
        )}
      </div>
    </div>
  );
}
