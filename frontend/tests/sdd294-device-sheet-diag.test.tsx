// @vitest-environment jsdom
// SDD-294 — 기기 시트 연결 진단: 아이콘이 시트 안쪽(in-flow)에 항상 보이고, 진단 없음(path off)이면 표시하지 않는다.
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemberSheetBody } from '../src/components/class/player/member/MemberSheets';
import { deriveConnectionDiagnostics, type ConnectionDiagnosticsInput, type ConnectionDiagnosticsView } from '../src/components/class/player/member/connection-diagnostics-model';
import type { MemberClassViewProps } from '../src/components/class/player/member/member-view-types';

const base: ConnectionDiagnosticsInput = {
  path: 'native', status: 'running', code: null, nativeState: 'CAPTURING', streamIdHead: 'a1b2c3d4', restartCount: 0, lastConfirmElapsedMs: 3000,
  nativeFailed: false, socket: 'connected', upload: { featurePending: 0, featureAcked: 31, rawPending: 0, rawVerified: 1 }, backlogSinceMs: null, nowMs: 100_000,
};
const FORBIDDEN = ['점수', '종합점수', '좋음', '나쁨', '완료', '보증', '100%'];
const css = readFileSync(resolve(__dirname, '../src/components/class/player/member/member-player.css'), 'utf8');
const rule = (sel: string): string => {
  const m = css.match(new RegExp(`^${sel.replace(/[.[\]"=]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm'));
  return m ? m[1] : '';
};

let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

const deviceProps = (diagnostics: ConnectionDiagnosticsView | null): MemberClassViewProps => ({
  diagnostics,
  input: { band: 'off' },
  device: { error: null, isMock: false },
  actions: { onBandConnect: () => undefined },
} as unknown as MemberClassViewProps);
const mount = async (diagnostics: ConnectionDiagnosticsView | null) => {
  await act(async () => { root.render(<MemberSheetBody sheetKey="device" props={deviceProps(diagnostics)} c={{} as never} />); });
};
const toggle = () => document.querySelector<HTMLButtonElement>('[data-pz="diag-toggle"]');
const panel = () => document.querySelector('[data-pz="diag"]');

describe('기기 시트 진단 표시', () => {
  it('진단 있음 — 토글이 .mp-diag-bar 안에 있다', async () => {
    await mount(deriveConnectionDiagnostics(base));
    expect(toggle()).not.toBeNull();
    expect(toggle()!.closest('.mp-diag-bar')).not.toBeNull();
    expect(toggle()!.closest('.mp-diag-frame')).not.toBeNull();
  });
  it('진단 없음(path off) — 토글·패널 없음', async () => {
    await mount(null);
    expect(toggle()).toBeNull(); expect(panel()).toBeNull();
  });
  it('정상 — 초록 아이콘, 접힘 기본, 클릭 펼침·재클릭 접힘', async () => {
    await mount(deriveConnectionDiagnostics(base));
    expect(toggle()!.getAttribute('data-abnormal')).toBeNull();
    expect(panel()).toBeNull();
    await act(async () => toggle()!.click()); expect(panel()).not.toBeNull();
    await act(async () => toggle()!.click()); expect(panel()).toBeNull();
  });
  it('이상 — 주의 아이콘, 자동 펼침', async () => {
    await mount(deriveConnectionDiagnostics({ ...base, socket: 'disconnected' }));
    expect(toggle()!.getAttribute('data-abnormal')).toBe('true'); expect(panel()).not.toBeNull();
  });
  it('금지 표현 없음', async () => {
    await mount(deriveConnectionDiagnostics({ ...base, socket: 'disconnected' }));
    for (const w of FORBIDDEN) expect(container.textContent).not.toContain(w);
  });
});

describe('CSS — 시트 밖으로 나가지 않는다', () => {
  it('.mp-diag-toggle 은 absolute·음수 오프셋이 없다', () => {
    const r = rule('.mp-diag-toggle');
    expect(r).not.toBe('');
    expect(r).not.toMatch(/position\s*:\s*absolute/);
    expect(r).not.toMatch(/(top|right|left|bottom)\s*:\s*-/);
  });
  it('.mp-diag-bar 는 우측 정렬 flex', () => {
    const r = rule('.mp-diag-bar');
    expect(r).toMatch(/display\s*:\s*flex/); expect(r).toMatch(/justify-content\s*:\s*flex-end/);
  });
  it('.mp-diag-frame 은 relative/absolute 기준점이 아니다', () => {
    expect(rule('.mp-diag-frame')).not.toMatch(/position\s*:/);
  });
});
