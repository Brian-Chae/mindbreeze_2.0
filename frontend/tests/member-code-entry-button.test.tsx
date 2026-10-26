// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CodeEntryButton } from '../src/components/client/code-entry-button';

let root: Root; let container: HTMLDivElement;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
function Where() { return <p data-testid="where">{useLocation().pathname}</p>; }

it.each(['primary', 'secondary'] as const)('%s 버튼은 [코드로 바로 입장] 문구이고 누르면 /join 으로 이동한다', async (variant) => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/app']}><Routes><Route path="/app" element={<CodeEntryButton variant={variant} />} /><Route path="/join" element={<Where />} /></Routes></MemoryRouter>));
  const link = container.querySelector<HTMLAnchorElement>('[data-testid="enter-with-code"]')!;
  expect(link.textContent).toBe('코드로 바로 입장');
  expect(link.className).toContain('whitespace-nowrap');
  await act(async () => link.click());
  expect(container.querySelector('[data-testid="where"]')!.textContent).toBe('/join');
});
