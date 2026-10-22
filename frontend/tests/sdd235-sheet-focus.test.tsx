// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { PlayerSheet } from '../src/components/class/player/shared/PlayerSheet';

it('신호 시트의 Tab/Shift+Tab을 시트 내부에 제한하고 닫으면 진입점으로 복귀한다', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const opener = document.createElement('button');
  const mount = document.createElement('div');
  document.body.append(opener, mount);
  opener.focus();
  const root = createRoot(mount);
  await act(async () => root.render(<PlayerSheet open title="신호" onClose={() => undefined}><button>마지막 조치</button></PlayerSheet>));
  const buttons = [...mount.querySelectorAll('button')];
  const first = buttons[0];
  const last = buttons.at(-1)!;
  last.focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(first);
  first.focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(last);
  await act(async () => root.unmount());
  expect(document.activeElement).toBe(opener);
  opener.remove(); mount.remove();
});

it('진입 버튼이 inert 영역에 있어 포커스를 잃어도 명시한 진입점으로 복귀한다', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const opener = document.createElement('button');
  const mount = document.createElement('div');
  document.body.append(opener, mount);
  const root = createRoot(mount);
  await act(async () => root.render(<PlayerSheet open title="신호" returnFocusRef={{ current: opener }} onClose={() => undefined}><button>조치</button></PlayerSheet>));
  await act(async () => root.unmount());
  expect(document.activeElement).toBe(opener);
  opener.remove(); mount.remove();
});
