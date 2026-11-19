// 코치 홈 "오늘 · 다가오는 일정" 월간 달력. 홈이 이미 받은 회차 데이터만 쓰고(새 API 없음) 날짜는 KST 기준이다.
import { useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { ClassSummary } from '../../lib/api/dashboard';
import { dashboardSessionPath } from '../../lib/class-structure/dashboard-navigation';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n: number): string => String(n).padStart(2, '0');

export interface KstDay { y: number; m: number; d: number }

/** ISO 시각 → KST 달력 날짜(m: 1~12). 잘못된 값은 null. */
// eslint-disable-next-line react-refresh/only-export-components -- 순수 함수, 시험에서 직접 검증
export function kstDay(iso: string | Date | null | undefined): KstDay | null {
  if (!iso) return null;
  const t = (iso instanceof Date ? iso : new Date(iso)).getTime();
  if (Number.isNaN(t)) return null;
  const k = new Date(t + KST_OFFSET_MS);
  return { y: k.getUTCFullYear(), m: k.getUTCMonth() + 1, d: k.getUTCDate() };
}
// eslint-disable-next-line react-refresh/only-export-components -- 순수 함수
export const dayKey = (x: KstDay): string => `${x.y}-${pad(x.m)}-${pad(x.d)}`;

/** 해당 월의 달력 칸(앞뒤 빈 칸은 null). 일요일 시작. */
// eslint-disable-next-line react-refresh/only-export-components -- 순수 함수, 시험에서 직접 검증
export function monthCells(y: number, m: number): (KstDay | null)[] {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (KstDay | null)[] = Array.from({ length: first }, () => null);
  for (let d = 1; d <= days; d += 1) cells.push({ y, m, d });
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function timeKst(iso: string | null): string {
  if (!iso) return '--:--';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '--:--';
  const k = new Date(t + KST_OFFSET_MS);
  return `${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}`;
}
const isPast = (c: ClassSummary): boolean => c.status === 'completed' || c.status === 'cancelled';
const sessionTitle = (c: ClassSummary): string => `${c.title || '제목 없음'}${c.seq != null ? ` · ${c.seq}회차` : ''}`;

interface Props { sessions: readonly ClassSummary[]; now?: Date; emptyAction?: ReactElement }

export function UiV2CoachCalendar({ sessions, now, emptyAction }: Props): ReactElement {
  const today = useMemo(() => kstDay(now ?? new Date())!, [now]);
  const todayKey = dayKey(today);
  const byDay = useMemo(() => {
    const map = new Map<string, ClassSummary[]>();
    for (const c of sessions) {
      const k = kstDay(c.scheduled_at);
      if (!k) continue;
      const key = dayKey(k);
      map.set(key, [...(map.get(key) ?? []), c].sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime()));
    }
    return map;
  }, [sessions]);

  // 기본 선택: 오늘 → 없으면 다음 예정일 → 없으면 오늘
  const initial = useMemo(() => {
    if (byDay.has(todayKey)) return todayKey;
    const next = [...byDay.keys()].filter((k) => k > todayKey).sort()[0];
    return next ?? todayKey;
  }, [byDay, todayKey]);
  const [selected, setSelected] = useState<string>(initial);
  const [view, setView] = useState<{ y: number; m: number }>(() => ({ y: Number(initial.slice(0, 4)), m: Number(initial.slice(5, 7)) }));

  const moveMonth = (delta: number): void => setView((v) => {
    const d = new Date(Date.UTC(v.y, v.m - 1 + delta, 1));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
  });
  const goToday = (): void => { setView({ y: today.y, m: today.m }); setSelected(todayKey); };

  const cells = useMemo(() => monthCells(view.y, view.m), [view]);
  const list = byDay.get(selected) ?? [];
  const selMonth = Number(selected.slice(5, 7));
  const selDay = Number(selected.slice(8, 10));

  return (
    <div className="u2f-cal" data-testid="coach-calendar">
      <div className="u2f-cal-bar">
        <div className="u2f-cal-nav">
          <button type="button" className="u2f-cal-arrow" aria-label="이전 달" onClick={() => moveMonth(-1)}>‹</button>
          <b className="u2f-cal-title" aria-live="polite">{view.y}년 {view.m}월</b>
          <button type="button" className="u2f-cal-arrow" aria-label="다음 달" onClick={() => moveMonth(1)}>›</button>
        </div>
        <button type="button" className="u2f-cal-today" onClick={goToday}>오늘</button>
      </div>
      <div className="u2f-cal-grid" role="group" aria-label={`${view.y}년 ${view.m}월`}>
        {WEEKDAYS.map((w) => <span key={w} className="u2f-cal-wd" aria-hidden="true">{w}</span>)}
        {cells.map((cell, i) => {
          if (!cell) return <span key={`e${i}`} className="u2f-cal-cell is-empty" aria-hidden="true" />;
          const key = dayKey(cell);
          const items = byDay.get(key) ?? [];
          const upcoming = items.some((c) => !isPast(c));
          const cls = ['u2f-cal-cell', key === todayKey ? 'is-today' : '', key === selected ? 'is-selected' : '', items.length ? 'has-items' : ''].filter(Boolean).join(' ');
          return (
            <button key={key} type="button" className={cls} aria-pressed={key === selected} aria-current={key === todayKey ? 'date' : undefined}
              aria-label={`${cell.m}월 ${cell.d}일${items.length ? `, 회차 ${items.length}건` : ''}`} onClick={() => setSelected(key)}>
              <span className="u2f-cal-num">{cell.d}</span>
              <span className="u2f-cal-dots" aria-hidden="true">
                {items.slice(0, 3).map((c) => <i key={c.id} className={isPast(c) ? 'is-past' : upcoming ? 'is-upcoming' : ''} />)}
              </span>
            </button>
          );
        })}
      </div>
      <div className="u2f-cal-list" aria-live="polite">
        <h3 className="u2f-cal-day">{selMonth}월 {selDay}일{selected === todayKey ? ' · 오늘' : ''}</h3>
        {list.length > 0 ? list.map((c) => {
          const k = kstDay(c.scheduled_at)!;
          const wd = WEEKDAYS[new Date(Date.UTC(k.y, k.m - 1, k.d)).getUTCDay()];
          return (
            <Link key={c.id} className={`u2-listrow u2f-sched-row${isPast(c) ? ' is-past' : ''}`} to={dashboardSessionPath(c)}>
              <span className="u2f-sched-date" aria-hidden="true"><b>{k.m}.{k.d}</b><small>{wd}</small></span>
              <div className="u2-body"><h3>{sessionTitle(c)}</h3><p>{timeKst(c.scheduled_at)} · 참여 {c.participant_count}명</p></div>
              <small aria-hidden="true">›</small>
            </Link>
          );
        }) : <div className="u2f-cal-empty"><p className="u2-empty">예정된 일정이 없어요</p>{emptyAction}</div>}
      </div>
    </div>
  );
}
