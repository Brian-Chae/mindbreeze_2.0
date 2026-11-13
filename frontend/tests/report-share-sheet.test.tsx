// @vitest-environment jsdom
// SDD-327 T15 — 리포트 보내기 시트 단위 테스트
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api/client';
import * as shareApi from '../src/lib/api/report-share';
import * as reportsApi from '../src/lib/api/reports';
import ReportShareSheet from '../src/components/report-share/ReportShareSheet';

vi.mock('../src/lib/api/report-share', async (orig) => ({
  ...(await orig<typeof shareApi>()),
  shareMyReportByEmail: vi.fn(),
  getMyReportShareHistory: vi.fn(),
}));
vi.mock('../src/lib/api/reports', () => ({ resendReportEmail: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); document.body.innerHTML = ''; vi.resetAllMocks(); });

const render = async (mode: 'member' | 'counselor' = 'member', defaultRecipient?: string) => {
  await act(async () => root.render(<ReportShareSheet reportId="r1" mode={mode} defaultRecipient={defaultRecipient} onClose={() => undefined} />));
};
const setValue = async (el: HTMLInputElement | HTMLTextAreaElement, v: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const addAddress = async (email: string) => {
  const input = document.getElementById('rs-address') as HTMLInputElement;
  await setValue(input, email);
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
};
const sendBtn = () => [...document.querySelectorAll('button')].find((b) => /보내기$/.test(b.textContent ?? '') && b.textContent !== '리포트 보내기') as HTMLButtonElement;
const check = async () => { await act(async () => { (document.getElementById('rs-confirm') as HTMLInputElement).click(); }); };

it('주소는 최대 3개까지만 추가된다', async () => {
  await render();
  for (const e of ['a@x.com', 'b@x.com', 'c@x.com']) await addAddress(e);
  expect(document.querySelectorAll('button[aria-label$="삭제"]').length).toBe(3);
  expect((document.getElementById('rs-address') as HTMLInputElement).disabled).toBe(true);
});

it('확인 체크 전에는 보내기 버튼이 비활성이다', async () => {
  await render();
  await addAddress('a@x.com');
  expect(sendBtn().disabled).toBe(true);
  await check();
  expect(sendBtn().disabled).toBe(false);
});

it('429 응답이면 하루 상한 문구를 보여준다', async () => {
  vi.mocked(shareApi.shareMyReportByEmail).mockRejectedValue(new ApiError(429, 'too many', null));
  await render();
  await addAddress('a@x.com'); await check();
  await act(async () => { sendBtn().click(); });
  expect(document.body.textContent).toContain('오늘 보낼 수 있는 수를 채웠어요');
  expect(document.body.textContent).toContain('내일 00:00 이후에 다시 보내 주세요.');
});

it('5xx 응답이면 서버 오류 문구와 다시 시도 버튼', async () => {
  vi.mocked(shareApi.shareMyReportByEmail).mockRejectedValue(new ApiError(503, 'x', null));
  await render();
  await addAddress('a@x.com'); await check();
  await act(async () => { sendBtn().click(); });
  expect(document.body.textContent).toContain('메일을 보내지 못했어요');
  expect(document.body.textContent).toContain('다시 시도');
});

it('회원 성공 시 요청 본문에 PDF 첨부 기본 켬·메시지가 담긴다', async () => {
  vi.mocked(shareApi.shareMyReportByEmail).mockResolvedValue({ accepted_count: 1, attached: true, delivery_delayed: false, daily_remaining: 9, events: [] });
  await render();
  await addAddress('A@x.com'); await check();
  await setValue(document.getElementById('rs-message') as HTMLTextAreaElement, '안녕');
  await act(async () => { sendBtn().click(); });
  expect(shareApi.shareMyReportByEmail).toHaveBeenCalledWith('r1', { recipients: ['a@x.com'], attach_pdf: true, message: '안녕' });
  expect(document.body.textContent).toContain('1곳에 보냈어요');
});

it('상담사 경로는 기존 resendReportEmail 을 호출한다', async () => {
  vi.mocked(reportsApi.resendReportEmail).mockResolvedValue({ success: true, sent: true, message: 'ok' });
  await render('counselor', 'c@x.com');
  await check();
  await act(async () => { sendBtn().click(); });
  expect(reportsApi.resendReportEmail).toHaveBeenCalledWith('r1', 'c@x.com');
  expect(shareApi.shareMyReportByEmail).not.toHaveBeenCalled();
});
