// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import { UiV2CoachCalendar, dayKey, kstDay, type CalendarJump } from '../src/components/ui-v2/ui-v2-coach-calendar';
import { UiV2CoachClassList } from '../src/components/ui-v2/ui-v2-coach-class-list';
import { classColor, CLASS_COLORS, nextSessionOf } from '../src/lib/dashboard/coach-calendar-link';
import type { ClassSummary } from '../src/lib/api/dashboard';
import type { ClassReadModel } from '../src/lib/class-structure/adapters';

const NOW = new Date('2026-11-19T03:00:00Z');
const s = (id: string, cid: string, at: string, status = 'scheduled'): ClassSummary => ({ id, class_id: cid, title: cid, seq: 1, status, scheduled_at: at, participant_count: 3 } as unknown as ClassSummary);
const model = (id: string, title: string): ClassReadModel => ({ id, title: { kind: 'value', value: title }, status: { kind: 'value', value: 'active' }, progress: { kind: 'value', value: { completed: 1, total: 4 } }, nextSession: { kind: 'no_data', label: '데이터 없음' } } as unknown as ClassReadModel);
const SESSIONS = [s('a1', 'A', '2026-11-19T01:00:00Z'), s('b1', 'B', '2026-11-19T05:00:00Z'), s('a2', 'A', '2026-11-25T01:00:00Z'), s('b2', 'B', '2026-11-27T01:00:00Z')];
const keyOf = (iso: string) => { const k = kstDay(iso); return k ? dayKey(k) : null; };

function Harness({ classes }: { classes: ClassReadModel[] }) {
  const [filter, setFilter] = useState<string | null>(null);
  const [jump, setJump] = useState<CalendarJump | null>(null);
  const [onDate, setOnDate] = useState<ReadonlySet<string>>(new Set());
  const select = (id: string) => {
    if (filter === id) { setFilter(null); return; }
    setFilter(id);
    const n = nextSessionOf(SESSIONS, id, '2026-11-19', keyOf);
    if (n) setJump((j) => ({ key: keyOf(n.scheduled_at!)!, nonce: (j?.nonce ?? 0) + 1 }));
  };
  return <MemoryRouter>
    <UiV2CoachCalendar sessions={SESSIONS} now={NOW} classFilter={filter} jump={jump} onDateClick={() => setFilter(null)} onToday={() => setFilter(null)} onSelectedClasses={(ids) => setOnDate(new Set(ids))} />
    <UiV2CoachClassList classes={classes} totalCount={classes.length} selectedId={filter} onDateIds={onDate} hoverIds={new Set()} onSelect={select} onHover={() => undefined} />
  </MemoryRouter>;
}
async function mount(classes: ClassReadModel[]) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const box = document.createElement('div'); document.body.appendChild(box);
  const root = createRoot(box);
  await act(async () => root.render(<Harness classes={classes} />));
  return { box, unmount: () => act(async () => root.unmount()) };
}
const row = (box: HTMLElement, id: string) => box.querySelector<HTMLButtonElement>(`button[data-class-id="${id}"]`)!;
const cell = (box: HTMLElement, label: string) => box.querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`)!;

it('클래스 색: 같은 id는 항상 같고 5색 안', () => {
  expect(classColor('abc')).toBe(classColor('abc'));
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) expect(CLASS_COLORS).toContain(classColor(id));
});

it('클래스 클릭 → 다음 회차 날짜 선택·그 클래스만, 재클릭 → 해제(날짜 유지)', async () => {
  const { box, unmount } = await mount([model('A', '호흡'), model('B', '이완')]);
  expect(box.querySelector('[data-testid="coach-calendar-list"]')!.textContent).toContain('A');
  await act(async () => cell(box, '11월 20일').click()); // 회차 없는 날
  await act(async () => row(box, 'B').click());
  expect(row(box, 'B').getAttribute('aria-pressed')).toBe('true');
  expect(cell(box, '11월 19일').className).toContain('is-selected'); // B 의 다음 회차 = 오늘
  const list = box.querySelector('[data-testid="coach-calendar-list"]')!;
  expect(list.querySelectorAll('a.u2f-sched-row')).toHaveLength(1);
  expect(cell(box, '11월 25일').querySelector('.u2f-cal-dots i')!.className).toContain('is-dim');
  await act(async () => row(box, 'A').click());
  expect(cell(box, '11월 19일').className).toContain('is-selected');
  await act(async () => row(box, 'A').click());
  expect(row(box, 'A').getAttribute('aria-pressed')).toBe('false');
  expect(list.querySelectorAll('a.u2f-sched-row')).toHaveLength(2);
  await unmount();
});

it('날짜 클릭 → 필터 해제, 그날 회차 클래스 행에 안내', async () => {
  const { box, unmount } = await mount([model('A', '호흡'), model('B', '이완')]);
  await act(async () => row(box, 'B').click());
  await act(async () => cell(box, '11월 25일').click());
  expect(row(box, 'B').getAttribute('aria-pressed')).toBe('false');
  expect(row(box, 'A').textContent).toContain('선택한 날짜에 회차가 있어요');
  expect(row(box, 'B').textContent).not.toContain('선택한 날짜에 회차가 있어요');
  await unmount();
});

it('빈 상태: 클래스 0개면 안내와 만들기 링크', async () => {
  const { box, unmount } = await mount([]);
  expect(box.textContent).toContain('아직 클래스가 없어요');
  expect(box.querySelector('a[href="/classes/new"]')).toBeTruthy();
  await unmount();
});
