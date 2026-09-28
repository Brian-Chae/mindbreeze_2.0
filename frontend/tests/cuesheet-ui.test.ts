// @vitest-environment jsdom
// 개선 7: 진행 큐시트 UI — 생성 폼 작성기 + 상담사 플레이어 패널(현재 단계 하이라이트·남은 시간)
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CuesheetStep } from '../src/lib/api/session';
import { CuesheetPanel } from '../src/components/class/CuesheetPanel';
import { CuesheetEditor } from '../src/components/session/CuesheetEditor';

let root: Root;
let container: HTMLDivElement;

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

function text(): string {
  return container.textContent ?? '';
}

function byAria(label: string): HTMLElement | null {
  return container.querySelector(`[aria-label="${label}"]`);
}

function button(textContent: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((el) => el.textContent === textContent);
}

/** React 18 controlled input 에 값을 반영한다(프로토타입 setter + input 이벤트) */
function setInputValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const FLOW: CuesheetStep[] = [
  { label: '도입 호흡', duration_min: 5, note: '4-7-8 호흡' },
  { label: '바디스캔', duration_min: 20, note: null },
  { label: '마무리', duration_min: 5, note: null },
];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

// ── 상담사 플레이어 패널 ───────────────────────────────────────────────

describe('CuesheetPanel', () => {
  it('큐시트가 없으면 아무것도 렌더하지 않는다', async () => {
    await render(createElement(CuesheetPanel, { cuesheet: [], elapsedSec: 120 }));
    expect(container.querySelector('[data-testid="cuesheet-panel"]')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('현재 단계를 하이라이트하고 남은 시간 진행바를 보여 준다', async () => {
    await render(createElement(CuesheetPanel, { cuesheet: FLOW, elapsedSec: 0 }));

    // 1단계가 현재 단계
    const current = container.querySelector('[aria-current="step"]');
    expect(current?.textContent).toContain('도입 호흡');
    expect(current?.textContent).toContain('5분');
    // 남은 시간 = 5분 전체
    expect(text()).toContain('남은 05분 00초');
    // 진행바 0%
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('0');
    // 다음 단계 안내
    expect(text()).toContain('다음 · 바디스캔');
    // 전체 단계 라벨 노출
    expect(text()).toContain('마무리');
    expect(text()).toContain('1/3 단계');
  });

  it('경과가 2단계로 넘어가면 하이라이트가 이동하고 진행률이 갱신된다', async () => {
    await render(createElement(CuesheetPanel, { cuesheet: FLOW, elapsedSec: 0 }));
    // 1단계(300초) 종료 + 2단계 600초 = 절반
    await render(createElement(CuesheetPanel, { cuesheet: FLOW, elapsedSec: 900 }));

    const current = container.querySelector('[aria-current="step"]');
    expect(current?.textContent).toContain('바디스캔');
    expect(text()).toContain('남은 10분 00초');
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('50');
  });

  it('단계 전환 순간에만 조용한 안내를 띄우고 소리·팝업은 없다', async () => {
    await render(createElement(CuesheetPanel, { cuesheet: FLOW, elapsedSec: 0 }));
    // 첫 렌더에는 전환 안내 없음
    expect(container.querySelector('[role="status"]')).toBeNull();

    await render(createElement(CuesheetPanel, { cuesheet: FLOW, elapsedSec: 310 }));
    const notice = container.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain('2단계');
    expect(notice?.textContent).toContain('바디스캔');
    expect(notice?.getAttribute('aria-live')).toBe('polite');

    // 같은 단계 내 경과 갱신만으로는 안내가 다시 뜨지 않는다(중복 알림 방지)
    await act(async () => {
      root.render(createElement(CuesheetPanel, { cuesheet: FLOW, elapsedSec: 400 }));
    });
    const notices = container.querySelectorAll('[role="status"]');
    expect(notices.length).toBeLessThanOrEqual(1);
    expect(notices[0]?.textContent).toContain('2단계');
  });

  it('마지막 단계까지 지나면 완료로 표시한다', async () => {
    await render(createElement(CuesheetPanel, { cuesheet: FLOW, elapsedSec: 5000 }));
    expect(text()).toContain('완료');
    expect(text()).toContain('3/3 단계');
  });

  it('일시정지 중에도 현재 단계와 남은 시간은 유지된다', async () => {
    await render(createElement(CuesheetPanel, { cuesheet: FLOW, elapsedSec: 100, paused: true }));
    expect(text()).toContain('도입 호흡');
    expect(text()).toContain('일시정지 중');
  });
});

// ── 생성 폼 작성기 ─────────────────────────────────────────────────────

describe('CuesheetEditor', () => {
  it('빈 큐시트에는 기본 흐름·빈 단계 버튼을 제공한다', async () => {
    await render(createElement(CuesheetEditor, { value: [], onChange: vi.fn() }));
    expect(text()).toContain('아직 단계가 없습니다');
    expect(button('명상 기본 흐름 넣기')).toBeDefined();
    expect(button('빈 단계 추가')).toBeDefined();
  });

  it('기본 흐름 버튼은 도입→바디스캔→마무리 3단계를 채운다', async () => {
    const onChange = vi.fn();
    await render(createElement(CuesheetEditor, { value: [], onChange }));
    await act(async () => {
      button('명상 기본 흐름 넣기')?.click();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const steps = onChange.mock.calls[0][0] as CuesheetStep[];
    expect(steps.map((s) => s.label)).toEqual(['도입 호흡', '바디스캔', '마무리']);
  });

  it('단계 라벨 입력은 해당 단계만 바꾼 새 배열을 올린다', async () => {
    const onChange = vi.fn();
    await render(createElement(CuesheetEditor, { value: FLOW, onChange }));
    const labelInput = byAria('2단계 라벨') as HTMLInputElement;
    await act(async () => {
      setInputValue(labelInput, '바디스캔(수정)');
    });
    const next = onChange.mock.calls.at(-1)?.[0] as CuesheetStep[];
    expect(next[1].label).toBe('바디스캔(수정)');
    expect(next[0].label).toBe('도입 호흡');
    expect(next).toHaveLength(3);
  });

  it('삭제 버튼은 해당 단계를 제거한다', async () => {
    const onChange = vi.fn();
    await render(createElement(CuesheetEditor, { value: FLOW, onChange }));
    await act(async () => {
      (byAria('2단계 삭제') as HTMLButtonElement).click();
    });
    const next = onChange.mock.calls.at(-1)?.[0] as CuesheetStep[];
    expect(next.map((s) => s.label)).toEqual(['도입 호흡', '마무리']);
  });

  it('합계와 클래스 소요 시간이 다르면 안내 문구를 보여 준다', async () => {
    await render(
      createElement(CuesheetEditor, { value: FLOW, onChange: vi.fn(), classDurationMin: 50 }),
    );
    expect(text()).toContain('3단계 · 30분');
    expect(text()).toContain('짧습니다');
  });

  it('합계가 맞으면 경고를 띄우지 않는다', async () => {
    await render(
      createElement(CuesheetEditor, { value: FLOW, onChange: vi.fn(), classDurationMin: 30 }),
    );
    expect(text()).not.toContain('짧습니다');
    expect(text()).not.toContain('깁니다');
  });
});
