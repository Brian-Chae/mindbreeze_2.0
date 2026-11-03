// SDD-281 — /classes/new 시작 날짜 D-1: 단일 필드 + 데스크톱(≥768px) 캘린더 팝오버 / 모바일 Bottom Sheet.
// 값 형식은 "YYYY-MM-DD" 그대로. 날짜 탭 즉시 적용(확인 버튼 없음). 순수 날짜 계산은 lib/class/start-date.ts.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useIsDesktop } from '../../../../hooks/use-is-desktop';
import { koreanToday } from '../../../../lib/class-structure/scheduling-model';
import {
  DOW_LABELS, addDays, addMonths, cellLabel, formatDisplay, isSelectable, monthGrid, monthOf, monthReachable, monthTitle, shiftMonth, type YearMonth,
} from '../../../../lib/class/start-date';

export interface StartDatePickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  /** 테스트·하니스용: 오늘(KST) 고정 */
  today?: string;
  /** 테스트·하니스용: 지정하면 화면 폭 판정(useIsDesktop) 대신 쓴다 */
  desktop?: boolean;
}

const sheetMounts = { count: 0 };
const POP_W = 326;
const EDGE_GAP = 8;
const clampDate = (value: string, min?: string, max?: string): string => (min && value < min ? min : max && value > max ? max : value);

export function StartDatePicker({ label, value, onChange, min, max, today, desktop }: StartDatePickerProps) {
  const isDesktop = useIsDesktop();
  const useDesktop = desktop ?? isDesktop;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const todayIso = today ?? koreanToday();
  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);
  const pick = (iso: string): void => {
    if (!isSelectable(iso, min, max)) return;
    onChange(iso);
    close(true);
  };
  const props: PanelProps = { label, value, min, max, today: todayIso, onPick: pick, onClose: close, triggerRef, dialogId };
  return (
    <div className="cw-datefield" role="group" aria-label={label}>
      <button
        ref={triggerRef}
        type="button"
        className="cw-datebtn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-label={`${label} ${formatDisplay(value)}`}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <span>{formatDisplay(value)}</span>
        <ChevronDown size={20} aria-hidden="true" />
      </button>
      {open ? (useDesktop ? <DatePopover {...props} /> : <DateSheet {...props} />) : null}
    </div>
  );
}

interface PanelProps {
  label: string;
  value: string;
  min?: string;
  max?: string;
  today: string;
  onPick: (iso: string) => void;
  onClose: (returnFocus: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  dialogId: string;
}

/** 월 이동·커서·키보드를 갖는 달력 본문 상태 */
function useCalendar({ value, min, max, today }: Pick<PanelProps, 'value' | 'min' | 'max' | 'today'>) {
  const start = clampDate(isSelectable(value, min, max) ? value : today, min, max);
  const [cursor, setCursor] = useState(start);
  const [view, setView] = useState<YearMonth>(monthOf(start));
  const [focusTick, setFocusTick] = useState(1);
  const moveTo = (next: string, focus: boolean): void => {
    const clamped = clampDate(next, min, max);
    setCursor(clamped); setView(monthOf(clamped));
    if (focus) setFocusTick((n) => n + 1);
  };
  const stepMonth = (delta: number): void => {
    const target = shiftMonth(view, delta);
    if (!monthReachable(target, min, max)) return;
    setView(target);
    setCursor(clampDate(addMonths(cursor, delta), min, max));
  };
  const goToday = (): void => moveTo(today, false);
  const canPrev = monthReachable(shiftMonth(view, -1), min, max);
  const canNext = monthReachable(shiftMonth(view, 1), min, max);
  return { cursor, view, focusTick, moveTo, stepMonth, goToday, canPrev, canNext };
}
type Calendar = ReturnType<typeof useCalendar>;

function CalendarBody({ cal, value, min, max, today, onPick, swipe, ready = true }: { cal: Calendar; swipe?: boolean; ready?: boolean } & Pick<PanelProps, 'value' | 'min' | 'max' | 'today' | 'onPick'>) {
  const gridRef = useRef<HTMLDivElement>(null);
  const rows = monthGrid(cal.view);
  const swipeRef = useRef<{ x: number; y: number } | null>(null);
  const suppress = useRef(false);

  useEffect(() => {
    if (!ready) return;
    gridRef.current?.querySelector<HTMLElement>(`[data-date="${cal.cursor}"]`)?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cal.focusTick, ready]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement; const date = target.getAttribute('data-date'); if (!date) return;
    const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in delta) { event.preventDefault(); cal.moveTo(addDays(date, delta[event.key]), true); return; }
    if (event.key === 'PageDown' || event.key === 'PageUp') { event.preventDefault(); const next = addMonths(date, event.key === 'PageDown' ? 1 : -1); if (monthReachable(monthOf(next), min, max)) cal.moveTo(next, true); return; }
    if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); cal.moveTo(addDays(date, event.key === 'Home' ? -((new Date(`${date}T12:00:00Z`)).getUTCDay()) : 6 - (new Date(`${date}T12:00:00Z`)).getUTCDay()), true); return; }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPick(date); }
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => { if (swipe) swipeRef.current = { x: event.clientX, y: event.clientY }; };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const origin = swipeRef.current; swipeRef.current = null; if (!origin) return;
    const dx = event.clientX - origin.x; const dy = event.clientY - origin.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      suppress.current = true; window.setTimeout(() => { suppress.current = false; }, 120);
      cal.stepMonth(dx < 0 ? 1 : -1);
    }
  };
  return (
    <>
      <div className="cw-datemonth">
        <button type="button" className="cw-datenav" aria-label="이전 달" disabled={!cal.canPrev} onClick={() => cal.stepMonth(-1)}><ChevronLeft size={20} aria-hidden="true" /></button>
        <b aria-live="polite">{monthTitle(cal.view)}</b>
        <button type="button" className="cw-datenav" aria-label="다음 달" disabled={!cal.canNext} onClick={() => cal.stepMonth(1)}><ChevronRight size={20} aria-hidden="true" /></button>
      </div>
      <div className="cw-dateweek" aria-hidden="true">{DOW_LABELS.map((d) => <span key={d}>{d}</span>)}</div>
      <div
        ref={gridRef}
        className="cw-dategrid"
        role="grid"
        aria-label={monthTitle(cal.view)}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onClickCapture={(event) => { if (suppress.current) { event.preventDefault(); event.stopPropagation(); } }}
      >
        {rows.map((row, r) => (
          <div className="cw-daterow" role="row" key={r}>
            {row.map((iso, c) => {
              if (!iso) return <span className="cw-datecell empty" role="gridcell" key={c} />;
              const ok = isSelectable(iso, min, max);
              return (
                <button
                  key={iso}
                  type="button"
                  role="gridcell"
                  className={`cw-datecell${iso === today ? ' today' : ''}${iso === value ? ' sel' : ''}`}
                  data-date={iso}
                  tabIndex={iso === cal.cursor ? 0 : -1}
                  aria-label={cellLabel(iso, { today, selected: value, min, max })}
                  aria-selected={iso === value}
                  aria-current={iso === today ? 'date' : undefined}
                  aria-disabled={ok ? undefined : 'true'}
                  onClick={() => { if (ok) onPick(iso); }}
                >{Number(iso.slice(8))}</button>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

function DatePopover(props: PanelProps) {
  const { label, value, min, max, today, onPick, onClose, triggerRef, dialogId } = props;
  const cal = useCalendar({ value, min, max, today });
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const place = useCallback(() => {
    const trigger = triggerRef.current; const pop = popRef.current; if (!trigger || !pop) return;
    const rect = trigger.getBoundingClientRect(); const h = pop.getBoundingClientRect().height;
    const left = Math.max(EDGE_GAP, Math.min(rect.right - POP_W, window.innerWidth - POP_W - EDGE_GAP));
    const top = Math.max(EDGE_GAP, Math.min(rect.bottom + 8, window.innerHeight - h - EDGE_GAP));
    setPos({ left, top });
  }, [triggerRef]);
  useLayoutEffect(() => { place(); }, [place, cal.view]);
  useEffect(() => {
    const onPointerDown = (event: Event): void => {
      const t = event.target as Node;
      if (popRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      onClose(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { document.removeEventListener('pointerdown', onPointerDown); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [onClose, place, triggerRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true); return; }
    if (event.key === 'Tab') trapTab(event, popRef.current);
  };
  return createPortal(
    <div
      ref={popRef}
      id={dialogId}
      className="cw-date-pop cs-wizard"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${dialogId}-t`}
      style={pos ? { left: pos.left, top: pos.top, visibility: 'visible' } : { left: 0, top: 0, visibility: 'hidden' }}
      onKeyDown={onKeyDown}
    >
      <h2 id={`${dialogId}-t`} className="cw-sr">{label === '시작 날짜' ? '시작 날짜 선택' : `${label} 선택`}</h2>
      <CalendarBody cal={cal} value={value} min={min} max={max} today={today} onPick={onPick} ready={pos !== null} />
      <div className="cw-datefoot"><button type="button" className="cw-datetoday" onClick={cal.goToday}>오늘로 이동</button></div>
    </div>,
    document.body,
  );
}

function DateSheet(props: PanelProps) {
  const { label, value, min, max, today, onPick, onClose, dialogId } = props;
  const cal = useCalendar({ value, min, max, today });
  const sheetRef = useRef<HTMLElement>(null);
  const handleDrag = useRef<number | null>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const popped = useRef(false);

  // 뒤로가기: 시트가 열린 동안 history 한 칸을 쌓고(라우터 state 복사 + 표식), popstate 로 닫는다.
  // StrictMode 의 mount→cleanup→mount 이중 실행에도 한 칸만 쌓고, 닫힐 때 아직 우리 칸이 맨 위일 때만(지연 확인) back() 한다.
  useEffect(() => {
    sheetMounts.count += 1;
    const marked = (window.history.state as { cwDateSheet?: boolean } | null)?.cwDateSheet;
    if (!marked) window.history.pushState({ ...(window.history.state ?? {}), cwDateSheet: true }, '');
    const onPop = (): void => { popped.current = true; closeRef.current(false); };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      sheetMounts.count -= 1;
      const byPop = popped.current;
      window.setTimeout(() => {
        if (sheetMounts.count > 0 || byPop) return;
        if ((window.history.state as { cwDateSheet?: boolean } | null)?.cwDateSheet) window.history.back();
      }, 0);
    };
  }, []);

  // 배경 inert + 스크롤 잠금
  useEffect(() => {
    const sheet = sheetRef.current?.parentElement;
    const prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const touched: [Element, boolean][] = [];
    for (const el of Array.from(document.body.children)) { if (el === sheet) continue; touched.push([el, (el as HTMLElement).inert]); (el as HTMLElement).inert = true; }
    return () => { document.body.style.overflow = prevOverflow; for (const [el, was] of touched) (el as HTMLElement).inert = was; };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true); return; }
    if (event.key === 'Tab') trapTab(event, sheetRef.current);
  };
  return createPortal(
    <div className="cw-date-scrim cs-wizard" onClick={(event) => { if (event.target === event.currentTarget) onClose(true); }}>
      <section ref={sheetRef} id={dialogId} className="cw-date-sheet" role="dialog" aria-modal="true" aria-labelledby={`${dialogId}-t`} onKeyDown={onKeyDown}>
        <div
          className="cw-date-handle"
          aria-hidden="true"
          onPointerDown={(event) => { handleDrag.current = event.clientY; event.currentTarget.setPointerCapture?.(event.pointerId); }}
          onPointerUp={(event) => { const y = handleDrag.current; handleDrag.current = null; if (y !== null && event.clientY - y > 50) onClose(true); }}
        />
        <header className="cw-datehead">
          <h2 id={`${dialogId}-t`}>{label === '시작 날짜' ? '시작 날짜 선택' : `${label} 선택`}</h2>
          <button type="button" className="w-x" aria-label="닫기" onClick={() => onClose(true)}><X size={20} /></button>
        </header>
        <CalendarBody cal={cal} value={value} min={min} max={max} today={today} onPick={onPick} swipe />
        <div className="cw-datefoot">
          <span>날짜를 누르면 바로 적용돼요</span>
          <button type="button" className="cw-datetoday" onClick={cal.goToday}>오늘로 이동</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function trapTab(event: KeyboardEvent, root: HTMLElement | null): void {
  const targets = [...(root?.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), [data-date][tabindex="0"]') ?? [])];
  const first = targets[0]; const last = targets[targets.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
