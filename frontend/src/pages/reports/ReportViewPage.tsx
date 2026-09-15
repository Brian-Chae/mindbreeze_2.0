// SDD-052 — 메일 토큰 기반 리포트 열람 (로그인 불필요)
// 상담사 ReportDetailPage와 동일한 커버 + NarrativeSections 서사 디자인

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import NarrativeSections from '../../components/reports/NarrativeSections';
import ReportCoverSection from '../../components/reports/ReportCoverSection';
import { ApiError } from '../../lib/api/client';
import {
  adaptReportContent,
  getReportView,
  type ReportDto,
} from '../../lib/api/reports';

function tokenErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) {
      return '링크가 만료되었거나 유효하지 않습니다. 메일의 최신 링크를 확인해 주세요.';
    }
    if (err.status === 404) {
      return '리포트를 찾을 수 없습니다.';
    }
    return err.message;
  }
  return err instanceof Error ? err.message : '리포트를 불러오지 못했습니다.';
}

export default function ReportViewPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token')?.trim() ?? '';

  const [report, setReport] = useState<ReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('유효한 리포트 링크가 아닙니다. 메일에서 다시 열어 주세요.');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getReportView(token)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((e) => {
        if (!cancelled) setError(tokenErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-6">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-2 border-[#5F0080] border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-[#6F6F6F] text-sm">리포트를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-[#EFEFEF] p-8 text-center">
          <p className="text-[11px] font-bold tracking-[1.5px] text-[#5F0080] mb-4">
            MIND BREEZE
          </p>
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-[#F5EDFC] flex items-center justify-center">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#5F0080"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 className="text-[18px] font-bold text-[#1F1F1F] mb-2">
            리포트를 열 수 없습니다
          </h1>
          <p className="text-[14px] text-[#6F6F6F] leading-relaxed" role="alert">
            {error ?? '리포트 데이터가 없습니다.'}
          </p>
        </div>
      </div>
    );
  }

  const adapted = adaptReportContent(report.content, report.type);
  const { displayNarrative } = adapted;

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <header className="border-b border-[#EFEFEF] bg-white">
        <div className="max-w-4xl mx-auto px-5 py-4 flex items-center gap-2">
          <span className="text-[13px] font-extrabold tracking-wide text-[#5F0080]">
            MIND BREEZE
          </span>
          <span className="text-[12px] text-[#9B9B9B]">· 몸·마음 리포트</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-5 py-8 space-y-6">
        <ReportCoverSection report={report} adapted={adapted} />
        {displayNarrative && <NarrativeSections narrative={displayNarrative} />}
        <p className="text-center text-[11px] text-[#9B9B9B] pb-8">
          본 리포트는 의료 진단이 아닌 두뇌건강 관리 목적의 참고 자료입니다.
        </p>
      </main>
    </div>
  );
}
