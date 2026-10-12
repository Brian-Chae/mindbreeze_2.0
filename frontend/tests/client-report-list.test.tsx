// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ClientReportListPage from '../src/pages/client/ClientReportListPage';
import { listReports, type ReportDto } from '../src/lib/api/reports';

vi.mock('../src/lib/api/reports', () => ({ listReports: vi.fn() }));
const base: ReportDto = {
  id: 'a', session_id: 'session-a', user_id: 'client', type: 'client',
  content: { headline: 'Calm 기록' }, pdf_url: null, sent_at: '2026-10-01',
  is_read: false, created_at: '2026-10-01', session_title: '가 명상',
  session_type: 'meditation', scheduled_at: '2026-10-03T14:05:00', counselor_name: '김상담',
};
const reports: ReportDto[] = [
  base,
  { ...base, counselor_name: '이상담', id: 'b', session_id: 'session-b', session_title: '나 상담', scheduled_at: '2026-10-01', sent_at: null },
  { ...base, id: 'c', session_id: 'session-c', scheduled_at: '2026-10-02', content: { headline: 'Calm 기록', summary: '호흡으로 긴장을 풀었어요' } },
];
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(listReports).mockReset().mockResolvedValue({ reports, total: 3 });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render() { await act(async () => root.render(<MemoryRouter><ClientReportListPage /></MemoryRouter>)); }
function button(label: string) {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(label))!;
}
async function search(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function sort(value: string) {
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="정렬"]')!;
  expect(select).not.toBeNull();
  await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
}
function titles() {
  return Array.from(container.querySelectorAll('tbody tr')).map((r) => r.querySelector('td > div > span.truncate')?.textContent);
}
it('20건 페이지 요청과 반응형 목록, 기본 상담사 그룹 및 회원 상태를 표시한다', async () => {
  await render();
  expect(listReports).toHaveBeenCalledWith({ page: 1, limit: 20 });
  expect(container.querySelector('.hidden.md\\:block table')).not.toBeNull();
  expect(container.querySelector('.block.md\\:hidden button')).not.toBeNull();
  expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
  expect(container.querySelectorAll('table')).toHaveLength(2);
  expect(Array.from(container.querySelector('table')!.querySelectorAll('th')).map((el) => el.textContent))
    .toEqual(['제목', '세션유형', '날짜·시간', '상태', '액션']);
  expect(container.textContent).toContain('확인 가능');
  expect(container.textContent).toContain('대기');
  expect(container.textContent).toContain('3 / 3건');
});
it('세션 제목과 숨겨진 headline도 공백과 대소문자를 정리해 검색한다', async () => {
  await render();
  await search('  cALm  ');
  expect(titles()).toHaveLength(3);
  await search('나 상담');
  expect(titles()).toEqual(['나 상담']);
  expect(container.textContent).toContain('1 / 3건');
  await search('없는 기록');
  expect(titles()).toEqual([]);
  expect(container.textContent).toContain('조건에 맞는 리포트가 없습니다');
  await act(async () => button('필터 초기화').click());
  expect(titles()).toHaveLength(3);
});
it('그룹핑을 끄고 날짜 및 제목 순서를 바꾼다', async () => {
  await render();
  await act(async () => button('상담사별 그룹핑').click());
  expect(container.querySelectorAll('table')).toHaveLength(1);
  expect(titles()).toEqual(['가 명상', '가 명상', '나 상담']);
  await sort('oldest');
  expect(titles()).toEqual(['나 상담', '가 명상', '가 명상']);
  await sort('title');
  expect(titles()).toEqual(['가 명상', '가 명상', '나 상담']);
});
it.each(['search', 'sort'])('%s 변경은 1페이지로 돌아가고 total 기반 경계를 지킨다', async (change) => {
  vi.mocked(listReports).mockImplementation(async (params) => ({
    reports: params?.page === 2 ? [{ ...base, session_title: '두 번째 페이지' }] : [base], total: 21,
  }));
  await render();
  expect(button('이전').disabled).toBe(true);
  await act(async () => button('다음').click());
  expect(listReports).toHaveBeenLastCalledWith({ page: 2, limit: 20 });
  expect(titles()).toEqual(['두 번째 페이지']);
  expect(button('다음').disabled).toBe(true);
  if (change === 'search') await search('가 명상'); else await sort('oldest');
  expect(listReports).toHaveBeenLastCalledWith({ page: 1, limit: 20 });
  expect(titles()).toEqual(['가 명상']);
  expect(button('이전').disabled).toBe(true);
});
it('현재 페이지에 검색 결과가 없어도 다른 페이지에서 찾을 수 있다', async () => {
  vi.mocked(listReports).mockImplementation(async (params) => ({
    reports: params?.page === 2 ? [{ ...base, session_title: '목표' }] : [base], total: 21,
  }));
  await render(); await search('목표');
  expect(titles()).toEqual([]);
  expect(button('다음')).toBeDefined();
  await act(async () => button('다음').click());
  expect(titles()).toEqual(['목표']);
});
it('빈 목록과 API 실패 후 재시도를 구분한다', async () => {
  vi.mocked(listReports).mockRejectedValueOnce(new Error('연결 실패'))
    .mockResolvedValueOnce({ reports: [], total: 0 });
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('연결 실패');
  await act(async () => button('다시 시도').click());
  expect(container.textContent).toContain('아직 리포트가 없어요');
  expect(container.textContent).toContain('0 / 0건');
});
it('날짜와 제목이 없는 리포트도 표시하고 ID가 없으면 열 수 없다', async () => {
  vi.mocked(listReports).mockResolvedValue({ reports: [{ ...base, id: null, session_title: null, content: {}, scheduled_at: null, created_at: null }], total: 1 });
  await render();
  expect(titles()).toEqual(['리포트']);
  expect(container.querySelector('tbody')?.textContent).toContain('-');
  expect(button('보기').disabled).toBe(true);
});

it('필터 변경으로 돌아온 페이지를 이전 페이지의 늦은 응답이 덮어쓰지 않는다', async () => {
  let resolveOld!: (value: { reports: ReportDto[]; total: number }) => void;
  vi.mocked(listReports).mockImplementation((params) => params?.page === 2
    ? new Promise((resolve) => { resolveOld = resolve; })
    : Promise.resolve({ reports: [base], total: 21 }));
  await render();
  await act(async () => button('다음').click());
  expect(container.querySelector('[role="status"]')?.textContent).toContain('불러오는 중');
  await search('가 명상');
  await act(async () => resolveOld({ reports: [{ ...base, session_title: '이전 페이지' }], total: 21 }));
  expect(titles()).toEqual(['가 명상']);
  expect(button('이전').disabled).toBe(true);
});

it('상담사별로 다른 세션을 묶고 예약 시간과 요약을 두 화면에 표시한다', async () => {
  await render();
  const tables = container.querySelectorAll('table');
  expect(tables[0].querySelectorAll('tbody tr')).toHaveLength(2);
  expect(tables[0].parentElement?.textContent).toContain('김상담');
  expect(tables[1].parentElement?.textContent).toContain('이상담');
  for (const selector of ['.hidden.md\\:block', '.block.md\\:hidden']) {
    const view = container.querySelector(selector)!;
    expect(view.textContent).toContain('2026.10.03 14:05');
    expect(view.textContent).toContain('호흡으로 긴장을 풀었어요');
    expect(view.textContent).toContain('Calm 기록');
  }
  const card = container.querySelector('.block.md\\:hidden button')!;
  expect(card.textContent).toContain('김상담');
  await search('  호흡으로  ');
  expect(titles()).toEqual(['가 명상']);
});
it('상담사와 요약이 없으면 이름과 headline을 폴백하고 잘못된 날짜를 숨긴다', async () => {
  vi.mocked(listReports).mockResolvedValue({ reports: [
    { ...base, counselor_name: null, scheduled_at: 'invalid', content: { headline: '폴백 요약', summary: { text: '객체' } } },
  ], total: 1 });
  await render();
  const table = container.querySelector('table')!;
  expect(table.parentElement?.textContent).toContain('상담사');
  expect(table.textContent).toContain('폴백 요약');
  expect(table.textContent).not.toContain('NaN');
  expect(table.querySelectorAll('tbody td')[2].textContent).toBe('-');
});
