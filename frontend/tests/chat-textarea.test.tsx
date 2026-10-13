// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatTextarea } from '../src/components/chat/ChatTextarea';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onSend = vi.fn();

function Harness() {
  const [value, setValue] = useState('');
  return <ChatTextarea value={value} onChange={setValue} onSend={onSend} placeholder="메시지" ariaLabel="입력" />;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  onSend.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const area = (): HTMLTextAreaElement => container.querySelector('textarea')!;

describe('ChatTextarea', () => {
  it('Enter 는 전송하고 줄바꿈을 막는다', async () => {
    await act(async () => root.render(<Harness />));
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await act(async () => { area().dispatchEvent(event); });
    expect(onSend).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('Shift+Enter 는 전송하지 않는다(줄바꿈)', async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => { area().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })); });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('한글 조합 중 Enter 는 전송하지 않는다', async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => { area().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })); });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('내용이 바뀌면 높이를 내용(scrollHeight)에 맞춘다', async () => {
    await act(async () => root.render(<Harness />));
    Object.defineProperty(area(), 'scrollHeight', { configurable: true, get: () => 132 });
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area(), '첫 줄\n둘째 줄\n셋째 줄');
      area().dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(area().style.height).toBe('132px');
    expect(area().rows).toBe(1);
  });
});
