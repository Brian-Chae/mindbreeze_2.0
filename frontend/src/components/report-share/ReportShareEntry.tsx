// 진입 버튼 + 시트 + (회원) 이력 카드 묶음 (SDD-327 T15)
import { useState } from 'react';
import { buttonClass } from '../ui';
import ReportShareSheet, { type ReportShareMode } from './ReportShareSheet';
import ReportShareHistoryCard from './ReportShareHistoryCard';

export interface ReportShareEntryProps {
  reportId: string;
  mode: ReportShareMode;
  subtitle?: string;
  defaultRecipient?: string | null;
  onNativeShare?: () => void;
  /** 이력 카드 노출(회원 기본 true) */
  showHistory?: boolean;
}

export default function ReportShareEntry({
  reportId, mode, subtitle, defaultRecipient, onNativeShare, showHistory = mode === 'member',
}: ReportShareEntryProps) {
  const [open, setOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <>
      <button type="button" data-print-exclude onClick={() => setOpen(true)} className={buttonClass({ variant: 'secondary' })}>
        ↗ 리포트 보내기
      </button>
      {open && (
        <ReportShareSheet
          reportId={reportId}
          mode={mode}
          subtitle={subtitle}
          defaultRecipient={defaultRecipient}
          onNativeShare={onNativeShare}
          onClose={() => setOpen(false)}
          onSent={() => setRefreshKey((k) => k + 1)}
        />
      )}
      {showHistory && <ReportShareHistoryCard reportId={reportId} refreshKey={refreshKey} />}
    </>
  );
}
