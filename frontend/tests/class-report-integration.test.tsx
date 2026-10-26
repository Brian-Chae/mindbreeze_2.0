// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SessionDetailPage from '../src/pages/sessions/SessionDetailPage';
import * as sessionApi from '../src/lib/api/session';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ClassReportManage } from '../src/components/class/structure/class-report-manage';
import { SessionNotePromptToggle } from '../src/components/settings/session-note-prompt-toggle';
import { sessionNotePromptApi } from '../src/lib/api/class-summary';
import { EndingScene } from '../src/components/class/flow/host/EndingScreen';
import { ENDING_FIXTURES } from '../src/lib/class/flow/host-ending-fixtures';
import { deriveEnding, completedClassDestination } from '../src/lib/class/flow/host-ending-model';
import { PRIVACY_ARTICLES, PRIVACY_POLICY_VERSION, PRIVACY_POLICY_EFFECTIVE_ISO } from '../src/lib/privacy-policy';

vi.mock('../src/components/class/structure/class-session-detail', () => ({ ClassSessionDetail: () => createElement('div', null, '회차 상세') }));

describe('명상 종료와 상담 회귀 경계', () => {
  it('서버가 명상 종료를 확정했을 때만 요약으로 이동한다', () => {
    expect(completedClassDestination({ id: 's1', class_id: 'c1', status: 'completed' })).toBe('/sessions/s1/summary');
    expect(completedClassDestination({ id: 's1', class_id: 'c1', status: 'in_progress' })).toBeNull();
    expect(completedClassDestination({ id: 's1', class_id: null, status: 'completed' })).toBeNull();
  });
  it('leaveTo 의도를 먼저 보존한다', () => {
    expect(completedClassDestination({ id: 's1', class_id: 'c1', status: 'completed' }, '/classes')).toBe('/classes');
    expect(completedClassDestination({ id: 's1', class_id: 'c1', status: 'in_progress' }, '/classes')).toBeNull();
  });
});
describe('수업 통계 위탁 고지', () => {
  it('통계 전송 고지가 미제공 문구와 충돌하지 않고 기관 비회원 개정 방침과 일치한다', () => {
    const text = PRIVACY_ARTICLES.flatMap((a) => a.items).join(' ');
    expect(text).toContain('Google(Gemini API)');
    expect(text).not.toContain('AI 기능은 현재 제공하지 않');
    expect(text).not.toContain('AI 미제공');
    expect(PRIVACY_POLICY_VERSION).toBe('2.3');
    expect(PRIVACY_POLICY_EFFECTIVE_ISO).toBe('2026-10-26');
  });
});

describe('진행 기록 전체 안내 설정', () => {
  afterEach(() => vi.restoreAllMocks());
  it('계정 설정을 낙관적으로 바꾸고 실패하면 이전 값으로 복원한다', async () => {
    vi.spyOn(sessionNotePromptApi, 'get').mockResolvedValue({ enabled: true });
    let rejectSave: ((reason: Error) => void) | undefined;
    const save = vi.spyOn(sessionNotePromptApi, 'set').mockImplementation(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(SessionNotePromptToggle)));
    const button = host.querySelector('button')!;
    expect(button.getAttribute('aria-checked')).toBe('true');
    await act(async () => button.click());
    expect(save).toHaveBeenCalledWith(false);
    expect(button.getAttribute('aria-checked')).toBe('false');
    await act(async () => rejectSave?.(new Error('network')));
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(host.querySelector('[role=alert]')?.textContent).toContain('저장하지 못했어요');
    await act(async () => root.unmount()); host.remove();
  });
});

it('클래스 승인 화면에서 상담사용 리포트는 집계와 선택에 포함하지 않는다', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(ClassReportManage, { classId: 'c1', rows: [{ session_id: 's1', order: 1, scheduled_at: null, host_name: null, attended: 1, absent: 0, reports: [
    { id: 'client-report', type: 'client', participant_name: '참여자', status: 'pending_review', selectable: true },
    { id: 'host-report', type: 'counselor', participant_name: '진행 상담사', status: 'pending_review', selectable: true },
  ] }] })));
  expect(host.textContent).toContain('검토 대기');
  expect(host.textContent).not.toContain('진행 상담사');
  expect(host.textContent).not.toContain('리포트 2건');
  await act(async () => root.unmount()); host.remove();
  vi.unstubAllGlobals();
});

it('명상 종료 CTA는 회차 요약, 상담 종료 CTA는 기록 보기를 유지한다', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }));
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const onOpenRecord = vi.fn();
  const render = (isClassSession: boolean) => createElement(EndingScene, {
    view: deriveEnding({ ...ENDING_FIXTURES['end-done'], isClassSession }), title: '수업',
    left: { label: '목록', onClick: () => undefined }, onOpenRecord,
  });
  await act(async () => root.render(render(true)));
  expect(host.textContent).toContain('회차 요약 보기');
  expect(host.textContent).not.toContain('기록에서 언제든');
  const button = Array.from(host.querySelectorAll('button')).find((item) => item.textContent?.includes('회차 요약 보기'))!;
  await act(async () => button.click()); expect(onOpenRecord).toHaveBeenCalledOnce();
  await act(async () => root.render(render(false)));
  expect(host.textContent).toContain('기록 보기');
  expect(host.textContent).not.toContain('회차 요약 보기');
  await act(async () => root.unmount()); host.remove();
  vi.unstubAllGlobals();
});

it('실제 클래스 회차 상세 라우트는 서버 completed 확인 후 회차 요약 링크를 보인다', async () => {
  vi.spyOn(sessionApi, 'getSession').mockResolvedValue({ id: 's1', class_id: 'c1', status: 'completed' } as sessionApi.SessionDto);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/classes/c1/sessions/s1'] },
    createElement(Routes, null, createElement(Route, { path: '/classes/:classId/sessions/:id', element: createElement(SessionDetailPage) })))));
  expect(host.textContent).toContain('회차 상세');
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/sessions/s1/summary');
  expect(host.querySelector('a')?.textContent).toBe('회차 요약으로');
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks();
});
