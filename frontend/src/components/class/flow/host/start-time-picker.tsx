// SDD-279 — 시작 시각 C-3: 단일 필드 + 오전/오후 탭·시|분 2열 팝오버. 모바일(<768px)은 네이티브 select 시·분 두 개.
// draft 형식은 그대로(timeMin = 자정부터 분, 5분 단위). 값 변환은 lib/class/start-time.ts.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { fmtClock, fmtHour } from '../../../../lib/class/class-wizard';
import {
  allowedHours, hour24Of, minuteOptions, setHour, setMeridiem, setMinute, snapMinute, splitTime, type Meridiem, type TimeBounds,
} from '../../../../lib/class/start-time';
import { useIsDesktop } from '../../../../hooks/use-is-desktop';

export interface StartTimePickerProps {
  timeMin: number;
  onChange: (timeMin: number) => void;
  /** 테스트·하니스용: 지정하면 화면 폭 판정(useIsDesktop) 대신 쓴다 */
  desktop?: boolean;
  /** 허용 범위(자정부터 분). 생략하면 class-wizard 의 MIN_TIME_MIN~MAX_TIME_MIN */
  minMin?: number;
  maxMin?: number;
}

const EDGE_GAP = 8;

export function StartTimePicker({ timeMin, onChange, desktop, minMin, maxMin }: StartTimePickerProps) {
  const isDesktop = useIsDesktop();
  const bounds: TimeBounds = { minMin, maxMin };
  return (desktop ?? isDesktop) ? <TimePopover timeMin={timeMin} onChange={onChange} bounds={bounds} /> : <TimeSelects timeMin={timeMin} onChange={onChange} bounds={bounds} />;
}

type InnerProps = Pick<StartTimePickerProps, 'timeMin' | 'onChange'> & { bounds: TimeBounds };

function TimeSelects({ timeMin, onChange, bounds }: InnerProps) {
  const { minute } = splitTime(timeMin);
  const hour24 = Math.floor(timeMin / 60);
  const hours = [...allowedHours('am', bounds).map((h) => hour24Of('am', h)), ...allowedHours('pm', bounds).map((h) => hour24Of('pm', h))];
  const minutes = minuteOptions(hour24, bounds);
  return (
    <div className="fh-timesel">
      <select
        className="fh-timesel-s"
        aria-label="시작 시각 시"
        value={String(hour24)}
        onChange={(e) => {
          const h = Number(e.target.value);
          onChange(setHour(timeMin, h < 12 ? 'am' : 'pm', h % 12 === 0 ? 12 : h % 12, bounds));
        }}
      >
        {hours.map((h) => <option key={h} value={String(h)}>{fmtHour(h * 60)}</option>)}
      </select>
      <select
        className="fh-timesel-s"
        aria-label="시작 시각 분, 5분 단위"
        value={String(snapMinute(minute))}
        onChange={(e) => onChange(setMinute(timeMin, Number(e.target.value), bounds))}
      >
        {minutes.map((m) => <option key={m.value} value={String(m.value)} disabled={m.disabled}>{String(m.value).padStart(2, '0')}분</option>)}
      </select>
    </div>
  );
}

function TimePopover({ timeMin, onChange, bounds }: InnerProps) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const dialogId = useId();
  const { meridiem, hour12, minute } = splitTime(timeMin);
  const hour24 = Math.floor(timeMin / 60);
  const hours = allowedHours(meridiem, bounds);
  const minutes = minuteOptions(hour24, bounds);
  const snapped = snapMinute(minute);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // 열릴 때: 현재 시 항목으로 스크롤 + 포커스, 화면 가장자리 보정
  useLayoutEffect(() => {
    if (!open) return;
    const pop = popRef.current;
    if (!pop) return;
    const rect = pop.getBoundingClientRect();
    let dx = 0;
    if (rect.right > window.innerWidth - EDGE_GAP) dx = window.innerWidth - EDGE_GAP - rect.right;
    if (rect.left + dx < EDGE_GAP) dx = EDGE_GAP - rect.left;
    setShift(dx);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const pop = popRef.current;
    pop?.querySelectorAll<HTMLElement>('[role="listbox"]').forEach((list) => {
      const sel = list.querySelector<HTMLElement>('[aria-selected="true"]');
      if (sel) list.scrollTop = Math.max(0, sel.offsetTop - list.clientHeight / 2 + sel.offsetHeight / 2);
    });
    pop?.querySelector<HTMLElement>('[role="listbox"][aria-label="시"] [aria-selected="true"]')?.focus({ preventScroll: true });
    const onPointerDown = (e: Event): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const pickMeridiem = (m: Meridiem): void => onChange(setMeridiem(timeMin, m, bounds));
  const pickHour = (h: number): void => onChange(setHour(timeMin, meridiem, h, bounds));
  const pickMinute = (m: number, disabled: boolean): void => {
    if (disabled) return;
    onChange(setMinute(timeMin, m, bounds));
    close(true);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const pop = popRef.current;
    if (!pop) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    const target = e.target as HTMLElement;
    const list = target.closest<HTMLElement>('[role="listbox"]');
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && list) {
      e.preventDefault();
      const items = [...list.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])')];
      const i = items.indexOf(target);
      const next = items[Math.min(items.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      next?.focus();
      return;
    }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && list) {
      e.preventDefault();
      const label = list.getAttribute('aria-label') === '시' ? '분' : '시';
      if ((label === '분') !== (e.key === 'ArrowRight')) return;
      const other = pop.querySelector<HTMLElement>(`[role="listbox"][aria-label="${label}"]`);
      (other?.querySelector<HTMLElement>('[aria-selected="true"]') ?? other?.querySelector<HTMLElement>('[role="option"]'))?.focus();
      return;
    }
    if (e.key === 'Tab') {
      const items = [...pop.querySelectorAll<HTMLElement>('button:not([aria-disabled="true"])')];
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && target === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && target === last) { e.preventDefault(); first?.focus(); }
    }
  };

  return (
    <div className="fh-timefield" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="fh-timebtn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-label={`시작 시각 ${fmtClock(timeMin)}`}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <span>{fmtClock(timeMin)}</span>
        <ChevronDown size={20} aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={popRef}
          id={dialogId}
          className="fh-timepop"
          role="dialog"
          aria-label="시작 시각 선택"
          style={shift ? { transform: `translateX(${shift}px)` } : undefined}
          onKeyDown={onKeyDown}
        >
          <div className="fh-timepop-tabs" role="group" aria-label="오전 오후">
            {(['am', 'pm'] as const).map((m) => (
              <button key={m} type="button" className="fh-timetab" aria-pressed={meridiem === m} onClick={() => pickMeridiem(m)}>
                {m === 'am' ? '오전' : '오후'}
              </button>
            ))}
          </div>
          <div className="fh-timepop-cols">
            <div className="fh-timelist" role="listbox" aria-label="시">
              {hours.map((h) => (
                <button key={h} type="button" role="option" className="fh-timeopt" aria-selected={h === hour12} onClick={() => pickHour(h)}>{h}시</button>
              ))}
            </div>
            <div className="fh-timelist" role="listbox" aria-label="분">
              {minutes.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="option"
                  className="fh-timeopt"
                  aria-selected={m.value === snapped}
                  aria-disabled={m.disabled ? 'true' : undefined}
                  onClick={() => pickMinute(m.value, m.disabled)}
                >
                  {String(m.value).padStart(2, '0')}분
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
