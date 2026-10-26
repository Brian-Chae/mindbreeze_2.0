// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { SignalsSheet } from '../src/components/class/player/host/sheets/SignalsSheet';

it('최근 신호만 이름과 최신 선택으로 보여주며 동명이인은 내부 ID로 구분한다', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const node = document.createElement('div');
  const root = createRoot(node);
  const now = Date.now();
  try {
    await act(async () => root.render(<SignalsSheet counts={{ following: 0, difficult: 1, resting: 2 }} onCheckin={() => undefined} signals={{
      private1: { type: 'difficult', at: now, displayName: '지은' },
      private2: { type: 'resting', at: now, displayName: '지은' },
      private3: { type: 'resting', at: now, displayName: '익명' },
      stale: { type: 'following', at: now - 10000, displayName: '만료이름' },
    }} />));
    expect(node.querySelectorAll('[data-signal-person]')).toHaveLength(3);
    expect(node.textContent).toContain('지은');
    expect(node.textContent).toContain('참가자');
    expect(node.textContent).not.toContain('private');
    expect(node.textContent).not.toContain('만료이름');
    expect(node.textContent).not.toContain('익명');
  } finally { await act(async () => root.unmount()); }
});
