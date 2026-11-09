// @vitest-environment jsdom
// SDD-318 F-B/F-D — 리포트 상세 시트 D안: 금지 문구 미노출·밴드 미착용 안내·닫기 버튼·영문 라벨 매핑·인용문·측정 본문 재작성.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UiV2ReportBody } from '../src/components/ui-v2/ui-v2-report-body';
import { buildReportCover, sessionTypeLabel, NO_BAND_NOTICE, metricChangeSentence, metricRangeLabel, readReportQuote } from '../src/components/ui-v2/ui-v2-report-copy';
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

// ---- F-D ----
const timeline = Array.from({ length: 40 }, (_, i) => ({ min: i * 0.5, concentration: 50 + i * 0.3, relaxation: 45 + i * 0.4, stress: 0.5 - i * 0.003, heart_rate: 76 - i * 0.1, respiratory_rate: 15 - i * 0.03, sdnn: 45 + i * 0.2 }));
const rich: ReportDto = { ...base, content: { ...base.content, quote: '생각이 떠오를 때마다 다시 돌아왔어요.', eeg: { status: 'valid', score: 70, metrics: {}, timeline, narrative: { journey: '서서히 느려진 호흡이 이어졌어요.', closing: '수고했어요.', body: '몸 이야기', mind: '마음 이야기' } } } };
const BANNED = /점수|종합점수|좋음|나쁨|좋아졌|나빠졌|주의가 필요|완료|보증|100%/;

it('인용문: 값이 있으면 첫머리에 표시, null·빈값·비문자열이면 숨김', () => {
  render({ ...base, content: { ...base.content, quote: '  함께 숨을 고른 시간이었어요.  ' } });
  expect(box.querySelector('[data-testid="report-quote"]')?.textContent).toBe('함께 숨을 고른 시간이었어요.');
  // F-E: 인용문은 커버(나의 명상) 섹션 안, 제목 줄 뒤 첫 블록
  expect(box.querySelector('#u2r3-cover [data-testid="report-quote"]')).toBeTruthy();
  for (const q of [null, '', '   ', 3]) {
    act(() => root.render(<UiV2ReportBody report={{ ...base, content: { ...base.content, quote: q } }} onClose={() => {}} />));
    expect(box.querySelector('[data-testid="report-quote"]')).toBeNull();
  }
  expect(readReportQuote({ quote: 5 })).toBeNull();
});

it('밴드 착용: 새 측정 본문 렌더, 레거시 NarrativeSections 미사용, 금지 평가어 0, 인용문 표시', () => {
  render(rich);
  expect(box.querySelector('[data-testid="ui-v2-report-measure"]')).toBeTruthy();
  expect(box.querySelector('[data-testid="narrative-sections"], .narrative-report')).toBeNull();
  expect(box.querySelector('[data-testid="report-quote"]')?.textContent).toContain('생각이 떠오를 때마다');
  expect(box.querySelector('[data-testid="report-no-band-notice"]')).toBeNull();
  const text = box.textContent ?? '';
  expect(text).not.toMatch(BANNED);
  expect(text).toContain('몸의 변화');
  expect(text).toContain('마음의 변화');
  expect(box.querySelectorAll('[data-metric]').length).toBeGreaterThanOrEqual(3);
  // F-E: 추이선 SVG 대신 1분 고정 막대(.u2r3-plot)
  expect(box.querySelectorAll('.u2r3-plot').length).toBeGreaterThanOrEqual(3);
  expect(text.split('본 서비스와 LINK BAND는 의료기기가 아니며').length - 1).toBe(1);
  expect(text).toMatch(/올라갔어요|내려갔어요|비슷하게/);
});

it('밴드 미착용: 측정 본문 없음, 인용문이 있으면 표시, 금지 평가어 0', () => {
  render({ ...base, content: { ...base.content, quote: '오늘 마음에 남은 말이에요.' } });
  expect(box.querySelector('[data-testid="ui-v2-report-measure"]')).toBeNull();
  expect(box.querySelector('[data-testid="report-quote"]')).toBeTruthy();
  expect(box.querySelector('[data-testid="report-no-band-notice"]')).toBeTruthy();
  expect(box.textContent ?? '').not.toMatch(BANNED);
});

it('변화 문장: 방향+사실만, 평가어·레거시 상태 판단 문장 없음', () => {
  const up = metricChangeSentence('hrv', 'up');
  const down = metricChangeSentence('heart_rate', 'down');
  const flat = metricChangeSentence('focus', 'stable');
  expect(up).toBe('심박변이는 전반보다 후반에 올라갔어요.');
  expect(down).toBe('심박수는 전반보다 후반에 내려갔어요.');
  expect(flat).toBe('집중도는 전반과 후반이 비슷했어요.');
  expect(metricRangeLabel('hrv', 44.8, 54.8)).toBe('전반 44.8밀리초 → 후반 54.8밀리초');
  for (const t of [up, down, flat]) expect(t).not.toMatch(BANNED);
});

it('밴드 착용: 레거시 상태 판단 문구(산만·불안정·유지됐어요)가 측정 본문에 없다', () => {
  render(rich);
  expect(box.textContent ?? '').not.toMatch(/산만|불안정|긴장이 남|유지됐어요|안정적으로/);
});
