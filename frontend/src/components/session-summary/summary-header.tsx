import { Link } from 'react-router-dom';
import type { ClassSummaryResponse } from '../../lib/class-report/types';
export function SummaryHeader({ session }: { session: ClassSummaryResponse['session'] }) {
  const ended = session.ended_at ? new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(session.ended_at)) : '—';
  return <header className="ss-header" data-section="S0"><div><strong>mind breeze <span>/ 회차 요약</span></strong><p className="ss-caption">{session.class_name} {session.seq != null ? `${session.seq}회차` : ''} · {ended} 종료 · {session.duration_min}분 진행</p></div><div className="ss-actions"><span className="ss-badge">클래스가 종료되었습니다</span><Link className="ss-btn" to="/classes">목록으로</Link></div></header>;
}
