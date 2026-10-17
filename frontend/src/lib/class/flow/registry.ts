// SDD-209 T1 — 케이스 레지스트리. fixtures/*.ts 가 `export const flowCases` 를 내보내면 자동 수집된다.
// 트랙(M·H·SH)은 각자 fixtures 파일만 추가하고 하니스 페이지는 수정하지 않는다.
import { parseFlowCaseRef } from './case-key';
import { roleOfScreen, type FlowCaseEntry, type FlowRole, type FlowScreenId } from './types';

/** 키: `화면ID:케이스키` (case-keys.json 의 cases 항목과 같은 형식) */
export type FlowCaseMap = Record<string, FlowCaseEntry>;

function isCaseEntry(value: unknown): value is FlowCaseEntry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { description?: unknown; render?: unknown };
  return typeof candidate.description === 'string' && typeof candidate.render === 'function';
}

/** import.meta.glob 결과에서 flowCases 를 모은다. 경로 순으로 병합해 결과가 결정적이고, 키 문법이 틀린 항목은 제외한다 */
export function collectFlowCases(modules: Record<string, unknown>): FlowCaseMap {
  const collected: FlowCaseMap = {};
  for (const path of Object.keys(modules).sort()) {
    const mod = modules[path];
    if (typeof mod !== 'object' || mod === null || !('flowCases' in mod)) continue;
    const cases = (mod as { flowCases: unknown }).flowCases;
    if (typeof cases !== 'object' || cases === null) continue;
    for (const [ref, entry] of Object.entries(cases)) {
      if (parseFlowCaseRef(ref) && isCaseEntry(entry)) collected[ref] = entry;
    }
  }
  return collected;
}

export function caseRef(screen: FlowScreenId, key: string): string {
  return `${screen}:${key}`;
}

export function findFlowCase(map: FlowCaseMap, screen: string | null, key: string | null): FlowCaseEntry | null {
  if (!screen || !key) return null;
  return map[`${screen}:${key}`] ?? null;
}

/** 역할별 등록된 케이스 ref 목록(정렬) — 측정 스크립트가 window.__flowCases 로 읽는다 */
export function listFlowRefs(map: FlowCaseMap): Record<FlowRole, string[]> {
  const out: Record<FlowRole, string[]> = { member: [], host: [] };
  for (const ref of Object.keys(map).sort()) {
    const parsed = parseFlowCaseRef(ref);
    if (parsed) out[roleOfScreen(parsed.screen)].push(ref);
  }
  return out;
}

export interface FlowIndexRow {
  screen: FlowScreenId;
  key: string;
  description: string;
}

/** `?index=1` 표 — 화면 → 키 순 */
export function buildFlowIndex(map: FlowCaseMap): FlowIndexRow[] {
  const rows: FlowIndexRow[] = [];
  for (const [ref, entry] of Object.entries(map)) {
    const parsed = parseFlowCaseRef(ref);
    if (parsed) rows.push({ screen: parsed.screen, key: parsed.key, description: entry.description });
  }
  return rows.sort((a, b) => (a.screen === b.screen ? a.key.localeCompare(b.key) : a.screen.localeCompare(b.screen)));
}

/** 정본 키 목록 대비 미등록·초과 등록 (verify G1) */
export function diffFlowRegistry(map: FlowCaseMap, expected: readonly string[]): { missing: string[]; extra: string[] } {
  const have = new Set(Object.keys(map));
  const want = new Set(expected);
  return {
    missing: expected.filter((ref) => !have.has(ref)),
    extra: [...have].filter((ref) => !want.has(ref)).sort(),
  };
}
