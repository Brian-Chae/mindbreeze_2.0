// SDD-253 D3·D4 — 승인자·시각 + 발송 결과(성공/실패) + 실패 시 '다시 발송'.
// 승인 완료와 발송 결과는 독립 사실이다. '발송 성공'은 메일 서비스 인계 기준이며 수신함 도착을 뜻하지 않는다.
import { useState } from 'react';
import { retryReportDelivery, type ReportDto } from '../../lib/api/reports';
import { DELIVERY_LABELS, FAILURE_LABELS, approverLabel, formatKst } from '../../lib/report-ops-labels';

interface Props {
  report: ReportDto;
  onChange: (next: ReportDto) => void;
}

export default function ReportApprovalStatus({ report, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (report.status !== 'completed' || report.type !== 'client') return null;

  const delivery = report.delivery_status ?? null;
  const failed = delivery === 'failed';
  const canRetry = failed && report.capabilities?.can_retry_delivery === true;

  const retry = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await retryReportDelivery(report.id!));
    } catch (e) {
      setError(e instanceof Error ? e.message : '다시 발송에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-print-exclude aria-label="승인과 발송 상태" className="rounded-2xl border border-[#E8D9F5] bg-[#FDFAFF] p-5">
      <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[14px]">
        <dt className="text-[#7C7482]">승인</dt>
        <dd className="font-semibold text-[#2F2833]">
          승인 완료 · {approverLabel(report)}
          {report.approved_at && <span className="ml-2 font-normal text-[#7C7482]">{formatKst(report.approved_at)}</span>}
        </dd>
        <dt className="text-[#7C7482]">발송</dt>
        <dd className={`font-semibold ${failed ? 'text-[#994C25]' : 'text-[#2F2833]'}`}>
          {delivery ? DELIVERY_LABELS[delivery] ?? delivery : '발송 기록 없음'}
          {report.delivery_attempted_at && (
            <span className="ml-2 font-normal text-[#7C7482]">{formatKst(report.delivery_attempted_at)}</span>
          )}
          {failed && report.delivery_failure_code && (
            <span className="ml-2 font-normal text-[#994C25]">
              {FAILURE_LABELS[report.delivery_failure_code] ?? '발송에 실패했습니다'}
            </span>
          )}
        </dd>
      </dl>
      {delivery === 'sent' && (
        <p className="mt-2 text-[12px] text-[#7C7482]">메일 서비스에 전달된 기준이며 수신함 도착이나 열람을 뜻하지 않습니다.</p>
      )}
      {canRetry && (
        <div className="mt-3">
          <button
            type="button"
            onClick={retry}
            disabled={busy}
            aria-busy={busy}
            className="inline-flex h-11 items-center justify-center whitespace-nowrap rounded-xl border border-[#DCC6B8] bg-[#FFFAF6] px-5 text-[14px] font-semibold text-[#994C25] hover:bg-[#FFF3EA] disabled:opacity-50"
          >
            {busy ? '다시 발송 중...' : '다시 발송'}
          </button>
        </div>
      )}
      {error && <div role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    </section>
  );
}
