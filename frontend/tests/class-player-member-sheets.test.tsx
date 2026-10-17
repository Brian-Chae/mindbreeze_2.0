// @vitest-environment jsdom
// SDD-208 M3 — 회원 도크·시트 5종(내 상태·채팅·조용한 신호·소리·기기)·오프라인 현장 안내
import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberClassView, type MemberClassViewProps } from '../src/components/class/player/member/MemberClassView';
import { MemberCaseDemo } from '../src/components/class/player/member/MemberCaseDemo';
import { memberCaseViewProps } from '../src/lib/class/fixtures/member-cases';
import type { MemberSheetKey } from '../src/components/class/player/member/member-view-types';

let root: Root;
let container: HTMLDivElement;

async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(node); });
}
const q = <T extends Element = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
const qa = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const text = (): string => document.body.textContent ?? '';
const sheetEl = (): HTMLElement | null => q('[data-pz="sheet"]');
const buttonByText = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
const dockButton = (label: string): HTMLButtonElement | undefined =>
  qa('[data-pz="dk"]').find((b) => b.querySelector('.pz-dk__label')?.textContent === label) as HTMLButtonElement | undefined;

type Override = Partial<MemberClassViewProps>;

async function mount(id: string, sheet: MemberSheetKey | null, override: Override = {}): Promise<MemberClassViewProps['actions']> {
  const props = memberCaseViewProps(id);
  const actions = Object.fromEntries(Object.keys(props.actions).map((k) => [k, vi.fn()])) as unknown as MemberClassViewProps['actions'];
  actions.onSignal = vi.fn(() => 'sent');
  const merged = { ...actions, ...override.actions };
  await render(<MemberClassView {...props} {...override} sheet={sheet} actions={merged} />);
  return merged;
}

/** 시트 열기·닫기 상호작용용 — 상태를 가진 데모 래퍼 */
async function mountDemo(id: string, sheet: MemberSheetKey | null = null): Promise<void> {
  const props = memberCaseViewProps(id);
  await render(<MemberCaseDemo initial={{ ...props, sheet }} />);
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

describe('도크 ↔ 시트 — 동시에 1개, 닫기, 접근성', () => {
  it('도크 항목을 누르면 해당 시트가 열리고 다시 누르면 닫힌다', async () => {
    await mountDemo('M01');
    expect(sheetEl()).toBeNull();
    await act(async () => { dockButton('내 상태')?.click(); });
    expect(sheetEl()?.getAttribute('aria-label')).toBe('내 상태');
    expect(dockButton('내 상태')?.getAttribute('aria-pressed')).toBe('true');
    expect(q('[data-pz="app"]')?.getAttribute('data-sheet-open')).toBe('true');
    await act(async () => { dockButton('내 상태')?.click(); });
    expect(sheetEl()).toBeNull();
    expect(q('[data-pz="app"]')?.getAttribute('data-sheet-open')).toBe('false');
  });
  it('다른 도크 항목을 누르면 시트가 바뀐다(동시에 1개)', async () => {
    await mountDemo('M01');
    await act(async () => { dockButton('내 상태')?.click(); });
    await act(async () => { dockButton('소리')?.click(); });
    expect(qa('[data-pz="sheet"]')).toHaveLength(1);
    expect(sheetEl()?.getAttribute('aria-label')).toBe('소리');
  });
  it('시트는 role=dialog + aria-modal + 라벨, Esc·닫기 버튼으로 닫힌다', async () => {
    await mountDemo('M01', 'signal');
    expect(sheetEl()?.getAttribute('role')).toBe('dialog');
    expect(sheetEl()?.getAttribute('aria-modal')).toBe('true');
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(sheetEl()).toBeNull();
    await act(async () => { dockButton('조용한 신호')?.click(); });
    await act(async () => { q<HTMLButtonElement>('[data-pz="sheet"] button[aria-label="닫기"]')?.click(); });
    expect(sheetEl()).toBeNull();
  });
  it('시트가 열리면 상단 바·본문만 inert, 도크는 계속 눌린다', async () => {
    await mountDemo('M01', 'chat');
    expect(q('.pz-shell__top')?.hasAttribute('inert')).toBe(true);
    expect(q('.pz-shell__stage')?.hasAttribute('inert')).toBe(true);
    expect(q('.pz-shell__dock')?.hasAttribute('inert')).toBe(false);
  });
  it('도크에 없는 시트(오프라인의 조용한 신호)는 열지 않는다', async () => {
    await mount('M05', 'signal');
    expect(sheetEl()).toBeNull();
  });
});

describe('내 상태 시트 — 6지표 2×3 격자', () => {
  it('MIND 3 + BODY 3, 현재 지표가 눌림 상태이고 값·단위가 보인다', async () => {
    await mount('M01', 'status');
    const cells = qa('[data-pz="mcell"]');
    expect(cells.map((c) => c.querySelector('.mp-mcell__label')?.textContent)).toEqual(['집중도', '이완도', '감정균형도', 'BPM', '호흡', 'HRV']);
    expect(cells.map((c) => c.querySelector('.mp-mring__mv b')?.textContent)).toEqual(['58', '72', '64', '68', '11', '52']);
    expect(cells.map((c) => c.querySelector('.mp-mring__mv i')?.textContent)).toEqual(['%', '%', '%', 'bpm', '회/분', 'ms']);
    expect(cells.filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.querySelector('.mp-mcell__label')?.textContent)).toEqual(['이완도']);
    expect(text()).toContain('마음');
    expect(text()).toContain('몸');
    expect(text()).toContain('눌러서 가운데 링에 보여 드려요');
  });
  it('지표를 누르면 가운데 링 지표가 바뀐다(onHeroChange)', async () => {
    const actions = await mount('M01', 'status');
    await act(async () => { qa('[data-pz="mcell"]')[3].click(); });
    expect(actions.onHeroChange).toHaveBeenCalledWith('bpm');
  });
  it('값이 아직 없으면 "—" 로 표시한다(빈 칸 금지)', async () => {
    const base = memberCaseViewProps('M01');
    await mount('M01', 'status', { snapshot: { ...base.snapshot, hrv: null } });
    expect(qa('[data-pz="mcell"]')[5].querySelector('.mp-mring__mv b')?.textContent).toBe('—');
  });
  it.each([
    ['M07', '밴드 없이 참여 중이에요', 'LINK BAND를 연결하면 내 몸과 마음의 상태를 볼 수 있어요.', '기기에서 연결하기'],
    ['M08', '밴드를 연결하는 중이에요', '연결되면 내 상태가 여기에 나타나요.', '기기에서 보기'],
    ['M10', '접촉을 확인해 주세요', '밴드가 피부에 닿으면 상태가 다시 나타나요.', '확인 방법 보기'],
    ['M11', '다시 연결하는 중이에요', '연결되면 이어서 보여 드려요.', '기기에서 보기'],
    ['M13', '밴드 없이 참여 중이에요', 'Chrome 또는 Edge로 열면 내 상태를 볼 수 있어요.', '기기에서 보기'],
  ])('%s: 지표 대신 안내 카드("%s") + 기기 시트로 가는 버튼', async (id, title, body, action) => {
    const actions = await mount(id, 'status');
    expect(qa('[data-pz="mcell"]')).toHaveLength(0);
    expect(q('.mp-empty h3')?.textContent).toBe(title);
    expect(q('.mp-empty p')?.textContent).toBe(body);
    await act(async () => { buttonByText(action)?.click(); });
    expect(actions.onSheetChange).toHaveBeenCalledWith('device');
  });
  it.each(['M09', 'M12'])('%s: 신호 약함·배터리 부족에서도 지표 격자는 그대로', async (id) => {
    await mount(id, 'status');
    expect(qa('[data-pz="mcell"]')).toHaveLength(6);
  });
});

describe('채팅 시트', () => {
  it('상담사가 채팅을 켠 회원: 시트 본문에 채팅(node)이 들어가고 도크에 안읽음 배지', async () => {
    const node = <p data-testid="chat-node">채팅방</p>;
    await mount('M01', 'chat', { chat: { enabled: true, authenticated: true, unread: 2, node } });
    expect(sheetEl()?.querySelector('[data-testid="chat-node"]')).not.toBeNull();
    expect(q('.pz-dk__badge')?.textContent).toBe('2');
  });
  it('시트가 닫혀 있어도 채팅 node 는 계속 마운트된다(안읽음 집계 유지)', async () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    function Probe() {
      useEffect(() => {
        mounted();
        return unmounted;
      }, []);
      return <p data-testid="chat-node">채팅방</p>;
    }
    await mount('M01', null, { chat: { enabled: true, authenticated: true, unread: 0, node: <Probe /> } });
    expect(q('[data-testid="chat-node"]')).not.toBeNull();
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(q('[data-testid="chat-node"]')?.closest('[data-pz="sheet"]')).toBeNull();
  });
  it('게스트: 회원 전용 안내(가입 링크)', async () => {
    await mount('M01', 'chat', { chat: { enabled: true, authenticated: false, unread: 0, node: null } });
    expect(sheetEl()?.textContent).toContain('채팅은 회원 전용이에요');
    expect(sheetEl()?.querySelector('a[href="/register/client"]')?.textContent).toBe('회원가입 하기');
  });
  it('채팅이 꺼져 있으면 안내 문구, 배지는 없다', async () => {
    await mount('M01', 'chat', { chat: { enabled: false, authenticated: true, unread: 5, node: null } });
    expect(sheetEl()?.textContent).toContain('상담사가 채팅을 켜면 여기에서 대화할 수 있어요.');
    expect(q('.pz-dk__badge')).toBeNull();
  });
});

describe('조용한 신호 시트', () => {
  it('기존 QuietSignalButtons 를 재사용 — 3개 버튼, 누르면 onSignal', async () => {
    const actions = await mount('M01', 'signal');
    const labels = qa('[data-pz="sheet"] .player-signal').map((b) => b.textContent);
    expect(labels).toEqual(['잘 따라가요', '조금 어려워요', '잠시 쉴게요']);
    await act(async () => { qa('[data-pz="sheet"] .player-signal')[0].click(); });
    expect(actions.onSignal).toHaveBeenCalledWith('following');
    expect(sheetEl()?.textContent).toContain('지금 상태를 조용히 알려 주세요 · 상담사에게만 보여요');
    expect(sheetEl()?.textContent).toContain('상담사에게 조용히 전달했어요');
  });
});

describe('소리 시트(D3: BGM 행 없음)', () => {
  it('온라인: 가이드 이름·볼륨·상담사 음성 스위치·화면 끄기', async () => {
    const actions = await mount('M01', 'sound');
    expect(sheetEl()?.textContent).toContain('고요한 숲의 아침');
    expect(sheetEl()?.textContent).toContain('60%');
    const slider = q<HTMLInputElement>('[data-pz="sheet"] input[type="range"]');
    expect(slider?.getAttribute('aria-label')).toBe('볼륨');
    expect(slider?.value).toBe('60');
    const sw = q('[data-pz="sheet"] [role="switch"]');
    expect(sw?.getAttribute('aria-label')).toBe('상담사 음성 듣기');
    expect(sw?.getAttribute('aria-checked')).toBe('true');
    await act(async () => { (sw as HTMLButtonElement).click(); });
    expect(actions.onSpeakerChange).toHaveBeenCalledWith(false);
    await act(async () => { buttonByText('화면 끄기')?.click(); });
    expect(actions.onScreenOff).toHaveBeenCalledTimes(1);
  });
  it('볼륨 슬라이더 변경 → onVolumeChange(0~1)', async () => {
    const actions = await mount('M01', 'sound');
    const slider = q<HTMLInputElement>('[data-pz="sheet"] input[type="range"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(slider, '35');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(actions.onVolumeChange).toHaveBeenCalledWith(0.35);
  });
  it('BGM 행은 두지 않는다 — "BGM" 문구 0', async () => {
    await mount('M01', 'sound');
    expect(sheetEl()?.textContent).not.toMatch(/BGM|배경음/);
  });
  it('자동재생이 막혀 있으면 [소리 켜기]', async () => {
    const base = memberCaseViewProps('M01');
    const actions = await mount('M01', 'sound', { sound: { ...base.sound, blocked: true } });
    await act(async () => { buttonByText('소리 켜기')?.click(); });
    expect(actions.onResumeAudio).toHaveBeenCalledTimes(1);
  });
  it('재생 중인 가이드가 없으면 카드 대신 안내', async () => {
    const base = memberCaseViewProps('M01');
    await mount('M01', 'sound', { sound: { ...base.sound, trackTitle: null } });
    expect(sheetEl()?.textContent).toContain('지금은 재생 중인 소리가 없어요');
  });
  it('오프라인: 이 기기에서는 소리가 나지 않는다는 안내와 화면 끄기만(스위치·슬라이더 없음)', async () => {
    await mount('M05', 'sound');
    expect(q('[data-pz="sheet"] input[type="range"]')).toBeNull();
    expect(q('[data-pz="sheet"] [role="switch"]')).toBeNull();
    expect(sheetEl()?.textContent).toContain('같은 공간의 스피커로 함께 들어요');
    expect(buttonByText('화면 끄기')).toBeDefined();
  });
});

describe('기기 시트 — 밴드 상태별', () => {
  it('on: 연결됨 · N분째, 배터리·신호·접촉, 원시 데이터, [연결 해제]', async () => {
    const actions = await mount('M01', 'device');
    expect(sheetEl()?.textContent).toContain('LINK BAND 2.0');
    expect(sheetEl()?.textContent).toContain('연결됨 · 12분째');
    const stats = qa('[data-pz="sheet"] .mp-stat').map((s) => s.textContent);
    expect(stats).toEqual(['배터리82%', '신호좋음', '접촉양호']);
    expect(q('[data-pz="sheet"] .mp-raw svg')).not.toBeNull();
    await act(async () => { buttonByText('연결 해제')?.click(); });
    expect(actions.onBandDisconnect).toHaveBeenCalledTimes(1);
  });
  it('weak·low: 부족 표시는 주의색 + 텍스트', async () => {
    await mount('M09', 'device');
    expect(sheetEl()?.textContent).toContain('신호 약함 · 접촉을 확인해 주세요');
    expect(q('[data-pz="sheet"] .mp-stat b[data-warn="true"]')).not.toBeNull();
    await mount('M12', 'device');
    expect(sheetEl()?.textContent).toContain('배터리 부족 · 15%');
    expect(qa('[data-pz="sheet"] .mp-stat')[0].textContent).toBe('배터리15%');
  });
  it('leadoff(M10): 제목 "접촉 확인" · 3단계 · [접촉 다시 확인] — 전체 화면 모달이 아니다', async () => {
    const actions = await mount('M10', 'device');
    expect(sheetEl()?.getAttribute('aria-label')).toBe('접촉 확인');
    expect(qa('[data-pz="sheet"] ol li').map((li) => li.textContent)).toEqual([
      '밴드를 이마 중앙에 맞춰 주세요',
      '머리카락이 센서에 닿지 않게 정리해 주세요',
      '센서 부분을 마른 천으로 닦아 주세요',
    ]);
    expect(sheetEl()?.textContent).toContain('접촉이 확인되지 않아요');
    expect(sheetEl()?.textContent).toContain('밴드가 피부에 닿지 않았어요');
    expect(qa('[aria-modal="true"]')).toHaveLength(1);
    await act(async () => { buttonByText('접촉 다시 확인')?.click(); });
    expect(actions.onBandRecheck).toHaveBeenCalledTimes(1);
  });
  it('pending(M08): 3점 순차 페이드 · [연결 취소]', async () => {
    const actions = await mount('M08', 'device');
    expect(qa('[data-pz="sheet"] .mp-dots i')).toHaveLength(3);
    expect(sheetEl()?.textContent).toContain('밴드 전원이 켜져 있는지, 가까이에 있는지 확인해 주세요.');
    await act(async () => { buttonByText('연결 취소')?.click(); });
    expect(actions.onBandCancel).toHaveBeenCalledTimes(1);
  });
  it('lost(M11): 자동 재연결 안내 + [수동으로 다시 연결]', async () => {
    const actions = await mount('M11', 'device');
    expect(sheetEl()?.textContent).toContain('연결이 끊겼어요');
    expect(sheetEl()?.textContent).toContain('끊긴 동안 측정된 값은 이 기기에 보관돼요. 연결되면 이어서 기록해요.');
    await act(async () => { buttonByText('수동으로 다시 연결')?.click(); });
    expect(actions.onBandRetry).toHaveBeenCalledTimes(1);
  });
  it('unsupported(M13): 브라우저 안내 + [밴드 없이 계속]', async () => {
    const actions = await mount('M13', 'device');
    expect(sheetEl()?.textContent).toContain('이 브라우저에서는 연결이 안 돼요');
    expect(sheetEl()?.textContent).toContain('Chrome 또는 Edge로 열면 연결할 수 있어요. 지금은 밴드 없이도 수업에 참여할 수 있어요.');
    await act(async () => { buttonByText('밴드 없이 계속')?.click(); });
    expect(actions.onBandContinue).toHaveBeenCalledTimes(1);
  });
  it('off(M07): 연결된 기기 없음 + [LINK BAND 연결], 시뮬레이션이면 라벨이 바뀐다', async () => {
    const actions = await mount('M07', 'device');
    expect(sheetEl()?.textContent).toContain('연결된 기기 없음');
    await act(async () => { buttonByText('LINK BAND 연결')?.click(); });
    expect(actions.onBandConnect).toHaveBeenCalledTimes(1);
    const base = memberCaseViewProps('M07');
    await mount('M07', 'device', { device: { ...base.device, isMock: true } });
    expect(buttonByText('시뮬레이션 시작')).toBeDefined();
  });
  it('접촉 복구 직후 15초 "AI 분석중", 밴드 오류는 alert 로', async () => {
    const base = memberCaseViewProps('M01');
    await mount('M01', 'device', { device: { ...base.device, analyzing: true, error: '블루투스 연결에 실패했어요' } });
    expect(sheetEl()?.textContent).toContain('AI 분석중');
    expect(q('[data-pz="sheet"] [role="alert"]')?.textContent).toBe('블루투스 연결에 실패했어요');
  });
});

describe('오프라인 현장 안내(M05·M06)', () => {
  it('M05: 현장 카드 + 링 + 안내 칩 + 추이, 영상·마이크·카메라 UI 없음, 도크 4개', async () => {
    await mount('M05', null);
    expect(q('[data-pz="side-card"]')?.textContent).toContain('현장 수업 중이에요');
    expect(q('[data-pz="side-card"]')?.textContent).toContain('고요한 숲의 아침 재생 중');
    expect(q('[data-pz="pip"]')).toBeNull();
    expect(q('[data-pz="mypip"]')).toBeNull();
    expect(q('[data-pz="media-row"]')).toBeNull();
    expect(text()).not.toMatch(/마이크|카메라|손들기/);
    expect(qa('[data-pz="dk"]').map((el) => el.querySelector('.pz-dk__label')?.textContent)).toEqual(['내 상태', '채팅', '소리', '기기']);
    expect(q('[data-pz="app"]')?.getAttribute('data-place')).toBe('offline');
  });
  it('현장 카드 [소리] → 소리 시트', async () => {
    const actions = await mount('M05', null);
    await act(async () => { buttonByText('소리')?.click(); });
    expect(actions.onSheetChange).toHaveBeenCalledWith('sound');
  });
  it('재생 중인 소리가 없으면 보조 문구가 달라진다', async () => {
    const base = memberCaseViewProps('M05');
    await mount('M05', null, { sound: { ...base.sound, onsiteLabel: null } });
    expect(q('[data-pz="side-card"]')?.textContent).toContain('같은 공간에서 함께하고 있어요');
  });
  it('체크인 칩: 서버 저장 API 가 있을 때만(onCheckin 제공) 그리고, 선택은 눌림 상태로 표시', async () => {
    const actions = await mount('M05', null, { checkin: 'comfortable' });
    const chips = qa('[data-pz="side-card"] .mp-chip-btn');
    expect(chips.map((c) => c.textContent)).toEqual(['편안해요', '보통이에요', '무거워요']);
    expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    await act(async () => { chips[1].click(); });
    expect(actions.onCheckin).toHaveBeenCalledWith('normal');
    const base = memberCaseViewProps('M05');
    await mount('M05', null, { actions: { ...base.actions, onCheckin: undefined } });
    expect(q('[data-pz="side-card"]')?.textContent).not.toContain('지금 기분은 어떤가요?');
    expect(qa('[data-pz="side-card"] .mp-chip-btn')).toHaveLength(0);
  });
  it('M06: 무밴드 오프라인 — 링 안내·밴드 연결 슬롯·현장 카드, 코랄 요소 없음', async () => {
    await mount('M06', null);
    expect(q('[data-pz="ring"]')?.textContent).toMatch(/밴드 없이\s*참여 중이에요/);
    expect(q('[data-pz="info-card"]')?.textContent).toContain('원하시면 기기에서 LINK BAND를 연결할 수 있어요.');
    expect(q('[data-pz="side-card"]')).not.toBeNull();
    expect(qa('[data-tone="coral"]')).toHaveLength(0);
  });
});

describe('D7 linkband_mode=none — 밴드 UI 전체 숨김', () => {
  it('도크는 채팅·조용한 신호·소리만, 링 자리는 수업 안내', async () => {
    const base = memberCaseViewProps('M01');
    await mount('M01', null, { input: { ...base.input, bandEnabled: false } });
    expect(qa('[data-pz="dk"]').map((el) => el.querySelector('.pz-dk__label')?.textContent)).toEqual(['채팅', '조용한 신호', '소리']);
    expect(q('[data-pz="ring"]')?.textContent).toMatch(/함께하는\s*수업이에요/);
    expect(q('[data-pz="info-card"]')).toBeNull();
    expect(q('[data-pz="trend"]')).toBeNull();
  });
});

describe('금지 요소 — 모든 케이스 × 시트 전체 텍스트', () => {
  const SHEETS: MemberSheetKey[] = ['status', 'chat', 'signal', 'sound', 'device'];
  const LIVE = Array.from({ length: 19 }, (_, i) => `M${String(i + 1).padStart(2, '0')}`);
  it.each(LIVE)('%s', async (id) => {
    for (const key of SHEETS) {
      await mount(id, key);
      const all = text();
      expect(all, `${id}/${key}`).not.toMatch(/호흡에 집중|숨을 (들이|내쉬)|들이쉬|내쉬|호흡하세요|천천히 호흡|심호흡/);
      expect(all, `${id}/${key}`).not.toMatch(/그룹|평균|순위|상위|하위|종합|총점|점수/);
      expect(all, `${id}/${key}`).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
  it('아이콘 전용 버튼에는 aria-label 이 있다(X7)', async () => {
    await mount('M01', 'status');
    for (const b of qa('button')) {
      const hasText = (b.textContent ?? '').trim().length > 0;
      expect(hasText || b.getAttribute('aria-label'), b.outerHTML.slice(0, 80)).toBeTruthy();
    }
  });
});
