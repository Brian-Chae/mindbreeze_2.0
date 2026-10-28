// SDD-253 D6 — 회원: 지난 승인 리포트와 서사를 나란히 읽는다.
// 같은 상담사·같은 활동의 승인된 본인 리포트만 쓰고, 수치 비교·점수·순위는 만들지 않는다(수치 비교는 후속).
import { useEffect, useMemo, useState } from 'react';
import { listReports, type ReportDto } from '../../lib/api/reports';
import { isReportInReview } from '../../lib/report-review-copy';

function narrativeOf(report: ReportDto): { title: string; body: string } {
  const content = (report.content ?? {}) as Record<string, unknown>;
  const eeg = content.eeg as { narrative?: { journey?: string; closing?: string } } | undefined;
  const title = (content.headline as string | undefined) || report.session_title || '리포트';
  const body = eeg?.narrative?.journey || (content.summary as string | undefined) || '이 기록에는 서사 요약이 없습니다.';
  return { title, body };
}

function when(report: ReportDto): string {
  const d = new Date(report.scheduled_at ?? report.created_at ?? 0);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export default function PastReportsCompare({ current }: { current: ReportDto }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ReportDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || items) return;
    let cancelled = false;
    listReports()
      .then((r) => !cancelled && setItems(r.reports))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : '지난 리포트를 불러오지 못했습니다.'));
    return () => {
      cancelled = true;
    };
  }, [open, items]);

  const previous = useMemo(() => {
    if (!items) return null;
    const base = new Date(current.scheduled_at ?? current.created_at ?? 0).getTime();
    return items
      .filter((r) => r.id && r.id !== current.id && r.type === 'client' && !isReportInReview(r) && r.status !== 'pending_review')
      .filter((r) => (r.counselor_name ?? '') === (current.counselor_name ?? '') && (r.session_type ?? '') === (current.session_type ?? ''))
      .filter((r) => new Date(r.scheduled_at ?? r.created_at ?? 0).getTime() < base)
      .sort((a, b) => new Date(b.scheduled_at ?? b.created_at ?? 0).getTime() - new Date(a.scheduled_at ?? a.created_at ?? 0).getTime())[0] ?? null;
  }, [items, current]);

  return (
    <section data-print-exclude className="mx-auto mt-4 max-w-4xl px-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="min-h-11 whitespace-nowrap rounded-xl border border-[#E8D9F5] bg-white px-5 text-[15px] font-semibold text-[#5F0080] hover:bg-[#F5EDFC]"
      >
        {open ? '지난 리포트 닫기' : '지난 리포트와 함께 보기'}
      </button>
      {open && (
        <div className="mt-3 rounded-2xl border border-[#E8D9F5] bg-white p-5" role="region" aria-label="지난 리포트와 함께 보기">
          {error && <p role="alert" className="m-0 text-sm text-red-700">{error}</p>}
          {!error && !items && <p role="status" className="m-0 text-sm text-[#6F6F6F]">불러오는 중...</p>}
          {items && !previous && (
            <p className="m-0 text-[14px] text-[#6F6F6F]">
              함께 볼 지난 기록이 아직 없어요. 같은 상담사와의 이전 리포트가 승인되면 이곳에서 나란히 읽을 수 있습니다.
            </p>
          )}
          {previous && (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {[{ label: '지난 기록', report: previous }, { label: '이번 기록', report: current }].map(({ label, report }) => {
                  const n = narrativeOf(report);
                  return (
                    <article key={label} className="rounded-xl bg-[#F8F5EE] p-5">
                      <p className="m-0 text-[12px] font-semibold text-[#7D3399]">{label} · {when(report)}</p>
                      <h3 className="mb-0 mt-2 text-[16px] font-bold text-[#29272D]">{n.title}</h3>
                      <p className="mb-0 mt-2 text-[14px] leading-7 text-[#716578]">{n.body}</p>
                    </article>
                  );
                })}
              </div>
              <p className="mb-0 mt-3 text-[12px] text-[#8B8191]">두 기록의 이야기를 나란히 읽는 화면입니다. 수치를 비교해 좋고 나쁨을 가르지 않습니다.</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
