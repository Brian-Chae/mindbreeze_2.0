// 내담자용 리포트 상세 — AppShell 없음, 승인 버튼 없음
// EEG: 어댑터 기반, 상위 지표 + 쉬운 라벨, not_measured 시 미노출

import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import ClientReportViewer from '../../components/reports/ClientReportViewer';
import { getReport, type ReportDto } from '../../lib/api/reports';

export default function ClientReportDetailPage() {
  const location = useLocation();
  const id = location.pathname.match(/\/app\/reports\/([^/]+)$/)?.[1];
  const navigate = useNavigate();
  const [report, setReport] = useState<ReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setError('리포트를 찾을 수 없습니다');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setReport(null);
    setError(null);
    getReport(id)
      .then((r) => {
        if (cancelled) return;
        setReport(r);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : '리포트 조회 실패');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center">
        <div className="text-[#6F6F6F] text-sm">불러오는 중...</div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] p-6">
        <div className="max-w-4xl mx-auto">
          {error ? (
            <div className="p-4 rounded-xl bg-red-50 text-red-700 text-sm mb-4" role="alert">
              {error}
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-white border border-[#EFEFEF] text-[#6F6F6F] text-sm mb-4">
              표시할 리포트가 없습니다
            </div>
          )}
          <button
            onClick={() => navigate('/app/reports')}
            className="px-5 py-2.5 rounded-xl bg-white border border-[#EFEFEF] text-[14px] text-[#1F1F1F] hover:bg-[#F5F5F5] transition-colors"
          >
            목록으로
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <ClientReportViewer report={report} onClose={() => navigate('/app/reports')} closeLabel="목록으로" />
    </div>
  );
}
