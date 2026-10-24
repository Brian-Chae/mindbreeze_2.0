import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import './birth-year-month-wheel.css';

const ROW_HEIGHT = 44;
interface WheelOption { value: string; label: string }
interface WheelProps { label: string; options: WheelOption[]; value: string; onChange: (value: string) => void }

function Wheel({ label, options, value, onChange }: WheelProps) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ options, value, onChange });
  latest.current = { options, value, onChange };
  const index = Math.max(0, options.findIndex(option => option.value === value));
  useLayoutEffect(() => {
    // 초기 위치 동기화는 선택 이벤트를 발생시키지 않는다.
    if (ref.current) ref.current.scrollTop = index * ROW_HEIGHT;
  }, [index]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const select = (next: number) => {
    clearTimeout(timer.current);
    const current = latest.current;
    const option = current.options[Math.max(0, Math.min(current.options.length - 1, next))]!;
    current.onChange(option.value);
  };
  return <div className="birth-wheel-column">
    <span className="birth-wheel-label">{label === '출생 연도' ? '연도' : '월'}</span>
    <div className="birth-wheel-window">
      <div className="birth-wheel-highlight" aria-hidden="true" />
      <div ref={ref} role="listbox" aria-label={label} aria-activedescendant={`${id}-${index}`} tabIndex={0} className="birth-wheel-scroll"
        onScroll={() => {
          clearTimeout(timer.current);
          const target = ref.current;
          timer.current = setTimeout(() => {
            if (!target) return;
            const current = latest.current;
            const next = Math.max(0, Math.min(current.options.length - 1, Math.round(target.scrollTop / ROW_HEIGHT)));
            if (current.options[next]!.value !== current.value) select(next);
          }, 100);
        }}
        onKeyDown={event => {
          const next = event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowUp' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : null;
          if (next !== null) { event.preventDefault(); select(next); }
        }}>
        {options.map((option, itemIndex) => <div key={option.value} id={`${id}-${itemIndex}`} role="option" aria-selected={value === option.value} className="birth-wheel-option" onClick={() => select(itemIndex)}>{option.label}</div>)}
      </div>
    </div>
  </div>;
}

interface Props { id: string; value: string; onChange: (value: string) => void; invalid?: boolean; now?: Date }
/** 연도·월은 독립적으로 고른다. 두 값이 완성되기 전에는 빈 문자열만 전달한다. */
export function BirthYearMonthWheel({ id, value, onChange, invalid, now = new Date() }: Props) {
  const [parts, setParts] = useState(() => ({ year: value.slice(0, 4), month: value.slice(5, 7) }));
  const lastEmitted = useRef(value);
  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setParts({ year: value.slice(0, 4), month: value.slice(5, 7) });
    }
  }, [value]);
  const currentYear = now.getFullYear();
  const maxMonth = Number(parts.year) === currentYear ? now.getMonth() + 1 : 12;
  const years: WheelOption[] = [{ value: '', label: '연도 선택' }, ...Array.from({ length: currentYear - 1899 }, (_, index) => ({ value: String(currentYear - index), label: `${currentYear - index}년` }))];
  const months: WheelOption[] = [{ value: '', label: '월 선택' }, ...Array.from({ length: maxMonth }, (_, index) => ({ value: String(index + 1).padStart(2, '0'), label: `${index + 1}월` }))];
  const change = (field: 'year' | 'month', selected: string) => {
    const next = { ...parts, [field]: selected };
    if (Number(next.year) === currentYear && Number(next.month) > now.getMonth() + 1) next.month = '';
    setParts(next);
    const result = next.year && next.month ? `${next.year}-${next.month}` : '';
    lastEmitted.current = result;
    onChange(result);
  };
  return <div id={id} role="group" aria-label="생년월" aria-invalid={invalid || undefined} className="birth-year-month-wheel">
    <Wheel label="출생 연도" options={years} value={parts.year} onChange={selected => change('year', selected)} />
    <Wheel label="출생 월" options={months} value={parts.month} onChange={selected => change('month', selected)} />
    <p className="birth-wheel-help">연도와 월을 각각 위아래로 밀어 선택해 주세요</p>
  </div>;
}
