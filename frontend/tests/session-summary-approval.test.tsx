// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import { TodoSection } from '../src/components/session-summary/todo-section';
import fixture from '../src/lib/class-report/fixtures/summary-normal.json';
import type { ClassSummaryResponse } from '../src/lib/class-report/types';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it('유예 0분은 즉시 적용이며 상담사용 리포트를 승인 대상에 더하지 않는다', async () => {
  const data = fixture as ClassSummaryResponse;
  const box = document.createElement('div'); const root = createRoot(box);
  await act(async () => root.render(<MemoryRouter><TodoSection data={data} /></MemoryRouter>));
  expect(box.textContent).toContain('자동 승인 즉시 적용');
  expect(box.textContent).toContain(`승인됨 ${data.approval.counts.approved}명`);
  expect(box.textContent).not.toContain('이번 회차 보류');
  await act(async () => root.unmount());
});
it('자동 승인 끔은 서버의 검토 대기 인원과 무데이터 제외 건수를 표시한다', async () => {
  const data = structuredClone(fixture) as ClassSummaryResponse;
  data.approval.auto_approve.enabled = false;
  data.approval.counts.pending_review = 2;
  const box = document.createElement('div'); const root = createRoot(box);
  await act(async () => root.render(<MemoryRouter><TodoSection data={data} /></MemoryRouter>));
  expect(box.textContent).toContain('검토 대기 2명');
  expect(box.textContent).toContain('자동 승인에서 제외된 리포트');
  await act(async () => root.unmount());
});
