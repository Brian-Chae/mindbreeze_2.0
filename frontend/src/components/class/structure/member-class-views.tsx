import { Link } from 'react-router-dom';
import type { ClassReadModel, SessionReadModel } from '../../../lib/class-structure/adapters';
import type { DisplayField } from '../../../lib/class-structure/read-model';
import { classPath } from '../../../lib/class-structure/navigation';
import { ReadField } from './read-state';

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
  const labels: Record<string, string> = { active: '진행 중', scheduled: '예정', in_progress: '진행 중', completed: '완료', cancelled: '취소', closed: '종료', draft: '준비 중' };
  const value = memberValue(field);
  return value ? labels[value] : undefined;
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
export function MemberClassCard({ model }: { model: ClassReadModel }) {
  const next = memberValue(model.nextSession);
  return <article className="mc-card"><Link className="mc-card-link" to={classPath('member', model.id)}>
    <span className="mc-chip"><ReadField value={memberStatus(model.status)} /></span>
    <h3><ReadField value={memberValue(model.title)} /></h3><MemberProgress model={model} />
    <p className="mc-muted">다음 회차 · <ReadField value={next && memberValue(next.seq) != null ? `${memberValue(next.seq)}회차` : undefined} /></p>
    {next ? <MemberSessionMeta session={next} /> : <ReadField />}
  </Link></article>;
}
