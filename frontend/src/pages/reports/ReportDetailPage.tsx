// AI 리포트 상세 페이지 — SDD-045 서사형
// 순서: Cover(점수 최소화) → 서사(종합→몸→마음→마무리) → 상담 본문 → EEG 보조(7지표/타임라인)
// LINK BAND 미착용(not_measured) 시 EEG 섹션 DOM 미노출
// SDD-064 — 본문은 ReportDetailView로 추출 (모달 재사용)

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import ReportDetailView from '../../components/reports/ReportDetailView';
import { getReport, type ReportDto } from '../../lib/api/reports';

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<ReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    getReport(id)
      .then(setReport)
      .catch((e) => setError(e instanceof Error ? e.message : '리포트 조회 실패'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <AppShell title="리포트 상세" sub="AI REPORT DETAIL">
        <div className="text-[#6F6F6F]">불러오는 중...</div>
      </AppShell>
    );
  }

  if (error && !report) {
    return (
      <AppShell title="리포트 상세" sub="AI REPORT DETAIL">
        <div className="p-4 rounded-xl bg-red-50 text-red-700 text-sm mb-4">{error}</div>
        <button
          type="button"
          onClick={() => navigate('/reports')}
          className="mb-btn mb-btn-secondary text-[14px] px-5 py-2.5 rounded-xl"
        >
          목록으로
        </button>
      </AppShell>
    );
  }

  if (!report) return null;

  return (
    <AppShell title="리포트 상세" sub="BODY · MIND REPORT">
      <ReportDetailView
        report={report}
        onReportChange={setReport}
        error={error}
        showListAction
        listActionLabel="목록으로"
        onListAction={() => navigate('/reports')}
      />
    </AppShell>
  );
}
