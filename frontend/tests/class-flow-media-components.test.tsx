// @vitest-environment jsdom
// SDD-209 T2b — MyAvCheck · PermissionHelpSheet · ElectrodeLeds · SensorTracker 3상태
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MyAvCheck, type MyAvCheckProps } from '../src/components/class/flow/shared/MyAvCheck';
import { PermissionHelpSheet } from '../src/components/class/flow/shared/PermissionHelpSheet';
import { ElectrodeLeds } from '../src/components/class/flow/shared/ElectrodeLeds';
import { SensorTracker } from '../src/components/class/SensorTracker';

let root: Root;
let container: HTMLDivElement;
async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(node); });
}
const q = <T extends Element = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
const qa = (sel: string): Element[] => [...document.querySelectorAll(sel)];

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

const base = (over: Partial<MyAvCheckProps> = {}): MyAvCheckProps => ({
  mic: 'on', cam: 'off', level: 0.5, steps: 3, quiet: false, solo: false, speakerPlaying: false,
  onToggleMic: vi.fn(), onToggleCamera: vi.fn(), onRecheck: vi.fn(), onPlayTone: vi.fn(), onOpenHelp: vi.fn(),
  ...over,
});
const text = (): string => document.body.textContent ?? '';

describe('MyAvCheck', () => {
  it('카메라 꺼짐 + 마이크 켜짐: 가로 막대(10칸) + 정상 칩 + 세로 미터 없음', async () => {
    await render(<MyAvCheck {...base({ level: 0.5 })} />);
    expect(q('[data-pz="flow-avcheck"]')!.getAttribute('data-cam')).toBe('off');
    expect(qa('[data-pz="flow-level"] i')).toHaveLength(10);
    expect(qa('[data-pz="flow-level"] i.on')).toHaveLength(5);
    expect(text()).toContain('정상');
    expect(q('.mav-seg')).toBeNull();
  });

  it('카메라 켜짐: video + 마이크 토글 둘레 5단계 링(채움 = steps), 가로 막대 없음', async () => {
    await render(<MyAvCheck {...base({ cam: 'on', steps: 3 })} />);
    expect(q('video')).not.toBeNull();
    expect(qa('.mav-seg circle')).toHaveLength(5);
    expect(qa('.mav-seg circle[data-on="1"]')).toHaveLength(3);
    expect(q('[data-pz="flow-level"]')).toBeNull();
    expect(q('button[aria-label="마이크 끄기 · 입력 정상 (5단계 중 3단계)"]')).not.toBeNull();
  });

  it('조용해요: 칩·접근성 이름이 함께 바뀐다', async () => {
    await render(<MyAvCheck {...base({ cam: 'on', steps: 1, quiet: true })} />);
    expect(text()).toContain('조용해요');
    expect(q('button[aria-label="마이크 끄기 · 입력 조용해요 (5단계 중 1단계)"]')).not.toBeNull();
  });

  it.each([
    ['denied', '마이크 권한이 꺼져 있어요', '마이크 허용 방법 보기'],
    ['nodevice', '마이크를 찾지 못했어요', '다시 확인하기'],
    ['inuse', '마이크를 쓸 수 없어요', '다시 확인하기'],
  ] as const)('마이크 %s: 칩과 상세 문구가 같은 상태', async (mic, msg, action) => {
    await render(<MyAvCheck {...base({ mic })} />);
    expect(text()).toContain(msg);
    expect(text()).toContain(action);
    expect(q<HTMLButtonElement>('button[aria-label="마이크를 사용할 수 없어요"]')!.disabled).toBe(true);
  });

  it('허용 방법/다시 확인 버튼이 콜백을 부른다', async () => {
    const onOpenHelp = vi.fn();
    const onRecheck = vi.fn();
    await render(<MyAvCheck {...base({ mic: 'denied', onOpenHelp })} />);
    await act(async () => { [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('허용 방법'))!.click(); });
    expect(onOpenHelp).toHaveBeenCalledWith('마이크');
    await render(<MyAvCheck {...base({ mic: 'nodevice', onRecheck })} />);
    await act(async () => { [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('다시 확인'))!.click(); });
    expect(onRecheck).toHaveBeenCalledTimes(1);
  });

  it('카메라 거부: 마이크는 정상 표시 + 카메라 안내 + 카메라 토글 비활성', async () => {
    await render(<MyAvCheck {...base({ cam: 'denied' })} />);
    expect(text()).toContain('카메라 권한이 꺼져 있어요');
    expect(q<HTMLButtonElement>('button[aria-label="카메라를 사용할 수 없어요"]')!.disabled).toBe(true);
    expect(qa('[data-pz="flow-level"]')).toHaveLength(1);
  });

  it('미지원: 안내 + 링크 복사(콜백 있을 때만)', async () => {
    const onCopyLink = vi.fn();
    await render(<MyAvCheck {...base({ mic: 'unsupported', cam: 'unsupported', onCopyLink })} />);
    expect(text()).toContain('Chrome 또는 Edge');
    await act(async () => { [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('링크 복사'))!.click(); });
    expect(onCopyLink).toHaveBeenCalledTimes(1);
  });

  it('1:1 이면 카메라 안내가 상담사에게로 바뀐다', async () => {
    await render(<MyAvCheck {...base({ solo: true })} />);
    expect(text()).toContain('상담사에게 내 모습이 보여요');
    expect(text()).not.toContain('다른 분들');
  });

  it('스피커: 테스트음 듣기 ↔ 재생 중, showSpeaker=false 면 없음', async () => {
    const onPlayTone = vi.fn();
    await render(<MyAvCheck {...base({ onPlayTone })} />);
    expect(text()).toContain('테스트음 듣기');
    await act(async () => { [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('테스트음'))!.click(); });
    expect(onPlayTone).toHaveBeenCalledTimes(1);
    await render(<MyAvCheck {...base({ speakerPlaying: true })} />);
    expect(text()).toContain('재생 중');
    await render(<MyAvCheck {...base({ showSpeaker: false })} />);
    expect(text()).not.toContain('스피커');
  });

  it('모든 버튼은 접근 가능한 이름이 있다', async () => {
    await render(<MyAvCheck {...base({ cam: 'on', mic: 'denied' })} />);
    for (const b of qa('button')) expect((b.getAttribute('aria-label') || b.textContent || '').trim()).not.toBe('');
  });
});

describe('PermissionHelpSheet', () => {
  it('장치별 제목·단계·확인 버튼', async () => {
    const onRecheck = vi.fn();
    await render(<PermissionHelpSheet open device="카메라" onClose={() => {}} onRecheck={onRecheck} />);
    expect(q('[data-pz="flow-sheet"]')!.getAttribute('aria-label')).toBe('카메라 허용 방법');
    expect(text()).toContain('카메라를 허용으로 바꿔요');
    expect(text()).toContain('주소창 왼쪽의 자물쇠');
    await act(async () => { q<HTMLButtonElement>('.pz-sheet__foot button')!.click(); });
    expect(onRecheck).toHaveBeenCalledTimes(1);
  });
  it('닫혀 있으면 아무것도 그리지 않는다', async () => {
    await render(<PermissionHelpSheet open={false} device="마이크" onClose={() => {}} onRecheck={() => {}} />);
    expect(q('[data-pz="flow-sheet"]')).toBeNull();
  });
});

describe('SensorTracker 3상태', () => {
  const states = (): string[] => qa('svg g[data-led]').map((g) => `${g.getAttribute('data-led')}:${g.getAttribute('data-state')}`);
  it('leadOff=null 은 전부 미확인(회색) — 빨강으로 오표시하지 않는다', async () => {
    await render(<SensorTracker leadOff={null} />);
    expect(states()).toEqual(['L:unknown', 'ref:unknown', 'R:unknown']);
    const fills = qa('svg g[data-led] rect:last-of-type').map((r) => r.getAttribute('fill'));
    expect(fills.every((f) => f === '#8A8A9A')).toBe(true);
    expect(text()).toContain('확인 전');
  });
  it('양호/실패: 색은 prop 으로 바꿀 수 있다', async () => {
    await render(<SensorTracker leadOff={{ ch1: true, ch2: false }} colors={{ good: '#111111', bad: '#222222', unknown: '#333333' }} />);
    expect(states()).toEqual(['L:bad', 'ref:bad', 'R:good']);
    expect(q('svg g[data-led="L"] rect:last-of-type')!.getAttribute('fill')).toBe('#222222');
    expect(q('svg g[data-led="R"] rect:last-of-type')!.getAttribute('fill')).toBe('#111111');
    expect(text()).not.toContain('확인 전');
  });
  it('전극별 aria-label + 라벨 줄', async () => {
    await render(<SensorTracker leadOff={{ ch1: false, ch2: true }} />);
    expect(q('[aria-label="왼쪽 전극 접촉 양호"]')).not.toBeNull();
    expect(q('[aria-label="오른쪽 전극 접촉 실패"]')).not.toBeNull();
    expect(q('[aria-label="기준 전극 접촉 실패"]')).not.toBeNull();
    expect(q('[data-pz="flow-electrode-labels"]')!.textContent).toBe('왼쪽 양호기준 실패오른쪽 실패');
  });
  it('폭: 288 고정이 아니라 max-width 288 + width 100%', async () => {
    await render(<SensorTracker leadOff={null} />);
    const wrap = q<HTMLElement>('[data-pz="flow-electrodes"]')!;
    expect(wrap.style.maxWidth).toBe('288px');
    expect(wrap.style.width).toBe('100%');
    expect(q('svg')!.getAttribute('width')).toBe('100%');
    expect(q('svg')!.getAttribute('viewBox')).toBe('0 0 288 64');
  });
  it('체크·엑스 글리프를 쓰지 않는다', async () => {
    await render(<SensorTracker leadOff={{ ch1: true, ch2: true }} />);
    expect(text()).not.toMatch(/[✓✕✔✖×]/);
  });
});

describe('ElectrodeLeds', () => {
  it('card = SensorTracker 와 같은 매핑', async () => {
    await render(<ElectrodeLeds leadOff={{ ch1: true, ch2: false }} />);
    expect(q('[data-pz="flow-electrodes"]')).not.toBeNull();
    expect(q('svg g[data-led="L"]')!.getAttribute('data-state')).toBe('bad');
  });
  it('mini: 점 3개 + 한 문장 aria-label', async () => {
    await render(<ElectrodeLeds size="mini" leadOff={{ ch1: false, ch2: true }} />);
    const mini = q('[data-pz="flow-electrode-mini"]')!;
    expect(mini.getAttribute('aria-label')).toBe('전극 접촉: 왼쪽 양호, 기준 실패, 오른쪽 실패');
    expect(mini.querySelectorAll('.eled-mini__item')).toHaveLength(3);
    expect(q('[data-pz="flow-electrodes"]')).toBeNull();
  });
  it('mini + null: 미확인 3개', async () => {
    await render(<ElectrodeLeds size="mini" leadOff={null} />);
    expect(qa('.eled-mini__item[data-state="unknown"]')).toHaveLength(3);
  });
});
