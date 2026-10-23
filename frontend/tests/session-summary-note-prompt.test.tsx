// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { NotePromptCard } from '../src/components/session-summary/note-prompt-card';
const calls = vi.hoisted(() => ({ claimNotePrompt: vi.fn(), dismissNotePrompt: vi.fn(), set: vi.fn() }));
vi.mock('../src/lib/api/class-summary', () => ({ classSummaryApi: calls, sessionNotePromptApi: { set: calls.set } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => { vi.clearAllMocks(); calls.claimNotePrompt.mockResolvedValue({ show: true }); calls.dismissNotePrompt.mockResolvedValue({ dismissed_at: '2026-10-23T10:00:00Z' }); });
async function mount(eligible = true) {
  const box = document.createElement('div'); const root = createRoot(box);
  await act(async () => root.render(<MemoryRouter><NotePromptCard sessionId="session" eligible={eligible} /></MemoryRouter>));
  return { box, root };
}
it('claim 성공에만 한 번 안내하고 비워두기 뒤 조용한 작성 링크를 남긴다', async () => {
  const { box, root } = await mount();
  expect(calls.claimNotePrompt).toHaveBeenCalledTimes(1);
  expect(box.textContent).toContain('다음 회차를 준비할 때');
  await act(async () => Array.from(box.querySelectorAll('button')).find(b => b.textContent === '비워두기')!.click());
  expect(calls.dismissNotePrompt).toHaveBeenCalledWith('session');
  expect(box.textContent).not.toContain('다음 회차를 준비할 때');
  expect(box.textContent).toContain('진행 기록 남기기');
  await act(async () => root.unmount());
});
it.each(['실패', '이미 안내'])('%s면 안내를 띄우지 않는다', async mode => {
  if (mode === '실패') calls.claimNotePrompt.mockRejectedValue(new Error('offline'));
  else calls.claimNotePrompt.mockResolvedValue({ show: false });
  const { box, root } = await mount();
  expect(box.textContent).not.toContain('다음 회차를 준비할 때');
  expect(box.textContent).toContain('진행 기록 남기기');
  await act(async () => root.unmount());
});
it('대상이 아니면 claim하지 않는다', async () => {
  const { root } = await mount(false);
  expect(calls.claimNotePrompt).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});
it('비워두기 저장 실패는 닫힌 채 재시도하고 안내를 다시 띄우지 않는다', async () => {
  calls.dismissNotePrompt.mockRejectedValueOnce(new Error('offline'));
  const { box, root } = await mount();
  await act(async () => Array.from(box.querySelectorAll('button')).find(b => b.textContent === '비워두기')!.click());
  expect(box.textContent).not.toContain('다음 회차를 준비할 때');
  expect(box.textContent).toContain('다시 저장');
  await act(async () => Array.from(box.querySelectorAll('button')).find(b => b.textContent === '다시 저장')!.click());
  expect(calls.dismissNotePrompt).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
});
