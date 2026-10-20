import { useCallback, useEffect, useRef, useState } from 'react';
import {
  classReportsApi,
  type ReportJob,
  type ReportJobItem,
} from '../../../lib/api/class-reports';
import { excludedReasonText } from './report-status';
import { operationError } from './class-operation-state';

/** SDD-218 R2: 일괄 작업의 접수 → 권한 재검사 → 건별 처리 단계와 결과.
 *
 * 재시도 가능한 실패와 정책상 처리 제외를 섞어 보여주지 않는다.
 * 제외 건에는 재시도 수단을 아예 그리지 않는다.
 */

const POLL_MS = 1500;

function StepMark({ tone }: { tone: 'done' | 'busy' | 'warn' }) {
  const styles = {
    done: 'bg-[#E3F8F2] text-[#0B6B55]',
    busy: 'bg-[#EDE7F6] text-[#5B3E8C]',
    warn: 'bg-[#FBEAE3] text-[#8A3A1F]',
  }[tone];
  return (
    <span className={`grid h-6 w-6 flex-none place-items-center rounded-full ${styles}`} aria-hidden>
      <svg viewBox="0 0 18 18" className="h-4 w-4 fill-none stroke-current stroke-2" strokeLinecap="round">
        {tone === 'done' ? <path d="M3 9l4 4 8-9" /> : <path d="M9 4v6M9 13v1" />}
      </svg>
    </span>
  );
}

function ItemRow({ item, name }: { item: ReportJobItem; name?: string }) {
  const label = name ?? item.report_id.slice(0, 8);
  if (item.state === 'excluded') {
    return (
      <li className="flex min-h-[52px] flex-wrap items-center gap-3 border-b border-[#ECE6F0] py-2 last:border-b-0">
        <span className="w-24 font-semibold">{label}</span>
        <span className="inline-flex min-h-[28px] items-center rounded-lg border border-[#97909C] bg-[#F4F1F6] px-3 text-xs font-semibold text-[#62586A]">
          처리 제외
        </span>
        <span className="text-sm text-[#6F6F6F]">{excludedReasonText(item.reason_code)}</span>
        {/* 제외 건에는 재시도 수단을 노출하지 않는다. */}
      </li>
    );
  }
  if (item.state === 'failed') {
    return (
      <li className="flex min-h-[52px] flex-wrap items-center gap-3 border-b border-[#ECE6F0] py-2 last:border-b-0">
        <span className="w-24 font-semibold">{label}</span>
        <span className="inline-flex min-h-[28px] items-center rounded-lg border border-dashed border-[#B77760] bg-[#FBEAE3] px-3 text-xs font-semibold text-[#8A3A1F]">
          실패
        </span>
        <span className="text-sm text-[#6F6F6F]">{item.error_message ?? '잠시 후 다시 시도해 주세요'}</span>
      </li>
    );
  }
  return (
    <li className="flex min-h-[52px] flex-wrap items-center gap-3 border-b border-[#ECE6F0] py-2 last:border-b-0">
      <span className="w-24 font-semibold">{label}</span>
      <span className="inline-flex min-h-[28px] items-center rounded-full border border-[#90C4B5] bg-[#E3F8F2] px-3 text-xs font-semibold text-[#0B6B55]">
        {item.state === 'succeeded' ? '완료' : '대기 중'}
      </span>
      {item.processed_at && (
        <span className="text-sm text-[#6F6F6F]">
          {new Date(item.processed_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </li>
  );
}

export function ClassReportJobPanel({
  classId,
  job: initialJob,
  names,
  onClose,
}: {
  classId: string;
  job: ReportJob;
  names?: Record<string, string>;
  onClose?: () => void;
}) {
  const [job, setJob] = useState<ReportJob>(initialJob);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  // 작업이 끝날 때까지만 폴링한다.
  useEffect(() => {
    if (job.status === 'completed') return;
    const version = ++generation.current;
    const timer = window.setInterval(() => {
      void classReportsApi
        .getJob(classId, job.job_id)
        .then((next) => {
          if (version === generation.current) setJob(next);
        })
        .catch((e) => {
          if (version === generation.current) setError(operationError(e));
        });
    }, POLL_MS);
    return () => {
      window.clearInterval(timer);
      generation.current += 1;
    };
  }, [classId, job.job_id, job.status]);

  const retry = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      setJob(await classReportsApi.retryJob(classId, job.job_id));
    } catch (e) {
      setError(operationError(e));
    } finally {
      setBusy(false);
    }
  }, [classId, job.job_id]);

  const succeeded = job.items.filter((i) => i.state === 'succeeded').length;
  const failed = job.items.filter((i) => i.state === 'failed');
  const excluded = job.items.filter((i) => i.state === 'excluded');
  const pending = job.items.filter((i) => i.state === 'pending');
  const processed = succeeded + failed.length + excluded.length;
  const actionLabel = { approve: '승인', regenerate: '재생성', resend_email: '메일 재발송' }[job.action];

  return (
    <section className="space-y-6 rounded-2xl border border-[#ECE6F0] bg-white p-6">
      <header className="space-y-1">
        <h2 className="text-lg font-bold">일괄 {actionLabel} 작업</h2>
        <p className="text-sm text-[#6F6F6F]">
          대상 {job.accepted}건 · 작업번호 {job.job_id.slice(0, 8)}
          {job.on_behalf && ' · 주강사 대행'}
        </p>
      </header>

      <ol className="space-y-3">
        <li className="flex gap-4">
          <StepMark tone="done" />
          <div>
            <b className="text-sm">작업 접수됨</b>
            <p className="text-sm text-[#9B9B9B]">
              요청을 받았어요. 처리 결과는 아래에서 이어서 보여드려요.
            </p>
          </div>
        </li>
        <li className="flex gap-4">
          <StepMark tone="done" />
          <div>
            <b className="text-sm">대상 확정 · 권한 재검사</b>
            <p className="text-sm text-[#9B9B9B]">
              실행 시점에 권한을 다시 확인했어요. 처리 제외 {excluded.length}건.
            </p>
          </div>
        </li>
        <li className="flex gap-4">
          <StepMark tone={failed.length > 0 ? 'warn' : job.status === 'completed' ? 'done' : 'busy'} />
          <div className="flex-1 space-y-2">
            <b className="text-sm">
              건별 처리 — {succeeded}건 완료
              {failed.length > 0 && ` · ${failed.length}건 실패`}
            </b>
            <div
              className="h-2 max-w-sm overflow-hidden rounded-full bg-[#EFEAF3]"
              role="progressbar"
              aria-valuenow={processed}
              aria-valuemin={0}
              aria-valuemax={job.items.length}
            >
              <span
                className="block h-full rounded-full bg-[#5F0080]"
                style={{ width: `${job.items.length ? (processed / job.items.length) * 100 : 0}%` }}
              />
            </div>
            <p className="text-sm text-[#9B9B9B]">
              같은 건을 다시 승인해도 메일과 알림이 중복으로 가지 않아요.
            </p>
          </div>
        </li>
      </ol>

      <ul className="border-t border-[#ECE6F0] pt-2">
        {job.items.map((item) => (
          <ItemRow key={item.report_id} item={item} name={names?.[item.report_id]} />
        ))}
      </ul>

      {job.status === 'completed' && pending.length > 0 && (
        <p role="status" className="text-sm text-[#8A3A1F]">
          {pending.length}건이 아직 처리되지 않았어요. 자동으로 이어서 처리하지 않으니, 잠시 후 목록에서 해당 건을 다시 선택해 직접 다시 시도해 주세요.
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-[#8A3A1F]">
          {error}
        </p>
      )}

      <footer className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-[#9B9B9B]">
          실패한 건만 다시 시도할 수 있어요. 완료된 건은 다시 실행해도 그대로예요.
        </p>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-full bg-[#EFEAF3] px-5 text-sm font-bold text-[#6F6F6F]"
          >
            닫기
          </button>
        )}
        {failed.length > 0 && (
          <button
            type="button"
            onClick={() => void retry()}
            disabled={busy}
            className="min-h-[44px] rounded-full border-[1.5px] border-[#5F0080] px-5 text-sm font-bold text-[#5F0080] disabled:opacity-40"
          >
            실패 {failed.length}건 다시 시도
          </button>
        )}
      </footer>
    </section>
  );
}
