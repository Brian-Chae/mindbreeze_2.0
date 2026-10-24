// @vitest-environment jsdom
// SDD-209 M0 — FM04 코드 입력 · FM04b 개인정보 입력 화면 + /join 컨테이너 흐름(API 모킹)
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeEntryView } from '../src/components/class/flow/member/CodeEntryView';
import { ProfileEntryView } from '../src/components/class/flow/member/ProfileEntryView';
import { ApiError } from '../src/lib/api/client';
import { emptyProfileDraft } from '../src/lib/class/flow/member-entry';
import { flowCases } from '../src/lib/class/flow/fixtures/member-entry';
import { takeEntryHandoff } from '../src/lib/class/flow/member-handoff';

const verifyEntryCode = vi.fn();
const enterByCode = vi.fn();
vi.mock('../src/lib/api/class-flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/class-flow')>()),
  verifyEntryCode: (...a: unknown[]) => verifyEntryCode(...a),
  enterByCode: (...a: unknown[]) => enterByCode(...a),
}));
vi.mock('../src/lib/api/client-profile', () => ({ getClientProfile: vi.fn().mockResolvedValue({ gender: null, birth_date: null }) }));

import CodeEntryPage from '../src/pages/class/CodeEntryPage';

let root: Root;
let container: HTMLDivElement;
async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(node); });
}
const qa = <T extends Element = HTMLElement>(sel: string): T[] => [...document.querySelectorAll<T>(sel)];
const text = (): string => document.body.textContent ?? '';
const btn = (label: string): HTMLButtonElement => {
  const found = qa<HTMLButtonElement>('button').find((b) => (b.textContent ?? '').trim() === label);
  if (!found) throw new Error(`버튼 없음: ${label}`);
  return found;
};
async function type(el: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function chooseBirth(year: string, month: string): Promise<void> {
  for (const [label, text] of [['출생 연도', year], ['출생 월', month]]) {
    const wheel = document.querySelector(`[role="listbox"][aria-label="${label}"]`)!;
    await act(async () => { Array.from(wheel.querySelectorAll<HTMLElement>('[role="option"]')).find(option => option.textContent === text)!.click(); });
  }
}
async function click(el: HTMLElement): Promise<void> {
  await act(async () => { el.click(); });
}
/** SDD-220 F1 — 입장 전 녹음·녹화 필수 동의 체크 */
async function agreeRecording(): Promise<void> {
  const box = qa<HTMLElement>('[role="checkbox"]').find((el) => (el.textContent ?? '').includes('녹음·녹화에 동의해요'));
  if (!box) throw new Error('녹음·녹화 동의 체크가 없습니다');
  await click(box);
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  verifyEntryCode.mockReset();
  enterByCode.mockReset();
  window.sessionStorage.clear();
  // jsdom 에는 matchMedia 가 없다 — 교차 페이드 배경이 움직임 줄이기 설정을 읽는다
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const noop = (): void => undefined;

describe('FM04 코드 입력', () => {
  it('숫자 입력 칸 4개만 있고 개인정보·인증 입력은 없다', async () => {
    await render(<CodeEntryView digits="" status="idle" memberName={null} onChange={noop} onSubmit={noop} onBack={noop} />);
    const inputs = qa<HTMLInputElement>('input');
    expect(inputs).toHaveLength(4);
    expect(inputs.every((i) => i.getAttribute('inputmode') === 'numeric')).toBe(true);
    expect(text()).not.toMatch(/이름|성별|생년월일|이메일|인증|로그인이 필요/);
    expect(btn('코드 확인').disabled).toBe(true);
  });
  it('4자리를 채워야 확인할 수 있고 시도 제한 중에는 입력과 버튼이 잠긴다', async () => {
    await render(<CodeEntryView digits="0042" status="idle" memberName={null} onChange={noop} onSubmit={noop} onBack={noop} />);
    expect(btn('코드 확인').disabled).toBe(false);
    expect(qa<HTMLInputElement>('input').map((i) => i.value).join('')).toBe('0042');
    await render(<CodeEntryView digits="0047" status="throttled" memberName={null} onChange={noop} onSubmit={noop} onBack={noop} />);
    expect(text()).toContain('잠시 후 다시 시도해 주세요');
    expect(btn('코드 확인').disabled).toBe(true);
    expect(qa<HTMLInputElement>('input').every((i) => i.disabled)).toBe(true);
  });
  it('오류 문구는 하나뿐이다(없는·틀린·종료 구분 없음)', async () => {
    await render(<CodeEntryView digits="0047" status="error" memberName={null} onChange={noop} onSubmit={noop} onBack={noop} />);
    expect(qa('[role="alert"]').map((e) => e.textContent)).toEqual(['코드를 확인해 주세요. 4자리를 다시 입력해 주세요']);
  });
  it('붙여넣기는 숫자만 4자리로 받는다', async () => {
    const onChange = vi.fn();
    await render(<CodeEntryView digits="" status="idle" memberName={null} onChange={onChange} onSubmit={noop} onBack={noop} />);
    const first = qa<HTMLInputElement>('input')[0]!;
    await act(async () => {
      const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData?: { getData: () => string } };
      event.clipboardData = { getData: () => '00-42 xx' };
      first.dispatchEvent(event);
    });
    expect(onChange).toHaveBeenCalledWith('0042');
  });
  it('회원은 계정으로 이어서 입장한다는 안내가 나온다', async () => {
    await render(<CodeEntryView digits="0042" status="idle" memberName="지은" onChange={noop} onSubmit={noop} onBack={noop} />);
    expect(text()).toContain('지은님으로 이어서 입장해요');
  });
});

describe('FM04b 개인정보 입력', () => {
  const summary = { title: '마음챙김 명상', startLabel: '오늘 오후 3:00 시작', hostName: '채용욱' };
  it('이름·성별·생년월·이메일·이메일 확인 입력과 입장하기가 있고 인증 DOM 은 없다', async () => {
    await render(<ProfileEntryView summary={summary} mode="guest" draft={emptyProfileDraft()} errors={{}} submitError={null} submitting={false} onChange={noop} onSubmit={noop} onBack={noop} />);
    expect(qa('input')).toHaveLength(3);
    expect(text()).toContain('실명이 아니어도 됩니다(별명·반 번호 가능)');
    expect(qa('[role="listbox"]')).toHaveLength(2);
    expect(qa('input[type=month],input[type=date]')).toHaveLength(0);
    expect(text()).not.toContain('생년월일');
    expect(qa('[role="radio"]').map((r) => r.textContent)).toEqual(['여성', '남성', '선택 안 함']);
    expect(text()).toContain('채용욱 상담사');
    expect(text()).toContain('리포트는 입력한 이메일로 보내 드려요');
    expect(text()).not.toMatch(/인증|OTP|인증 요청/);
    expect(btn('입장하기').disabled).toBe(true);
  });
  it('로그인 회원은 읽기 전용이고 이메일 재입력 칸이 없다', async () => {
    const draft = { name: '지은', gender: 'female' as const, birth: '1990-03', email: 'jieun@example.com', emailConfirm: 'jieun@example.com' };
    await render(<ProfileEntryView summary={summary} mode="member" draft={draft} errors={{}} submitError={null} submitting={false} onChange={noop} onSubmit={noop} onBack={noop} />);
    const inputs = qa<HTMLInputElement>('input');
    expect(inputs).toHaveLength(3);
    expect(inputs.every((i) => i.readOnly)).toBe(true);
    expect(btn('입장하기').disabled).toBe(false);
  });
  it('오류는 항목 아래에 해요체로 나온다', async () => {
    const c = flowCases['FM04b:mismatch']!;
    await render(c.render({ screen: 'FM04b', caseKey: 'mismatch', sheet: null, n: null, level: null, ch1: null, ch2: null, backdropSrc: '', params: new URLSearchParams() }));
    expect(qa('[role="alert"]').map((e) => e.textContent)).toEqual(['이메일이 서로 달라요']);
  });
});

function Probe() {
  const location = useLocation();
  return <p data-testid="path">{location.pathname}{location.search}{location.hash}</p>;
}

function renderPage(): Promise<void> {
  return render(
    <MemoryRouter initialEntries={['/join']}>
      <Routes>
        <Route path="/join" element={<CodeEntryPage />} />
        <Route path="/class/:sessionId/enter" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function enterCode(code: string): Promise<void> {
  const inputs = qa<HTMLInputElement>('input');
  await type(inputs[0]!, code);
}

describe('/join 컨테이너', () => {
  it('코드는 문자열 그대로(0042) 확인하고, 틀린 코드(404)와 제한(429)·서버 오류를 구분해 안내한다', async () => {
    verifyEntryCode.mockRejectedValueOnce(new ApiError(404, '세션을 찾을 수 없습니다', null));
    await renderPage();
    // 4자리를 다 넣으면 버튼 없이 바로 확인한다
    await enterCode('0042');
    expect(verifyEntryCode).toHaveBeenCalledTimes(1);
    expect(verifyEntryCode).toHaveBeenCalledWith('0042');
    expect(text()).toContain('코드를 확인해 주세요');
    // 틀린 코드면 칸을 비우고 첫 칸에 커서를 둬 바로 다시 입력하게 한다
    expect(qa<HTMLInputElement>('input').map((i) => i.value).join('')).toBe('');
    expect(document.activeElement).toBe(qa('input')[0]);

    verifyEntryCode.mockRejectedValueOnce(new ApiError(422, '형식', null));
    await enterCode('0042');
    expect(verifyEntryCode).toHaveBeenCalledTimes(2);
    expect(text()).toContain('코드를 확인해 주세요');

    verifyEntryCode.mockRejectedValueOnce(new ApiError(429, '제한', null));
    await enterCode('0042');
    expect(verifyEntryCode).toHaveBeenCalledTimes(3);
    expect(text()).toContain('잠시 후 다시 시도해 주세요');
  });

  it('코드 확인 → 개인정보 입력 → 입장: 요청 바디에 코드+프로필, 저장소에는 입장 자격만 남는다', async () => {
    verifyEntryCode.mockResolvedValue({ title: '마음챙김 명상', scheduled_at: null, host_name: '채용욱' });
    enterByCode.mockResolvedValue({
      entry_credential: 'cred-xyz', expires_at: null, participant_id: 'p1', is_guest: true, is_waitlisted: false,
      session: { id: 's1' },
    });
    await renderPage();
    await enterCode('0042');
    expect(text()).toContain('정보를 입력해 주세요');

    await type(document.getElementById('fm-name') as HTMLInputElement, '지은');
    await click(qa('[role="radio"]')[0] as HTMLElement);
    await chooseBirth('1990년', '3월');
    await type(document.getElementById('fm-email') as HTMLInputElement, 'jieun@example.com');
    await type(document.getElementById('fm-email2') as HTMLInputElement, 'jieun@example.com');
    expect(btn('입장하기').disabled).toBe(true); // 녹음·녹화 필수 동의 전에는 입장할 수 없다
    await agreeRecording();
    await click(btn('입장하기'));

    expect(enterByCode).toHaveBeenCalledWith({
      code: '0042', name: '지은', gender: 'female', birth_year_month: '1990-03', email: 'jieun@example.com',
      recording_consent: true, recording_notice_version: 'rec-1',
    });
    expect(document.querySelector('[data-testid="path"]')?.textContent).toBe('/class/s1/enter');
    const stored = window.sessionStorage.getItem('mb_entry_s1') ?? '';
    expect(stored).toContain('cred-xyz');
    for (const secret of ['0042', '지은', 'jieun', '1990']) expect(stored).not.toContain(secret);
    expect(window.location.href).not.toContain('0042');
    expect(takeEntryHandoff('s1')).toEqual({ sessionId: 's1', displayName: '지은', maskedEmail: 'ji***@example.com' });
    expect(window.localStorage.length).toBe(0);
  });

  it('형식 오류는 서버로 보내지 않고 인라인으로 막는다(입력값 보존)', async () => {
    verifyEntryCode.mockResolvedValue({ title: '명상', scheduled_at: null, host_name: null });
    await renderPage();
    await enterCode('0042');
    await type(document.getElementById('fm-name') as HTMLInputElement, '지은');
    await type(document.getElementById('fm-email') as HTMLInputElement, 'jieun@');
    await agreeRecording();
    await click(btn('입장하기'));
    expect(enterByCode).not.toHaveBeenCalled();
    expect(text()).toContain('이메일 형식을 확인해 주세요');
    expect((document.getElementById('fm-name') as HTMLInputElement).value).toBe('지은');
  });

  it('입장 중 코드가 닫히면(404) 코드 입력으로 돌아가 같은 안내를 쓴다', async () => {
    verifyEntryCode.mockResolvedValue({ title: '명상', scheduled_at: null, host_name: null });
    enterByCode.mockRejectedValue(new ApiError(404, '세션을 찾을 수 없습니다', null));
    await renderPage();
    await enterCode('0042');
    await type(document.getElementById('fm-name') as HTMLInputElement, '지은');
    await click(qa('[role="radio"]')[1] as HTMLElement);
    await chooseBirth('1990년', '3월');
    await type(document.getElementById('fm-email') as HTMLInputElement, 'jieun@example.com');
    await type(document.getElementById('fm-email2') as HTMLInputElement, 'jieun@example.com');
    await agreeRecording();
    await click(btn('입장하기'));
    expect(text()).toContain('입장 코드를 입력해 주세요');
    expect(text()).toContain('코드를 확인해 주세요');
  });
});
