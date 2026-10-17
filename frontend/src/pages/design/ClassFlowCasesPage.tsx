// SDD-209 T3 — 클래스 사전·사후 흐름 케이스 하니스.
// /design/class-flow?screen=FM06c&case=on-group-opt-member-leadoffl[&sheet=&n=&level=&ch1=&ch2=&viewport=390x844]
// 서버·BLE 없이 픽스처만으로 232 케이스를 결정적으로 렌더해 측정(e2e/class-flow)과 눈 확인에 쓴다. `?index=1` 은 인덱스 표.
import { useEffect, useMemo, type CSSProperties } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { deriveFlowExpect, type FlowExpect } from '../../lib/class/flow/expect';
import { buildFlowIndex, collectFlowCases, findFlowCase, listFlowRefs, type FlowCaseMap } from '../../lib/class/flow/registry';
import { SELFTEST_CASES } from '../../lib/class/flow/selftest-cases';
import type { FlowCaseContext, FlowRole } from '../../lib/class/flow/types';
import { HARNESS_BACKDROP_SRC, parseViewport } from '../../lib/class/player-harness';

declare global {
  interface Window {
    /** 케이스가 그려지고 폰트가 준비되면 true — 측정 스크립트가 기다린다 */
    __ready?: boolean;
    /** 등록된 케이스 ref(`화면:키`, 역할별) — 측정 스크립트가 미등록 케이스를 건너뛴다 */
    __flowCases?: Record<FlowRole, string[]>;
    /** 규칙 기대값(진행 점 수·상태 의존 요소·CTA 비교 그룹) — 측정 스크립트가 파생을 다시 구현하지 않도록 */
    __flowExpect?: (ref: string, query?: string) => FlowExpect;
  }
}

const CASES: FlowCaseMap = collectFlowCases(import.meta.glob('../../lib/class/flow/fixtures/*.ts', { eager: true }));
const REGISTRY = listFlowRefs(CASES);

const pageStyle: CSSProperties = {
  minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16,
  background: '#12081c', color: '#f7f4f0', fontFamily: 'system-ui, sans-serif',
};

function toNumber(raw: string | null): number | null {
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export default function ClassFlowCasesPage() {
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const search = params.toString();
  const screen = params.get('screen');
  const caseKey = params.get('case');
  const viewport = parseViewport(params.get('viewport'));
  const showIndex = params.get('index') === '1';

  const entry = (() => {
    const real = findFlowCase(CASES, screen, caseKey);
    if (real) return real;
    return screen && caseKey ? (SELFTEST_CASES[`${screen}:${caseKey}`] ?? null) : null;
  })();

  const ctx = useMemo<FlowCaseContext | null>(() => {
    if (!screen || !caseKey) return null;
    const query = new URLSearchParams(search);
    return {
      screen,
      caseKey,
      sheet: query.get('sheet') || null,
      n: toNumber(query.get('n')),
      level: toNumber(query.get('level')),
      ch1: query.get('ch1') || null,
      ch2: query.get('ch2') || null,
      backdropSrc: HARNESS_BACKDROP_SRC,
      params: query,
    };
  }, [search, screen, caseKey]);

  useEffect(() => {
    window.__flowCases = REGISTRY;
    window.__flowExpect = deriveFlowExpect;
    window.__ready = false;
    let cancelled = false;
    const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
    void fontsReady.then(() => {
      setTimeout(() => {
        if (!cancelled) window.__ready = true;
      }, 0);
    });
    return () => {
      cancelled = true;
    };
  }, [search]);

  if (viewport) {
    const inner = new URLSearchParams(search);
    inner.delete('viewport');
    return (
      <div style={pageStyle}>
        <iframe
          title={`${screen ?? ''} ${caseKey ?? ''} ${viewport.width}x${viewport.height}`}
          width={viewport.width}
          height={viewport.height}
          src={`${pathname}?${inner.toString()}`}
          style={{ border: '1px solid rgba(255,255,255,0.25)', background: '#000' }}
        />
      </div>
    );
  }

  if (showIndex) {
    const rows = buildFlowIndex(CASES);
    return (
      <div style={{ ...pageStyle, display: 'block' }}>
        <h1 style={{ fontSize: 24, margin: '0 0 8px' }}>클래스 사전·사후 흐름 케이스 인덱스</h1>
        <p data-testid="index-total" style={{ fontSize: 15, margin: '0 0 16px' }}>
          등록 {rows.length}건 · 회원 {REGISTRY.member.length} · 상담사 {REGISTRY.host.length}
        </p>
        <table style={{ fontSize: 13, borderCollapse: 'collapse' }}>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.screen}:${row.key}`}>
                <td style={{ padding: '2px 12px 2px 0' }}>{row.screen}</td>
                <td style={{ padding: '2px 12px 2px 0' }}>
                  <a style={{ color: '#d2aefc' }} href={`${pathname}?screen=${row.screen}&case=${encodeURIComponent(row.key)}`}>{row.key}</a>
                </td>
                <td style={{ padding: '2px 0' }}>{row.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (!entry || !ctx) {
    return (
      <div style={pageStyle} role="status">
        <div style={{ maxWidth: 560 }}>
          <h1 style={{ fontSize: 24, margin: '0 0 12px' }}>케이스 미등록</h1>
          <p style={{ fontSize: 15, margin: '0 0 16px' }}>
            요청: screen={screen ?? '-'} · case={caseKey ?? '-'}
          </p>
          <p style={{ fontSize: 13, margin: '0 0 8px' }}>회원 케이스 {REGISTRY.member.length}건 · 상담사 케이스 {REGISTRY.host.length}건 (?index=1 로 전체 목록)</p>
        </div>
      </div>
    );
  }

  return <>{entry.render(ctx)}</>;
}
