// @vitest-environment jsdom
// SDD-095 — 리포트 생성 진행 표시: 계약 파싱 · 스텝퍼 렌더 · 소켓 구독/조용한 토스트 1회

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { fakeSocket, ioCalls, listeners } = vi.hoisted(() => {
  const listeners: Record<string, Array<(payload: unknown) => void>> = {};
  const ioCalls: unknown[][] = [];
  const fakeSocket = {
    connected: true,
    on: (event: string, cb: (payload: unknown) => void) => {
      (listeners[event] ||= []).push(cb);
      return fakeSocket;
    },
    off: () => fakeSocket,
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
  return { fakeSocket, ioCalls, listeners };
});

vi.mock('socket.io-client', () => ({
  io: (...args: unknown[]) => {
    ioCalls.push(args);
    return fakeSocket;
  },
}));

vi.mock('../src/lib/api/report-status', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/lib/api/report-status')>();
  return { ...original, getSessionReportStatus: vi.fn() };
});

import {
  getSessionReportStatus,
  isReportGenerationDone,
  parseReportProgress,
  resolveReportGenerationStatus,
  type ReportProgressDto,
} from '../src/lib/api/report-status';
import { ReportProgressStepper } from '../src/components/session/ReportProgressStepper';
import { useReportProgress } from '../src/hooks/useReportProgress';
import { useNotificationStore } from '../src/stores/notificationStore';

const SESSION_ID = 'session-1';

function progressPayload(overrides: Partial<ReportProgressDto> = {}): ReportProgressDto {
  return {
    session_id: SESSION_ID,
    generation_status: 'processing',
    stage: 'summary',
    progress: 70,
    reason: null,
    report_status: null,
    steps: [
      { key: 'save', label: '녹음 저장', state: 'done' },
      { key: 'stt', label: '음성 인식(STT)', state: 'done' },
      { key: 'summary', label: 'AI 요약', state: 'active' },
      { key: 'ready', label: '리포트 완료', state: 'pending' },
    ],
    updated_at: null,
    ...overrides,
  };
}

/** 첫 REST 조회(kickoff 타이머)까지 흘려보낸다. */
async function flushInitialLoad(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(listeners)) delete listeners[key];
  ioCalls.length = 0;
  useNotificationStore.setState({ toast: null, unread: 0 });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

// ── 1. 계약 파싱 ────────────────────────────────────────────────────────
it('서버가 스텝을 일부만 줘도 표준 4스텝 순서로 복원한다', () => {
  const parsed = parseReportProgress({
    session_id: SESSION_ID,
    generation_status: 'ready',
    stage: 'ready',
    progress: 140,
    steps: [{ key: 'stt', state: 'done' }],
  });
  expect(parsed).not.toBeNull();
  expect(parsed!.steps.map((s) => s.key)).toEqual(['save', 'stt', 'summary', 'ready']);
  expect(parsed!.steps.map((s) => s.label)).toEqual(['녹음 저장', '음성 인식(STT)', 'AI 요약', '리포트 완료']);
  expect(parsed!.steps[1].state).toBe('done');
  expect(parsed!.steps[0].state).toBe('pending');
  // 진행률은 0~100으로 클램프
  expect(parsed!.progress).toBe(100);
});

it('알 수 없는 계약 값은 안전한 기본값으로 정규화한다', () => {
  expect(resolveReportGenerationStatus('weird')).toBe('pending');
  expect(resolveReportGenerationStatus(undefined)).toBe('pending');
  expect(resolveReportGenerationStatus('partial')).toBe('partial');
  expect(parseReportProgress(null)).toBeNull();
  expect(parseReportProgress(['nope'])).toBeNull();
  // 종료 상태 판정 — partial 도 종료
  expect(isReportGenerationDone('ready')).toBe(true);
  expect(isReportGenerationDone('partial')).toBe(true);
  expect(isReportGenerationDone('processing')).toBe(false);
});

// ── 2. 스텝퍼 렌더 ──────────────────────────────────────────────────────
it('진행 중에는 스텝 상태와 안내 문구를 보여주고 완료 상태에서는 기록 보기 버튼을 노출한다', async () => {
  const onViewReport = vi.fn();
  await act(async () => {
    root.render(createElement(ReportProgressStepper, { progress: progressPayload(), onViewReport }));
  });

  const stepper = container.querySelector('[data-testid="report-progress-stepper"]')!;
  expect(stepper.getAttribute('data-generation-status')).toBe('processing');
  expect(stepper.getAttribute('data-progress')).toBe('70');
  expect(container.textContent).toContain('AI 요약 진행 중');
  expect(container.querySelector('[data-testid="report-step-summary"]')?.getAttribute('data-step-state')).toBe('active');
  // 진행 중에는 기록 보기 버튼을 띄우지 않는다(조용한 대기)
  expect(container.textContent).not.toContain('기록 보기');

  await act(async () => {
    root.render(
      createElement(ReportProgressStepper, {
        progress: progressPayload({ generation_status: 'ready', stage: 'ready', progress: 100 }),
        onViewReport,
      }),
    );
  });
  expect(container.textContent).toContain('리포트가 준비되었습니다');
  const viewButton = [...container.querySelectorAll('button')].find((b) => b.textContent === '기록 보기')!;
  await act(async () => viewButton.click());
  expect(onViewReport).toHaveBeenCalledTimes(1);
});

it('일부 생성(partial)이면 사유 문구를 함께 보여준다', async () => {
  await act(async () => {
    root.render(
      createElement(ReportProgressStepper, {
        progress: progressPayload({
          generation_status: 'partial',
          reason: 'low_confidence',
          steps: [
            { key: 'save', label: '녹음 저장', state: 'done' },
            { key: 'stt', label: '음성 인식(STT)', state: 'done' },
            { key: 'summary', label: 'AI 요약', state: 'skipped' },
            { key: 'ready', label: '리포트 완료', state: 'done' },
          ],
        }),
      }),
    );
  });
  expect(container.textContent).toContain('리포트가 일부만 준비되었습니다');
  expect(container.textContent).toContain('음성 분석 신뢰도가 낮아');
});

// ── 3. 훅: 구독 + 폴링 + 조용한 토스트 1회 ──────────────────────────────
function Harness({ sessionId }: { sessionId: string | null }) {
  const { progress, generationStatus, isComplete } = useReportProgress(sessionId, { pollMs: 0 });
  return createElement('output', {
    'data-status': generationStatus ?? 'none',
    'data-complete': String(isComplete),
    'data-progress': progress?.progress ?? -1,
  });
}

const statusText = () => container.querySelector('output')?.getAttribute('data-status');

it('/record 네임스페이스에 구독하고 progress 이벤트를 반영한다', async () => {
  vi.mocked(getSessionReportStatus).mockResolvedValue(progressPayload());
  await act(async () => root.render(createElement(Harness, { sessionId: SESSION_ID })));
  await flushInitialLoad();
  expect(statusText()).toBe('processing');

  // 네임스페이스 /record 로 연결 확인
  expect(String(ioCalls[0][0])).toContain('/record');

  // 소켓 connect → 세션 구독 요청
  await act(async () => {
    listeners['connect']?.forEach((cb) => cb(undefined));
  });
  expect(fakeSocket.emit).toHaveBeenCalledWith('subscribe', { session_id: SESSION_ID });

  // 진행 이벤트 push → 완료 전이
  await act(async () => {
    listeners['report:progress']?.forEach((cb) =>
      cb(progressPayload({ generation_status: 'ready', stage: 'ready', progress: 100 })),
    );
  });
  expect(statusText()).toBe('ready');
  expect(container.querySelector('output')?.getAttribute('data-complete')).toBe('true');
});

it('완료 전이 시 조용한 토스트를 1회만 띄운다', async () => {
  vi.mocked(getSessionReportStatus).mockResolvedValue(progressPayload());
  await act(async () => root.render(createElement(Harness, { sessionId: SESSION_ID })));
  await flushInitialLoad();
  expect(useNotificationStore.getState().toast).toBeNull();

  const ready = progressPayload({ generation_status: 'ready', stage: 'ready', progress: 100 });
  await act(async () => {
    listeners['report:progress']?.forEach((cb) => cb(ready));
    listeners['report:progress']?.forEach((cb) => cb(ready));
    listeners['report:progress']?.forEach((cb) => cb(ready));
  });

  const toast = useNotificationStore.getState().toast;
  expect(toast).not.toBeNull();
  expect(toast!.title).toBe('리포트가 준비되었어요');
});

it('이미 완료된 상태로 진입하면 토스트를 띄우지 않는다', async () => {
  vi.mocked(getSessionReportStatus).mockResolvedValue(
    progressPayload({ generation_status: 'ready', stage: 'ready', progress: 100 }),
  );
  await act(async () => root.render(createElement(Harness, { sessionId: SESSION_ID })));
  await flushInitialLoad();

  expect(statusText()).toBe('ready');
  expect(useNotificationStore.getState().toast).toBeNull();
});

it('sessionId 가 없으면 소켓을 연결하지 않는다', async () => {
  await act(async () => root.render(createElement(Harness, { sessionId: null })));
  expect(ioCalls).toHaveLength(0);
  expect(vi.mocked(getSessionReportStatus)).not.toHaveBeenCalled();
});
