import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { classOperationsApi } from '../../../lib/api/class-operations';
import {
  classReportsApi,
  newOperationKey,
  type JobAction,
  type ReportJob,
} from '../../../lib/api/class-reports';
import { operationError } from './class-operation-state';
import { REPORT_STATUS, sessionStatus, type ReportStatusKey } from './report-status';
import { ClassReportJobPanel } from './class-report-job';

/** SDD-218 R1: 클래스 리포트 관리.
 *
 * 지금 조치가 필요한 것이 먼저 읽히도록 요약 → 필터 → 회차별 목록 순으로 둔다.
 * 결석·미대상 건은 선택할 수 없고, 선택 대상에서도 자동으로 빠진다.
 */

export interface SessionReportRow {
  session_id: string;
  order: number;
  scheduled_at: string | null;
  host_name: string | null;
  attended: number;
  absent: number;
  reports: {
    id: string;
    participant_name: string | null;
    status: string;
    /** 결석 등으로 일괄 작업 대상이 아닌 건. */
    selectable: boolean;
    note?: string;
  }[];
}

const FILTERS: { key: 'all' | ReportStatusKey; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'review', label: '검토 대기' },
  { key: 'partial', label: '실패 포함' },
  { key: 'busy', label: '생성 중' },
  { key: 'empty', label: '미생성' },
];

function StatusChip({ status }: { status: ReportStatusKey }) {
  const style = REPORT_STATUS[status];
  return (
    <span
      className={`inline-flex min-h-[32px] items-center gap-2 px-3 text-xs font-bold ${style.className}`}
    >
      {style.label}
    </span>
  );
}

function Checkbox({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`grid h-11 w-11 flex-none place-items-center ${disabled ? 'cursor-default' : ''}`}
    >
      <span
        className={`grid h-5 w-5 place-items-center rounded-md border-[1.5px] ${
          disabled
            ? 'border-[#E0D8E8] bg-[#F0ECF3]'
            : checked
              ? 'border-[#5F0080] bg-[#5F0080] text-white'
              : 'border-[#C9BFD4] bg-white'
        }`}
      >
        {checked && (
          <svg viewBox="0 0 18 18" className="h-3.5 w-3.5 fill-none stroke-current stroke-2" strokeLinecap="round">
            <path d="M3 9l4 4 8-9" />
          </svg>
        )}
      </span>
    </button>
  );
}

function countsOf(row: SessionReportRow) {
  const counts = { total: row.reports.length, approved: 0, pending: 0, generating: 0, failed: 0 };
  for (const report of row.reports) {
    if (report.status === 'completed') counts.approved += 1;
    else if (report.status === 'pending_review') counts.pending += 1;
    else if (report.status === 'pending_analysis') counts.generating += 1;
    else if (report.status === 'error') counts.failed += 1;
  }
  return counts;
}

export function ClassReportManage({
  classId,
  rows,
  loading,
}: {
  classId: string;
  rows: SessionReportRow[];
  loading?: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | ReportStatusKey>('all');
  const [job, setJob] = useState<ReportJob | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const operationKey = useRef<string | null>(null);

  // 목록이 바뀌면 사라진 대상의 선택을 버린다.
  useEffect(() => {
    const alive = new Set(rows.flatMap((r) => r.reports.map((x) => x.id)));
    setSelected((prev) => new Set([...prev].filter((id) => alive.has(id))));
  }, [rows]);

  const summary = useMemo(() => {
    let pending = 0;
    let failed = 0;
    let generating = 0;
    const sessionsWithPending = new Set<string>();
    for (const row of rows) {
      const counts = countsOf(row);
      pending += counts.pending;
      failed += counts.failed;
      generating += counts.generating;
      if (counts.pending > 0) sessionsWithPending.add(row.session_id);
    }
    return { pending, failed, generating, sessionCount: sessionsWithPending.size };
  }, [rows]);

  const visibleRows = useMemo(
    () =>
      filter === 'all'
        ? rows
        : rows.filter((row) => {
            const status = sessionStatus(countsOf(row));
            return filter === 'partial'
              ? status === 'partial' || status === 'failed'
              : status === filter;
          }),
    [rows, filter],
  );

  const names = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of rows)
      for (const report of row.reports)
        if (report.participant_name) map[report.id] = report.participant_name;
    return map;
  }, [rows]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // 선택이 바뀌면 새 작업으로 본다.
    operationKey.current = null;
  }, []);

  const run = useCallback(
    async (action: JobAction) => {
      if (selected.size === 0) return;
      setBusy(true);
      setError('');
      // 중복 클릭에도 같은 작업으로 묶이도록 키를 한 번만 만든다.
      operationKey.current ??= newOperationKey();
      try {
        setJob(
          await classReportsApi.createJob(classId, {
            action,
            operation_key: operationKey.current,
            targets: [...selected],
          }),
        );
      } catch (e) {
        setError(operationError(e));
        operationKey.current = null;
      } finally {
        setBusy(false);
      }
    },
    [classId, selected],
  );

  if (job) {
    return (
      <ClassReportJobPanel
        classId={classId}
        job={job}
        names={names}
        onClose={() => {
          setJob(null);
          setSelected(new Set());
          operationKey.current = null;
        }}
      />
    );
  }

  return (
    <section className="space-y-4">
      <header className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold">지금 확인할 일</h2>
          <span className="text-sm text-[#9B9B9B]">전체 {rows.length}회차</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-[#5F0080] p-4 text-white">
            <span className="text-sm">검토 대기</span>
            <b className="mt-1 block text-2xl">{summary.pending}건</b>
            <span className="text-sm text-[#D9CCE4]">{summary.sessionCount}개 회차 확인</span>
          </div>
          <div className="rounded-2xl bg-[#FBEAE3] p-4">
            <span className="text-sm text-[#8A3A1F]">생성 재시도</span>
            <b className="mt-1 block text-2xl text-[#8A3A1F]">{summary.failed}건</b>
            <span className="text-sm text-[#8A3A1F]">실패한 건만 처리</span>
          </div>
          <div className="rounded-2xl border border-[#ECE6F0] bg-white p-4">
            <span className="text-sm text-[#6F6F6F]">생성 중</span>
            <b className="mt-1 block text-2xl">{summary.generating}건</b>
          </div>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={filter === item.key}
            onClick={() => setFilter(item.key)}
            className={`min-h-[44px] rounded-full px-4 text-sm font-semibold ${
              filter === item.key
                ? 'border border-[#5F0080] bg-[#F5EDFC] text-[#5F0080]'
                : 'border border-[#ECE6F0] bg-white text-[#6F6F6F]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p role="status">리포트 현황을 불러오는 중이에요.</p>
      ) : visibleRows.length === 0 ? (
        <p className="text-sm text-[#6F6F6F]">해당하는 회차가 없어요.</p>
      ) : (
        <ul className="space-y-3">
          {visibleRows.map((row) => {
            const status = sessionStatus(countsOf(row));
            const open = expanded === row.session_id;
            return (
              <li key={row.session_id} className="overflow-hidden rounded-2xl border border-[#ECE6F0] bg-white">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : row.session_id)}
                  className="flex min-h-[64px] w-full flex-wrap items-center gap-3 px-4 py-2 text-left"
                >
                  <span className="w-14 flex-none font-bold">{row.order}회차</span>
                  <span className="min-w-[160px] flex-1">
                    <b className="block text-sm">
                      {row.scheduled_at
                        ? new Date(row.scheduled_at).toLocaleDateString('ko-KR', {
                            month: 'long',
                            day: 'numeric',
                            weekday: 'short',
                          })
                        : '일정 미정'}
                    </b>
                    <span className="text-sm text-[#6F6F6F]">
                      {row.host_name ? `진행 ${row.host_name} 지도사` : '진행자 미배정'} · 출석{' '}
                      {row.attended} / 결석 {row.absent}
                    </span>
                  </span>
                  <span className="min-w-[96px] text-sm text-[#6F6F6F]">
                    {row.reports.length > 0 ? `리포트 ${row.reports.length}건` : '—'}
                  </span>
                  <StatusChip status={status} />
                </button>

                {open && row.reports.length > 0 && (
                  <ul className="border-t border-[#ECE6F0] bg-[#FBF9F6] px-4 py-2">
                    {row.reports.map((report) => (
                      <li
                        key={report.id}
                        className="flex min-h-[52px] flex-wrap items-center gap-3 border-b border-[#ECE6F0] last:border-b-0"
                      >
                        <Checkbox
                          checked={selected.has(report.id)}
                          disabled={!report.selectable}
                          onChange={() => toggle(report.id)}
                          label={`${report.participant_name ?? '참여자'} 선택`}
                        />
                        <span className="w-20 font-semibold">{report.participant_name ?? '참여자'}</span>
                        <span className="min-w-[140px] flex-1 text-sm text-[#6F6F6F]">
                          {report.note ??
                            (report.status === 'completed'
                              ? '승인 완료'
                              : report.status === 'pending_review'
                                ? '검토 대기'
                                : report.status === 'error'
                                  ? '생성 실패'
                                  : '생성 중')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-sm text-[#8A3A1F]">
          {error}
        </p>
      )}

      {selected.size > 0 && (
        <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-2xl bg-[#2A1536] px-4 py-3 text-[#F7F4F0] shadow-lg">
          <b className="text-sm">리포트 {selected.size}건 선택</b>
          <span className="flex-1 text-xs text-[#CFC6D6]">
            선택한 대상은 실행 직전에 다시 확인해요. 결석·미대상 건은 자동으로 빠져요.
          </span>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="min-h-[44px] rounded-full bg-white/10 px-4 text-sm font-bold"
          >
            선택 해제
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run('regenerate')}
            className="min-h-[44px] rounded-full bg-white/10 px-4 text-sm font-bold disabled:opacity-40"
          >
            재생성
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run('resend_email')}
            className="min-h-[44px] rounded-full bg-white/10 px-4 text-sm font-bold disabled:opacity-40"
          >
            메일 재발송
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run('approve')}
            className="min-h-[44px] rounded-full bg-[#B373EF] px-5 text-sm font-bold text-[#1F0A2E] disabled:opacity-40"
          >
            선택 승인
          </button>
        </div>
      )}
    </section>
  );
}

/** 회차 목록과 건별 상태를 한 번에 읽어 R1 행으로 만든다. */
export function useSessionReportRows(
  classId: string,
  sessions: { id: string; seq: number | null; scheduled_at: string | null; host?: { name: string | null } | null }[],
): { rows: SessionReportRow[]; loading: boolean; error: string } {
  const [rows, setRows] = useState<SessionReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);

  useEffect(() => {
    const version = ++generation.current;
    setLoading(true);
    setError('');
    void Promise.all(
      sessions.map(async (session, index) => {
        const result = await classOperationsApi.reports(classId, session.id).catch(() => ({ reports: [] }));
        return {
          session_id: session.id,
          order: session.seq ?? index + 1,
          scheduled_at: session.scheduled_at,
          host_name: session.host?.name ?? null,
          attended: 0,
          absent: 0,
          reports: result.reports
            .filter((r) => r.type === 'client')
            .map((r) => ({
              id: r.id,
              participant_name: null,
              status: r.status,
              selectable: r.status === 'pending_review' || r.status === 'completed',
            })),
        } satisfies SessionReportRow;
      }),
    )
      .then((value) => {
        if (version === generation.current) setRows(value);
      })
      .catch((e) => {
        if (version === generation.current) setError(operationError(e));
      })
      .finally(() => {
        if (version === generation.current) setLoading(false);
      });
    return () => {
      generation.current += 1;
    };
  }, [classId, sessions]);

  return { rows, loading, error };
}
