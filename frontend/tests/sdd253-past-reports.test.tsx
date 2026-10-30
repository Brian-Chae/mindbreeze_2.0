// @vitest-environment jsdom
// SDD-253 D6: 회원 '지난 리포트와 함께 보기' — 같은 상담사·활동의 승인된 본인 기록만, 수치·점수 비교 없음
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PastReportsCompare from '../src/components/reports/PastReportsCompare';
import type { ReportDto } from '../src/lib/api/reports';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const listReports = vi.fn();
vi.mock('../src/lib/api/reports', async (orig) => ({ ...(await orig<object>()), listReports: (...a: unknown[]) => listReports(...a) }));

const mk = (id: string, day: string, over: Partial<ReportDto> = {}): ReportDto => ({
  id, session_id: 's-' + id, user_id: 'u', type: 'client', status: 'completed', content: { headline: `제목 ${id}`, eeg: { narrative: { journey: `서사 ${id}` } } },
  pdf_url: null, sent_at: day, is_read: true, created_at: day, scheduled_at: day, session_title: '아침 명상', counselor_name: '서지연', session_type: 'meditation', in_review: false, ...over,
} as ReportDto);

let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); listReports.mockReset(); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function openCompare(current: ReportDto, all: ReportDto[]) {
  listReports.mockResolvedValue({ reports: all, total: all.length });
  await act(async () => root.render(<PastReportsCompare current={current} />));
  await act(async () => (container.querySelector('button') as HTMLButtonElement).click());
  await act(async () => { await Promise.resolve(); });
}

describe('PastReportsCompare', () => {
  it('가장 가까운 지난 승인 기록을 이번 기록과 나란히 보여 준다', async () => {
    const cur = mk('c', '2026-10-28T00:00:00Z');
    await openCompare(cur, [cur, mk('a', '2026-10-14T00:00:00Z'), mk('b', '2026-10-21T00:00:00Z')]);
    expect(container.textContent).toContain('지난 기록');
    expect(container.textContent).toContain('서사 b'); // 10/21 이 10/14 보다 가깝다
    expect(container.textContent).not.toContain('서사 a');
    expect(container.textContent).toContain('이번 기록');
    expect(container.textContent).toContain('서사 c');
  });
  it('이전 기록이 없으면 안내만 보여 준다', async () => {
    const cur = mk('c', '2026-10-28T00:00:00Z');
    await openCompare(cur, [cur]);
    expect(container.textContent).toContain('함께 볼 지난 기록이 아직 없어요');
  });
  it('승인 전(리뷰 중)·다른 상담사·상담사용 기록은 쓰지 않는다', async () => {
    const cur = mk('c', '2026-10-28T00:00:00Z');
    await openCompare(cur, [
      cur,
      mk('p', '2026-10-21T00:00:00Z', { status: 'pending_review', in_review: true }),
      mk('o', '2026-10-20T00:00:00Z', { counselor_name: '다른 상담사' }),
      mk('k', '2026-10-19T00:00:00Z', { type: 'counselor' }),
    ]);
    expect(container.textContent).toContain('함께 볼 지난 기록이 아직 없어요');
    expect(container.textContent).not.toContain('서사 p');
  });
  it('점수·순위·종합점수·좋음/나쁨 표현이 없고 수치 비교를 하지 않는다고 밝힌다', async () => {
    const cur = mk('c', '2026-10-28T00:00:00Z');
    await openCompare(cur, [cur, mk('b', '2026-10-21T00:00:00Z')]);
    expect(container.textContent).not.toMatch(/종합|순위|등급|점수 /);
    expect(container.textContent).toContain('수치를 비교해 좋고 나쁨을 가르지 않습니다');
  });
});
