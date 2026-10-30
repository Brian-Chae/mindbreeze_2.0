// @vitest-environment jsdom
// SDD-209 M5 — FM06d 기기 점검(온라인만) · 권한 요청은 사용자 동작 후 · 결과는 요약 초안에 반영
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceStepView, type DeviceStepViewProps } from '../src/components/class/flow/member/DeviceStepView';
import { deviceOutcomeOf } from '../src/lib/class/flow/member-prep';
import type { MediaDeviceUi } from '../src/lib/class/class-media';

let root: Root;
let container: HTMLDivElement;
async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(node); });
}
const qa = <T extends Element = HTMLElement>(sel: string): T[] => [...document.querySelectorAll<T>(sel)];
const text = (): string => document.body.textContent ?? '';
const btn = (label: string): HTMLButtonElement | undefined => qa<HTMLButtonElement>('button').find((b) => (b.textContent ?? '').trim() === label);
const byLabel = (label: string): HTMLButtonElement | undefined => qa<HTMLButtonElement>('button').find((b) => b.getAttribute('aria-label')?.startsWith(label));
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

function props(over: Partial<DeviceStepViewProps> = {}): DeviceStepViewProps {
  return {
    mic: 'on', cam: 'off', level: 0.5, ringSteps: 3, quiet: false, solo: false, speakerPlaying: false, steps: { total: 5, current: 3 },
    helpDevice: null, startedRemaining: null,
    onToggleMic: noop, onToggleCamera: noop, onRecheck: noop, onPlayTone: noop, onOpenHelp: noop, onCloseHelp: noop, onCopyLink: noop,
    onNext: noop, onBack: noop, onExit: noop, ...over,
  };
}

describe('deviceOutcomeOf — 요약에 반영할 결과', () => {
  const cases: Array<[MediaDeviceUi, MediaDeviceUi, string, boolean]> = [
    ['on', 'on', 'on', true],
    ['on', 'off', 'on', false],
    ['off', 'off', 'off', false],
    ['denied', 'off', 'off', false],
    ['nodevice', 'denied', 'off', false],
    ['unsupported', 'unsupported', 'off', false],
    ['pending', 'off', 'unknown', false],
  ];
  it.each(cases)('마이크 %s · 카메라 %s → 마이크 %s · 카메라 켜짐 %s', (mic, cam, expectedMic, expectedCam) => {
    expect(deviceOutcomeOf(mic, cam)).toEqual({ mic: expectedMic, camOn: expectedCam });
  });
});

describe('FM06d 화면', () => {
  it('마이크만(카메라 꺼짐): 제목·부제·필수·정상·막대·스피커·다음·안내, 링은 없다', async () => {
    await render(<DeviceStepView {...props()} />);
    expect(text()).toContain('내 영상과 소리를 확인해요');
    expect(text()).toContain('마이크는 꼭 필요하고, 카메라와 스피커는 선택이에요.');
    expect(text()).toContain('필수');
    expect(text()).toContain('정상');
    expect(text()).toContain('말해 보세요. 막대가 움직이면 잘 들리는 거예요. 카메라를 켜면 코치와 다른 분들에게 내 모습이 보여요.');
    expect(text()).toContain('스피커');
    expect(text()).toContain('테스트음 듣기');
    expect(text()).toContain('마이크는 입장한 뒤에도 다시 켤 수 있어요.');
    expect(qa('[data-pz="flow-level"] i')).toHaveLength(10);
    expect(qa('circle[data-seg]')).toHaveLength(0);
    expect(btn('다음')!.disabled).toBe(false);
  });
  it('1:1 은 카메라 안내가 코치에게로 바뀐다', async () => {
    await render(<DeviceStepView {...props({ solo: true })} />);
    expect(text()).toContain('카메라를 켜면 코치에게 내 모습이 보여요.');
  });
  it('카메라 켜짐: 하나의 컴포넌트에 5단계 링, 가로 막대 없음. 조용해요 칩', async () => {
    await render(<DeviceStepView {...props({ cam: 'on', ringSteps: 3 })} />);
    expect(qa('circle[data-seg]')).toHaveLength(5);
    expect(qa('circle[data-seg][data-on="1"]')).toHaveLength(3);
    expect(qa('[data-pz="flow-level"]')).toHaveLength(0);
    await render(<DeviceStepView {...props({ cam: 'on', ringSteps: 1, quiet: true })} />);
    expect(text()).toContain('조용해요');
  });
  it('마이크 권한 거부: 안내·허용 방법 보기 → 시트, 그래도 다음은 활성', async () => {
    const onOpenHelp = vi.fn();
    await render(<DeviceStepView {...props({ mic: 'denied', onOpenHelp })} />);
    expect(text()).toContain('권한 필요');
    expect(text()).toContain('마이크 권한이 꺼져 있어요. 마이크 없이도 입장할 수 있어요. 입장한 뒤에 다시 켤 수 있어요.');
    await act(async () => { btn('마이크 허용 방법 보기')!.click(); });
    expect(onOpenHelp).toHaveBeenCalledWith('마이크');
    expect(btn('다음')!.disabled).toBe(false);
  });
  it('마이크 장치 없음은 권한 거부 문구가 아니다', async () => {
    await render(<DeviceStepView {...props({ mic: 'nodevice' })} />);
    expect(text()).toContain('마이크를 찾지 못했어요');
    expect(text()).toContain('장치가 연결됐는지 확인해 주세요');
    expect(text()).not.toContain('권한 필요');
    expect(btn('다시 확인하기')).toBeDefined();
  });
  it('카메라 거부: 마이크 칩은 정상, 카메라 안내', async () => {
    await render(<DeviceStepView {...props({ cam: 'denied' })} />);
    expect(text()).toContain('정상');
    expect(text()).toContain('카메라 권한이 꺼져 있어요. 카메라 없이도 참여할 수 있어요.');
    expect(btn('카메라 허용 방법 보기')).toBeDefined();
  });
  it('미지원 브라우저: 링크 복사 제공, 진행은 막지 않는다', async () => {
    const onCopyLink = vi.fn();
    await render(<DeviceStepView {...props({ mic: 'unsupported', cam: 'unsupported', onCopyLink })} />);
    expect(text()).toContain('이 브라우저에서는 마이크와 카메라를 쓸 수 없어요. Chrome 또는 Edge에서 열어 주세요.');
    await act(async () => { btn('링크 복사하기')!.click(); });
    expect(onCopyLink).toHaveBeenCalledTimes(1);
    expect(btn('다음')!.disabled).toBe(false);
  });
  it('마이크 권한은 토글(사용자 동작)으로만 요청한다 — 화면은 요청하지 않고 콜백만 부른다', async () => {
    const onToggleMic = vi.fn();
    await render(<DeviceStepView {...props({ mic: 'off', onToggleMic })} />);
    expect(onToggleMic).not.toHaveBeenCalled();
    await act(async () => { byLabel('마이크 켜기')!.click(); });
    expect(onToggleMic).toHaveBeenCalledTimes(1);
  });
  it('허용 방법 시트: 3단계 + 다시 확인하기', async () => {
    const onRecheck = vi.fn();
    await render(<DeviceStepView {...props({ mic: 'denied', helpDevice: '마이크', onRecheck })} />);
    expect(text()).toContain('마이크 허용 방법');
    expect(text()).toContain('주소창 왼쪽의 자물쇠 아이콘을 눌러요');
    expect(text()).toContain('마이크를 허용으로 바꿔요');
    expect(text()).toContain('화면을 새로고침한 뒤 다시 확인해요');
    expect(text()).toContain('스마트폰에서는 설정 앱의 브라우저 항목에서도 바꿀 수 있어요.');
    await act(async () => { btn('허용했어요, 다시 확인하기')!.click(); });
    expect(onRecheck).toHaveBeenCalledTimes(1);
  });
  it('시작 후 시트: 남은 준비는 기기', async () => {
    await render(<DeviceStepView {...props({ startedRemaining: ['기기'] })} />);
    expect(text()).toContain('코치가 클래스를 시작했어요');
    expect(text()).toContain('남은 준비: 기기');
  });
  it('코랄 경고색은 카메라 켜짐·마이크 정상 상태에 쓰지 않는다', async () => {
    await render(<DeviceStepView {...props({ cam: 'on' })} />);
    expect(qa('[data-tone="warn"]')).toHaveLength(0);
    await render(<DeviceStepView {...props()} />);
    expect(qa('[data-tone="warn"]')).toHaveLength(0);
  });
});
