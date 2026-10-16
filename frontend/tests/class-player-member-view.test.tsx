// @vitest-environment jsdom
// SDD-208 M1 — 회원 뷰(MemberClassView): 상단 바·링·밴드 8상태·안내 칩·슬롯 카드·5분 추이·도크
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberClassView, type MemberClassViewProps } from '../src/components/class/player/member/MemberClassView';
import { memberCaseViewProps } from '../src/lib/class/fixtures/member-cases';

let root: Root;
let container: HTMLDivElement;

async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(node); });
}
const q = <T extends Element = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
const qa = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const text = (): string => document.body.textContent ?? '';
const buttonByText = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

/** 케이스를 그리고 액션 스파이를 돌려준다 */
async function mount(id: string, override: Partial<MemberClassViewProps> = {}): Promise<MemberClassViewProps['actions']> {
  const props = memberCaseViewProps(id);
  const actions = Object.fromEntries(Object.keys(props.actions).map((k) => [k, vi.fn()])) as unknown as MemberClassViewProps['actions'];
  await render(<MemberClassView {...props} {...override} actions={{ ...actions, ...override.actions }} />);
  return actions;
}

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

describe('M01 기본형 — 측정 훅(data-pz)과 상단 바', () => {
  it('시안 data-pz 훅이 모두 있다', async () => {
    await mount('M01');
    for (const name of ['app', 'topbar', 'leave', 'title', 'conn', 'ring', 'guide', 'trend', 'dock']) {
      expect(q(`[data-pz="${name}"]`), name).not.toBeNull();
    }
    expect(qa('[data-pz="dk"]')).toHaveLength(5);
    expect(q('[data-pz="app"]')?.getAttribute('data-place')).toBe('online');
  });
  it('제목·시계(12:34 / 30:00)·연결됨 표시, 나가기는 aria-label 을 가진다', async () => {
    const actions = await mount('M01');
    expect(q('[data-pz="title"]')?.textContent).toContain('마음챙김 명상수업 · 4회차');
    expect(q('[data-pz="title"]')?.textContent).toContain('12:34');
    expect(q('[data-pz="title"]')?.textContent).toContain('30:00');
    expect(q('[data-pz="conn"]')?.getAttribute('aria-label')).toBe('연결됨');
    await act(async () => { q<HTMLButtonElement>('[data-pz="leave"]')?.click(); });
    expect(q('[data-pz="leave"]')?.getAttribute('aria-label')).toBe('나가기');
    expect(actions.onLeave).toHaveBeenCalledTimes(1);
  });
  it('링 중앙에 지표명·값·단위, 링 아래 안내 문구, 5분 추이 한 줄', async () => {
    await mount('M01');
    const ring = q('[data-pz="ring"]');
    expect(ring?.getAttribute('data-core')).toBe('gauge');
    expect(ring?.textContent).toContain('이완도');
    expect(ring?.textContent).toContain('72');
    expect(ring?.textContent).toContain('%');
    expect(ring?.getAttribute('aria-label')).toBe('지표 게이지 — 이완도 72%');
    expect(q('[data-pz="guide"]')?.textContent).toBe('이완도는 최근 5분간 부드럽게 이어졌어요');
    expect(q('[data-pz="trend"]')?.textContent).toContain('최근 5분 · 이완도');
    expect(q('[data-pz="trend"]')?.textContent).toContain('5분간 +8');
  });
  it('도크 5개 라벨과 안읽음 배지(2)', async () => {
    await mount('M01');
    expect(qa('[data-pz="dk"]').map((el) => el.querySelector('.pz-dk__label')?.textContent)).toEqual(['내 상태', '채팅', '조용한 신호', '소리', '기기']);
    expect(q('.pz-dk__badge')?.textContent).toBe('2');
  });
});

describe('링 코어 — 밴드 상태별', () => {
  it.each([
    ['M07', 'msg', /밴드 없이\s*참여 중이에요/, /측정 없이도 수업은\s*그대로 진행돼요/],
    ['M13', 'msg', /밴드 없이\s*참여 중이에요/, /측정 없이도 수업은\s*그대로 진행돼요/],
    ['M08', 'msg', /밴드를 연결하는\s*중이에요/, null],
    ['M10', 'msg', /접촉을 확인해\s*주세요/, null],
    ['M11', 'dim', /이완도/, /다시 연결하는\s*중이에요/],
  ] as const)('%s → core=%s', async (id, core, title, sub) => {
    await mount(id);
    const ring = q('[data-pz="ring"]');
    expect(ring?.getAttribute('data-core')).toBe(core);
    expect(ring?.getAttribute('data-tone')).toBe('idle');
    expect(ring?.textContent).toMatch(title);
    if (sub) expect(ring?.textContent).toMatch(sub);
  });
  it('M08: 연결 대기는 회전이 아닌 3점 순차 페이드', async () => {
    await mount('M08');
    expect(qa('[data-pz="ring"] .pz-ring__dots i')).toHaveLength(3);
  });
  it('M10: 접촉 확인 링 코어에 경고 아이콘', async () => {
    await mount('M10');
    expect(q('[data-pz="ring"] .pz-ring__core-ic svg')).not.toBeNull();
  });
  it('M11: 끊겨도 마지막 값은 흐리게 남긴다(빈 칸 금지)', async () => {
    await mount('M11');
    expect(q('[data-pz="ring"] .pz-ring__num b')?.textContent).toBe('72');
  });
  it.each(['M09', 'M12'])('%s: 신호 약함·배터리 부족에서도 링 값은 유지', async (id) => {
    await mount(id);
    expect(q('[data-pz="ring"]')?.getAttribute('data-core')).toBe('gauge');
    expect(q('[data-pz="ring"] .pz-ring__num b')?.textContent).toBe('72');
  });
});

describe('안내 칩(밴드)', () => {
  it.each([
    ['M07', 'info', '밴드를 연결하면 내 상태가 이 링에 나타나요'],
    ['M08', 'info', '연결되면 이 링에 내 상태가 나타나요'],
    ['M09', 'caution', '접촉이 약해요 · 밴드를 이마에 살짝 밀착해 주세요'],
    ['M10', 'coral', '접촉이 확인되면 다시 측정해요'],
    ['M11', 'coral', '밴드 연결이 끊겼어요 · 자동으로 다시 연결하고 있어요'],
    ['M12', 'caution', '배터리가 15%예요 · 곧 충전해 주세요'],
    ['M13', 'info', '이 브라우저에서는 밴드 연결이 안 돼요'],
  ] as const)('%s → %s', async (id, tone, message) => {
    await mount(id);
    const guide = q('[data-pz="guide"]');
    expect(guide?.getAttribute('data-tone')).toBe(tone);
    expect(guide?.textContent).toBe(message);
    // R8: 색만이 아니라 아이콘 + 텍스트를 함께 가진다
    expect(guide?.querySelector('svg')).not.toBeNull();
  });
});

describe('슬롯 카드 — 추이 자리를 대체하고 행동 하나를 준다', () => {
  it('M01 은 슬롯 카드 없이 추이를 보여 준다', async () => {
    await mount('M01');
    expect(q('[data-pz="info-card"]')).toBeNull();
    expect(q('[data-pz="trend"]')).not.toBeNull();
  });
  it('M07: [밴드 연결] → 기기 시트 요청, 추이는 숨김', async () => {
    const actions = await mount('M07');
    expect(q('[data-pz="trend"]')).toBeNull();
    expect(q('[data-pz="info-card"]')?.textContent).toContain('원하시면 기기에서 LINK BAND를 연결할 수 있어요.');
    await act(async () => { buttonByText('밴드 연결')?.click(); });
    expect(actions.onSheetChange).toHaveBeenCalledWith('device');
  });
  it('M08: [취소] → 연결 취소', async () => {
    const actions = await mount('M08');
    expect(q('[data-pz="info-card"]')?.textContent).toContain('오래 걸리면 밴드 전원이 켜져 있는지 확인해 주세요.');
    await act(async () => { buttonByText('취소')?.click(); });
    expect(actions.onBandCancel).toHaveBeenCalledTimes(1);
  });
  it('M10: [확인 방법] → 기기 시트', async () => {
    const actions = await mount('M10', { sheet: null });
    await act(async () => { buttonByText('확인 방법')?.click(); });
    expect(actions.onSheetChange).toHaveBeenCalledWith('device');
  });
  it('M11: [다시 연결] → 수동 재연결', async () => {
    const actions = await mount('M11');
    expect(q('[data-pz="info-card"]')?.textContent).toContain('다시 연결해도 앞서 측정한 값은 안전하게 보관돼요.');
    await act(async () => { buttonByText('다시 연결')?.click(); });
    expect(actions.onBandRetry).toHaveBeenCalledTimes(1);
  });
  it('M13: [밴드 없이 계속]', async () => {
    const actions = await mount('M13');
    expect(q('[data-pz="info-card"]')?.textContent).toContain('Chrome 또는 Edge로 열면 밴드를 연결할 수 있어요.');
    await act(async () => { buttonByText('밴드 없이 계속')?.click(); });
    expect(actions.onBandContinue).toHaveBeenCalledTimes(1);
  });
});

describe('지표 전환', () => {
  it('hero 지표가 바뀌면 링·안내 문구·추이 라벨이 같이 바뀐다', async () => {
    await mount('M01', { hero: 'bpm' });
    expect(q('[data-pz="ring"]')?.textContent).toContain('BPM');
    expect(q('[data-pz="ring"]')?.textContent).toContain('68');
    expect(q('[data-pz="ring"]')?.textContent).toContain('bpm');
    expect(q('[data-pz="guide"]')?.textContent).toBe('BPM은 최근 5분간 안정적으로 이어졌어요');
    expect(q('[data-pz="trend"]')?.textContent).toContain('최근 5분 · BPM');
  });
});

describe('금지 요소 — P5(호흡 지시)·P6(그룹 비교·점수)·X2(이모지)', () => {
  const LIVE = Array.from({ length: 19 }, (_, i) => `M${String(i + 1).padStart(2, '0')}`);
  it.each(LIVE)('%s 화면 전체 텍스트', async (id) => {
    await mount(id);
    const all = text();
    expect(all).not.toMatch(/호흡에 집중|숨을 (들이|내쉬)|들이쉬|내쉬|호흡하세요|천천히 호흡|심호흡/);
    expect(all).not.toMatch(/그룹|평균|순위|상위|하위|종합|총점|점수/);
    expect(all).not.toMatch(/\p{Extended_Pictographic}/u);
  });
  it('정적 링: 값 호 외에 애니메이션 클래스가 없다(M08 점 페이드 제외)', async () => {
    await mount('M01');
    expect(q('[data-pz="ring"] .pz-ring__dots')).toBeNull();
  });
});
