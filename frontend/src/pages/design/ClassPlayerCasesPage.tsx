// SDD-208 — 클래스 진행 화면 케이스 하니스.
// /design/class-player?role=member|host&case=ID&sheet=&detail=&viewport=390x844
// 서버·BLE 없이 픽스처만으로 회원 M01~M21 · 상담사 C01~C18 을 결정적으로 렌더해 측정(e2e/class-player)과 눈 확인에 쓴다.
import { useEffect, useMemo, type CSSProperties } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import {
  HARNESS_BACKDROP_SRC,
  collectPlayerCases,
  parseViewport,
  type PlayerCaseContext,
  type PlayerCaseMap,
  type PlayerRole,
} from '../../lib/class/player-harness';

declare global {
  interface Window {
    /** 케이스가 그려지고 폰트가 준비되면 true — 측정 스크립트가 기다린다 */
    __ready?: boolean;
    /** 등록된 케이스 ID(역할별) — 측정 스크립트가 미등록 케이스를 건너뛴다 */
    __playerCases?: Record<PlayerRole, string[]>;
  }
}

const CASES: PlayerCaseMap = collectPlayerCases(import.meta.glob('../../lib/class/fixtures/*.ts', { eager: true }));

const idsOf = (role: PlayerRole): string[] =>
  Object.keys(CASES).filter((id) => CASES[id]?.role === role).sort();
const REGISTRY: Record<PlayerRole, string[]> = { member: idsOf('member'), host: idsOf('host') };

const pageStyle: CSSProperties = {
  minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16,
  background: '#12081c', color: '#f7f4f0', fontFamily: 'system-ui, sans-serif',
};

function findCase(role: string | null, caseId: string | null): PlayerCaseMap[string] | null {
  if (!role || !caseId) return null;
  const entry = CASES[caseId] ?? CASES[caseId.toUpperCase()];
  return entry && entry.role === role ? entry : null;
}

export default function ClassPlayerCasesPage() {
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const search = params.toString();
  const role = params.get('role');
  const caseId = params.get('case');
  const viewport = parseViewport(params.get('viewport'));
  const entry = findCase(role, caseId);

  const ctx = useMemo<PlayerCaseContext>(() => {
    const query = new URLSearchParams(search);
    return {
      sheet: query.get('sheet') || null,
      detail: query.get('detail') || null,
      backdropSrc: HARNESS_BACKDROP_SRC,
      params: query,
    };
  }, [search]);

  useEffect(() => {
    window.__playerCases = REGISTRY;
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
          title={`${role ?? ''} ${caseId ?? ''} ${viewport.width}x${viewport.height}`}
          width={viewport.width}
          height={viewport.height}
          src={`${pathname}?${inner.toString()}`}
          style={{ border: '1px solid rgba(255,255,255,0.25)', background: '#000' }}
        />
      </div>
    );
  }

  if (!entry) {
    return (
      <div style={pageStyle} role="status">
        <div style={{ maxWidth: 560 }}>
          <h1 style={{ fontSize: 24, margin: '0 0 12px' }}>케이스 미등록</h1>
          <p style={{ fontSize: 15, margin: '0 0 16px' }}>
            요청: role={role ?? '-'} · case={caseId ?? '-'}
          </p>
          <p style={{ fontSize: 13, margin: '0 0 8px' }}>회원 케이스: {REGISTRY.member.join(', ') || '없음'}</p>
          <p style={{ fontSize: 13, margin: 0 }}>코치 케이스: {REGISTRY.host.join(', ') || '없음'}</p>
        </div>
      </div>
    );
  }

  return <>{entry.render(ctx)}</>;
}
