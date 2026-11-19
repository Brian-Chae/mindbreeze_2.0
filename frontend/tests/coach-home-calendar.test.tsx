// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import { UiV2CoachCalendar, monthCells, kstDay } from '../src/components/ui-v2/ui-v2-coach-calendar';
import type { ClassSummary } from '../src/lib/api/dashboard';

const NOW = new Date('2026-11-19T03:00:00Z'); // KST 11/19 12:00
const s = (id: string, at: string, status = 'scheduled', title = id): ClassSummary => ({ id, class_id: 'c1', title, seq: 1, status, scheduled_at: at, participant_count: 3 } as unknown as ClassSummary);
async function mount(sessions: ClassSummary[]) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const box = document.createElement('div'); document.body.appendChild(box);
  const root = createRoot(box);
  await act(async () => root.render(<MemoryRouter><UiV2CoachCalendar sessions={sessions} now={NOW} emptyAction={<a href="/classes/now">지금 바로 시작</a>} /></MemoryRouter>));
  return { box, unmount: () => act(async () => root.unmount()) };
}
const cell = (box: HTMLElement, label: string) => box.querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`)!;

it('KST 날짜 계산: UTC 15시 이후는 다음 날', () => {
  expect(kstDay('2026-11-18T15:30:00Z')).toEqual({ y: 2026, m: 11, d: 19 });
  const cells = monthCells(2026, 11);
  expect(cells.length % 7).toBe(0);
  expect(cells.filter(Boolean)).toHaveLength(30);
  expect(cells[0]).toEqual({ y: 2026, m: 11, d: 1 }); // 2026-11-01은 일요일
});

it('오늘 강조·점·날짜 선택 시 목록 변경', async () => {
  const { box, unmount } = await mount([s('지난', '2026-11-10T01:00:00Z', 'completed'), s('오늘A', '2026-11-19T01:00:00Z'), s('오늘B', '2026-11-19T05:00:00Z'), s('다음', '2026-11-25T01:00:00Z')]);
  expect(cell(box, '11월 19일').className).toContain('is-today');
  expect(cell(box, '11월 19일').getAttribute('aria-label')).toBe('11월 19일, 회차 2건');
  expect(cell(box, '11월 19일').querySelectorAll('.u2f-cal-dots i')).toHaveLength(2);
  expect(cell(box, '11월 10일').querySelector('.u2f-cal-dots i')!.className).toContain('is-past');
  expect(box.textContent).toContain('오늘A');
  await act(async () => cell(box, '11월 25일').click());
  expect(box.textContent).toContain('다음');
  expect(box.textContent).not.toContain('오늘A');
  expect(box.querySelector('a.u2f-sched-row')!.getAttribute('href')).toBeTruthy();
  await unmount();
});

it('달 이동 후 오늘 버튼으로 복귀, 범위 밖 달은 점 없음', async () => {
  const { box, unmount } = await mount([s('a', '2026-11-19T01:00:00Z')]);
  await act(async () => box.querySelector<HTMLButtonElement>('button[aria-label="다음 달"]')!.click());
  expect(box.querySelector('.u2f-cal-title')!.textContent).toBe('2026년 12월');
  expect(box.querySelectorAll('.u2f-cal-dots i')).toHaveLength(0);
  await act(async () => [...box.querySelectorAll('button')].find((b) => b.textContent === '오늘')!.click());
  expect(box.querySelector('.u2f-cal-title')!.textContent).toBe('2026년 11월');
  await unmount();
});

it('오늘 없으면 다음 예정일 선택, 아무것도 없으면 빈 상태+시작 링크', async () => {
  const a = await mount([s('나중', '2026-11-27T01:00:00Z')]);
  expect(cell(a.box, '11월 27일').className).toContain('is-selected');
  expect(a.box.textContent).toContain('나중');
  await a.unmount();
  const b = await mount([]);
  expect(b.box.textContent).toContain('예정된 일정이 없어요');
  expect(b.box.querySelector('a[href="/classes/now"]')).toBeTruthy();
  await b.unmount();
});
