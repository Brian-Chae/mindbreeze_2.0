// @vitest-environment jsdom
// SDD-327 T7 — 회원 리포트 화면: 픽스처 7종 렌더·결측 생략·그룹 숨김·금지어·lf_hf
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import MemberReportView from '../src/components/member-report/MemberReportView';
import type { MemberReport } from '../src/lib/member-report/types';
import sample from '../src/lib/member-report/__fixtures__/member-report-sample.json';
import groupHidden from '../src/lib/member-report/__fixtures__/member-report-group-hidden.json';
import notWorn from '../src/lib/member-report/__fixtures__/member-report-not-worn.json';
import partial from '../src/lib/member-report/__fixtures__/member-report-partial-missing-rmssd.json';
import noRaw from '../src/lib/member-report/__fixtures__/member-report-no-aperiodic-no_raw.json';
import insufficient from '../src/lib/member-report/__fixtures__/member-report-no-aperiodic-insufficient_window.json';
import poorFit from '../src/lib/member-report/__fixtures__/member-report-no-aperiodic-poor_fit.json';

const FORBIDDEN = ['B5', '건강 수준', '점수', '등급', '스트레스', '우울', '진단합니다', '위험'];
const fixtures: [string, MemberReport][] = [
  ['sample', sample as unknown as MemberReport],
  ['group-hidden', groupHidden as unknown as MemberReport],
  ['not-worn', notWorn as unknown as MemberReport],
  ['partial-missing-rmssd', partial as unknown as MemberReport],
  ['no-aperiodic-no_raw', noRaw as unknown as MemberReport],
  ['no-aperiodic-insufficient_window', insufficient as unknown as MemberReport],
  ['no-aperiodic-poor_fit', poorFit as unknown as MemberReport],
];

/** 요소 경계를 공백으로 구분한 화면 텍스트(textContent 는 인접 요소가 붙어 오탐 발생) */
function visibleText(el: Element): string {
  const parts: string[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? '');
  return parts.join(' ');
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
function render(report: MemberReport, shareSlot?: React.ReactNode) {
  act(() => root.render(<MemberReportView report={report} shareSlot={shareSlot} />));
}
const metricKeys = (): string[] =>
  Array.from(container.querySelectorAll('[data-metric]')).map((e) => e.getAttribute('data-metric') ?? '');

describe.each(fixtures)('픽스처 %s', (_name, report) => {
  it('렌더되고 금지어가 0이다', () => {
    render(report);
    const text = visibleText(container);
    expect(text.length).toBeGreaterThan(200);
    for (const w of FORBIDDEN) expect(text, `금지어 ${w}`).not.toContain(w);
  });
  it('상태 ok 인 지표만 카드로 그린다(결측 생략)', () => {
    render(report);
    const expected = Object.values(report.metrics).filter((m) => m?.state === 'ok').map((m) => m?.key).sort();
    expect(metricKeys().sort()).toEqual(expected);
  });
  it('요약 영역에 전후 쌍이 pairs 수만큼 있다', () => {
    render(report);
    expect(container.querySelectorAll('.mr-pair').length).toBe(report.hero.pairs.length);
  });
});

describe('개별 규칙', () => {
  it('sample: 전후 4쌍 + 지표 8개 + 안정된 5분', () => {
    render(sample as unknown as MemberReport);
    expect(container.querySelectorAll('.mr-pair').length).toBe(4);
    expect(metricKeys().length).toBe(8);
    expect(container.querySelector('#mr-stable5')).not.toBeNull();
  });
  it('결측 RMSSD 카드는 생략된다', () => {
    render(partial as unknown as MemberReport);
    expect(metricKeys()).not.toContain('rmssd');
  });
  it('group=null 이면 그룹 비교(접기)를 그리지 않는다', () => {
    render(groupHidden as unknown as MemberReport);
    const hidden = Object.values((groupHidden as unknown as MemberReport).metrics).filter((m) => m?.body?.group === null).length;
    expect(hidden).toBeGreaterThan(0);
    expect(container.querySelectorAll('details.mr-group').length).toBe(
      Object.values((groupHidden as unknown as MemberReport).metrics).filter((m) => m?.state === 'ok' && m.body?.group).length,
    );
  });
  it('sample: 그룹 비교는 접힘 상태(details)로 시작', () => {
    render(sample as unknown as MemberReport);
    const d = container.querySelectorAll('details.mr-group');
    expect(d.length).toBeGreaterThan(0);
    d.forEach((e) => expect((e as HTMLDetailsElement).open).toBe(false));
  });
  it('lf_hf 카드에는 변화량(전→후)을 그리지 않는다', () => {
    render(sample as unknown as MemberReport);
    const card = container.querySelector('[data-metric="lf_hf"]');
    expect(card).not.toBeNull();
    expect(card?.querySelector('[data-testid="mr-delta"]')).toBeNull();
    expect(container.querySelector('[data-metric="heart_rate"] [data-testid="mr-delta"]')).not.toBeNull();
  });
  it('미착용: 지표 카드·몸/마음 장이 없고 축약판이다', () => {
    render(notWorn as unknown as MemberReport);
    expect(metricKeys().length).toBe(0);
    expect(container.querySelector('#mr-body')).toBeNull();
    expect(container.querySelector('#mr-mind')).toBeNull();
    expect(container.querySelectorAll('.mr-pair').length).toBe(0);
  });
  it('보내기 슬롯을 주입하면 한 번 렌더한다', () => {
    render(sample as unknown as MemberReport, <button type="button">슬롯</button>);
    expect(container.querySelectorAll('.mr-share button').length).toBe(1);
  });
});
