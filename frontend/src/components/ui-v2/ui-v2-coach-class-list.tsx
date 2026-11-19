// 코치 홈 '내 클래스' 구분선 목록(A안). 행을 누르면 달력과 연동된다(상태는 홈이 소유).
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { ClassReadModel } from '../../lib/class-structure/adapters';
import { classColor } from '../../lib/dashboard/coach-calendar-link';

const STATUS_LABEL: Record<string, string> = { active: '진행 중', ready: '준비 중', draft: '준비 중', paused: '잠시 멈춤', completed: '마무리', closed: '마무리' };
const WD = ['일', '월', '화', '수', '목', '금', '토'];

function nextText(model: ClassReadModel): string {
  const next = model.nextSession.kind === 'value' ? model.nextSession.value : null;
  const at = next && next.scheduledAt.kind === 'value' ? new Date(next.scheduledAt.value) : null;
  if (!at || Number.isNaN(at.getTime())) return '다음 일정 없음';
  const k = new Date(at.getTime() + 9 * 3600_000);
  const hh = String(k.getUTCHours()).padStart(2, '0');
  const mm = String(k.getUTCMinutes()).padStart(2, '0');
  return `${k.getUTCMonth() + 1}.${k.getUTCDate()} ${WD[k.getUTCDay()]} ${hh}:${mm}`;
}

interface Props {
  classes: readonly ClassReadModel[];
  totalCount: number;
  loading?: boolean;
  selectedId: string | null;
  /** 선택한 날짜에 회차가 있는 클래스 id. */
  onDateIds: ReadonlySet<string>;
  hoverIds: ReadonlySet<string>;
  notice?: string | null;
  /** 클래스 만들기 이동 경로. */
  createTo?: string;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

export function UiV2CoachClassList({ classes, totalCount, loading, selectedId, onDateIds, hoverIds, notice, createTo = '/classes/new', onSelect, onHover }: Props): ReactElement {
  return (
    <section className={`u2-card u2f-class-card${!loading && classes.length > 0 && classes.length <= 3 ? ' is-few' : ''}`} aria-label="내 클래스" data-testid="coach-class-list">
      <div className="u2-section-head u2-row"><h2>내 클래스</h2><Link className="u2-textlink" to="/classes">전체 보기{totalCount > classes.length ? ` (${totalCount})` : ''} ›</Link></div>
      {loading ? <p className="u2-empty">불러오는 중...</p> : classes.length === 0 ? (
        <div className="u2f-class-empty" role="status">
          <p>아직 클래스가 없어요</p>
          <Link className="u2f-home-create" to={createTo} data-header-action="primary">클래스 만들기 ›</Link>
        </div>
      ) : (
        <ul className="u2f-class-list">
          {classes.map((c) => {
            const id = String(c.id);
            const title = c.title.kind === 'value' && c.title.value.trim() ? c.title.value : '이름 없는 클래스';
            const status = c.status.kind === 'value' ? (STATUS_LABEL[c.status.value] ?? '') : '';
            const prog = c.progress.kind === 'value' ? c.progress.value : null;
            const pct = prog && prog.total > 0 ? Math.min(100, Math.round((prog.completed / prog.total) * 100)) : 0;
            const active = selectedId === id;
            const onDate = onDateIds.has(id);
            const cls = ['u2f-class-row', active ? 'is-active' : '', onDate && !active ? 'is-on-date' : '', hoverIds.has(id) ? 'is-hover' : ''].filter(Boolean).join(' ');
            return (
              <li key={id}>
                <button type="button" className={cls} aria-pressed={active} data-class-id={id}
                  onClick={() => onSelect(id)} onMouseEnter={() => onHover(id)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(id)} onBlur={() => onHover(null)}>
                  <span className="u2f-class-head">
                    <i className="u2f-class-dot" style={{ background: classColor(id) }} aria-hidden="true" />
                    <b>{title}</b>
                    {status && <em>{status}</em>}
                  </span>
                  <span className="u2f-class-meta">
                    <span className="u2f-class-prog">{prog ? <><span className="u2f-class-track" aria-hidden="true"><i style={{ width: `${pct}%`, background: classColor(id) }} /></span>{prog.completed}/{prog.total}회</> : '진행 정보 없음'}</span>
                    <span>{nextText(c)}</span>
                  </span>
                  {onDate && <span className="u2f-class-match">선택한 날짜에 회차가 있어요</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {notice && <p className="u2f-class-notice" role="status">{notice}</p>}
      {!loading && classes.length > 0 && classes.length <= 3 && <p className="u2f-class-hint">클래스를 누르면 달력에서 그 클래스의 회차만 진하게 보여요. 날짜를 누르면 그날 수업이 있는 클래스가 표시돼요.</p>}
      {classes.length > 0 && <div className="u2f-class-foot"><Link className="u2-textlink" to="/classes">전체 클래스 보기 ›</Link></div>}
    </section>
  );
}
