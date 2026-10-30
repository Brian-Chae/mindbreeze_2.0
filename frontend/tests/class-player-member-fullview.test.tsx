// @vitest-environment jsdom
// SDD-208 M4 — 회원 전체 화면 상태·네트워크: M18 재연결 배너 · M19 끊김 카드 · M20 대기열 · M21 종료
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

async function mount(id: string, override: Partial<MemberClassViewProps> = {}): Promise<MemberClassViewProps['actions']> {
  const props = memberCaseViewProps(id);
  const actions = Object.fromEntries(Object.keys(props.actions).map((k) => [k, vi.fn()])) as unknown as MemberClassViewProps['actions'];
  const merged = { ...actions, ...override.actions };
  await render(<MemberClassView {...props} {...override} actions={merged} />);
  return merged;
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

describe('M18 네트워크 재연결 중', () => {
  it('상단 코랄 배너 + 연결 표시 "재연결 중" + 코치 PiP 정지, 링·도크는 유지', async () => {
    await mount('M18');
    const banner = q('[data-pz="banner"]');
    expect(banner?.getAttribute('data-tone')).toBe('coral');
    expect(banner?.textContent).toContain('연결이 불안정해요');
    expect(banner?.textContent).toContain('· 다시 연결 중이에요');
    expect(banner?.querySelector('svg')).not.toBeNull();
    expect(q('[data-pz="conn"]')?.getAttribute('aria-label')).toBe('재연결 중');
    expect(q('[data-pz="pip"]')?.textContent).toContain('영상 멈춤');
    expect(q('[data-pz="ring"]')).not.toBeNull();
    expect(qa('[data-pz="dk"]')).toHaveLength(5);
    expect(q('[data-pz="net-down"]')).toBeNull();
  });
  it('정상일 때는 배너·"영상 멈춤"이 없다', async () => {
    await mount('M01');
    expect(q('[data-pz="banner"]')).toBeNull();
    expect(q('[data-pz="pip"]')?.textContent).not.toContain('영상 멈춤');
  });
});

describe('M19 네트워크 끊김 — 화면 중앙 전체 안내', () => {
  it('제목·안내·밴드 데이터 보관 문구·[다시 연결], 링·추이·미디어 줄은 숨긴다', async () => {
    const actions = await mount('M19');
    const card = q('[data-pz="net-down"]');
    expect(card?.textContent).toContain('연결이 끊겼어요');
    expect(card?.textContent).toContain('인터넷 연결을 확인하고 다시 시도해 주세요.');
    expect(card?.textContent).toContain('밴드로 측정한 데이터는 이 기기에 안전하게 보관 중이에요. 연결되면 이어서 기록돼요.');
    expect(q('[data-pz="conn"]')?.getAttribute('aria-label')).toBe('연결 끊김');
    for (const hidden of ['ring', 'guide', 'trend', 'media-row', 'pip', 'mypip']) expect(q(`[data-pz="${hidden}"]`), hidden).toBeNull();
    await act(async () => { buttonByText('다시 연결')?.click(); });
    expect(actions.onNetRetry).toHaveBeenCalledTimes(1);
  });
  it('보관할 밴드 데이터가 없으면(pendingCount=0) 보관 문구를 빼고 안내만 보여 준다', async () => {
    const base = memberCaseViewProps('M19');
    await mount('M19', { device: { ...base.device, pendingCount: 0 } });
    expect(q('[data-pz="net-down"]')?.textContent).not.toContain('안전하게 보관 중이에요');
    expect(q('[data-pz="net-down"]')?.textContent).toContain('인터넷 연결을 확인하고 다시 시도해 주세요.');
  });
  it('끊김 카드에도 도크는 남아 시트를 열 수 있다', async () => {
    await mount('M19');
    expect(qa('[data-pz="dk"]')).toHaveLength(5);
  });
});

describe('M20 대기열', () => {
  it('전체 화면 카드: 제목·안내·수업/코치/시작 정보, 상단 바·도크는 없다', async () => {
    await mount('M20');
    const card = q('[data-pz="fv-card"]');
    expect(card?.querySelector('h2')?.textContent).toBe('대기 중이에요');
    expect(card?.textContent).toMatch(/자리가 나면 자동으로 입장해요\.\s*이 화면을 열어 둬 주세요\./);
    const rows = qa('[data-pz="fv-card"] .mp-fv-info div').map((d) => d.textContent);
    expect(rows).toEqual(['수업마음챙김 명상수업 · 4회차', '코치채용욱 코치', '시작14:00']);
    for (const hidden of ['topbar', 'dock', 'ring', 'sheet']) expect(q(`[data-pz="${hidden}"]`), hidden).toBeNull();
  });
  it('로그인 회원에게만 푸시 안내 문구를 보여 준다(게스트는 알림이 없다)', async () => {
    await mount('M20');
    expect(q('[data-pz="fv-card"]')?.textContent).toContain('입장 알림은 이 기기와 푸시로 보내 드려요.');
    const base = memberCaseViewProps('M20');
    await mount('M20', { waitlist: { ...base.waitlist!, notifyByPush: false } });
    expect(q('[data-pz="fv-card"]')?.textContent).not.toContain('푸시');
  });
  it('[대기열에서 나가기] → onWaitlistLeave', async () => {
    const actions = await mount('M20');
    await act(async () => { buttonByText('대기열에서 나가기')?.click(); });
    expect(actions.onWaitlistLeave).toHaveBeenCalledTimes(1);
  });
  it('코치·시작 시각이 없으면 해당 줄을 그리지 않는다', async () => {
    const base = memberCaseViewProps('M20');
    await mount('M20', { waitlist: { ...base.waitlist!, counselorName: null, startLabel: null } });
    expect(qa('[data-pz="fv-card"] .mp-fv-info div').map((d) => d.textContent)).toEqual(['수업마음챙김 명상수업 · 4회차']);
  });
});

describe('M21 종료', () => {
  it('"수고하셨어요" + 리포트 안내, 점수·퍼센트 숫자는 어디에도 없다', async () => {
    await mount('M21');
    const card = q('[data-pz="fv-card"]');
    expect(card?.querySelector('h2')?.textContent).toBe('수고하셨어요');
    expect(card?.textContent).toContain('리포트는 준비되면 메일로 보내 드려요.');
    expect(qa('[data-pz="fv-card"] .mp-fv-info div').map((d) => d.textContent)).toEqual([
      '수업마음챙김 명상수업 · 4회차',
      '함께한 시간30분',
      '리포트준비되면 메일 발송',
    ]);
    expect(card?.textContent).toContain('AI 기록과 리포트를 만드는 데 몇 분 걸릴 수 있어요.');
    expect(text()).not.toMatch(/\d+\s*%/);
    expect(text()).not.toMatch(/점수|평균|순위|그룹/);
    expect(text()).not.toMatch(/\p{Extended_Pictographic}/u);
  });
  it('이동 버튼 라벨은 회원 "대시보드로 이동" · 게스트 "홈으로"(호출부가 정한다)', async () => {
    const actions = await mount('M21');
    await act(async () => { buttonByText('대시보드로 이동')?.click(); });
    expect(actions.onEndAction).toHaveBeenCalledTimes(1);
    const base = memberCaseViewProps('M21');
    await mount('M21', { end: { ...base.end!, actionLabel: '홈으로' } });
    expect(buttonByText('홈으로')).toBeDefined();
  });
  it('D5: [리포트 받기]·[오늘 상태 남기기] 는 기존 패널을 시트로 연다(패널을 넘긴 경우에만 버튼 노출)', async () => {
    const base = memberCaseViewProps('M21');
    await mount('M21', {
      end: { ...base.end!, reportPanel: <p data-testid="report-panel">리포트 신청 폼</p>, checkinPanel: <p data-testid="checkin-panel">사후 체크인</p> },
    });
    expect(q('[data-testid="report-panel"]')).toBeNull();
    await act(async () => { buttonByText('리포트 받기')?.click(); });
    expect(q('[data-pz="sheet"]')?.getAttribute('aria-label')).toBe('리포트 받기');
    expect(q('[data-pz="sheet"] [data-testid="report-panel"]')).not.toBeNull();
    await act(async () => { q<HTMLButtonElement>('[data-pz="sheet"] button[aria-label="닫기"]')?.click(); });
    expect(q('[data-pz="sheet"]')).toBeNull();
    await act(async () => { buttonByText('오늘 상태 남기기')?.click(); });
    expect(q('[data-pz="sheet"]')?.getAttribute('aria-label')).toBe('오늘 상태 남기기');
    expect(q('[data-pz="sheet"] [data-testid="checkin-panel"]')).not.toBeNull();
  });
  it('패널을 넘기지 않으면 D5 버튼은 그리지 않는다', async () => {
    const base = memberCaseViewProps('M21');
    await mount('M21', { end: { ...base.end!, reportPanel: undefined, checkinPanel: undefined } });
    expect(buttonByText('리포트 받기')).toBeUndefined();
    expect(buttonByText('오늘 상태 남기기')).toBeUndefined();
  });
});

describe('전체 화면 공통', () => {
  it.each(['M20', 'M21'])('%s: 카드 하나가 화면 중앙에 놓이는 구조(fv-card)이고 측정 훅이 있다', async (id) => {
    await mount(id);
    expect(qa('[data-pz="fv-card"]')).toHaveLength(1);
    expect(q('[data-pz="app"]')).not.toBeNull();
  });
  it.each(['M19', 'M20', 'M21'])('%s: 호흡 지시·비교 문구 없음', async (id) => {
    await mount(id);
    expect(text()).not.toMatch(/호흡에 집중|숨을 (들이|내쉬)|들이쉬|내쉬|호흡하세요|천천히 호흡|심호흡/);
    expect(text()).not.toMatch(/그룹|평균|순위|상위|하위|종합|총점|점수/);
  });
});
