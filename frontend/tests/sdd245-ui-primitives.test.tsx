// @vitest-environment jsdom
// SDD-245: 공용 UI primitive가 native 속성(type/disabled/ref/aria/이벤트)을 보존하고 토큰 규격을 따른다.
import { act, createRef, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, ButtonLink, Card, Input, PageFrame, PageHeading, Select, Textarea, buttonClass, chipClass, tabClass } from '../src/components/ui';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mounted: Array<() => Promise<void>> = [];
async function mount(node: ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  mounted.push(async () => { await act(async () => root.unmount()); container.remove(); });
  return container;
}
afterEach(async () => { while (mounted.length) await mounted.pop()?.(); });
const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });

describe('Button', () => {
  it('기본 type=button, 클릭·disabled·ref를 native 그대로 유지한다', async () => {
    const onClick = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    const c = await mount(<Button ref={ref} onClick={onClick}>저장</Button>);
    const btn = c.querySelector('button') as HTMLButtonElement;
    expect(btn.getAttribute('type')).toBe('button');
    expect(ref.current).toBe(btn);
    await click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    const d = await mount(<Button disabled onClick={onClick}>저장</Button>);
    const disabled = d.querySelector('button') as HTMLButtonElement;
    await click(disabled);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(disabled.disabled).toBe(true);
  });

  it('submit type을 덮어쓸 수 있다', async () => {
    const c = await mount(<Button type="submit">보내기</Button>);
    expect(c.querySelector('button')?.getAttribute('type')).toBe('submit');
  });

  it('primary는 pill + 보라, md는 모바일 48/데스크톱 44, lg는 48', () => {
    const primary = buttonClass({ variant: 'primary', size: 'md' });
    expect(primary).toContain('rounded-full');
    expect(primary).toContain('bg-[#5F0080]');
    expect(primary).toContain('h-12');
    expect(primary).toContain('md:h-11');
    expect(buttonClass({ size: 'lg' })).toContain('h-12');
    expect(buttonClass({ size: 'lg' })).not.toContain('md:h-11');
    expect(buttonClass({ size: 'sm' })).toContain('min-h-11');
  });

  it('secondary/ghost는 12px 반경, icon은 44×44 원형', () => {
    expect(buttonClass({ variant: 'secondary' })).toContain('rounded-xl');
    expect(buttonClass({ variant: 'ghost' })).toContain('rounded-xl');
    const icon = buttonClass({ variant: 'icon' });
    expect(icon).toContain('h-11');
    expect(icon).toContain('w-11');
    expect(icon).toContain('rounded-full');
  });

  it('inverse/danger tone은 별도 색을 쓴다', () => {
    expect(buttonClass({ tone: 'inverse' })).toContain('bg-white');
    expect(buttonClass({ tone: 'danger' })).toContain('bg-[#B3264B]');
  });

  it('icon 버튼에 aria-label이 전달된다', async () => {
    const c = await mount(<Button variant="icon" aria-label="알림">★</Button>);
    expect(c.querySelector('button')?.getAttribute('aria-label')).toBe('알림');
  });

  it('키보드 Enter/Space는 native button 동작에 맡긴다(tabIndex 변경 없음)', async () => {
    const c = await mount(<Button>확인</Button>);
    expect(c.querySelector('button')?.hasAttribute('tabindex')).toBe(false);
  });
});

describe('ButtonLink', () => {
  it('<a>로 렌더되고 button 중첩이 없다', async () => {
    const c = await mount(<MemoryRouter><ButtonLink to="/classes">클래스</ButtonLink></MemoryRouter>);
    const link = c.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/classes');
    expect(link.closest('button')).toBeNull();
    expect(link.className).toContain('rounded-full');
  });
});

describe('Card / fields / page', () => {
  it('Card는 20px 반경·E8E2ED 테두리, 패딩 variant를 지원한다', async () => {
    const c = await mount(<><Card>내용</Card><Card padding="compact">내용</Card></>);
    const [a, b] = Array.from(c.querySelectorAll('[data-ui="card"]'));
    expect(a.className).toContain('rounded-[20px]');
    expect(a.className).toContain('border-[#E8E2ED]');
    expect(a.className).toContain('p-6');
    expect(b.className).toContain('p-4');
  });

  it('Input/Select/Textarea는 value·onChange·ref·aria를 보존한다', async () => {
    const onChange = vi.fn();
    const ref = createRef<HTMLInputElement>();
    const c = await mount(<>
      <Input ref={ref} aria-label="이름" defaultValue="a" onChange={onChange} />
      <Select aria-label="유형" defaultValue="x"><option value="x">x</option></Select>
      <Textarea aria-label="메모" defaultValue="m" />
    </>);
    const input = c.querySelector('input') as HTMLInputElement;
    expect(ref.current).toBe(input);
    expect(input.getAttribute('aria-label')).toBe('이름');
    expect(input.className).toContain('h-12');
    expect(input.className).toContain('md:h-11');
    expect(c.querySelector('select')?.getAttribute('aria-label')).toBe('유형');
    expect(c.querySelector('textarea')?.getAttribute('aria-label')).toBe('메모');
  });

  it('PageFrame은 외곽 padding을 주지 않고(이중 inset 금지) standard=1200 콘텐츠 폭이다', async () => {
    const c = await mount(<><PageFrame>x</PageFrame><PageFrame width="full">y</PageFrame></>);
    const [std, full] = Array.from(c.querySelectorAll('[data-ui="page-frame"]'));
    expect(std.className).toContain('max-w-mb-content');
    expect(std.className).not.toMatch(/(^|\s)(p|px|pl|pr)-\d/);
    expect(full.className).not.toContain('max-w-');
  });

  it('PageHeading은 22px/700 제목과 보조 문구·액션을 그린다', async () => {
    const c = await mount(<PageHeading title="리포트" sub="요약" actions={<span>액션</span>} />);
    const h = c.querySelector('h1') as HTMLElement;
    expect(h.textContent).toBe('리포트');
    expect(h.className).toContain('text-[22px]');
    expect(h.className).toContain('font-bold');
    expect(c.textContent).toContain('요약');
    expect(c.textContent).toContain('액션');
  });

  it('탭/칩 클래스: 탭 44px 터치, 칩 pill', () => {
    expect(tabClass(true)).toContain('min-h-11');
    expect(tabClass(true)).toContain('bg-[#5F0080]');
    expect(tabClass(false)).toContain('text-[#5F0080]');
    expect(chipClass()).toContain('rounded-full');
  });
});
