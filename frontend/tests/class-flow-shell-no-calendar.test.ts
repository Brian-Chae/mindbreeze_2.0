// SDD-209 D-5② — 캘린더·타임라인 제거(독립 커밋). 회원·상담사 목록 어디에도 캘린더/타임라인 코드가 남지 않는다.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (path: string): string => resolve(__dirname, '..', 'src', path);
const REMOVED = [
  'components/session/MonthCalendar.tsx',
  'components/session/CalendarView.tsx',
  'components/session/MobileTimetable.tsx',
  'components/session/DaySchedule.tsx',
  'components/session/SessionListTable.tsx',
  'pages/client/legacy-calendar-block.tsx',
  'pages/sessions/legacy-host-calendar-block.tsx',
];

describe('D-5② 캘린더·타임라인 제거', () => {
  it.each(REMOVED)('%s 는 삭제됐다', (path) => {
    expect(existsSync(src(path))).toBe(false);
  });
  it('목록 페이지가 캘린더·타임라인·표를 가져오지 않는다', () => {
    for (const page of ['pages/client/ClientSessionListPage.tsx', 'pages/sessions/SessionListPage.tsx']) {
      const text = readFileSync(src(page), 'utf8');
      expect(text).not.toMatch(/MonthCalendar|CalendarView|MobileTimetable|SessionListTable|legacy-/);
    }
  });
});
