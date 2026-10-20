import { useEffect, useRef, useState } from 'react';
import { classOperationsApi } from '../../../lib/api/class-operations';
import { operationError } from './class-operation-state';
import type { SessionReportRow } from './class-report-manage';

/** 회차 목록과 건별 상태를 한 번에 읽어 R1 행으로 만든다. */
export function useSessionReportRows(
  classId: string,
  sessions: { id: string; seq: number | null; scheduled_at: string | null; host?: { name: string | null } | null }[],
): { rows: SessionReportRow[]; loading: boolean; error: string; failedCount: number } {
  const [rows, setRows] = useState<SessionReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [failedCount, setFailedCount] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const version = ++generation.current;
    setLoading(true);
    setError('');
    setFailedCount(0);
    void Promise.all(
      sessions.map(async (session, index) => {
        // 실패를 빈 목록으로 삼키지 않고 따로 센다.
        const result = await classOperationsApi.reports(classId, session.id).catch(() => null);
        return {
          failed: result === null,
          row: {
          session_id: session.id,
          order: session.seq ?? index + 1,
          scheduled_at: session.scheduled_at,
          host_name: session.host?.name ?? null,
          attended: null,
          absent: null,
          reports: (result?.reports ?? [])
            .filter((r) => r.type === 'client')
            .map((r) => ({
              id: r.id,
              participant_name: null,
              status: r.status,
              selectable: r.status === 'pending_review' || r.status === 'completed',
            })),
          } satisfies SessionReportRow,
        };
      }),
    )
      .then((value) => {
        if (version !== generation.current) return;
        setRows(value.map((v) => v.row));
        setFailedCount(value.filter((v) => v.failed).length);
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

  return { rows, loading, error, failedCount };
}
