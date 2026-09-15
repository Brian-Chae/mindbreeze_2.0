// 몸·마음 서사형 리포트 샘플 — codex 디자인 정본(NarrativeSections) 재사용
// 샘플 timeline → 규칙 기반 서사 → index.html 디자인으로 렌더링

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import NarrativeSections from '../../components/reports/NarrativeSections';
import {
  resolveDisplayNarrative,
  type TimelineLikePoint,
} from '../../lib/report/resolve-narrative';

/** 샘플 mock timeline — 6지표 · 5시점 (0~20분) */
const SAMPLE_TIMELINE: TimelineLikePoint[] = [
  { min: 0, respiratory_rate: 16.8, heart_rate: 78, sdnn: 32, concentration: 42, relaxation: 38, stress: 55 },
  { min: 5, respiratory_rate: 16.2, heart_rate: 76, sdnn: 34, concentration: 48, relaxation: 41, stress: 53 },
  { min: 10, respiratory_rate: 15.5, heart_rate: 74, sdnn: 36, concentration: 55, relaxation: 44, stress: 51 },
  { min: 15, respiratory_rate: 14.9, heart_rate: 73, sdnn: 38, concentration: 58, relaxation: 46, stress: 49 },
  { min: 20, respiratory_rate: 14.4, heart_rate: 73, sdnn: 40, concentration: 60, relaxation: 48, stress: 48 },
];

const displayNarrative = resolveDisplayNarrative({
  narrative: null,
  timeline: SAMPLE_TIMELINE,
});

export function SampleReportContent() {
  return displayNarrative ? <NarrativeSections narrative={displayNarrative} isSample session={{
    participantName: '지우',
    dateLabel: '2026년 9월 15일 화요일 · 예시 참여자',
    shortDate: '2026. 09. 15',
    className: '나를 돌보는 호흡 명상',
    timeLabel: '오후 2:00–2:20 · 20분',
    durationMinutes: 20,
    recordedSignals: '뇌파 · 맥파 · 호흡',
    qualityLabel: '디자인 예시 · 실제 신뢰도는 측정 후 제공',
  }} /> : <p>샘플 서사를 생성할 수 없습니다.</p>;
}

/** native dialog가 배경 비활성화·포커스 제한·Escape 닫기를 담당한다. */
export function ReportSampleModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);
  return createPortal(
    <dialog ref={dialogRef} className="report-sample-modal" aria-labelledby="sample-report-title" onCancel={onClose}>
      <div className="report-sample-toolbar">
        <h2 id="sample-report-title">샘플 리포트 · 예시 데이터</h2>
        <button type="button" onClick={onClose} autoFocus aria-label="샘플 리포트 닫기">닫기 <span aria-hidden="true">×</span></button>
      </div>
      <div className="report-sample-scroll"><SampleReportContent /></div>
    </dialog>, document.body,
  );
}

export default function ReportSamplePage() {
  return (
    <AppShell
      title="샘플 리포트"
      sub="BODY · MIND SAMPLE"
      rightSlot={
        <Link
          to="/reports"
          className="text-[13px] font-semibold text-[#5F0080] hover:underline"
        >
          목록으로
        </Link>
      }
    >
      <div className="max-w-[1160px] mx-auto space-y-6">
        {/* 샘플 배지 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-bold bg-[#F5EDFC] text-[#5F0080] border border-[#E8D9F5]">
            샘플 리포트
          </span>
          <span className="text-[12px] text-[#6F6F6F]">
            실제 세션 데이터가 아닙니다. 규칙 기반 서사 미리보기입니다.
          </span>
        </div>

        <SampleReportContent />
      </div>
    </AppShell>
  );
}
