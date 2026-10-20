import { useMemo } from 'react';
import { ClassReportManage } from './class-report-manage';
import { useSessionReportRows } from './use-session-report-rows';

/** SDD-219 T9: 회차 상세의 리포트 영역을 SDD-218 리포트 관리로 연결한다.
 *
 * useSessionReportRows 는 sessions 를 effect 의존성으로 쓰므로,
 * 부모가 렌더마다 새 배열을 넘기면 조회가 반복된다. 여기서 한 번만 만들어 고정한다.
 */
export interface ReportTabSession {
  id: string;
  seq: number | null;
  scheduled_at: string | null;
  status: string;
  host?: { name: string | null } | null;
}

export function ClassReportTab({ classId, sessions }: { classId: string; sessions: ReportTabSession[] }) {
  // 완료된 회차만 리포트 대상이다. 취소·예정 회차는 조회하지 않는다.
  const completed = useMemo(() => sessions.filter((s) => s.status === 'completed'), [sessions]);
  const { rows, loading, error, failedCount } = useSessionReportRows(classId, completed);
  const loadError = error || (failedCount > 0 ? `${failedCount}개 회차의 리포트를 불러오지 못했어요. 새로고침 후 다시 확인해 주세요. 목록이 비어 보여도 실제로 없는 것은 아닐 수 있어요.` : '');
  return <ClassReportManage classId={classId} rows={rows} loading={loading} loadError={loadError} />;
}
