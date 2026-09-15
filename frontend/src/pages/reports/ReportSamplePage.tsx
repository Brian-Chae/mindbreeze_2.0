// 몸·마음 서사형 리포트 샘플 — codex 디자인 정본(NarrativeSections) 재사용
// 샘플 timeline → 규칙 기반 서사 → index.html 디자인으로 렌더링

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
      <div className="max-w-3xl mx-auto space-y-6">
        {/* 샘플 배지 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-bold bg-[#F5EDFC] text-[#5F0080] border border-[#E8D9F5]">
            샘플 리포트
          </span>
          <span className="text-[12px] text-[#6F6F6F]">
            실제 세션 데이터가 아닙니다. 규칙 기반 서사 미리보기입니다.
          </span>
        </div>

        {displayNarrative ? (
          <NarrativeSections narrative={displayNarrative} />
        ) : (
          <p className="text-[13px] text-[#6F6F6F]">샘플 서사를 생성할 수 없습니다.</p>
        )}
      </div>
    </AppShell>
  );
}
