// @vitest-environment jsdom
import { createElement, act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CounselorAddSheet } from '../src/components/client/counselor-add-sheet';
import { CounselorManagementPanel } from '../src/components/client/counselor-management-panel';
import { ApiError } from '../src/lib/api/client';
import { useAuthStore } from '../src/stores/authStore';
import { mergeCounselor } from '../src/hooks/use-client-counselors';
import { normalizeCounselorCode, classifyAddCounselorError } from '../src/lib/api/client-counselors';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../src/lib/api/client', async (orig) => ({
  ...(await orig<typeof import('../src/lib/api/client')>()),
  apiClient: { get: api.get, post: api.post },
}));

const A = { id: 'a', name: '김상담', profile_image: null, org_name: '대구교육청' };
const B = { id: 'b', name: '박코치', profile_image: null, org_name: null };

let cleanup: (() => void) | undefined;
async function render(node: ReactNode) {
  const el = document.createElement('div');
  document.body.append(el);
  const root = createRoot(el);
  await act(async () => { root.render(createElement(MemoryRouter, null, node)); });
  cleanup = () => { act(() => root.unmount()); el.remove(); };
  return el;
}
function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: { id: 'u1', email: 'c@t.com', name: '회원', role: 'client', verified_tier: 'unverified', onboarding_completed: true, auth_provider: 'email', counselors: [A] } as never });
  api.get.mockResolvedValue([A]);
});
afterEach(() => { cleanup?.(); cleanup = undefined; });

describe('순수 함수', () => {
  it('코드 정규화: 소문자·공백 허용, 6자 영숫자만', () => {
    expect(normalizeCounselorCode(' ab 12cd ')).toBe('AB12CD');
    expect(normalizeCounselorCode('001131')).toBe('001131');
    expect(normalizeCounselorCode('ABC12')).toBeNull();
    expect(normalizeCounselorCode('ABC1234')).toBeNull();
    expect(normalizeCounselorCode('12-345')).toBeNull();
  });
  it('오류 분류: 409 중복 vs 기관 비활성 구분, 네트워크는 결과 불명', () => {
    expect(classifyAddCounselorError(new ApiError(409, '이미 연결된 코치입니다', null)).kind).toBe('duplicate');
    expect(classifyAddCounselorError(new ApiError(409, '비활성화된 기관에서는 이 작업을 수행할 수 없습니다', null)).kind).toBe('org_inactive');
    expect(classifyAddCounselorError(new ApiError(404, '유효하지 않은 코치 코드입니다', null)).message).toBe('유효하지 않은 코치 코드입니다');
    expect(classifyAddCounselorError(new TypeError('Failed to fetch')).kind).toBe('unknown_result');
  });
  it('불변 병합', () => {
    const list = [A];
    const next = mergeCounselor(list, B);
    expect(next).toEqual([A, B]);
    expect(list).toEqual([A]);
    expect(mergeCounselor(next, B)).toHaveLength(2);
  });
});

describe('설정 > 상담사 관리 패널', () => {
  it('목록·기관·기관 없음 표시 + 추가 버튼', async () => {
    api.get.mockResolvedValue([A, B]);
    const el = await render(<CounselorManagementPanel />);
    await flush();
    expect(el.textContent).toContain('김상담');
    expect(el.textContent).toContain('대구교육청');
    expect(el.textContent).toContain('박코치');
    expect(el.textContent).toContain('소속 기관 정보 없음');
    expect(el.textContent).toContain('코드로 코치 추가');
  });

  it('0명이어도 빈 상태와 추가 버튼 유지, 조회 실패는 0명으로 오인하지 않고 재시도 제공', async () => {
    useAuthStore.setState({ user: { ...useAuthStore.getState().user!, counselors: [] } });
    api.get.mockRejectedValue(new Error('net'));
    const el = await render(<CounselorManagementPanel />);
    await flush();
    expect(el.textContent).toContain('불러오지 못했어요');
    expect(el.textContent).not.toContain('아직 연결된 코치가 없어요');
    expect(el.textContent).toContain('코드로 코치 추가');
  });
});

describe('코드 입력 시트', () => {
  async function open() {
    const el = await render(<CounselorManagementPanel />);
    await flush();
    act(() => { (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('코드로 코치 추가')) as HTMLButtonElement).click(); });
    return el;
  }
  const submitBtn = () => document.querySelector('button[type="submit"]') as HTMLButtonElement;
  const input = () => document.querySelector('input') as HTMLInputElement;

  it('안내 문구와 클래스 입장 코드 불가 안내', async () => {
    await open();
    expect(document.body.textContent).toContain('클래스 입장 코드는 사용할 수 없어요');
    expect(submitBtn().disabled).toBe(true);
  });

  it('성공: 소문자·숫자 코드 대문자 전송, 즉시 목록 병합', async () => {
    await open();
    api.post.mockResolvedValue(B);
    api.get.mockResolvedValue([A, B]);
    setInput(input(), '001131');
    expect(submitBtn().disabled).toBe(false);
    await act(async () => { submitBtn().click(); });
    await flush();
    expect(api.post).toHaveBeenCalledWith('/client/counselors', { code: '001131' });
    expect(document.body.textContent).toContain('코치를 추가했어요');
    expect(useAuthStore.getState().user!.counselors.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('성공 후 GET 실패해도 추가 행 유지 + 안내', async () => {
    await open();
    api.post.mockResolvedValue(B);
    api.get.mockRejectedValue(new Error('net'));
    setInput(input(), '123456');
    await act(async () => { submitBtn().click(); });
    await flush();
    expect(document.body.textContent).toContain('목록을 새로 확인하려면 다시 시도해 주세요');
    expect(useAuthStore.getState().user!.counselors.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('404: 서버 문구, 입력 유지, 목록 불변', async () => {
    await open();
    api.post.mockRejectedValue(new ApiError(404, '유효하지 않은 코치 코드입니다', null));
    setInput(input(), '999999');
    await act(async () => { submitBtn().click(); });
    await flush();
    expect(document.body.textContent).toContain('유효하지 않은 코치 코드입니다');
    expect(input().value).toBe('999999');
    expect(useAuthStore.getState().user!.counselors).toHaveLength(1);
  });

  it('409 중복 안내, 네트워크 단절은 결과 불명 문구', async () => {
    await open();
    api.post.mockRejectedValueOnce(new ApiError(409, '이미 연결된 코치입니다', null));
    setInput(input(), '123456');
    await act(async () => { submitBtn().click(); });
    await flush();
    expect(document.body.textContent).toContain('이미 연결된 코치입니다');
    api.post.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await act(async () => { submitBtn().click(); });
    await flush();
    expect(document.body.textContent).toContain('연결 결과를 확인하지 못했어요');
  });

  it('중복 전송 방지: 전송 중 연속 제출은 POST 1회', async () => {
    await open();
    let resolve!: (v: unknown) => void;
    api.post.mockReturnValue(new Promise((r) => { resolve = r; }));
    setInput(input(), '123456');
    await act(async () => { submitBtn().click(); submitBtn().click(); });
    expect(api.post).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(B); });
  });

  it('숫자 외 문자는 제거·6자 초과는 잘라냄, 6자 미만은 전송 불가', async () => {
    await open();
    setInput(input(), '1234567');
    expect(input().value).toBe('123456');
    setInput(input(), '12-345');
    expect(input().value).toBe('12345');
    expect(submitBtn().disabled).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('CounselorAddSheet 단독', () => {
  it('닫힘 상태는 렌더하지 않음', async () => {
    const el = await render(<CounselorAddSheet open={false} onOpenChange={() => {}} addCounselor={vi.fn()} />);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
