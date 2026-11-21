import { describe, expect, it } from 'vitest';
import {
  MIN_GROUP_N,
  expectedBookPagesV2,
  type MemberReportV2,
  type MetricKeyV2,
} from '../src/lib/member-report/types-v2';
import schema from '../src/lib/member-report/__fixtures__/v2/member-report-v2.schema.json';

// 픽스처는 BE tests/fixtures/member_report_v2 와 동일 바이트(BE 계약 테스트가 보증)
const modules = import.meta.glob<MemberReportV2>('../src/lib/member-report/__fixtures__/v2/{bodycare,mindcare}.json', {
  eager: true, import: 'default',
});
const byName: Record<string, MemberReportV2> = {};
for (const [path, mod] of Object.entries(modules)) byName[path.split('/').pop() as string] = mod;
const names = Object.keys(byName).sort();
const load = (n: string): MemberReportV2 => structuredClone(byName[n]);
const FORBIDDEN = ['점수', '등급', '스트레스', '우울', '진단합니다', '위험', '불규칙', '덕분에', '때문에'];
const JARGON = ['RMSSD', 'SDNN', 'HRV', 'LF/HF', 'PRV', '심박수'];

function* strings(node: unknown, path: string[] = []): Generator<[string[], string]> {
  if (typeof node === 'string') yield [path, node];
  else if (Array.isArray(node)) for (let i = 0; i < node.length; i++) yield* strings(node[i], [...path, String(i)]);
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) yield* strings(v, [...path, k]);
}

describe('member_report.v2 계약 픽스처', () => {
  it('합성 픽스처 2종', () => expect(names).toEqual(['bodycare.json', 'mindcare.json']));

  it.each(names)('%s: 구조·결측 규칙', (n) => {
    const r = load(n);
    expect(r.schema_version).toBe('member_report.v2');
    expect(r.opinion.narrative.source).toBe('rule');
    expect(r.meta.settle_minutes).toBe(2);
    for (const [k, sec] of Object.entries(r.metrics)) {
      expect(sec.key).toBe(k as MetricKeyV2);
      if (sec.state === 'ok') {
        const b = sec.body!;
        const len = b.series.minutes.length;
        expect(len).toBe(r.meta.last_minute);
        expect((b.series.values ?? b.series.norm)!.length).toBe(len);
        const gb = b.series.group_band;
        if (gb) {
          gb.n.forEach((c, i) => {
            expect(c >= MIN_GROUP_N).toBe(gb.mean[i] !== null);
            expect(c >= MIN_GROUP_N).toBe(gb.sd[i] !== null);
          });
          expect(gb.mean[0]).toBeNull();
          expect(gb.mean[1]).toBeNull();
        }
        if (b.group === null) expect(gb).toBeNull();
      } else {
        expect(sec.body).toBeNull();
        expect(sec.missing_reason).not.toBeNull();
      }
    }
  });

  it.each(names)('%s: 금지어·큰 글씨 전문용어 0(각주 필드만 허용)', (n) => {
    const r = load(n);
    for (const [path, s] of strings(r)) {
      for (const w of FORBIDDEN) expect(s, path.join('.')).not.toContain(w);
      if (path[path.length - 1] === 'footnote') continue;
      for (const w of JARGON) expect(s, path.join('.')).not.toContain(w);
    }
  });

  it('쪽수 규칙: 몸돌봄 18쪽(편안한 5분 7쪽), 마음돌봄 1/f 없음 17쪽', () => {
    const b = expectedBookPagesV2(load('bodycare.json'));
    expect(b.total).toBe(18);
    expect(b.pages[6].key).toBe('quiet5');
    expect(b.toc.slice(2, 4).map((t) => [t.label, t.start, t.end])).toEqual([
      ['몸의 변화 · 수업 여정과 다섯 지표', 5, 10], ['마음의 변화 · 네 지표', 11, 14]]);
    const m = expectedBookPagesV2(load('mindcare.json'));
    expect(m.total).toBe(17);
    expect(m.toc[3]).toMatchObject({ label: '마음의 변화 · 세 지표', start: 11, end: 13 });
  });

  it('JSON Schema 사본과 TS 타입이 같은 키 집합(드리프트)', () => {
    const defs = (schema as { $defs: Record<string, { properties?: Record<string, unknown> }> }).$defs;
    const top = (schema as { properties: Record<string, unknown> }).properties;
    const r = load('bodycare.json');
    expect(Object.keys(top).sort()).toEqual(Object.keys(r).sort());
    expect(Object.keys(defs.MemberMetaV2.properties!).sort()).toEqual(Object.keys(r.meta).sort());
    expect(Object.keys(defs.HeroV2.properties!).sort()).toEqual(Object.keys(r.hero).sort());
    expect(Object.keys(defs.Quiet5.properties!).sort()).toEqual(Object.keys(r.quiet5!).sort());
    const body = r.metrics.heart_rate!.body!;
    expect(Object.keys(defs.MetricBodyV2.properties!).sort()).toEqual(Object.keys(body).sort());
    expect(Object.keys(defs.SeriesV2.properties!).sort()).toEqual(Object.keys(body.series).sort());
    expect(Object.keys(defs.DistributionV2.properties!).sort()).toEqual(Object.keys(body.group!.distribution).sort());
    expect(Object.keys(defs.GroupBandV2.properties!).sort()).toEqual(Object.keys(body.series.group_band!).sort());
  });
});
