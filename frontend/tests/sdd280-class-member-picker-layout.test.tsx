// @vitest-environment jsdom
// SDD-280 — 클래스 만들기 4단계 회원 목록 레이아웃(B2-2, 데스크톱 2열 1:1) 구조·CSS 계약 시험.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClassSchedulingWizard } from '../src/pages/classes/class-scheduling-wizard';
import { ClassMemberPicker } from '../src/components/class/structure/class-member-picker';

const mocks = vi.hoisted(() => ({ candidates: vi.fn(), preview: vi.fn(), create: vi.fn(), getClasses: vi.fn(), getClass: vi.fn(), update: vi.fn(), members: vi.fn(), role: { value: 'org_admin' } }));
vi.mock('../src/lib/api/class-scheduling', () => ({ schedulingApi: mocks }));
vi.mock('../src/lib/api/class-structure', () => ({ getClasses: mocks.getClasses, getClass: mocks.getClass }));
vi.mock('../src/lib/api/class-member-candidates', () => ({ searchClassMemberCandidates: mocks.members }));
vi.mock('../src/stores/authStore', () => ({ useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { id: 'u1', name: '지도사', role: mocks.role.value } }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const css = readFileSync(resolve(__dirname, '../src/pages/classes/class-scheduling.css'), 'utf8');
/** 선택자에 `needle`을 포함하는 모든 규칙 본문을 돌려준다(미디어쿼리 안쪽 포함). */
function rules(needle: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (selector.includes(needle)) out.push({ selector, body: match[2] });
  }
  return out;
}
const memberRows = [{ id: 'm1', name: '김하나', masked_email: 'k***@test.com' }, { id: 'm2', name: '이두리', masked_email: 'l***@test.com' }];

let box: HTMLDivElement; let root: Root;
async function press(text: string) { await act(async () => [...box.querySelectorAll('button')].find(x => x.textContent === text)!.click()); }
async function toStep4(role: 'org_admin' | 'counselor') {
  mocks.role.value = role;
  mocks.candidates.mockResolvedValue({ instructors: [{ id: 'u1', name: '지도사' }] });
  mocks.members.mockResolvedValue({ members: memberRows, has_more: false });
  mocks.preview.mockResolvedValue({ rows: [{ client_key: 'regular:2026-12-21', seq: 1, scheduled_at: '2026-12-21T10:00:00Z', host_id: 'u1', duration_min: 60 }], conflicts: [], conflict_fingerprint: 'fp' });
  box = document.createElement('div'); document.body.append(box); root = createRoot(box);
  await act(async () => root.render(<RouterProvider router={createMemoryRouter([{ path: '*', element: <ClassSchedulingWizard /> }], { initialEntries: ['/classes/new'] })} />));
  await press('처음부터 만들어요이름·일정·강사를 새로 정해요');
  const title = box.querySelector<HTMLInputElement>('[name="title"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, '마음 명상'); title.dispatchEvent(new Event('input', { bubbles: true })); });
  await press('다음'); await press('다음'); await press('다음');
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 260)); });
}
afterEach(async () => { if (root) await act(async () => root.unmount()); box?.remove(); vi.clearAllMocks(); mocks.role.value = 'org_admin'; });

describe('SDD-280 CSS 계약', () => {
  it('A1 회원 목록 규칙에 고정 최소 높이(320px)가 없다', () => {
    for (const rule of [...rules('class-member-picker__list'), ...rules('w-plist')]) {
      expect(rule.body, rule.selector).not.toMatch(/min-height:\s*320px/);
      expect(rule.body, rule.selector).not.toMatch(/flex:\s*1\s+0\s+320px/);
      expect(rule.body, rule.selector).not.toMatch(/max-height:\s*320px/);
    }
  });
  it('A3 데스크톱(≥1024px)에서 .cw-split 은 동일 비율 2열이다', () => {
    const media = css.match(/@media\s*\(min-width:\s*1024px\)\s*\{([\s\S]*?)\n\}/);
    expect(media, '1024px 미디어쿼리').not.toBeNull();
    expect(media![1]).toMatch(/\.cw-split\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/);
  });
  it('A4 본문만 스크롤하고 하단 바는 별도 행이다', () => {
    expect(rules('.cw-scroll').some(rule => /overflow-y:\s*auto/.test(rule.body))).toBe(true);
    expect(rules('.cw-scroll').some(rule => /scroll-padding-bottom/.test(rule.body))).toBe(true);
    expect(rules('.fl-foot').some(rule => /flex:\s*none/.test(rule.body))).toBe(true);
  });
  it('A5 새 규칙에 !important 를 쓰지 않는다', () => {
    for (const rule of [...rules('cw-split'), ...rules('cw-scroll'), ...rules('cw-sec')]) expect(rule.body, rule.selector).not.toContain('!important');
  });
});

describe('SDD-280 4단계 구조', () => {
  it('A6 센터 관리자: 왼쪽에 요약·탭·CSV·대행 사유, 오른쪽에 picker', async () => {
    await toStep4('org_admin');
    const split = box.querySelector('.cw-split')!;
    expect(split).not.toBeNull();
    const left = split.querySelector(':scope > .cw-split-left')!;
    expect(left.querySelector('.w-sum')).not.toBeNull();
    expect(left.querySelector('[role="tablist"]')).not.toBeNull();
    expect(left.textContent).toContain('CSV 추가');
    expect(left.querySelector('.cw-reason')).not.toBeNull();
    const picker = split.querySelector(':scope > [data-class-member-picker]')!;
    expect(picker).not.toBeNull();
    expect(left.contains(picker)).toBe(false);
    expect(picker.querySelector('input[type="search"]')).not.toBeNull();
    expect(picker.querySelectorAll('.class-member-picker__row')).toHaveLength(2);
  });
  it('A7 하단 바는 본문(.fl-body) 바깥의 별도 영역이다', async () => {
    await toStep4('org_admin');
    const body = box.querySelector('.fl-body')!; const foot = box.querySelector('footer.fl-foot')!;
    expect(body.classList.contains('cw-scroll')).toBe(true);
    expect(body.contains(foot)).toBe(false);
    expect(body.parentElement).toBe(foot.parentElement);
    expect([...foot.querySelectorAll('button')].map(x => x.textContent)).toEqual(expect.arrayContaining(['이전', '클래스 만들기']));
  });
  it('A8 상담사 계정에는 대행 사유가 없다', async () => {
    await toStep4('counselor');
    expect(box.querySelector('.cw-reason')).toBeNull();
    expect(box.querySelector('.cw-split-left')).not.toBeNull();
  });
  it('A9 선택한 회원 칩은 왼쪽 슬롯에 나오고 제거할 수 있다', async () => {
    await toStep4('org_admin');
    await act(async () => box.querySelector<HTMLInputElement>('[aria-label="김하나 선택"]')!.click());
    const slot = box.querySelector('.cw-split-left .class-member-picker__selected')!;
    expect(slot).not.toBeNull();
    expect(slot.textContent).toContain('김하나');
    await act(async () => slot.querySelector<HTMLButtonElement>('[aria-label="김하나 선택 취소"]')!.click());
    expect(box.querySelector('.class-member-picker__selected')).toBeNull();
  });
  it('A11 비회원 이메일 탭은 오른쪽에 입력한 이메일 목록을 보여 준다', async () => {
    await toStep4('org_admin');
    await press('비회원 이메일');
    const input = box.querySelector<HTMLInputElement>('[aria-label="초대할 이메일"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'a@test.com'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await press('추가');
    expect(box.querySelector('[data-class-member-picker]')).toBeNull();
    expect(box.querySelector('.cw-split > .cw-split-panel')?.textContent).toContain('a@test.com');
  });
});

describe('SDD-280 picker 선택 슬롯', () => {
  it('A10 selectedContainer 가 없으면 기존처럼 picker 안에 칩을 렌더한다', async () => {
    mocks.members.mockResolvedValue({ members: memberRows, has_more: false });
    mocks.role.value = 'counselor';
    box = document.createElement('div'); document.body.append(box); root = createRoot(box);
    await act(async () => root.render(<ClassMemberPicker selected={[{ userId: 'm1', name: '김하나' }]} onChange={() => undefined} maxParticipants={10} />));
    expect(box.querySelector('[data-class-member-picker] .class-member-picker__selected')?.textContent).toContain('김하나');
  });
});
