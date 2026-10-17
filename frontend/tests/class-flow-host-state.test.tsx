// @vitest-environment jsdom
// SDD-209 H8 — FH10 닫힘·오류: 오류 분기(404/403/네트워크)와 서버 원문 비노출
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostStateScreen } from '../src/components/class/flow/host/HostStateScreen';
import { ApiError } from '../src/lib/api/client';
import { deriveHostStateKind, hostStateCopy, type HostStateKind } from '../src/lib/class/flow/host-state-model';

describe('deriveHostStateKind', () => {
  it('404 → 찾을 수 없음, 403 → 내 클래스 아님, 408·503·TypeError·오프라인 → 연결, 그 외 → 일반', () => {
    expect(deriveHostStateKind({ error: new ApiError(404, 'x', null) })).toBe('error-notfound');
    expect(deriveHostStateKind({ error: new ApiError(403, 'x', null) })).toBe('error-forbidden');
    expect(deriveHostStateKind({ error: new ApiError(503, 'x', null) })).toBe('error-network');
    expect(deriveHostStateKind({ error: new ApiError(408, 'x', null) })).toBe('error-network');
    expect(deriveHostStateKind({ error: new TypeError('Failed to fetch') })).toBe('error-network');
    expect(deriveHostStateKind({ error: new ApiError(500, 'x', null) })).toBe('error');
    expect(deriveHostStateKind({ error: new Error('boom') })).toBe('error');
    expect(deriveHostStateKind({ error: new ApiError(500, 'x', null), online: false })).toBe('error-network');
  });
});

describe('hostStateCopy', () => {
  it('방금 닫음: 대기 회원 수와 닫은 시각, 재진입엔 시각·인원이 없다', () => {
    const c = hostStateCopy('closed', { waiting: 3, closedAtText: '오늘 오후 2:41' });
    expect(c.lead).toBe('대기 중이던 회원 3명에게 클래스가 닫혔다고 안내했어요.');
    expect(c.rows.map((r) => r.title)).toEqual(['닫은 시각', '다시 열 수는 없어요']);
    expect(hostStateCopy('closed-0', { waiting: 0, closedAtText: '오늘 오후 2:41' }).lead).toBe('대기 중이던 회원은 없었어요.');
    const re = hostStateCopy('closed-revisit');
    expect(re.heading).toBe('이미 닫힌 클래스예요');
    expect(re.rows.map((r) => r.title)).not.toContain('닫은 시각');
    expect(re.lead).not.toMatch(/\d+명/);
  });

  it('시각을 모르면 닫은 시각 줄을 만들지 않는다', () => {
    expect(hostStateCopy('closed', { waiting: 2 }).rows.map((r) => r.title)).toEqual(['다시 열 수는 없어요']);
  });

  it('주 버튼: 닫힘은 같은 설정으로 새 클래스, 403 은 내 클래스 보기, 연결 오류는 다시 시도', () => {
    expect(hostStateCopy('closed').primary).toEqual({ label: '같은 설정으로 새 클래스', action: 'clone' });
    expect(hostStateCopy('error-forbidden').primary).toEqual({ label: '내 클래스 보기', action: 'list' });
    expect(hostStateCopy('error-network').primary.action).toBe('retry');
    expect(hostStateCopy('error-notfound').primary.action).toBe('list');
  });
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(window, { matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }) });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('HostStateScreen', () => {
  const kinds: HostStateKind[] = ['closed', 'closed-0', 'closed-revisit', 'error', 'error-notfound', 'error-forbidden', 'error-network'];

  it('7종 모두 렌더되고 서버 오류 원문(secret-server-message)은 어디에도 없다', async () => {
    for (const kind of kinds) {
      await act(async () => root.render(createElement(HostStateScreen, { kind, title: '마음챙김', waiting: 3, onAction: () => undefined })));
      expect(container.querySelector('h1')?.textContent).toBe(hostStateCopy(kind).heading);
      expect(container.textContent).not.toContain('secret-server-message');
    }
  });

  it('주·보조 버튼이 action 으로 호출되고, 오류는 alert 역할', async () => {
    const onAction = vi.fn();
    await act(async () => root.render(createElement(HostStateScreen, { kind: 'error-network', title: '마음챙김', onAction })));
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    const buttons = [...container.querySelectorAll('button')];
    await act(async () => { buttons.find((b) => b.textContent?.includes('다시 시도'))?.click(); });
    await act(async () => { buttons.find((b) => b.textContent?.includes('클래스 목록으로'))?.click(); });
    expect(onAction.mock.calls.map((c) => c[0])).toEqual(['retry', 'list']);
  });
});
