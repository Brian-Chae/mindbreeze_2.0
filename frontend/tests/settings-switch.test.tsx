// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SettingsSwitch } from '../src/components/settings/settings-switch';
it('일부 상태를 조회로 유지하고 명시 클릭에만 켜기를 전달한다', async () => {
  const host = document.createElement('div'); const root = createRoot(host); const change = vi.fn();
  await act(async () => root.render(<SettingsSwitch checked="mixed" label="일정 이메일" onChange={change} />));
  const button = host.querySelector('button')!;
  expect(button.getAttribute('role')).toBe('switch');
  expect(button.getAttribute('aria-label')).toContain('일정 이메일');
  expect(button.getAttribute('aria-checked')).toBe('false');
  expect(host.textContent).toContain('일부');
  expect(change).not.toHaveBeenCalled();
  await act(async () => button.click()); expect(change).toHaveBeenCalledWith(true);
  await act(async () => root.unmount());
});
