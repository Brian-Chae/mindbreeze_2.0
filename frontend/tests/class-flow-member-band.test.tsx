// @vitest-environment jsdom
// SDD-209 M4 — FM06c LINK BAND 단계(차단 없음) · 단계 결과 반영
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BandStepView, type BandStepViewProps } from '../src/components/class/flow/member/BandStepView';
import { bandOutcomeOf } from '../src/lib/class/flow/member-prep';
import type { BandStepUi } from '../src/lib/class/band-step';

let root: Root;
let container: HTMLDivElement;
async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(node); });
}
const qa = <T extends Element = HTMLElement>(sel: string): T[] => [...document.querySelectorAll<T>(sel)];
const text = (): string => document.body.textContent ?? '';
const btn = (label: string): HTMLButtonElement | undefined => qa<HTMLButtonElement>('button').find((b) => (b.textContent ?? '').trim() === label);
const noop = (): void => undefined;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function props(over: Partial<BandStepViewProps> = {}): BandStepViewProps {
  return {
    state: 'idle', bandMode: 'opt', leadOff: null, battery: 80, steps: { total: 5, current: 2 },
    onConnect: noop, onDisconnect: noop, onNext: noop, onSkip: noop, onBack: noop, onExit: noop, ...over,
  };
}

describe('bandOutcomeOf — 단계 결과', () => {
  it('연결된 채로 다음 = connected, 없이 계속 = skipped, 접촉 불량이어도 다음이면 connected 로 기록(차단 없음)', () => {
    expect(bandOutcomeOf('connected', 'next')).toBe('connected');
    expect(bandOutcomeOf('leadoff', 'next')).toBe('connected');
    expect(bandOutcomeOf('idle', 'skip')).toBe('skipped');
    expect(bandOutcomeOf('unsupported', 'skip')).toBe('skipped');
    expect(bandOutcomeOf('connected', 'skip')).toBe('skipped');
  });
});

describe('FM06c 화면', () => {
  it('idle(선택): 제목·부제·선택 태그·연결 안 됨·3줄 안내(귀 없음)·주/보조 버튼', async () => {
    await render(<BandStepView {...props()} />);
    expect(text()).toContain('LINK BAND를 연결해요');
    expect(text()).toContain('연결하면 뇌파도 함께 기록해요. 지금 연결하지 않아도 괜찮아요.');
    expect(text()).toContain('선택');
    expect(text()).toContain('연결 안 됨');
    expect(text()).toContain('LINK BAND의 전원을 켜요');
    expect(text()).toContain('이마 중앙에 밴드를 맞춰요');
    expect(text()).toContain('아래 버튼으로 연결해요');
    expect(text()).not.toContain('귀');
    expect(btn('LINK BAND 연결하기')!.disabled).toBe(false);
    expect(btn('LINK BAND 없이 계속하기')).toBeDefined();
  });
  it('연결 중: 3점 순차 페이드(회전 스피너 아님), 주 버튼 비활성, 없이 계속하기는 가능', async () => {
    await render(<BandStepView {...props({ state: 'connecting' })} />);
    expect(text()).toContain('연결 중');
    expect(text()).toContain('LINK BAND를 가까이에 두고 잠시만 기다려 주세요.');
    expect(qa('.fm-dots i')).toHaveLength(3);
    expect(btn('연결하고 있어요')!.disabled).toBe(true);
    expect(btn('LINK BAND 없이 계속하기')!.disabled).toBe(false);
  });
  it('연결됨: 배터리·전극 요약, 전극 LED 카드는 없다, 다음 / 연결 해제하기', async () => {
    const onNext = vi.fn();
    const onDisconnect = vi.fn();
    await render(<BandStepView {...props({ state: 'connected', onNext, onDisconnect })} />);
    expect(text()).toContain('연결됨');
    expect(text()).toContain('배터리');
    expect(text()).toContain('넉넉해요');
    expect(text()).toContain('접촉 양호');
    expect(text()).toContain('이마에서 밴드가 움직이면 접촉이 흐트러질 수 있어요');
    expect(document.querySelector('[data-pz="flow-electrodes"]')).toBeNull();
    await act(async () => { btn('다음')!.click(); });
    expect(onNext).toHaveBeenCalledTimes(1);
    await act(async () => { btn('연결 해제하기')!.click(); });
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });
  it('배터리가 낮으면 넉넉하다고 말하지 않는다', async () => {
    await render(<BandStepView {...props({ state: 'connected', battery: 10 })} />);
    expect(text()).not.toContain('넉넉해요');
    expect(text()).toContain('충전이 필요해요');
  });
  const lead: Array<[BandStepUi, string[]]> = [
    ['leadoffl', ['왼쪽 실패', '기준 실패', '오른쪽 양호']],
    ['leadoffr', ['왼쪽 양호', '기준 실패', '오른쪽 실패']],
    ['leadoff', ['왼쪽 실패', '기준 실패', '오른쪽 실패']],
  ];
  it.each(lead)('접촉 불량 %s: 전극 LED 카드와 3단계 안내, 체크·엑스 아이콘 없음', async (state, labels) => {
    const leadOff = state === 'leadoffl' ? { ch1: true, ch2: false } : state === 'leadoffr' ? { ch1: false, ch2: true } : { ch1: true, ch2: true };
    await render(<BandStepView {...props({ state, leadOff })} />);
    expect(text()).toContain('접촉 불량');
    expect(document.querySelector('[data-pz="flow-electrodes"]')).not.toBeNull();
    const ledLabels = qa('[data-pz="flow-electrode-labels"] span').map((s) => s.textContent);
    expect(ledLabels).toEqual(labels);
    expect(text()).toContain('접촉 양호');
    expect(text()).toContain('접촉 실패');
    expect(text()).toContain('밴드를 이마 중앙에 맞춰 전극이 피부에 밀착되게 조여요');
    expect(text()).toContain('머리카락이나 땀이 전극을 가리지 않게 정리해요');
    expect(text()).toContain('다시 착용해요. 그래도 안 되면 벗었다가 다시 써요');
    expect(document.querySelector('[data-pz="flow-electrodes"] svg path[d*="M20 6"]')).toBeNull();
    expect(btn('다음')!.disabled).toBe(false);
  });
  it('미지원 브라우저: 선택/권장 모두 없이 계속하기가 주 버튼이고 링크 복사 강제가 없다', async () => {
    for (const bandMode of ['opt', 'req'] as const) {
      await render(<BandStepView {...props({ state: 'unsupported', bandMode })} />);
      expect(text()).toContain('지원 안 됨');
      expect(text()).toContain('이 브라우저는 LINK BAND 연결을 지원하지 않아요');
      expect(text()).toContain('Chrome 또는 Edge에서 열면 연결할 수 있어요');
      expect(text()).toContain('밴드 없이도 클래스에 함께할 수 있어요');
      expect(btn('LINK BAND 없이 계속하기')!.getAttribute('data-kind')).toBe('primary');
      expect(text()).not.toContain('링크 복사');
    }
  });
  it('권장(req): 부제·권장 태그, 어떤 상태에서도 없이 계속하기와 활성 진행 버튼, 차단 문구 없음', async () => {
    const states: BandStepUi[] = ['idle', 'connecting', 'connected', 'leadoffl', 'leadoff'];
    for (const state of states) {
      await render(<BandStepView {...props({ state, bandMode: 'req', leadOff: state.startsWith('leadoff') ? { ch1: true, ch2: state === 'leadoff' } : null })} />);
      expect(text()).toContain('LINK BAND 사용을 권장해요. 없어도 참가할 수 있어요');
      expect(text()).toContain('권장');
      expect(btn('LINK BAND 없이 계속하기')).toBeDefined();
      expect(text()).not.toMatch(/연결해야|필수로 연결|입장할 수 없/);
    }
    await render(<BandStepView {...props({ state: 'leadoffl', bandMode: 'req', leadOff: { ch1: true, ch2: false } })} />);
    expect(btn('접촉을 확인해 주세요')!.disabled).toBe(false);
    await render(<BandStepView {...props({ state: 'connected', bandMode: 'req' })} />);
    expect(btn('다음')!.disabled).toBe(false);
  });
  it('코랄 경고색은 조치가 필요한 상태에서만(idle·connecting·unsupported 의 선택 모드 제외 규칙은 시안 P10)', async () => {
    await render(<BandStepView {...props({ state: 'idle' })} />);
    expect(qa('[data-tone="warn"]')).toHaveLength(0);
    await render(<BandStepView {...props({ state: 'connecting' })} />);
    expect(qa('[data-tone="warn"]')).toHaveLength(0);
  });
});
