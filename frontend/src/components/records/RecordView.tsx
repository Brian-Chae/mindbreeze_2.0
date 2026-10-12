// AI 기록지 3탭 통합 뷰어 (SDD-013)

import { useState } from 'react';
import type { RecordResponse, TranscriptResponse } from '../../lib/api/audio';
import { ENABLE_STT_AI_RECORD } from '../../lib/features';
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
  // SDD-085 G5 확장: 오디오 분석 신뢰도 낮으면 AI 요약 탭 숨김 — 원본 전사문·상담사 메모만
  const isLowConfidence = record.ai_summary?.transcript_confidence === 'low';
  // STT AI 기록 MVP 비활성 — AI 요약·전사문 탭을 노출하지 않고 상담사 메모만 남긴다.
  const showSttTabs = ENABLE_STT_AI_RECORD;
  const [tab, setTab] = useState<TabId>(
    showSttTabs ? (isManual ? 'notes' : isLowConfidence ? 'transcript' : 'summary') : 'notes',
  );

  const tabs: { id: TabId; label: string }[] = !showSttTabs
    ? [{ id: 'notes', label: '상담사 메모' }]
    : isManual
      ? [{ id: 'notes', label: '상담사 메모' }]
      : [
          ...(isLowConfidence ? [] : [{ id: 'summary' as TabId, label: 'AI 요약' }]),
          { id: 'transcript', label: '전사문' },
          { id: 'notes', label: '상담사 메모' },
        ];

  // 상태가 나중에 manual/low 로 갱신돼도 존재하지 않는 탭이 남지 않도록 보정
  const activeTab: TabId = !showSttTabs
    ? 'notes'
    : isManual
      ? 'notes'
      : isLowConfidence && tab === 'summary'
        ? 'transcript'
        : tab;

  return (
    <div className="bg-white border border-[#DDDEE7] rounded-2xl p-5 space-y-4">
      {record.is_edited && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-bold tracking-wide bg-[#FFF4DC] text-[#8A6B1F]">
            편집됨 {record.edit_history.length}회
          </span>
        </div>
      )}

      {showSttTabs && isLowConfidence && (
        <div className="rounded-xl border border-[#F5E2B8] bg-amber-50 px-4 py-3 text-sm text-[#8A6B1F]">
          오디오 분석 신뢰도가 낮아 AI 요약을 제공하지 않습니다. 아래 전사문은 녹음 원본을 그대로
          옮긴 것입니다.
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
