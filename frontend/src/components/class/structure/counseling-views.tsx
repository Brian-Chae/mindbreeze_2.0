import { Link } from 'react-router-dom';
import { ReadField } from './read-state';
import type { CounselingReadModel, SessionReadModel } from '../../../lib/class-structure/adapters';
import { counselingPath, counselingSessionPath } from '../../../lib/class-structure/navigation';
import type { DisplayField, StructureRole } from '../../../lib/class-structure/read-model';

const valueOf = <T,>(field: DisplayField<T>): T | null => (field.kind === 'value' ? field.value : null);

const SESSION_STATUS: Record<string, string> = {
  scheduled: '예정', in_progress: '진행 중', completed: '완료', cancelled: '취소',
};
const RELATIONSHIP_STATUS: Record<string, string> = { active: '진행 중', closed: '마무리' };
const PROGRESS_STATUS: Record<string, string> = {
  completed: '완료', processing: '만드는 중', pending: '준비 중', failed: '확인 필요', draft: '작성 중',
};

const label = (map: Record<string, string>, field: DisplayField<string>): string | null => {
  const value = valueOf(field);
  return value === null ? null : map[value] ?? '상태 확인 중';
};

function formatWhen(field: DisplayField<string>): string | null {
  const value = valueOf(field);
  if (value === null) return null;
  return new Date(value).toLocaleString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

const chip = 'inline-flex items-center rounded-full bg-[#f1ebf6] px-2 py-0.5 text-xs text-[#5f0080]';

function StatusLine({ name, status }: { name: string; status: string | null }) {
  return <span className="text-xs text-[#625b6c]">{name} <ReadField value={status} /></span>;
}

export function CounselingRow({ role, row }: { role: StructureRole; row: CounselingReadModel }) {
  const next = valueOf(row.nextSession);
  const client = valueOf(row.clientDisplay);
  const seq = next ? valueOf(next.seq) : null;
  return (
    <li className="rounded-2xl border border-[#e8e0ef] bg-white p-4">
      <Link to={counselingPath(role, row.id)} className="flex flex-col gap-1">
        <span className="flex items-center gap-2">
          <b className="text-base">{row.title}</b>
          <span className={chip}>{label(RELATIONSHIP_STATUS, row.status) ?? '상태 없음'}</span>
        </span>
        {role === 'host' && client !== null && <span className="text-sm">{client}</span>}
        {role === 'member' && <span className="text-sm">상담사 <ReadField value={valueOf(row.counselorName)} /></span>}
        <span className="text-sm text-[#625b6c]">
          다음 상담 <ReadField value={next ? formatWhen(next.scheduledAt) : null} />
          {seq !== null && ` · ${seq}회차`}
        </span>
      </Link>
    </li>
  );
}

export function CounselingList({ role, rows }: { role: StructureRole; rows: readonly CounselingReadModel[] }) {
  return (
    <div className="flex flex-col gap-4">
      {role === 'host' && (
        <div className="flex justify-end">
          <Link to="/clients" className="rounded-xl border border-[#dcd2e5] bg-white px-4 py-2 text-sm text-[#5f0080]">내담자</Link>
        </div>
      )}
      <ul className="flex list-none flex-col gap-3 p-0">
        {rows.map((row) => <CounselingRow key={row.id} role={role} row={row} />)}
      </ul>
    </div>
  );
}

function SessionRow({ role, relationshipId, session }: { role: StructureRole; relationshipId: CounselingReadModel['id']; session: SessionReadModel }) {
  const seq = valueOf(session.seq);
  return (
    <li className="rounded-2xl border border-[#e8e0ef] bg-white p-4">
      <Link to={counselingSessionPath(role, relationshipId, session.id)} className="flex flex-col gap-1">
        <b>{seq === null ? <ReadField value={null} /> : `${seq}회차`}</b>
        <span className="text-sm text-[#625b6c]"><ReadField value={formatWhen(session.scheduledAt)} /></span>
        <span className="flex flex-wrap gap-3">
          <span className={chip}>{label(SESSION_STATUS, session.status) ?? '상태 없음'}</span>
          <StatusLine name="기록" status={label(PROGRESS_STATUS, session.recordStatus)} />
          <StatusLine name="리포트" status={label(PROGRESS_STATUS, session.reportStatus)} />
        </span>
      </Link>
    </li>
  );
}

export function CounselingDetailView({ role, model }: { role: StructureRole; model: CounselingReadModel }) {
  const client = valueOf(model.clientDisplay);
  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-[#e8e0ef] bg-white p-4">
        <h2 className="m-0 flex items-center gap-2 text-base">
          {model.title}
          <span className={chip}>{label(RELATIONSHIP_STATUS, model.status) ?? '상태 없음'}</span>
        </h2>
        <p className="m-0 mt-2 text-sm">상담사 <ReadField value={valueOf(model.counselorName)} /></p>
        {role === 'host' && client !== null && <p className="m-0 text-sm">{client}</p>}
        {role === 'host' && <Link to="/clients" className="mt-2 inline-flex text-sm text-[#5f0080]">내담자</Link>}
      </section>
      <section aria-label="상담 세션">
        <h3 className="mb-2 mt-0 text-base">상담 세션</h3>
        {model.sessions.length === 0 ? (
          <p className="text-sm text-[#625b6c]">아직 상담 세션이 없어요</p>
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {model.sessions.map((s) => <SessionRow key={s.id} role={role} relationshipId={model.id} session={s} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
