// @vitest-environment jsdom
// SDD-318 F-B — 리포트 상세 시트 D안: 금지 문구 미노출·밴드 미착용 안내·닫기 버튼·영문 라벨 매핑.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UiV2ReportBody } from '../src/components/ui-v2/ui-v2-report-body';
import { buildReportCover, sessionTypeLabel, NO_BAND_NOTICE } from '../src/components/ui-v2/ui-v2-report-copy';
import type { ReportDto } from '../src/lib/api/reports';

vi.mock('../src/lib/features', async (orig) => ({ ...(await orig<typeof import('../src/lib/features')>()), isSttAiRecordVisible: () => true }));

const base: ReportDto = {
  id: 'a', session_id: 'sa', user_id: 'c', type: 'client', pdf_url: null, sent_at: '2026-10-01', is_read: false, created_at: '2026-10-01',
  session_title: '저녁의 호흡 · 2회차', session_type: 'meditation', scheduled_at: '2026-11-04T19:30:00', counselor_name: '가',
  content: { headline: '호흡에 다시 머문 시간', summary: '호흡과 몸의 감각에 주의를 기울였어요.', counselor_comment: '떠오른 생각을 알아차리고 돌아왔어요.' },
};
const measured: ReportDto = { ...base, content: { ...base.content, eeg: { status: 'valid', score: 70, metrics: {}, timeline: [], narrative: { journey: '서서히 느려진 호흡이 이어졌어요.', closing: '수고했어요.', body: '몸 이야기', mind: '마음 이야기' } } } };
let root: Root; let box: HTMLDivElement;
beforeEach(() => { box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box); });
afterEach(() => { act(() => root.unmount()); box.remove(); });
const render = (r: ReportDto, onClose = vi.fn()) => { act(() => root.render(<UiV2ReportBody report={r} onClose={onClose} />)); return onClose; };

it('영문 세션 유형은 한글 라벨로 매핑되고 알 수 없는 값은 노출되지 않는다', () => {
  expect(sessionTypeLabel('meditation')).toBe('명상수업');
  expect(sessionTypeLabel('clinical')).toBe('임상심리상담');
  expect(sessionTypeLabel('weird_internal')).toBe('리포트');
  expect(sessionTypeLabel(null)).toBe('리포트');
});

it('커버: 헤드라인이 있으면 eyebrow=회차 제목·h1=헤드라인, 없으면 회차 제목은 1회만', () => {
  expect(buildReportCover(base, '호흡에 다시 머문 시간')).toEqual({ eyebrow: '저녁의 호흡 · 2회차', title: '호흡에 다시 머문 시간' });
  expect(buildReportCover(base, null)).toEqual({ eyebrow: '명상수업', title: '저녁의 호흡 · 2회차' });
  expect(buildReportCover(base, '저녁의 호흡 · 2회차')).toEqual({ eyebrow: '명상수업', title: '저녁의 호흡 · 2회차' });
});

it('밴드 미착용: 안내 박스·코치 코멘트·AI 요약·리포트 닫기 노출, 금지 문구 0', () => {
  const onClose = render(base);
  const text = box.textContent ?? '';
  expect(box.querySelector('[data-testid="report-no-band-notice"]')?.textContent).toBe(NO_BAND_NOTICE);
  expect(text).toContain('함께 돌아보는 시간');
  expect(text).toContain('코치 코멘트');
  expect(text).toContain('AI 요약');
  for (const banned of ['승인 완료', 'PDF', '준비 중', 'meditation', '내담자용', '종합점수']) expect(text).not.toContain(banned);
  const close = [...box.querySelectorAll('button')].find((b) => b.textContent === '리포트 닫기');
  expect(close).toBeTruthy();
  act(() => close!.click());
  expect(onClose).toHaveBeenCalledTimes(1);
  expect([...box.querySelectorAll('button')].some((b) => b.textContent === '닫기')).toBe(false);
});

it('밴드 착용: 서사(journey)가 한 번만 노출되고 미착용 안내는 없다', () => {
  render(measured);
  expect((box.textContent ?? '').split('서서히 느려진 호흡이 이어졌어요.').length - 1).toBe(1);
  expect(box.querySelector('[data-testid="report-no-band-notice"]')).toBeNull();
  expect(box.textContent).not.toContain('승인 완료');
});
