// SDD-284 T4 — 기기 시트 하단 접이식 "연결 진단". 기본 숨김, 우상단 상태 아이콘으로 열고 닫고, 이상이면 자동으로 보인다.
// 판정은 connection-diagnostics-model(순수)이 하고 여기는 그리기만 한다.
import { useState } from 'react';
import { CircleDot, TriangleAlert } from 'lucide-react';
import { resolveDiagOpen, type ConnectionDiagnosticsView, type DiagOverride } from './connection-diagnostics-model';
import './member-player.css';

interface ConnectionDiagnosticsProps { view: ConnectionDiagnosticsView }

/** 시트 안쪽 맨 위 줄(우측)의 상태 아이콘 + 하단 진단 영역. 시트 본문을 children 으로 받아 사이에 끼운다. */
export function ConnectionDiagnosticsFrame({ view, children }: ConnectionDiagnosticsProps & { children: React.ReactNode }) {
  const [override, setOverride] = useState<DiagOverride | null>(null);
  const open = resolveDiagOpen(view, override);
  const Icon = view.abnormal ? TriangleAlert : CircleDot;
  return (
    <div className="mp-diag-frame">
      <div className="mp-diag-bar">
        <span className="mp-diag-bar__label">연결 진단</span>
        <button
          type="button"
          className="mp-diag-toggle"
          data-abnormal={view.abnormal ? 'true' : undefined}
          aria-label="연결 진단 표시 또는 숨기기"
          aria-expanded={open}
          aria-controls="mp-diag-panel"
          data-pz="diag-toggle"
          onClick={() => setOverride({ open: !open, forKind: view.kind })}
        >
          <Icon size={22} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      {children}
      {open ? <ConnectionDiagnosticsPanel view={view} /> : null}
    </div>
  );
}

export function ConnectionDiagnosticsPanel({ view }: ConnectionDiagnosticsProps) {
  return (
    <section id="mp-diag-panel" className="mp-diag" data-pz="diag" aria-label="연결 진단" data-kind={view.kind}>
      <h3>연결 진단</h3>
      {view.alerts.length === 0
        ? <div className="mp-diag__alert" data-tone="good" role="status">{view.okText}</div>
        : view.alerts.map((a) => <div key={a.kind} className="mp-diag__alert" data-tone={a.tone} data-kind={a.kind} role="status">{a.text}</div>)}
      <dl className="mp-diag__rows">
        {view.rows.map((r) => (
          <div key={r.key} className="mp-diag__row" data-key={r.key}><dt>{r.label}</dt><dd>{r.value}</dd></div>
        ))}
      </dl>
      <table className="mp-diag__counts">
        <thead><tr><th scope="col">업로드 현황</th><th scope="col">대기</th><th scope="col">서버에 도착</th></tr></thead>
        <tbody>
          {view.counts.map((c) => <tr key={c.label}><td>{c.label}</td><td>{c.pending}</td><td>{c.arrived}</td></tr>)}
        </tbody>
      </table>
      <small>기기에 마지막으로 확인된 전송 상태</small>
    </section>
  );
}
