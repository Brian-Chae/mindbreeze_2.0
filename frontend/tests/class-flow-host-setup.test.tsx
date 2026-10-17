// @vitest-environment jsdom
// SDD-209 H4 — FH05 세팅: 열기 결정(마이크 꺼짐 경고 도달) · 열 때 장비 값 · 화면 문구
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SetupFixture } from '../src/components/class/flow/host/SetupFixture';
import { decideOpen, resolveOpenPrefs, setupFootNote } from '../src/lib/class/flow/host-open';

describe('decideOpen — 마이크 꺼짐 경고 도달(현행에서 도달 불가였던 버그의 회귀 방지)', () => {
  it('온라인에서 마이크가 켜져 있지 않으면 확인 시트를 먼저 보인다', () => {
    for (const mic of ['off', 'denied', 'nodevice', 'inuse', 'unsupported', 'pending'] as const) {
      expect(decideOpen({ place: 'online', mic, cam: 'on' })).toBe('confirm-mic-off');
    }
    expect(decideOpen({ place: 'online', mic: 'on', cam: 'off' })).toBe('open');
  });

  it('오프라인은 마이크 UI 가 없어 경고 없이 연다', () => {
    expect(decideOpen({ place: 'offline', mic: 'off', cam: 'off' })).toBe('open');
  });
});

describe('resolveOpenPrefs', () => {
  it('오프라인은 카메라 없음을 명시하고(영상 녹화 시도 금지) 마이크는 이 기기 녹음용으로 켠다', () => {
    expect(resolveOpenPrefs({ place: 'offline', mic: 'off', cam: 'on' })).toEqual({ cameraOn: false, micOn: true });
    expect(resolveOpenPrefs({ place: 'offline', mic: 'off', cam: 'on' }, 'mic-off')).toEqual({ cameraOn: false, micOn: false });
  });

  it('온라인은 점검 화면의 실제 상태를 따르고, 시트 선택이 마이크를 덮어쓴다', () => {
    expect(resolveOpenPrefs({ place: 'online', mic: 'on', cam: 'on' })).toEqual({ cameraOn: true, micOn: true });
    expect(resolveOpenPrefs({ place: 'online', mic: 'off', cam: 'denied' })).toEqual({ cameraOn: false, micOn: false });
    expect(resolveOpenPrefs({ place: 'online', mic: 'off', cam: 'on' }, 'mic-on')).toEqual({ cameraOn: true, micOn: true });
    expect(resolveOpenPrefs({ place: 'online', mic: 'on', cam: 'on' }, 'mic-off')).toEqual({ cameraOn: true, micOn: false });
  });
});

describe('setupFootNote', () => {
  it('상태별 하단 안내(시안 문구)', () => {
    expect(setupFootNote('online', 'on', 'on', false)).toBe('열면 초대한 회원이 입장할 수 있어요');
    expect(setupFootNote('online', 'on', 'on', true)).toBe('소리가 작아요. 조금 더 크게 말해 보세요');
    expect(setupFootNote('online', 'on', 'off', false)).toBe('카메라 없이 소리만 열어요');
    expect(setupFootNote('online', 'off', 'on', false)).toBe('열 때 마이크를 한 번 더 확인해요');
    expect(setupFootNote('online', 'denied', 'on', false)).toBe('마이크 없이 열면 수동 기록이에요');
    expect(setupFootNote('online', 'on', 'denied', false)).toBe('카메라 없이도 열 수 있어요');
    expect(setupFootNote('online', 'nodevice', 'nodevice', false)).toBe('장비 없이 열면 수동 기록이에요');
    expect(setupFootNote('online', 'unsupported', 'unsupported', false)).toBe('Chrome이나 Edge를 권장해요');
    expect(setupFootNote('offline', 'off', 'off', false)).toBe('열면 초대한 회원에게 알려요');
  });
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(window, { matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }) });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const text = (): string => container.textContent ?? '';
const click = async (el: Element | null | undefined): Promise<void> => { await act(async () => { (el as HTMLElement).click(); }); };
const byText = (sel: string, t: string): HTMLElement | undefined => [...container.querySelectorAll<HTMLElement>(sel)].find((el) => el.textContent?.includes(t));
const mount = async (props: Parameters<typeof SetupFixture>[0]): Promise<void> => { await act(async () => root.render(createElement(SetupFixture, props))); };
const ONLINE_OK = { place: 'online' as const, backdropSrc: '', media: { mic: 'on' as const, cam: 'on' as const, level: 0.8, steps: 4, quiet: false } };

describe('FH05 화면', () => {
  it('정상: 제목·보조 줄·내 영상·소리·스피커·주 버튼 1개·하단 안내', async () => {
    await mount(ONLINE_OK);
    expect(text()).toContain('마음챙김 명상 · 4회차');
    expect(text()).toContain('장비 점검 · 오늘 오후 3:00 시작');
    expect(container.querySelector('[data-pz="flow-avcheck"]')).not.toBeNull();
    expect(text()).toContain('스피커');
    expect(text()).toContain('테스트음 듣기');
    expect(container.querySelectorAll('[data-pz="flow-cta"]')).toHaveLength(1);
    expect(byText('button', '클래스 열기')).toBeDefined();
    expect(text()).toContain('열면 초대한 회원이 입장할 수 있어요');
    expect(text()).toContain('정상');
  });

  it('조용해요 칩과 안내', async () => {
    await mount({ ...ONLINE_OK, media: { ...ONLINE_OK.media, level: 0.2, steps: 1, quiet: true } });
    expect(text()).toContain('조용해요');
    expect(text()).toContain('소리가 작아요. 조금 더 크게 말해 보세요');
  });

  it('마이크가 꺼져 있으면 힌트가 보이고, 열기를 누르면 확인 시트에 도달한다(3지선다)', async () => {
    await mount({ ...ONLINE_OK, media: { ...ONLINE_OK.media, mic: 'off', level: 0, steps: 0 } });
    expect(text()).toContain('꺼져 있어요. 켜지 않으면 녹음과 AI 기록지를 만들 수 없어요');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await click(container.querySelector('[data-pz="flow-cta"]'));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(text()).toContain('마이크가 꺼져 있어요');
    expect(text()).toContain('이대로 열면 음성 녹음과 AI 기록지를 만들 수 없어요.');
    for (const label of ['마이크 켜고 열기', '꺼진 채로 열기 (수동 기록)', '돌아가기']) expect(byText('button', label)).toBeDefined();
    await click(byText('button', '돌아가기'));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('마이크가 켜져 있으면 열기가 시트 없이 진행된다', async () => {
    await mount(ONLINE_OK);
    await click(container.querySelector('[data-pz="flow-cta"]'));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('권한 거부 안내', async () => {
    await mount({ ...ONLINE_OK, media: { ...ONLINE_OK.media, mic: 'denied', level: 0, steps: 0 } });
    expect(text()).toContain('권한 필요');
    expect(text()).toContain('주소창 왼쪽 설정에서 마이크를 허용해 주세요');
    expect(text()).toContain('마이크 없이 열면 수동 기록이에요');
  });

  it('장치 없음·미지원 브라우저', async () => {
    await mount({ ...ONLINE_OK, media: { ...ONLINE_OK.media, mic: 'nodevice', cam: 'nodevice', level: 0, steps: 0 } });
    expect(text()).toContain('연결된 카메라와 마이크가 없어요. 없이 열면 수동 기록이에요');
    await mount({ ...ONLINE_OK, media: { ...ONLINE_OK.media, mic: 'unsupported', cam: 'unsupported', level: 0, steps: 0 } });
    expect(text()).toContain('Chrome이나 Edge를 권장해요');
  });

  it('오프라인: 장비 점검 없이 장소·안내(내 영상·소리·스피커 DOM 0)', async () => {
    await mount({ place: 'offline', backdropSrc: '', media: { mic: 'off', cam: 'off', level: 0, steps: 0, quiet: false } });
    expect(text()).toContain('준비 · 오프라인 · 오늘 오후 3:00');
    expect(text()).toContain('서울 강남구 테헤란로 123 · 4층 명상실');
    expect(text()).toContain('오늘 오후 3:00 시작 예정');
    expect(text()).toContain('카메라와 마이크는 쓰지 않아요');
    expect(text()).toContain('대면 클래스라 장비 점검 없이 바로 열 수 있어요.');
    expect(text()).toContain('초대한 회원에게 알려요');
    expect(text()).toContain('LINK BAND는 선택이에요');
    expect(container.querySelector('[data-pz="flow-avcheck"]')).toBeNull();
    expect(text()).not.toContain('스피커');
    // 오프라인은 마이크 꺼짐이어도 시트 없이 연다
    return click(container.querySelector('[data-pz="flow-cta"]')).then(() => expect(container.querySelector('[role="dialog"]')).toBeNull());
  });

  it('초대 알림은 요청이라고만 말한다(전달·수신 단정 0)', async () => {
    await mount({ place: 'offline', backdropSrc: '', media: { mic: 'off', cam: 'off', level: 0, steps: 0, quiet: false } });
    expect(text()).not.toMatch(/전달됐|받았|수신/);
  });
});
