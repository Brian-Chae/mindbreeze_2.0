// @vitest-environment jsdom
// SDD-220 (트랙 ⓑ) TS3·TS5·TS7 프론트 — AI 비공개 플래그(VITE_AI_ENABLED) off/on × 상담 플래그 4조합
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiGate, AiOnly } from '../src/components/routing/ai-gate';
import { isAiEnabled, isCounselingEnabled } from '../src/lib/feature-flags';
import { aiRecordUnavailableText, isSttAiRecordVisible } from '../src/lib/features';
import { ReportProgressStepper } from '../src/components/session/ReportProgressStepper';
import CounselorCommentCard from '../src/components/reports/CounselorCommentCard';
import MemberTabs from '../src/components/client/BottomTabBar';
import { useAgentStore } from '../src/stores/agent-store';
import type { ReportProgressDto } from '../src/lib/api/reports';
import type { ReportDto } from '../src/lib/api/reports';

let cleanup: (() => void) | undefined;
function render(node: ReactNode, path = '/') {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(createElement(MemoryRouter, { initialEntries: [path] }, node)));
  cleanup = () => { act(() => root.unmount()); container.remove(); };
  return container;
}

beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(() => { cleanup?.(); cleanup = undefined; vi.unstubAllEnvs(); });

const COMBOS = [
  { ai: undefined, counseling: undefined, aiOpen: false, counselingOpen: false },
  { ai: 'false', counseling: 'true', aiOpen: false, counselingOpen: true },
  { ai: 'true', counseling: 'false', aiOpen: true, counselingOpen: false },
  { ai: 'true', counseling: 'true', aiOpen: true, counselingOpen: true },
];

describe.each(COMBOS)('AI=$ai × 상담=$counseling', ({ ai, counseling, aiOpen, counselingOpen }) => {
  beforeEach(() => {
    vi.stubEnv('VITE_AI_ENABLED', ai ?? '');
    vi.stubEnv('VITE_STT_ENABLED', ai ?? ''); // SDD-228: AI 와 함께 움직이는 기존 계약
    vi.stubEnv('VITE_COUNSELING_ENABLED', counseling ?? '');
  });

  it('두 플래그는 독립이다(AI=true 가 상담 비공개를 해제하지 않는다)', () => {
    expect(isAiEnabled()).toBe(aiOpen);
    expect(isCounselingEnabled()).toBe(counselingOpen);
  });

  it('AiGate: off 면 자식 mount 0 + 대체 경로 replace, on 이면 자식 노출', () => {
    const mounted = vi.fn();
    const Child = () => { mounted(); return <p>루시 화면</p>; };
    const view = render(
      <Routes>
        <Route path="/agent" element={<AiGate><Child /></AiGate>} />
        <Route path="/chat" element={<p>일반 채팅 목록</p>} />
      </Routes>,
      '/agent',
    );
    if (aiOpen) {
      expect(view.textContent).toContain('루시 화면');
    } else {
      expect(mounted).not.toHaveBeenCalled();
      expect(view.textContent).toBe('일반 채팅 목록'); // redirect loop 없이 1회로 종료
    }
  });

  it('AiOnly 는 off 면 아무것도 렌더하지 않는다', () => {
    const view = render(<AiOnly><span>AI CTA</span></AiOnly>);
    expect(view.textContent).toBe(aiOpen ? 'AI CTA' : '');
  });

  it('전사·AI 요약 노출은 기존 STT 비공개 조건과 AI 플래그의 AND — 현재 STT 상수가 false 라 항상 숨김', () => {
    expect(isSttAiRecordVisible()).toBe(false);
  });

  it('리포트 "자동 기록 없음" 문구: off 면 AI·전사·요약 표현이 없다', () => {
    const text = aiRecordUnavailableText('mic_off');
    expect(/AI|전사|요약/.test(text)).toBe(aiOpen);
    expect(/AI|전사|요약/.test(aiRecordUnavailableText(null))).toBe(aiOpen);
  });

  it('리포트 진행 스텝퍼: off 면 STT·AI 요약 단계와 AI 문구가 없고 녹음 저장·리포트 완료는 유지', () => {
    const progress: ReportProgressDto = {
      generation_status: 'processing',
      stage: 'stt',
      reason: null,
      progress: 40,
      steps: [
        { key: 'save', label: '녹음 저장', state: 'done' },
        { key: 'stt', label: '음성 인식(STT)', state: 'active' },
        { key: 'summary', label: 'AI 요약', state: 'pending' },
        { key: 'ready', label: '리포트 완료', state: 'pending' },
      ],
    } as ReportProgressDto;
    const view = render(<ReportProgressStepper progress={progress} />);
    expect(Boolean(view.querySelector('[data-testid="report-step-stt"]'))).toBe(aiOpen);
    expect(Boolean(view.querySelector('[data-testid="report-step-summary"]'))).toBe(aiOpen);
    expect(view.querySelector('[data-testid="report-step-save"]')).not.toBeNull();
    expect(view.querySelector('[data-testid="report-step-ready"]')).not.toBeNull();
    if (!aiOpen) expect(view.textContent).not.toMatch(/AI|STT|음성 인식/);
  });

  it('상담사 코멘트: off 면 "AI 초안" 대신 "초안" 으로 표기', () => {
    const report = { id: 'r1', content: {} } as unknown as ReportDto;
    const view = render(<CounselorCommentCard report={report} onReportChange={() => undefined} showNoDataBanner={false} />);
    const buttons = Array.from(view.querySelectorAll('button')).map((b) => b.textContent ?? '');
    expect(buttons.some((t) => t === (aiOpen ? 'AI 초안 받기' : '초안 받기'))).toBe(true);
    if (!aiOpen) expect(view.textContent).not.toContain('AI');
  });

  it('회원 하단 탭: off 면 루시 미읽음이 채팅 배지에 합산되지 않는다', () => {
    useAgentStore.setState({ unread: 7 });
    const view = render(<MemberTabs onMoreClick={() => undefined} />);
    const text = view.textContent ?? '';
    expect(text.includes('7')).toBe(aiOpen && !counselingOpen);
    useAgentStore.setState({ unread: 0 });
  });
});
