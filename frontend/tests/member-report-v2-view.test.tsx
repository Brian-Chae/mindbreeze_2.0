// @vitest-environment jsdom
// SDD-328 F3 — v2 화면 렌더(골든 픽스처 2종) + v1/v2 디스패치 + 큰 글씨 전문용어·금지어 0
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import MemberReportViewV2 from '../src/components/member-report-v2/MemberReportViewV2';
import MemberReportBookView from '../src/components/reports/MemberReportBookView';
import { extractMemberReport, isMemberReportV2 } from '../src/lib/api/member-report';
import type { MemberReportV2 } from '../src/lib/member-report/types-v2';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const fx = (n: string): MemberReportV2 =>
  JSON.parse(readFileSync(resolve(__dirname, `../src/lib/member-report/__fixtures__/v2/${n}.json`), 'utf8')) as MemberReportV2;
const v1 = (): unknown =>
  JSON.parse(readFileSync(resolve(__dirname, '../src/lib/member-report/__fixtures__/member-report-sample.json'), 'utf8'));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

const TERMS = ['RMSSD', 'SDNN', 'HRV', 'LF/HF', 'PRV', '심박수'];
const FORBIDDEN = ['점수', '등급', '스트레스', '우울', '진단합니다', '위험', '불규칙'];

describe.each(['bodycare', 'mindcare'])('MemberReportViewV2 %s', (name) => {
  it('핵심 섹션·그래프를 오류 없이 렌더', () => {
    const r = fx(name);
    act(() => root.render(<MemberReportViewV2 report={r} />));
    const q = (s: string) => container.querySelector(s);
    expect(q('[data-testid="member-report-v2"]')).not.toBeNull();
    for (const id of ['mr2-summary', 'mr2-opinion', 'mr2-body', 'mr2-mind', 'mr2-next', 'mr2-method', 'mr2-journey', 'mr2-quiet5']) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull();
    }
    expect(container.querySelectorAll('.mr2-pair').length).toBe(r.hero.pairs.length);
    const okCount = Object.values(r.metrics).filter((s) => s.state === 'ok').length;
    expect(container.querySelectorAll('article[data-metric]').length).toBe(okCount);
    // V-B5 안착 회색·평균 점선·±SD 띠
    expect(container.querySelectorAll('.mr2-settle').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.mr2-gmean').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.mr2-band').length).toBeGreaterThan(0);
    // 회원 처음 시작·SVG NaN 없음
    for (const p of container.querySelectorAll('svg path')) expect(p.getAttribute('d') ?? '').not.toContain('NaN');
    expect(container.textContent).toContain('문의: 담당 클래스 코치');
  });

  it('LF/HF 쪽은 그룹 분포·세로 숫자 없음', () => {
    act(() => root.render(<MemberReportViewV2 report={fx(name)} />));
    const lf = container.querySelector('article[data-metric="lf_hf"]')!;
    expect(lf.querySelector('.mr2-dist')).toBeNull();
    expect(lf.querySelector('.mr2-band')).toBeNull();
    expect(lf.querySelectorAll('svg .mr2-axis').length).toBeGreaterThan(0); // 가로(분) 눈금만
    expect(Array.from(lf.querySelectorAll('svg .mr2-axis')).every((t) => (t.textContent ?? '').endsWith('분'))).toBe(true);
  });

  it('큰 글씨 전문용어 0·금지어 0 (각주·legend 제외)', () => {
    act(() => root.render(<MemberReportViewV2 report={fx(name)} />));
    const clone = container.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.mr2-footnote,.mr2-legend,.mr2-note,svg').forEach((n) => n.remove());
    const text = clone.textContent ?? '';
    for (const t of TERMS) expect(text, t).not.toContain(t);
    for (const w of FORBIDDEN) expect(container.textContent ?? '', w).not.toContain(w);
    expect(text).not.toMatch(/\d+(\.\d+)?\s*ms/);
  });

  it('편안한 5분 문구는 단정형이 아님', () => {
    act(() => root.render(<MemberReportViewV2 report={fx(name)} />));
    const t = container.querySelector('[data-testid="mr2-quiet5"]')!.textContent ?? '';
    expect(/찾았어요|후보|느낌과 함께/.test(t)).toBe(true);
  });
});

describe('버전 디스패치(V-B2/V-B3)', () => {
  it('v2 는 v2 화면, v1 은 기존 화면', () => {
    expect(isMemberReportV2(extractMemberReport({ member_report: fx('bodycare') })!)).toBe(true);
    const a = extractMemberReport({ member_report: v1() })!;
    expect(isMemberReportV2(a)).toBe(false);
    act(() => root.render(<MemberReportBookView report={fx('bodycare')} reportId={null} />));
    expect(container.querySelector('[data-testid="member-report-v2"]')).not.toBeNull();
    act(() => root.render(<MemberReportBookView report={a} reportId={null} />));
    expect(container.querySelector('[data-testid="member-report-v2"]')).toBeNull();
    expect(container.querySelector('.mr-root')).not.toBeNull();
  });
  it('알 수 없는 버전·없음 → null(예외 없음)', () => {
    expect(extractMemberReport({ member_report: { schema_version: 'member_report.v9' } })).toBeNull();
    expect(extractMemberReport({})).toBeNull();
    expect(extractMemberReport(null)).toBeNull();
  });
});

describe('결측·짧은 측정', () => {
  it('미착용: 몸·마음 장 없음, 예외 없음', () => {
    const r = fx('bodycare');
    const nw: MemberReportV2 = { ...r, meta: { ...r.meta, band_status: 'not_worn' }, journey: null, quiet5: null, hero: { ...r.hero, pairs: [], quiet_highlight: null }, metrics: {} };
    act(() => root.render(<MemberReportViewV2 report={nw} />));
    expect(container.querySelector('#mr2-body')).toBeNull();
    expect(container.querySelector('#mr2-mind')).toBeNull();
    expect(container.querySelector('#mr2-method')).not.toBeNull();
  });
  it('1/f 결측(mindcare)은 쪽 생략', () => {
    act(() => root.render(<MemberReportViewV2 report={fx('mindcare')} />));
    expect(container.querySelector('article[data-metric="aperiodic"]')).toBeNull();
  });
});
