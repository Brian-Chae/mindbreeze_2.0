// 서사형 리포트 커버 — ReportDetailPage / 토큰 열람 페이지 공용 (SDD-045 · SDD-052)

import type { AdaptedReportContent, ReportDto } from '../../lib/api/reports';
import { buildReportSessionInfo } from '../../lib/report/session-info';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function ReportCoverSection({
  report,
  adapted,
}: {
  report: ReportDto;
  adapted: AdaptedReportContent;
}) {
  const headline = adapted.headline ?? '리포트';
  const sessionTitle = report.session_title || headline;
  const sessionType = report.session_type ?? '-';
  const info = buildReportSessionInfo(report, adapted);
  const summaryRows: Array<[string, string]> = [
    ['클래스', info.className ?? '클래스 정보 없음'],
    ['진행 시간', info.timeLabel ?? '진행 시간 정보 없음'],
    ['기록된 신호', info.recordedSignals ?? '신호 정보 없음'],
    ['데이터 품질', info.qualityLabel ?? '측정 품질 정보가 제공되지 않았어요.'],
  ];

  return (
    <section className="report-print-cover relative overflow-hidden rounded-2xl border border-[#EFEFEF] bg-[#F5EDFC] p-8 mobile:p-4 frame:p-4">
      <div className="absolute right-6 top-8 opacity-40 pointer-events-none" aria-hidden>
        <svg width="120" height="120" viewBox="0 0 240 240">
          <g fill="none" stroke="#5F0080" strokeWidth="1.5">
            <ellipse cx="120" cy="120" rx="95" ry="44" transform="rotate(-32 120 120)" opacity=".25" />
            <ellipse cx="120" cy="120" rx="70" ry="70" opacity=".3" />
          </g>
          <circle cx="187" cy="76" r="8" fill="#59CE90" />
        </svg>
      </div>

      <div className="relative z-10">
        <p className="text-[12px] mobile:text-mb-caption frame:text-mb-caption font-bold tracking-[1.5px] text-[#5F0080]">
          MIND BREEZE · 몸·마음 리포트
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[12px] mobile:text-mb-caption frame:text-mb-caption font-bold bg-white text-[#5F0080] border border-[#E8D9F5]">
            {report.type === 'counselor' ? '상담사용' : '내담자용'}
          </span>
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[12px] mobile:text-mb-caption frame:text-mb-caption font-bold bg-white text-[#5F0080] border border-[#E8D9F5]">
            {sessionType}
          </span>
          {adapted.coverReasonChip && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[12px] mobile:text-mb-caption frame:text-mb-caption font-bold bg-amber-50 text-amber-800 border border-amber-200">
              {adapted.coverReasonChip}
            </span>
          )}
        </div>
        <h1 className="mobile:text-mb-title frame:text-mb-title mobile:[overflow-wrap:anywhere] frame:[overflow-wrap:anywhere] mt-4 text-[24px] font-extrabold tracking-tight text-[#5F0080] leading-snug">
          {sessionTitle}
        </h1>
        <p className="mt-2 text-[15px] mobile:text-mb-body frame:text-mb-body text-[#6D547A]">
          오늘 나에게 일어난 작은 변화를 만나보세요.
        </p>
        <div className="report-print-date mt-4 text-[13px] mobile:text-mb-caption frame:text-mb-caption text-[#6F6F6F] font-mono">
          {formatDate(report.scheduled_at ?? report.created_at)}
        </div>
        <p className="report-print-participant hidden">
          {report.participant_name ? `${report.participant_name}님을 위한 기록` : '참여자 정보 없음'}
        </p>
        <dl data-testid="cover-session-summary" className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-[13px] mobile:text-mb-caption frame:text-mb-caption">
          {summaryRows.map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <dt className="shrink-0 font-bold text-[#5F0080]">{label}</dt>
              <dd className="m-0 text-[#4A3A55] mobile:[overflow-wrap:anywhere] frame:[overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
        {report.sent_at && (
          <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#F0F9F5] text-[12px] mobile:text-mb-caption frame:text-mb-caption font-bold text-[#26724B] border border-[#D8EFE3]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            승인 완료
          </div>
        )}
      </div>
    </section>
  );
}
