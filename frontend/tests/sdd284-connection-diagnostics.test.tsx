// @vitest-environment jsdom
// SDD-284 T4 — 연결 진단: 상태 6종, 기본 숨김/토글/자동 노출, "확인 전", 용어·금지 표현
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConnectionDiagnosticsFrame } from '../src/components/class/player/member/ConnectionDiagnosticsPanel';
import {
  DIAG_BACKLOG_FEATURE_PENDING, DIAG_BACKLOG_HOLD_MS, DIAG_BACKLOG_RAW_PENDING, deriveConnectionDiagnostics, resolveDiagOpen,
  type ConnectionDiagnosticsInput,
} from '../src/components/class/player/member/connection-diagnostics-model';

const base: ConnectionDiagnosticsInput = {
  path: 'native', status: 'running', code: null, nativeState: 'CAPTURING', streamIdHead: 'a1b2c3d4', restartCount: 0, lastConfirmElapsedMs: 3000,
  nativeFailed: false, socket: 'connected', upload: { featurePending: 0, featureAcked: 248, rawPending: 0, rawVerified: 12 }, backlogSinceMs: null, nowMs: 100_000,
};
const mk = (o: Partial<ConnectionDiagnosticsInput>): ConnectionDiagnosticsInput => ({ ...base, ...o });
const FORBIDDEN = ['점수', '종합점수', '좋음', '나쁨', '완료', '보증', '100%'];
const INTERNAL = ['feature', '원시', '수신'];

let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const mount = async (input: ConnectionDiagnosticsInput) => {
  const view = deriveConnectionDiagnostics(input);
  await act(async () => { root.render(<ConnectionDiagnosticsFrame view={view}><p>본문</p></ConnectionDiagnosticsFrame>); });
  return view;
};
const panel = (): HTMLElement | null => document.querySelector('[data-pz="diag"]');
const toggle = (): HTMLButtonElement => document.querySelector('[data-pz="diag-toggle"]') as HTMLButtonElement;

describe('상태 판정 6종', () => {
  it('정상', () => { const v = deriveConnectionDiagnostics(base); expect(v.kind).toBe('normal'); expect(v.abnormal).toBe(false); });
  it('시작 단계 정체 — 확정 대기 초과·재시작 n/5', () => {
    const v = deriveConnectionDiagnostics(mk({ status: 'starting', nativeState: 'ARMING', streamIdHead: null, lastConfirmElapsedMs: 24_000, restartCount: 2, code: null }));
    expect(v.kind).toBe('start_stalled'); expect(v.alerts[0].text).toContain('확정 대기 24초'); expect(v.alerts[0].text).toContain('2/5');
  });
  it('실시간 연결 끊김 — 측정 상태와 구분', () => {
    const v = deriveConnectionDiagnostics(mk({ socket: 'disconnected' }));
    expect(v.kind).toBe('socket_down'); expect(v.rows.find((r) => r.key === 'socket')?.value).toBe('끊김'); expect(v.rows.find((r) => r.key === 'status')?.value).toBe('running');
  });
  it('업로드 적체 — 임계값 초과가 30초 이상', () => {
    const over = { featurePending: DIAG_BACKLOG_FEATURE_PENDING + 1, featureAcked: 10, rawPending: 0, rawVerified: 1 };
    expect(deriveConnectionDiagnostics(mk({ upload: over, backlogSinceMs: 100_000 - DIAG_BACKLOG_HOLD_MS + 1 })).kind).toBe('normal');
    expect(deriveConnectionDiagnostics(mk({ upload: over, backlogSinceMs: 100_000 - DIAG_BACKLOG_HOLD_MS })).kind).toBe('upload_backlog');
    const raw = { featurePending: 0, featureAcked: 10, rawPending: DIAG_BACKLOG_RAW_PENDING + 1, rawVerified: 1 };
    expect(deriveConnectionDiagnostics(mk({ upload: raw, backlogSinceMs: 0 })).kind).toBe('upload_backlog');
    const atLimit = { featurePending: DIAG_BACKLOG_FEATURE_PENDING, featureAcked: 0, rawPending: DIAG_BACKLOG_RAW_PENDING, rawVerified: 0 };
    expect(deriveConnectionDiagnostics(mk({ upload: atLimit, backlogSinceMs: 0 })).kind).toBe('normal');
  });
  it('웹 경로 전환됨', () => {
    const v = deriveConnectionDiagnostics(mk({ path: 'web_wasm', nativeFailed: true, status: 'failed', code: 'native_stream_unconfirmed' }));
    expect(v.kind).toBe('web_fallback'); expect(v.alerts[0].text).toContain('웹 경로로 전환했어요');
    expect(v.rows.some((r) => r.key === 'nativeState')).toBe(false);
  });
  it('복구 중 — 재시작 진행', () => {
    const v = deriveConnectionDiagnostics(mk({ status: 'starting', code: 'native_stream_lost', restartCount: 4, streamIdHead: null }));
    expect(v.kind).toBe('recovering'); expect(v.alerts[0].text).toContain('4/5');
  });
});

describe('"확인 전" 표기 — 0으로 추정하지 않는다', () => {
  it('업로드 집계·소켓·재시작 횟수가 없으면 확인 전', () => {
    const v = deriveConnectionDiagnostics(mk({ upload: null, socket: 'unknown', restartCount: null, nativeState: null, streamIdHead: null, status: 'idle' }));
    for (const c of v.counts) { expect(c.pending).toBe('확인 전'); expect(c.arrived).toBe('확인 전'); }
    expect(v.rows.find((r) => r.key === 'socket')?.value).toBe('확인 전');
    expect(v.rows.find((r) => r.key === 'restart')?.value).toBe('확인 전');
    expect(v.rows.find((r) => r.key === 'nativeState')?.value).toBe('확인 전');
    expect(v.rows.find((r) => r.key === 'streamId')?.value).toBe('확인 전');
  });
  it('실제 0은 0으로 보인다', () => {
    const v = deriveConnectionDiagnostics(base);
    expect(v.counts[0].pending).toBe('0'); expect(v.counts[0].arrived).toBe('248');
  });
});

describe('펼침 규칙', () => {
  it('정상은 기본 숨김, 아이콘으로 열고 다시 누르면 숨김', async () => {
    await mount(base);
    expect(panel()).toBeNull(); expect(toggle().getAttribute('aria-expanded')).toBe('false');
    await act(async () => { toggle().click(); });
    expect(panel()).not.toBeNull(); expect(toggle().getAttribute('aria-expanded')).toBe('true');
    await act(async () => { toggle().click(); });
    expect(panel()).toBeNull();
  });
  it('이상 상태는 자동 노출, 사용자가 접으면 같은 이상에서는 다시 열지 않는다', async () => {
    await mount(mk({ socket: 'disconnected' }));
    expect(panel()).not.toBeNull();
    await act(async () => { toggle().click(); });
    expect(panel()).toBeNull();
  });
  it('resolveDiagOpen — 새로운 종류의 이상이 생기면 다시 연다', () => {
    const closedForSocket = { open: false, forKind: 'socket_down' as const };
    expect(resolveDiagOpen({ kind: 'socket_down', abnormal: true }, closedForSocket)).toBe(false);
    expect(resolveDiagOpen({ kind: 'upload_backlog', abnormal: true }, closedForSocket)).toBe(true);
    expect(resolveDiagOpen({ kind: 'normal', abnormal: false }, null)).toBe(false);
  });
});

describe('용어·금지 표현', () => {
  it('상태 6종 + 정상 전체 화면 문구에 금지 표현·내부 용어가 없다', async () => {
    const inputs = [
      base,
      mk({ status: 'starting', lastConfirmElapsedMs: 24_000, restartCount: 2, streamIdHead: null }),
      mk({ socket: 'disconnected' }),
      mk({ upload: { featurePending: 99, featureAcked: 1, rawPending: 9, rawVerified: 1 }, backlogSinceMs: 0 }),
      mk({ path: 'web_wasm', nativeFailed: true, status: 'failed' }),
      mk({ status: 'starting', code: 'native_stream_lost', restartCount: 3, streamIdHead: null }),
    ];
    for (const i of inputs) {
      await mount(i);
      await act(async () => { if (!panel()) toggle().click(); });
      const t = container.textContent ?? '';
      for (const w of FORBIDDEN) expect(t, w).not.toContain(w);
      for (const w of INTERNAL) expect(t, w).not.toContain(w);
    }
  });
  it('상태 요약에 쓰이는 현장 용어 — 분석 데이터·측정 기록 파일·서버에 도착', async () => {
    await mount(base); await act(async () => { toggle().click(); });
    const t = container.textContent ?? '';
    expect(t).toContain('분석 데이터'); expect(t).toContain('측정 기록 파일'); expect(t).toContain('서버에 도착');
  });
  it('토큰·개인정보 필드가 없다 — 측정 식별자는 앞 8자리만', async () => {
    await mount(mk({ streamIdHead: 'a1b2c3d4' })); await act(async () => { toggle().click(); });
    expect(container.textContent).toContain('a1b2c3d4');
    expect(container.textContent).not.toMatch(/[0-9a-f]{9,}/);
  });
});
