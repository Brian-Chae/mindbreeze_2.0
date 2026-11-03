import { describe, expect, it } from 'vitest';
import { addDays, addMonths, cellLabel, daysInMonth, formatDisplay, isSelectable, monthGrid, monthReachable, parseIsoDate, shiftMonth, weekdayOf } from '../../src/lib/class/start-date';

describe('SDD-281 start-date 유틸', () => {
  it('parse 는 잘못된 날짜를 거른다', () => {
    expect(parseIsoDate('2026-11-03')).toEqual({ year: 2026, month: 11, day: 3 });
    expect(parseIsoDate('2026-02-30')).toBeNull(); expect(parseIsoDate('')).toBeNull(); expect(parseIsoDate('2026-1-3')).toBeNull();
  });
  it('윤년', () => {
    expect(daysInMonth(2028, 2)).toBe(29); expect(daysInMonth(2026, 2)).toBe(28); expect(daysInMonth(2100, 2)).toBe(28);
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29'); expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
  });
  it('표시 M/D(요일)', () => {
    expect(formatDisplay('2026-11-03')).toBe('11/3(화)'); expect(formatDisplay('2026-12-25')).toBe('12/25(금)'); expect(formatDisplay('x')).toBe('날짜 선택');
    expect(weekdayOf('2026-11-01')).toBe(0);
  });
  it('월 이동은 말일을 보정한다', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28'); expect(addMonths('2026-12-15', 1)).toBe('2027-01-15'); expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 }); expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });
  it('월 격자는 7열·5~6주, 모든 날짜를 포함', () => {
    const nov = monthGrid({ year: 2026, month: 11 }); expect(nov.length).toBe(5); expect(nov.every(r => r.length === 7)).toBe(true);
    expect(nov[0][0]).toBe('2026-11-01'); expect(nov.flat().filter(Boolean).length).toBe(30);
    const may27 = monthGrid({ year: 2027, month: 5 }); expect(may27.length).toBe(6); expect(may27.flat().filter(Boolean).length).toBe(31);
    expect(monthGrid({ year: 2026, month: 8 }).length).toBe(6); // 2026-08-01 은 토요일 → 6주
    expect(monthGrid({ year: 2027, month: 2 }).length).toBe(4 + 1 - 0); // 2027-02-01 월요일, 28일 → 5주
  });
  it('범위 판정', () => {
    expect(isSelectable('2026-11-02', '2026-11-03')).toBe(false); expect(isSelectable('2026-11-03', '2026-11-03')).toBe(true);
    expect(isSelectable('2026-11-20', '2026-11-03', '2026-11-19')).toBe(false); expect(isSelectable('bad', '2026-11-03')).toBe(false);
    expect(monthReachable({ year: 2026, month: 10 }, '2026-11-03')).toBe(false); expect(monthReachable({ year: 2026, month: 11 }, '2026-11-03')).toBe(true);
    expect(monthReachable({ year: 2027, month: 3 }, '2026-11-03', '2027-02-28')).toBe(false);
  });
  it('셀 라벨', () => {
    expect(cellLabel('2026-11-03', { today: '2026-11-03', min: '2026-11-03' })).toBe('2026년 11월 3일 화요일, 오늘');
    expect(cellLabel('2026-11-02', { today: '2026-11-03', min: '2026-11-03' })).toBe('2026년 11월 2일 월요일, 선택 불가');
    expect(cellLabel('2026-11-24', { selected: '2026-11-24', today: '2026-11-03', min: '2026-11-03' })).toBe('2026년 11월 24일 화요일, 선택됨');
  });
});
