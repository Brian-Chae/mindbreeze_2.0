// @vitest-environment jsdom
// SDD-228 — 받아쓰기(STT) 비공개: AI 가 켜져 있어도 단계·전사·사유 문구가 보이지 않는다.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_AI_ENABLED', 'true');

import { ReportProgressStepper } from '../src/components/session/ReportProgressStepper';
import { aiRecordUnavailableText, isSttAiRecordVisible, isSttEnabled } from '../src/lib/features';
import { parseReportProgress } from '../src/lib/api/report-status';

const progress = parseReportProgress({
  session_id: 's1',
  generation_status: 'processing',
  stage: 'stt',
  progress: 40,
  reason: null,
  steps: [
    { key: 'save', label: '녹음 저장', state: 'done' },
    { key: 'stt', label: '음성 인식(STT)', state: 'skipped' },
    { key: 'summary', label: 'AI 요약', state: 'skipped' },
    { key: 'ready', label: '리포트 완료', state: 'active' },
  ],
});

afterEach(() => {
  document.body.innerHTML = '';
});

it('STT 플래그 기본값은 off 이고 전사 노출도 off', () => {
  expect(isSttEnabled()).toBe(false);
  expect(isSttAiRecordVisible()).toBe(false);
});

it('AI on + STT off 에서도 스텝퍼는 받아쓰기·요약 단계를 숨기고 리포트 생성으로 안내한다', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    createRoot(host).render(createElement(ReportProgressStepper, { progress }));
  });
  const text = host.textContent ?? '';
  expect(text).not.toContain('음성 인식');
  expect(text).not.toContain('AI 요약');
  expect(text).toContain('리포트 생성 진행 중');
});

it('stt_disabled 사유는 마이크 꺼짐 문구가 아니다', () => {
  const text = aiRecordUnavailableText('stt_disabled');
  expect(text).not.toContain('마이크');
  expect(text).toContain('영상');
});
