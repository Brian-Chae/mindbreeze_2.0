// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ToolsSheet } from '../src/components/class/player/host/sheets/ToolsSheet';

it('도구 시트에서 클래스 종료와 구분된 화면 나가기를 제공한다', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onLeave = vi.fn();
  try {
    await act(async () => root.render(<ToolsSheet sort="join" onSort={() => {}} showHandsFirst={false} handsFirst={false} onHandsFirst={() => {}} table={false} onTable={() => {}} accessCode="0482" codeCopied={false} onCopyCode={() => {}} selfBandText="미착용" onOpenMyband={() => {}} onLeave={onLeave} />));
    const leave = [...container.querySelectorAll('button')].find(button => button.textContent === '클래스 화면 나가기');
    expect(leave).toBeDefined();
    await act(async () => leave!.click());
    expect(onLeave).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
