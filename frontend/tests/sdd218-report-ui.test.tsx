// @vitest-environment jsdom
/**
 * SDD-218 G1~G4, E6·E7·E12, F2: 화면 계약 검증.
 *
 * - 상태 6종이 색 말고 외곽선 형태로도 구분되는가 (G2)
 * - 처리 제외 건에 재시도 수단이 없는가 (G3·B8)
 * - 결석자를 선택할 수 없는가 (G4)
 * - 미착용·미동의가 다른 문구로 나오고 0 으로 바뀌지 않는가 (E6·E7)
 * - 회차 사이 개선·악화 문구가 없는가 (E12)
 * - 유효 착용 3명 미만이면 분포를 숨기는가 (F2)
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../src/lib/api/class-reports';
import { ClassReportJobPanel } from '../src/components/class/structure/class-report-job';
import { ClassReportManage } from '../src/components/class/structure/class-report-manage';
import { ClassSessionSummary } from '../src/components/class/structure/class-session-summary';
import { MemberClassTrend } from '../src/components/class/structure/member-class-trend';
import { REPORT_STATUS, sessionStatus } from '../src/components/class/structure/report-status';

vi.mock('../src/lib/api/class-reports', async () => {
  const actual = await vi.importActual<typeof api>('../src/lib/api/class-reports');
  return {
    ...actual,
    classReportsApi: {
      createJob: vi.fn(),
      getJob: vi.fn(),
      retryJob: vi.fn(),
      memberTrend: vi.fn(),
      sessionSummary: vi.fn(),
    },
  };
});
vi.mock('../src/lib/api/class-operations', () => ({
  classOperationsApi: { reports: vi.fn().mockResolvedValue({ reports: [] }) },
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.resetAllMocks();
});

const render = async (node: React.ReactNode) => {
  await act(async () => {
    root.render(node);
  });
};

// ─────────────── G1·G2 상태 6종과 색맹 대응 ───────────────

describe('리포트 상태 표시', () => {
  it('G1 상태 6종이 모두 정의돼 있다', () => {
    expect(Object.keys(REPORT_STATUS).sort()).toEqual(
      ['busy', 'done', 'empty', 'failed', 'partial', 'review'].sort(),
    );
  });

  it('G2 색 말고 외곽선 형태로도 구분된다', () => {
    const shapes = Object.values(REPORT_STATUS).map((s) => {
      const radius = /rounded-\S+/.exec(s.className)?.[0] ?? '';
      const border = /border-(solid|dashed|dotted|double)/.exec(s.className)?.[0] ?? '';
      return `${radius}|${border}`;
    });
    // 6종이 서로 다른 (모서리, 테두리) 조합을 갖는다.
    expect(new Set(shapes).size).toBe(6);
  });

  it('회차 상태는 건별 집계에서 나온다', () => {
    expect(sessionStatus({ total: 0, approved: 0, pending: 0, generating: 0, failed: 0 })).toBe('empty');
    expect(sessionStatus({ total: 3, approved: 3, pending: 0, generating: 0, failed: 0 })).toBe('done');
    expect(sessionStatus({ total: 3, approved: 0, pending: 3, generating: 0, failed: 0 })).toBe('review');
    expect(sessionStatus({ total: 3, approved: 0, pending: 0, generating: 3, failed: 0 })).toBe('busy');
    // 일부만 실패하면 부분 실패, 전부 실패면 생성 실패로 구분한다.
    expect(sessionStatus({ total: 3, approved: 2, pending: 0, generating: 0, failed: 1 })).toBe('partial');
    expect(sessionStatus({ total: 3, approved: 0, pending: 0, generating: 0, failed: 3 })).toBe('failed');
  });
});

// ─────────────── G3·B8 실패와 제외의 분리 ───────────────

describe('일괄 작업 결과', () => {
  const job: api.ReportJob = {
    job_id: 'job-1',
    class_id: 'c1',
    action: 'approve',
    status: 'completed',
    on_behalf: false,
    accepted: 3,
    excluded: [],
    items: [
      { report_id: 'r1', state: 'succeeded', reason_code: null, retriable: false, approved_by: 'u1', processed_at: '2026-04-01T05:03:00Z', error_message: null },
      { report_id: 'r2', state: 'failed', reason_code: 'internal_error', retriable: true, approved_by: null, processed_at: null, error_message: '일시적인 오류예요' },
      { report_id: 'r3', state: 'excluded', reason_code: 'consent_withdrawn', retriable: false, approved_by: null, processed_at: null, error_message: null },
    ],
  };

  it('G3 처리 제외 건은 실패와 다른 문구로 나온다', async () => {
    await render(<ClassReportJobPanel classId="c1" job={job} names={{ r3: '한지우' }} />);
    const text = container.textContent ?? '';
    expect(text).toContain('처리 제외');
    expect(text).toContain('회원이 이 회차 반영을 철회했어요');
  });

  it('B8 제외 건에는 재시도 버튼이 없고 실패 건에만 있다', async () => {
    await render(<ClassReportJobPanel classId="c1" job={job} />);
    const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent ?? '');
    const retry = buttons.filter((t) => t.includes('다시 시도'));
    // 실패 1건에 대한 재시도 수단만 있다.
    expect(retry).toHaveLength(1);
    expect(retry[0]).toContain('1건');
  });

  it('제외만 있고 실패가 없으면 재시도 버튼이 아예 없다', async () => {
    const onlyExcluded: api.ReportJob = {
      ...job,
      items: job.items.filter((i) => i.state !== 'failed'),
    };
    await render(<ClassReportJobPanel classId="c1" job={onlyExcluded} />);
    const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent ?? '');
    expect(buttons.filter((t) => t.includes('다시 시도'))).toHaveLength(0);
  });

  it('멱등 안내 문구가 보인다', async () => {
    await render(<ClassReportJobPanel classId="c1" job={job} />);
    expect(container.textContent).toContain('중복으로 가지 않아요');
  });
});

// ─────────────── G4 결석자 선택 불가 ───────────────

describe('리포트 관리 선택', () => {
  const rows = [
    {
      session_id: 's1',
      order: 3,
      scheduled_at: '2026-03-18T10:00:00Z',
      host_name: '박서준',
      attended: 6,
      absent: 2,
      reports: [
        { id: 'r1', participant_name: '이도윤', status: 'pending_review', selectable: true },
        { id: 'r2', participant_name: '최민재', status: 'excused', selectable: false, note: '결석 — 리포트 대상이 아니에요' },
      ],
    },
  ];

  it('G4 결석자는 선택할 수 없다', async () => {
    await render(<ClassReportManage classId="c1" rows={rows} />);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')?.click();
    });
    const boxes = [...container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')];
    expect(boxes).toHaveLength(2);
    expect(boxes[0].disabled).toBe(false);
    expect(boxes[1].disabled).toBe(true);
    expect(container.textContent).toContain('리포트 대상이 아니에요');
  });

  it('선택하면 일괄 작업 바가 나오고 승인·재생성·재발송을 제공한다', async () => {
    await render(<ClassReportManage classId="c1" rows={rows} />);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[role="checkbox"]')?.click();
    });
    const text = container.textContent ?? '';
    expect(text).toContain('리포트 1건 선택');
    expect(text).toContain('선택 승인');
    expect(text).toContain('재생성');
    expect(text).toContain('메일 재발송');
  });
});

// ─────────────── E6·E7·E12 회원 추이 ───────────────

describe('회원 변화 추이', () => {
  const trend: api.MemberTrend = {
    class_id: 'c1',
    member_id: 'm1',
    measured_session_count: 1,
    sessions: [
      {
        session_id: 's1', order: 1, scheduled_at: '2026-03-04T10:00:00Z',
        participation: { state: 'not_enrolled', is_makeup: false },
        measurement: 'none', report: null, change: null,
      },
      {
        session_id: 's2', order: 2, scheduled_at: '2026-03-11T10:00:00Z',
        participation: { state: 'attended', is_makeup: false },
        measurement: 'measured', report: { id: 'rep-2' },
        change: { status: 'computed', metrics: { relaxation: { before: 52, after: 58, delta: 6, direction: 'eased' } } },
      },
      {
        session_id: 's3', order: 3, scheduled_at: '2026-03-18T10:00:00Z',
        participation: { state: 'attended', is_makeup: false },
        measurement: 'not_worn', report: { id: 'rep-3' }, change: null,
      },
      {
        session_id: 's4', order: 4, scheduled_at: '2026-03-25T10:00:00Z',
        participation: { state: 'attended', is_makeup: false },
        measurement: 'not_consented', report: { id: 'rep-4' }, change: null,
      },
    ],
  };

  beforeEach(() => {
    vi.mocked(api.classReportsApi.memberTrend).mockResolvedValue(trend);
  });

  it('P5-01 방향과 숫자 델타를 함께 보여준다', async () => {
    await render(<MemberClassTrend classId="c1" />);
    const text = container.textContent ?? '';
    expect(text).toContain('전반 52 → 후반 58');
    expect(text).toContain('+6');
    expect(text).toContain('편안해짐');
  });

  it('E6·E7 미착용과 미동의는 다른 문구로 구분된다', async () => {
    await render(<MemberClassTrend classId="c1" />);
    const text = container.textContent ?? '';
    expect(text).toContain('밴드 미착용 — 측정 없음');
    expect(text).toContain('측정 미동의');
    // 측정이 없는 회차를 0 으로 표시하지 않는다.
    expect(text).not.toContain('전반 0 → 후반 0');
  });

  it('E11 합류 전 회차는 합류 전으로 표시된다', async () => {
    await render(<MemberClassTrend classId="c1" />);
    expect(container.textContent).toContain('합류 전');
  });

  it('E12 회차 사이 개선·악화 문구가 없다', async () => {
    await render(<MemberClassTrend classId="c1" />);
    const text = container.textContent ?? '';
    // 회차 사이를 비교하는 단정 표현이 없어야 한다.
    // "점수를 매기지 않아요" 같은 부정 안내문은 허용한다.
    for (const banned of ['회차를 거듭', '지난 회차보다', '이전 회차 대비', '평균 대비', '1위']) {
      expect(text).not.toContain(banned);
    }
    expect(text).toContain('각 회차 안에서');
    expect(text).toContain('점수를 매기지 않아요');
  });

  it('승인 전 회차는 리포트 링크 대신 안내를 보여준다', async () => {
    vi.mocked(api.classReportsApi.memberTrend).mockResolvedValue({
      ...trend,
      sessions: [{ ...trend.sessions[1], report: null, change: null }],
    });
    await render(<MemberClassTrend classId="c1" />);
    expect(container.textContent).toContain('지도사가 확인을 마치면');
    expect(container.querySelector('a[href^="/reports/"]')).toBeNull();
  });
});

// ─────────────── F2 소표본 보호 ───────────────

describe('회차 집계', () => {
  const base: api.SessionSummary = {
    class_id: 'c1', session_id: 's1',
    attendance: { attended: 6, absent: 2, withdrawn: 0, expected: 0 },
    makeup_linked: 1, valid_cohort: 5, min_cohort: 3,
    distribution: { relaxation: { eased: 3, steady: 1, tensed: 1 } },
    hidden_reason: null,
  };

  it('F1 유효 착용이 충분하면 분포를 보여준다', async () => {
    vi.mocked(api.classReportsApi.sessionSummary).mockResolvedValue(base);
    await render(<ClassSessionSummary classId="c1" sessionId="s1" />);
    const text = container.textContent ?? '';
    expect(text).toContain('더 편안해짐 3명');
    expect(text).toContain('비슷함 1명');
  });

  it('F2 3명 미만이면 분포를 숨기고 사유를 알린다', async () => {
    vi.mocked(api.classReportsApi.sessionSummary).mockResolvedValue({
      ...base, valid_cohort: 2, distribution: null, hidden_reason: 'small_cohort',
    });
    await render(<ClassSessionSummary classId="c1" sessionId="s1" />);
    const text = container.textContent ?? '';
    expect(text).toContain('분포를 표시하지 않아요');
    expect(text).toContain('3명 미만이면');
    expect(text).not.toContain('더 편안해짐 3명');
  });

  it('F6 점수·순위 표현이 없다', async () => {
    vi.mocked(api.classReportsApi.sessionSummary).mockResolvedValue(base);
    await render(<ClassSessionSummary classId="c1" sessionId="s1" />);
    const text = container.textContent ?? '';
    // 단정 표현만 금지한다. "순위는 제공하지 않아요" 안내문은 있어야 한다.
    for (const banned of ['1위', '평균 대비', '강사 비교', '종합점수']) {
      expect(text).not.toContain(banned);
    }
    expect(text).toContain('순위는 제공하지 않아요');
    // 개인별 수치가 숫자로 새어 나오지 않는다 (인원수 "N명" 만 허용).
    const numbers = text.match(/\d+(?!명)/g) ?? [];
    expect(numbers).toHaveLength(0);
  });
});

// ─────────────── G6 금지 용어 ───────────────

describe('용어 규칙', () => {
  it('G6 금지 용어가 화면 문구에 없다', async () => {
    vi.mocked(api.classReportsApi.memberTrend).mockResolvedValue({
      class_id: 'c1', member_id: 'm1', measured_session_count: 0,
      sessions: [{
        session_id: 's1', order: 1, scheduled_at: null,
        participation: { state: 'attended', is_makeup: false },
        measurement: 'measured', report: { id: 'r1' },
        change: { status: 'computed', metrics: { relaxation: { before: 50, after: 55, delta: 5, direction: 'eased' } } },
      }],
    });
    await render(<MemberClassTrend classId="c1" />);
    const text = container.textContent ?? '';
    for (const banned of ['수업', '오픈', '참여하기', '1:N']) {
      expect(text).not.toContain(banned);
    }
  });
});
