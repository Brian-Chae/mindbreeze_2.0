import { describe, expect, it } from 'vitest';
import { expectedBookPages, type MemberReport, type MetricKey } from '../src/lib/member-report/types';

// 픽스처는 BE tests/fixtures/member_report 와 동일 바이트(BE 계약 테스트가 보증)
const modules = import.meta.glob<MemberReport>('../src/lib/member-report/__fixtures__/member-report-*.json', {
  eager: true, import: 'default',
});
const byName: Record<string, MemberReport> = {};
for (const [path, mod] of Object.entries(modules)) byName[path.split('/').pop() as string] = mod;
const names = Object.keys(byName).sort();
const load = (n: string): MemberReport => structuredClone(byName[n]);
const FORBIDDEN = ['B5', '건강 수준', '점수', '등급', '스트레스', '우울', '진단합니다', '위험'];

describe('member_report 계약 픽스처', () => {
  it('픽스처가 7개 이상', () => expect(names.length).toBeGreaterThanOrEqual(7));

  it.each(names)('%s: 구조·결측 규칙을 만족', (n) => {
    const r = load(n);
    expect(r.schema_version).toBe('member_report.v1');
    for (const [k, sec] of Object.entries(r.metrics)) {
      expect(sec.key).toBe(k as MetricKey);
      if (sec.state === 'ok') {
        expect(sec.body).not.toBeNull();
        expect(sec.missing_reason).toBeNull();
        const len = sec.body!.series.minutes.length;
        expect((sec.body!.series.values ?? sec.body!.series.norm)!.length).toBe(len);
        if (sec.body!.group === null) expect(sec.body!.series.group_band).toBeNull();
      } else {
        expect(sec.body).toBeNull();
        expect(sec.missing_reason).not.toBeNull();
      }
    }
    if (r.meta.band_status === 'not_worn') {
      for (const s of Object.values(r.metrics)) expect(s.missing_reason).toBe('band_not_worn');
    }
    const text = JSON.stringify(r);
    for (const w of FORBIDDEN) expect(text).not.toContain(w);
  });

  it('샘플은 18쪽, 시안 목차와 동일', () => {
    const m = expectedBookPages(load('member-report-sample.json'));
    expect(m.total).toBe(18);
    expect(m.toc.slice(2, 4)).toEqual([
      { label: '몸의 변화 · 수업 여정과 다섯 지표', start: 5, end: 10 },
      { label: '마음의 변화 · 네 지표', start: 11, end: 14 },
    ]);
  });

  it.each(['no_raw', 'insufficient_window', 'poor_fit'])('1/f 결측(%s) → 17쪽, 마음 세 지표', (reason) => {
    const r = load(`member-report-no-aperiodic-${reason}.json`);
    expect(r.metrics.aperiodic?.missing_reason).toBe(reason);
    const m = expectedBookPages(r);
    expect(m.total).toBe(17);
    expect(m.toc[3]).toEqual({ label: '마음의 변화 · 세 지표', start: 11, end: 13 });
  });

  it('aperiodic 키가 없어도 17쪽', () => {
    const r = load('member-report-sample.json');
    delete r.metrics.aperiodic;
    expect(expectedBookPages(r).total).toBe(17);
  });

  it('밴드 미착용은 8쪽 축약판', () => {
    const m = expectedBookPages(load('member-report-not-worn.json'));
    expect(m.pages.map((p) => p.key)).toEqual(['cover', 'toc', 'summary', 'opinion', 'next_steps', 'memo', 'method', 'back']);
  });

  it('일부 지표 결측(RMSSD)은 그 쪽만 생략', () => {
    const m = expectedBookPages(load('member-report-partial-missing-rmssd.json'));
    expect(m.total).toBe(17);
    expect(m.pages.some((p) => p.key === 'rmssd')).toBe(false);
  });
});
