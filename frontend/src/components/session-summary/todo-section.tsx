import { Link, useLocation } from 'react-router-dom';
import type { ClassSummaryResponse } from '../../lib/class-report/types';
import { NotePromptCard } from './note-prompt-card';
export function TodoSection({ data }: { data: ClassSummaryResponse }) {
  const { search } = useLocation();
  const { session, approval, note_prompt: notePrompt, capabilities, next_session: next } = data;
  const nextDate = next ? new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(next.scheduled_at)) : '';
  return <section id="summary-actions" data-section="S6"><div className="ss-number">06 / 상담사가 할 일</div><h2>이제 할 일</h2>
    {data.class_report.status !== 'zero' && <><div className="ss-task"><h3>리포트 승인</h3>{approval.auto_approve.enabled ? <><p>자동 승인 즉시 적용 · 유예 0분</p><p>리포트는 생성되는 대로 자동으로 승인돼 참여자에게 이어져요.</p></> : <p>검토 대기 {approval.counts.pending_review}명 — 공개 코멘트를 확인하고 승인해 주세요.</p>}<p className="ss-caption">생성 중 {approval.counts.generating}명 · 승인됨 {approval.counts.approved}명 · 오류 {approval.counts.error}명</p>{approval.counts.no_data_manual > 0 && <p>측정·기록이 없어 자동 승인에서 제외된 리포트 {approval.counts.no_data_manual}건이 있어요.</p>}<p className="ss-caption">참여자 리포트 {approval.participants_total}명 기준 · 승인과 전달 완료는 별도예요.<br/>상담사용 리포트는 승인과 관계없이 바로 볼 수 있어요.</p><Link className="ss-btn" to={`/sessions/${session.id}/class-report${search}#class-participants`}>참여자별 결과 보기</Link></div>
    {capabilities.can_write_note && <div className="ss-task"><h3>진행 기록 <span className="ss-caption">선택</span></h3><NotePromptCard sessionId={session.id} eligible={notePrompt.eligible} /></div>}</>}
    <div className="ss-task"><h3>다음 회차</h3><p>{next ? `${nextDate} · ${session.class_name} ${next.seq}회차` : '예정된 다음 회차가 없어요.'}</p><div className="ss-actions">{next ? <Link className="ss-btn ss-primary" to={`/classes/${session.class_id}/sessions/${next.id}`}>다음 회차 보기 →</Link> : <Link className="ss-btn ss-primary" to={`/classes/${session.class_id}`}>클래스 상세</Link>}<Link className="ss-btn" to="/classes">클래스 목록</Link></div></div>
  </section>;
}
