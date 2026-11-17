// @vitest-environment jsdom
// SDD-318 F-E — 회원 리포트 상세 v3e: 1분 버킷, 색 단계, 변화 박스, 캡션, 평가어 치환, 금지 표현, 미착용 분기, quote.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UiV2ReportBody } from '../src/components/ui-v2/ui-v2-report-body';
import {
  EVALUATIVE_PATTERN, bucketByMinute, changeBoxText, changeCaption, changeLevel, colorStep, fiveMinuteTicks, neutralMetricSentence,
  neutralizeEvaluative, neutralizeNarrative, plotGap, resolveAxis, stepColor, STEP_COLORS,
} from '../src/components/ui-v2/ui-v2-report-v3-logic';
import {
  buildPartialReportNarrative, journeySentence, closingSentence, type BodyTrend, type MindTrend, type MetricChangeInput,
} from '../src/lib/report/narrative';
import type { ReportDto } from '../src/lib/api/reports';

vi.mock('../src/lib/features', async (orig) => ({ ...(await orig<typeof import('../src/lib/features')>()), isSttAiRecordVisible: () => true }));

// ---- 1분 버킷 ----
it('1분 버킷: 같은 분 평균, 값 없는 분은 null 유지(0·보간 금지)', () => {
  const pts = [{ min: 0.1, heart_rate: 70 }, { min: 0.9, heart_rate: 80 }, { min: 1.5, heart_rate: null }, { min: 3.2, heart_rate: 60 }];
  const b = bucketByMinute(pts, 'heart_rate');
  expect(b).toEqual([75, null, null, 60]);
});
it('1분 버킷: 세션 길이를 알면 끝쪽 빈 구간도 슬롯으로 유지, 데이터가 없으면 빈 배열', () => {
  expect(bucketByMinute([{ min: 0, heart_rate: 70 }], 'heart_rate', 5)).toEqual([70, null, null, null, null]);
  expect(bucketByMinute([], 'heart_rate')).toEqual([]);
});
it('1분 버킷: hrv 는 sdnn 우선, 감정안정도는 emotional_stability 우선·없으면 stress 역변환', () => {
  expect(bucketByMinute([{ min: 0, sdnn: 40, hrv: 90 }], 'hrv')).toEqual([40]);
  expect(bucketByMinute([{ min: 0, emotional_stability: 60, stress: 0.9 }], 'emotional_stability')).toEqual([60]);
  expect(bucketByMinute([{ min: 0, stress: 0.25 }], 'emotional_stability')).toEqual([0.75]);
  expect(bucketByMinute([{ min: 0, stress: 30 }], 'emotional_stability')).toEqual([70]);
});
it('5분 눈금과 간격 규칙', () => {
  expect(fiveMinuteTicks(20).map((t) => t.minute)).toEqual([0, 5, 10, 15, 20]);
  expect(fiveMinuteTicks(20)[4].leftPct).toBe(100);
  expect(plotGap(20, 304)).toBe(8);
  expect(plotGap(10, 600)).toBe(8); // 160/10=16 → 상한 8
  expect(plotGap(30, 600)).toBeCloseTo(160 / 30, 5); // 막대 폭 (600-5.33*29)/30 ≈ 14.8 ≥ 4
});
it('plotGap: 그 간격에서 막대 폭이 4px 미만이면 간격 1px(45분·390px)', () => {
  expect(plotGap(45, 304)).toBe(1); // 3.56px 간격이면 막대 3.4px <4 → 1
  expect(plotGap(80, 304)).toBe(1);
});

// ---- 색 단계 ----
it('색 단계 경계: [0,1/6)→0 … [5/6,1]→5, 축 확장', () => {
  expect(colorStep(0, 0, 24)).toBe(0);
  expect(colorStep(3.99, 0, 24)).toBe(0);
  expect(colorStep(4, 0, 24)).toBe(1);
  expect(colorStep(8, 0, 24)).toBe(2);
  expect(colorStep(20, 0, 24)).toBe(5);
  expect(colorStep(24, 0, 24)).toBe(5);
  expect(colorStep(100, 0, 100)).toBe(5);
  expect(colorStep(50, 0, 100)).toBe(3);
  expect(colorStep(-5, 0, 100)).toBe(0);
  expect(stepColor(0, 0, 100)).toBe(STEP_COLORS[0]);
  expect(STEP_COLORS[5]).toBe('#3A1650');
  expect(resolveAxis('respiratory_rate', [10, 30.2])).toEqual([0, 31]);
  expect(resolveAxis('focus', [10, 90])).toEqual([0, 100]);
});

// ---- 변화 박스·캡션 ----
it('변화 박스: 부호 포함 소수 1자리, 작은 변화도 숫자', () => {
  expect(changeBoxText(21)).toBe('+21.0');
  expect(changeBoxText(-3)).toBe('-3.0');
  expect(changeBoxText(2)).toBe('+2.0');
  expect(changeBoxText(0)).toBe('0.0');
  expect(changeBoxText(-0.04)).toBe('0.0');
  expect(changeBoxText(18.04)).toBe('+18.0');
});
it('캡션 3단계: 5%·20% 경계는 윗단계, 호흡만 느려졌어요/빨라졌어요, 숫자 반복 없음', () => {
  expect(changeCaption('emotional_stability', '감정안정도', 2, 0, 100)).toBe('전반과 후반이 비슷했어요');
  expect(changeCaption('emotional_stability', '감정안정도', 4.99, 0, 100)).toBe('전반과 후반이 비슷했어요');
  expect(changeCaption('emotional_stability', '감정안정도', 5, 0, 100)).toBe('후반에 감정안정도가 조금 올라갔어요');
  expect(changeCaption('focus', '집중도', 19.9, 0, 100)).toBe('후반에 집중도가 조금 올라갔어요');
  expect(changeCaption('focus', '집중도', 21, 0, 100)).toBe('후반에 집중도가 뚜렷하게 올라갔어요');
  expect(changeCaption('focus', '집중도', 20, 0, 100)).toBe('후반에 집중도가 뚜렷하게 올라갔어요');
  expect(changeCaption('respiratory_rate', '호흡수', -3, 0, 24)).toBe('후반에 호흡이 조금 느려졌어요');
  expect(changeCaption('respiratory_rate', '호흡수', 4.8, 0, 24)).toBe('후반에 호흡이 뚜렷하게 빨라졌어요');
  expect(changeCaption('respiratory_rate', '호흡수', 1.2, 0, 24)).toBe('후반에 호흡이 조금 빨라졌어요');
  expect(changeCaption('heart_rate', '심박수', -6, 0, 120)).toBe('후반에 심박수가 조금 내려갔어요');
  expect(changeCaption('hrv', '심박변이', 18, 0, 200)).toBe('후반에 심박변이가 조금 올라갔어요');
  expect(changeCaption('hrv', '심박변이', 40, 0, 200)).toBe('후반에 심박변이가 뚜렷하게 올라갔어요');
  for (const c of [changeCaption('focus', '집중도', 21, 0, 100), changeCaption('hrv', '심박변이', 18, 0, 200)]) expect(c).not.toMatch(/\d/);
  expect(changeLevel(0, 0, 100)).toEqual({ level: 'similar', dir: 'stable' });
});

// ---- 평가어 치환 ----
const SAMPLE_INPUTS: MetricChangeInput[][] = [
  [['respiratory_rate', 16, 13], ['heart_rate', 80, 72], ['hrv', 38, 56], ['focus', 42, 63], ['relaxation', 37, 64], ['emotional_stability', 49, 51]],
  [['respiratory_rate', 13, 17], ['heart_rate', 72, 80], ['hrv', 56, 38], ['focus', 63, 42], ['relaxation', 64, 37], ['emotional_stability', 51, 20]],
  [['respiratory_rate', 15, 15.2], ['heart_rate', 75, 75], ['hrv', 50, 51], ['focus', 10, 10], ['relaxation', 90, 91], ['emotional_stability', 30, 30]],
  [['respiratory_rate', 14, 13], ['heart_rate', 75, 79], ['hrv', 50, 40], ['focus', 20, 80], ['relaxation', 80, 20], ['emotional_stability', 30, 90]],
].map((rows) => rows.map(([id, early, late]) => ({ id, early, late }) as MetricChangeInput));

it('평가어 치환: 모든 규칙 서사 조합(지표 문장·여정·마무리)에서 평가어 0', () => {
  for (const inputs of SAMPLE_INPUTS) {
    const n = buildPartialReportNarrative(inputs)!;
    const neutral = neutralizeNarrative({ journey: n.journey, bodyText: null, mindText: null, closing: n.closing, body: n.body, mind: n.mind });
    expect(neutral.journey).not.toMatch(EVALUATIVE_PATTERN);
    expect(neutral.closing).not.toMatch(EVALUATIVE_PATTERN);
    for (const m of [...n.body, ...n.mind]) {
      const axis = { respiratory_rate: [0, 24], heart_rate: [0, 120], hrv: [0, 200] }[m.id] ?? [0, 100];
      expect(neutralMetricSentence(m, axis as [number, number])).not.toMatch(EVALUATIVE_PATTERN);
    }
  }
});
it('평가어 치환: 9개 여정·9개 마무리 템플릿 모두 중립 문장으로 바뀐다', () => {
  const bodies: BodyTrend[] = ['relax', 'arouse', 'stable'];
  const minds: MindTrend[] = ['calm', 'scatter', 'stable'];
  const seenJ = new Set<string>(); const seenC = new Set<string>();
  for (const b of bodies) for (const m of minds) {
    const out = neutralizeNarrative({ journey: journeySentence(b, m), bodyText: null, mindText: null, closing: closingSentence(b, m), body: [], mind: [] });
    expect(out.journey).not.toMatch(EVALUATIVE_PATTERN); expect(out.closing).not.toMatch(EVALUATIVE_PATTERN);
    expect(out.journey).not.toBe(journeySentence(b, m));
    seenJ.add(out.journey); seenC.add(out.closing);
  }
  expect(seenJ.size).toBe(9);
  expect(seenC.size).toBe(9);
});
it('평가어 치환: 자유 문장(LLM)은 치환하고, 치환 후에도 평가어가 남으면 숨기거나 폴백', () => {
  expect(neutralizeEvaluative('집중이 좋아졌어요', 'up')).toBe('집중이 올라갔어요');
  expect(neutralizeEvaluative('주의가 필요해요', 'down')).toBe('내려갔어요');
  expect(neutralizeEvaluative('마음이 안정적으로 이어졌어요')).not.toMatch(/안정적/);
  const out = neutralizeNarrative({ journey: '불안정했고 긴장이 남았어요.', bodyText: '몸이 산만했어요.', mindText: '마음이 차분해졌어요.', closing: '긴장이 남아 있어요.', body: [], mind: [] });
  expect(out.journey).not.toMatch(EVALUATIVE_PATTERN);
  expect(out.closing).not.toMatch(EVALUATIVE_PATTERN);
  expect(out.bodyText === null || !EVALUATIVE_PATTERN.test(out.bodyText)).toBe(true);
  expect(out.mindText === null || !EVALUATIVE_PATTERN.test(out.mindText)).toBe(true);
});

// ---- 렌더 ----
const base: ReportDto = {
  id: 'a', session_id: 'sa', user_id: 'c', type: 'client', pdf_url: null, sent_at: '2026-10-01', is_read: false, created_at: '2026-10-01',
  session_title: '저녁의 호흡 · 2회차', session_type: 'meditation', scheduled_at: '2026-11-04T19:30:00', counselor_name: '가',
  content: { headline: '호흡에 다시 머문 시간', summary: '호흡과 몸의 감각에 주의를 기울였어요.', counselor_comment: '떠오른 생각을 알아차리고 돌아왔어요.', insights: ['호흡을 세며 관심을 돌렸어요.'] },
};
// 20분 = 40점(30초 간격) 중 5~6분 사이는 비움 → 빈 슬롯 확인
const timeline = Array.from({ length: 40 }, (_, i) => ({ min: i * 0.5, concentration: 40 + i * 0.6, relaxation: 35 + i * 0.7, stress: 0.55 - i * 0.004, heart_rate: 80 - i * 0.2, respiratory_rate: 17 - i * 0.08, sdnn: 38 + i * 0.5 }))
  .filter((p) => !(p.min >= 5 && p.min < 6));
const rich: ReportDto = { ...base, content: { ...base.content, quote: '생각이 떠오를 때마다 다시 돌아왔어요.', eeg: { status: 'valid', score: 70, metrics: {}, timeline, narrative: { journey: '서서히 느려진 호흡이 이어졌어요.', closing: '수고했어요.', body: '호흡수와 심박수가 내려갔어요.', mind: '마음의 신호가 올라갔어요.' } } } };
let root: Root; let box: HTMLDivElement;
beforeEach(() => { box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box); });
afterEach(() => { act(() => root.unmount()); box.remove(); });
const render = (r: ReportDto, props: { showRail?: boolean } = {}) => act(() => root.render(<UiV2ReportBody report={r} onClose={() => {}} {...props} />));
const BANNED = /점수|종합점수|좋음|나쁨|좋아졌|나빠졌|주의가 필요|완료|보증|100%|불안정|안정적으로|산만했|긴장이 남|PDF|다운로드/;

it('착용: 섹션 순서·지표 6개·1분 20슬롯·빈 슬롯·숫자 라벨 없음·금지 표현 0·박스에 "비슷해요" 없음', () => {
  render(rich, { showRail: true });
  const ids = [...box.querySelectorAll('[data-section]')].map((n) => n.getAttribute('data-section'));
  expect(ids).toEqual(['cover', 'journey', 'body', 'mind', 'closing', 'coach', 'ai']);
  expect(box.querySelectorAll('[data-metric]').length).toBe(6);
  for (const plot of box.querySelectorAll('.u2r3-plot')) {
    expect(plot.children.length).toBe(20);
    expect(plot.querySelectorAll('[data-empty="true"]').length).toBeGreaterThanOrEqual(1);
    expect(plot.textContent).toBe(''); // 막대 위 숫자 라벨 없음
  }
  const text = box.textContent ?? '';
  expect(text).not.toMatch(BANNED);
  expect(text).not.toMatch(/증가|감소/);
  expect(text).toContain('빈 칸 = 측정 없음');
  expect(text.split('본 서비스와 LINK BAND는 의료기기가 아니며').length - 1).toBe(1);
  for (const cb of box.querySelectorAll('[data-testid="change-box"]')) expect(cb.textContent).toMatch(/변화[+-]?\d+\.\d/);
  for (const cb of box.querySelectorAll('[data-testid="change-box"]')) expect(cb.textContent).not.toContain('비슷해요');
  expect(box.querySelector('[data-testid="report-quote"]')?.textContent).toContain('생각이 떠오를 때마다');
  expect(box.querySelector('.u2r3-rail')).toBeTruthy();
  expect(box.querySelector('[data-testid="report-no-band-notice"]')).toBeNull();
  expect(box.querySelector('[data-testid="report-insights"]')).toBeTruthy();
});
it('착용: 초록/빨강 평가색·권장 범위 띠 없음(막대 색은 보라 6단계만)', () => {
  render(rich);
  const html = box.innerHTML.toLowerCase();
  for (const red of ['#f9746b', '#59ce90', '#e0f5ee', '#93e5b9', 'green', 'red']) expect(html).not.toContain(red);
  for (const bar of box.querySelectorAll<HTMLElement>('.u2r3-bar')) {
    const step = Number(bar.getAttribute('data-step'));
    expect(step).toBeGreaterThanOrEqual(0); expect(step).toBeLessThanOrEqual(5);
  }
});
it('quote 유무: 없거나 빈 값이면 숨김', () => {
  for (const q of [undefined, null, '', '  ', 3]) {
    render({ ...rich, content: { ...rich.content, quote: q } });
    expect(box.querySelector('[data-testid="report-quote"]')).toBeNull();
  }
});
it('미착용: 측정 본문·종합 여정·그래프 없음, 커버·인용·안내·코치·AI 요약만', () => {
  render({ ...base, content: { ...base.content, quote: '오늘 마음에 남은 말이에요.' } });
  expect(box.querySelector('[data-testid="ui-v2-report-measure"]')).toBeNull();
  expect(box.querySelector('.u2r3-plot')).toBeNull();
  expect(box.querySelector('[data-testid="report-no-band-notice"]')).toBeTruthy();
  expect(box.querySelector('[data-testid="report-quote"]')).toBeTruthy();
  expect([...box.querySelectorAll('[data-section]')].map((n) => n.getAttribute('data-section'))).toEqual(['cover', 'coach', 'ai']);
  expect(box.textContent ?? '').not.toMatch(BANNED);
});
