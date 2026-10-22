import type { MembershipMember } from '../../../lib/api/class-operations';
import { Link } from 'react-router-dom';
import type { ClassReadModel, SessionReadModel } from '../../../lib/class-structure/adapters';
import type { DisplayField } from '../../../lib/class-structure/read-model';
import { classPath } from '../../../lib/class-structure/navigation';
import { ReadField } from './read-state';
import { classCardCopy } from '../../../lib/class-structure/class-card-copy';

// eslint-disable-next-line react-refresh/only-export-components
export const membershipLabels:Record<string,string>={active:'참여 중',waitlisted:'대기 중',left:'탈퇴',removed:'참여 해제',completed:'수료',withdrawn:'참여 종료'};
// 같은 소유 파일에서 회원 표시 규칙을 공유한다. 컴포넌트 외 export는 새로고침 경계에서 제외한다.
// eslint-disable-next-line react-refresh/only-export-components
export function memberValue<T>(field: DisplayField<T>): T | undefined {
  return field.kind === 'value' ? field.value : undefined;
}
// 같은 소유 파일에서 회원 표시 규칙을 공유한다. 컴포넌트 외 export는 새로고침 경계에서 제외한다.
// eslint-disable-next-line react-refresh/only-export-components
export function memberDate(field: DisplayField<string>): string | undefined {
  const value = memberValue(field);
  return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value)) : undefined;
}
// 같은 소유 파일에서 회원 표시 규칙을 공유한다. 컴포넌트 외 export는 새로고침 경계에서 제외한다.
// eslint-disable-next-line react-refresh/only-export-components
export function memberStatus(field: DisplayField<string>): string | undefined {
  const labels: Record<string, string> = { active: '진행 중', ready: '준비 중', open: '입장 가능', scheduled: '예정', in_progress: '진행 중', completed: '완료', cancelled: '취소', closed: '종료', draft: '준비 중' };
  const value = memberValue(field);
  return value ? labels[value] : undefined;
}
function memberDate0(iso: string): string | undefined {
  return memberDate({ kind: 'value', value: iso });
}
export function MemberClassStyles() {
  return <style>{`
.cs-structure .mc-stack{display:flex;flex-direction:column;gap:20px;max-width:1040px;margin:0 auto;padding-bottom:16px}
.cs-structure .mc-card{border:1px solid #e8e2ed;border-radius:20px;padding:24px;background:#fff;min-width:0;overflow-wrap:anywhere}
.cs-structure .mc-hero{background:linear-gradient(120deg,#e7dbf3,#f3edf8);border-color:#ded0eb;padding:28px}
.cs-structure .mc-card h2,.cs-structure .mc-card h3{margin:8px 0 12px;font-size:20px;line-height:1.4;color:#292231}
.cs-structure .mc-hero h2{font-size:28px}
.cs-structure .mc-muted{color:#716779;font-size:14px;line-height:1.7}
.cs-structure .mc-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.cs-structure .mc-heading{font-size:18px;font-weight:700;margin:4px 0 12px}
.cs-structure .mc-link{display:inline-flex;align-items:center;justify-content:center;padding:10px 16px;border-radius:12px;color:#5f0080;background:#f4edf8;text-decoration:none;font-size:14px;font-weight:600}
.cs-structure .mc-primary{background:#5f0080;color:#fff;margin-top:16px}
.cs-structure .mc-card-link{display:block;text-decoration:none;color:inherit}
.cs-structure .mc-chip-row{display:flex;flex-wrap:wrap;gap:6px;min-height:28px}
.cs-structure .mc-next strong{display:block;font-size:14px;color:#292231;margin-bottom:2px}
.cs-structure .mc-chip{display:inline-block;border-radius:20px;background:#f1edf5;color:#655173;padding:5px 10px;font-size:12px}
.cs-structure .mc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.cs-structure .mc-progress{height:6px;overflow:hidden;background:#eee7f3;border-radius:6px;margin:10px 0}
.cs-structure .mc-progress-fill{height:100%;background:#9472b3}
.cs-structure .mc-timeline{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:12px}
.cs-structure .mc-selected{outline:2px solid #7c3aed;outline-offset:-2px;background:#f8f2fc}
.cs-structure .mc-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:16px 0 0}
.cs-structure .mc-facts dt{font-size:12px;color:#716779;margin-bottom:4px}
.cs-structure .mc-facts dd{margin:0;font-size:14px}
@media(max-width:767px){.cs-structure .mc-grid{grid-template-columns:1fr}.cs-structure .mc-card{padding:20px}.cs-structure .mc-hero h2{font-size:24px}}
/* SDD-234: 같은 스타일을 쓰는 A 홈(.mh-home)은 제외한다. */
@media(max-width:767px){
 .cs-structure .mc-stack:not(.mh-home) .mc-chip{font-size:var(--mobile-type-caption-size);line-height:var(--mobile-type-caption-leading)}
 .cs-structure .mc-stack:not(.mh-home) .mc-muted,
 .cs-structure .mc-stack:not(.mh-home) .mc-facts dd,
 .cs-structure .mc-stack:not(.mh-home) .mc-next strong{font-size:var(--mobile-type-compact-size);line-height:var(--mobile-type-compact-leading)}
 .cs-structure .mc-stack:not(.mh-home) .mc-facts dt,
 .cs-structure .mc-stack:not(.mh-home) .mc-link{font-size:var(--mobile-type-label-size);line-height:var(--mobile-type-label-leading)}
 .cs-structure .mc-stack:not(.mh-home) .mc-card h2,
 .cs-structure .mc-stack:not(.mh-home) .mc-card h3{font-size:var(--mobile-type-subtitle-size);line-height:var(--mobile-type-subtitle-leading)}
 .cs-structure .mc-stack:not(.mh-home) .mc-hero h2{font-size:var(--mobile-type-hero-size);line-height:var(--mobile-type-hero-leading)}
 .cs-structure .mc-stack:not(.mh-home) .mc-primary{min-height:var(--mobile-touch-control)}
}
`}</style>;
}
export function MemberProgress({ model }: { model: ClassReadModel }) {
  const progress = memberValue(model.progress);
  return <div className="mc-muted">클래스 진행 <ReadField value={progress ? `${progress.completed}/${progress.total}` : undefined} />
    {progress && progress.total > 0 && <div className="mc-progress" role="progressbar" aria-label="클래스 진행" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed}><div className="mc-progress-fill" style={{ width: `${Math.max(0, Math.min(100, progress.completed / progress.total * 100))}%` }} /></div>}
  </div>;
}
export function MemberSessionMeta({ session }: { session: SessionReadModel }) {
  return <div className="mc-muted"><div><ReadField value={memberDate(session.scheduledAt)} /></div><div>지도사 · <ReadField value={memberValue(session.hostName)} /></div></div>;
}
export function MemberClassCard({ model, membership, href }: { model: ClassReadModel; membership?: MembershipMember | null; href?: string }) {
  // SDD-232: 빈 값은 카드용 문구 규칙으로 처리한다(회원·상담사 공통). href 가 없으면 회원 경로를 쓴다.
  const copy = classCardCopy(model, memberDate0);
  const status = memberStatus(model.status);
  return <article className="mc-card"><Link className="mc-card-link" to={href ?? classPath('member', model.id)}>
    <span className="mc-chip-row">{status && <span className="mc-chip">{status}</span>}
      {membership && <span className="mc-chip">{membershipLabels[membership.status] ?? membership.status}{membership.waitlist_position != null ? ` · ${membership.waitlist_position}번` : ''}</span>}</span>
    <h3>{copy.title}</h3>
    {copy.progress ? <div className="mc-muted">클래스 진행 {copy.progress.completed}/{copy.progress.total}
      <div className="mc-progress" role="progressbar" aria-label="클래스 진행" aria-valuemin={0} aria-valuemax={copy.progress.total} aria-valuenow={copy.progress.completed}><div className="mc-progress-fill" style={{ width: `${Math.max(0, Math.min(100, copy.progress.completed / copy.progress.total * 100))}%` }} /></div></div>
      : copy.completedOnly !== null ? <div className="mc-muted">완료한 회차 {copy.completedOnly}회</div> : null}
    <div className="mc-muted mc-next"><strong>{copy.nextHeadline}</strong>
      {copy.nextDetail && <div>{copy.nextDetail}</div>}
      {copy.host && <div>지도사 · {copy.host}</div>}</div>
  </Link></article>;
}
