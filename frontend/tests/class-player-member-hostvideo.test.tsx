// @vitest-environment jsdom
// SDD-208 I1 — 상담사 영상 연결 안내 칩(뷰): 실패/기다림 두 종류, 재시도 버튼, 평상시·오프라인에서는 없음.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberClassView, type MemberClassViewProps } from '../src/components/class/player/member/MemberClassView';
import { memberCaseViewProps } from '../src/lib/class/fixtures/member-cases';

let root: Root;
let container: HTMLDivElement;
const q = <T extends Element = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

async function mount(id: string, override: Partial<MemberClassViewProps> = {}): Promise<MemberClassViewProps['actions']> {
  const props = memberCaseViewProps(id);
  const actions = Object.fromEntries(Object.keys(props.actions).map((k) => [k, vi.fn()])) as unknown as MemberClassViewProps['actions'];
  const node: ReactNode = <MemberClassView {...props} {...override} actions={{ ...actions, ...override.actions }} />;
  await act(async () => { root.render(node); });
  return actions;
}
const noTrack = { hostCamera: false };

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('상담사 영상 안내 칩', () => {
  it('failed: 불러오지 못했다는 안내와 [영상 다시 시도], 누르면 onHostVideoRetry', async () => {
    const props = memberCaseViewProps('M01');
    const actions = await mount('M01', { input: { ...props.input, ...noTrack }, hostVideoIssue: 'failed' });
    const chip = q('[data-pz="pip-issue"]');
    expect(chip?.textContent).toContain('상담사 영상을 불러오지 못했습니다');
    expect(q('[data-pz="pip"]')).toBeNull();
    await act(async () => { [...document.querySelectorAll('button')].find((b) => b.textContent === '영상 다시 시도')?.click(); });
    expect(actions.onHostVideoRetry).toHaveBeenCalledTimes(1);
  });

  it('waiting: 기다리고 있다는 안내와 [영상 다시 시도]', async () => {
    const props = memberCaseViewProps('M01');
    await mount('M01', { input: { ...props.input, ...noTrack }, hostVideoIssue: 'waiting' });
    expect(q('[data-pz="pip-issue"]')?.textContent).toContain('상담사 영상을 기다리고 있어요');
    expect([...document.querySelectorAll('button')].some((b) => b.textContent === '영상 다시 시도')).toBe(true);
  });

  it('칩은 내 PiP 와 나란히 한 자리를 차지한다(1:1 은 PiP 짝 구조 유지)', async () => {
    const props = memberCaseViewProps('M01');
    await mount('M01', { input: { ...props.input, ...noTrack }, hostVideoIssue: 'failed' });
    expect(q('.mp-pips')?.children).toHaveLength(2);
    expect(q('[data-pz="mypip"]')).not.toBeNull();
  });

  it('안내가 없으면(정상·재시도 중·트랙 없음) 칩이 없다', async () => {
    const props = memberCaseViewProps('M01');
    await mount('M01', { input: { ...props.input, ...noTrack }, hostVideoIssue: null });
    expect(q('[data-pz="pip-issue"]')).toBeNull();
  });

  it('상담사 카메라가 나오는 중이면 영상 PiP 만 보인다', async () => {
    await mount('M01', { hostVideoIssue: 'failed' });
    expect(q('[data-pz="pip"]')).not.toBeNull();
    expect(q('[data-pz="pip-issue"]')).toBeNull();
  });

  it('오프라인에서는 안내가 있어도 칩을 그리지 않는다', async () => {
    const props = memberCaseViewProps('M05');
    await mount('M05', { input: { ...props.input, ...noTrack }, hostVideoIssue: 'failed' });
    expect(q('[data-pz="pip-issue"]')).toBeNull();
  });

  it('끊김 카드(M19) 중에는 칩을 그리지 않는다', async () => {
    const props = memberCaseViewProps('M19');
    await mount('M19', { input: { ...props.input, ...noTrack }, hostVideoIssue: 'failed' });
    expect(q('[data-pz="pip-issue"]')).toBeNull();
  });
});
