// SDD-209 T1 — 케이스 키 파서·레지스트리. 정본(case-keys.json 232개)을 전부 파싱해야 한다.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFlowCaseKey, parseFlowCaseRef } from '../src/lib/class/flow/case-key';
import { buildFlowIndex, collectFlowCases, diffFlowRegistry, listFlowRefs } from '../src/lib/class/flow/registry';
import { FLOW_SCREEN_IDS, roleOfScreen } from '../src/lib/class/flow/types';

interface CaseKeysFile {
  total: number;
  screens: Record<string, { count: number; cases: string[] }>;
  cases: string[];
}

const canonical = JSON.parse(
  readFileSync(resolve(__dirname, '../../designs/class-flow-redesign/case-keys.json'), 'utf8'),
) as CaseKeysFile;

describe('case-keys.json 정본', () => {
  it('232 케이스, 화면 30개, 화면별 count 가 목록과 일치', () => {
    expect(canonical.total).toBe(232);
    expect(canonical.cases).toHaveLength(232);
    expect(new Set(canonical.cases).size).toBe(232);
    expect(Object.keys(canonical.screens).sort()).toEqual([...FLOW_SCREEN_IDS].sort());
    for (const spec of Object.values(canonical.screens)) expect(spec.cases).toHaveLength(spec.count);
  });

  it('232 키 전부 파싱되고 화면·키가 보존된다', () => {
    const failed: string[] = [];
    for (const ref of canonical.cases) {
      const parsed = parseFlowCaseRef(ref);
      if (!parsed || `${parsed.screen}:${parsed.key}` !== ref) failed.push(ref);
    }
    expect(failed).toEqual([]);
  });

  it('회원 106 · 상담사 126', () => {
    const roles = canonical.cases.map((ref) => roleOfScreen(parseFlowCaseRef(ref)!.screen));
    expect(roles.filter((r) => r === 'member')).toHaveLength(106);
    expect(roles.filter((r) => r === 'host')).toHaveLength(126);
  });
});

describe('회원 사전 흐름 키', () => {
  it('밴드 모드·장소·인원·상태·started 를 분해한다', () => {
    expect(parseFlowCaseKey('FM06c', 'on-group-opt-member-leadoffl')).toMatchObject({
      kind: 'prep', place: 'online', size: 'group', bandMode: 'opt', state: 'leadoffl', started: false,
    });
    expect(parseFlowCaseKey('FM06c', 'on-group-opt-member-idle-started')).toMatchObject({ state: 'idle', started: true });
    expect(parseFlowCaseKey('FM06d', 'on-solo-req-member-camon-spk')).toMatchObject({ bandMode: 'req', size: 'solo', state: 'camon-spk' });
    expect(parseFlowCaseKey('FM06a', 'off-solo-opt-member')).toMatchObject({ place: 'offline', state: '' });
    expect(parseFlowCaseKey('FM08', 'on-group-member-cancel-sheet')).toMatchObject({ bandMode: null, state: 'cancel-sheet' });
    expect(parseFlowCaseKey('FM09', 'off-solo-member')).toMatchObject({ bandMode: null, place: 'offline', size: 'solo' });
  });

  it('문법·어휘가 틀리면 null', () => {
    expect(parseFlowCaseKey('FM06c', 'on-group-opt-member-bogus')).toBeNull();
    expect(parseFlowCaseKey('FM06c', 'on-group-member-idle')).toBeNull(); // 밴드 모드 누락
    expect(parseFlowCaseKey('FM08', 'on-group-opt-member')).toBeNull(); // FM08 은 밴드 모드 없음
    expect(parseFlowCaseKey('FM07', 'on-group-opt-member-started')).toBeNull(); // started 비허용 화면
    expect(parseFlowCaseKey('FM06c', 'on-group-opt-member')).toBeNull(); // 상태 필수
    expect(parseFlowCaseKey('XX99', 'default')).toBeNull();
    expect(parseFlowCaseRef('no-colon')).toBeNull();
  });
});

describe('상담사 FH06 로비 키', () => {
  it('인원·r·변형을 분해한다', () => {
    expect(parseFlowCaseKey('FH06', 'g-on-3')).toMatchObject({ kind: 'lobby', size: 'group', place: 'online', count: 3, allReady: false, variant: null });
    expect(parseFlowCaseKey('FH06', 'o-off-1r-none')).toMatchObject({ size: 'solo', place: 'offline', count: 1, allReady: true, variant: 'none' });
    expect(parseFlowCaseKey('FH06', 'g-on-12-many')).toMatchObject({ count: 12, variant: 'many' });
    expect(parseFlowCaseKey('FH06', 'g-on-0-inv0')).toMatchObject({ count: 0, variant: 'inv0' });
  });

  it('잘못된 키는 null', () => {
    expect(parseFlowCaseKey('FH06', 'x-on-3')).toBeNull();
    expect(parseFlowCaseKey('FH06', 'g-on-3-bogus')).toBeNull();
    expect(parseFlowCaseKey('FH06', 'g-on')).toBeNull();
  });
});

describe('고정 키 화면', () => {
  it('어휘 안의 키만 허용', () => {
    expect(parseFlowCaseKey('FM04', 'leading-zero')).toEqual({ kind: 'simple', screen: 'FM04', key: 'leading-zero' });
    expect(parseFlowCaseKey('FH09', 'excluded-common')).not.toBeNull();
    expect(parseFlowCaseKey('FM04', 'nope')).toBeNull();
  });
});

describe('레지스트리', () => {
  const entry = (description: string) => ({ description, render: () => null });
  const modules = {
    './fixtures/b.ts': { flowCases: { 'FH05:ok': entry('정상'), 'FM04:default': entry('기본') } },
    './fixtures/a.ts': { flowCases: { 'FM04:bogus': entry('잘못된 키'), 'FM04:error': { description: 1 } } },
    './fixtures/c.ts': { other: 1 },
  };

  it('flowCases 만 모으고 잘못된 키·형태는 제외', () => {
    const map = collectFlowCases(modules);
    expect(Object.keys(map).sort()).toEqual(['FH05:ok', 'FM04:default']);
    expect(listFlowRefs(map)).toEqual({ member: ['FM04:default'], host: ['FH05:ok'] });
    expect(buildFlowIndex(map).map((r) => `${r.screen}:${r.key}`)).toEqual(['FH05:ok', 'FM04:default']);
  });

  it('정본 대비 누락·초과를 계산', () => {
    const map = collectFlowCases(modules);
    const { missing, extra } = diffFlowRegistry(map, ['FM04:default', 'FM04:error']);
    expect(missing).toEqual(['FM04:error']);
    expect(extra).toEqual(['FH05:ok']);
  });
});
