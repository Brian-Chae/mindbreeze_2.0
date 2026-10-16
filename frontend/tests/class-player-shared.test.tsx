// @vitest-environment jsdom
// SDD-208 T2 — 클래스 진행 화면 공용 UI 프리미티브(시트 분기·도크·링·배너·토큰·채팅 임베드)
import { act, createElement, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSideSheet } from '../src/components/class/player/shared/sheet-mode';
import { PlayerSheet } from '../src/components/class/player/shared/PlayerSheet';
import { PlayerDock, type DockItem } from '../src/components/class/player/shared/PlayerDock';
import { StatusRing } from '../src/components/class/player/shared/StatusRing';
import { NoticeBanner } from '../src/components/class/player/shared/NoticeBanner';
import { NoticeOverlay } from '../src/components/class/player/shared/NoticeOverlay';
import { IconCircleButton } from '../src/components/class/player/shared/IconCircleButton';
import { PlayerTopBar } from '../src/components/class/player/shared/PlayerTopBar';
import { PlayerShell } from '../src/components/class/player/shared/PlayerShell';
import { PlayerBackdrop } from '../src/components/class/player/shared/PlayerBackdrop';
import { ClassChatPanel } from '../src/components/chat/ClassChatPanel';
import { useAuthStore } from '../src/stores/authStore';
import { useChatStore } from '../src/stores/chatStore';
import { getChatRoom, getSessionChatRoom, type ChatRoom } from '../src/lib/api/chat';

vi.mock('../src/components/chat/ChatRoom', () => ({
  ChatRoom: ({ roomId }: { roomId: string }) => `CHAT_ROOM:${roomId}`,
}));
vi.mock('../src/lib/api/chat', () => ({ getChatRoom: vi.fn(), getSessionChatRoom: vi.fn() }));
vi.mock('../src/lib/socket', () => ({
  getChatSocket: vi.fn(() => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() })),
}));

let root: Root;
let container: HTMLDivElement;

async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(node); });
}
async function setViewport(width: number, height: number): Promise<void> {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  await act(async () => { window.dispatchEvent(new Event('resize')); });
}
const q = <T extends Element = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

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

describe('isSideSheet — 시트 분기 판정(균형.md S5, 한 곳)', () => {
  it.each([
    [390, 844, false],
    [834, 1194, false],
    [1194, 834, true],
    [1280, 720, true],
    [1000, 800, true],
    [999, 500, false],
    [1000, 1000, false],
    [1100, 1400, false],
  ])('%i×%i → 사이드=%s', (vw, vh, expected) => {
    expect(isSideSheet(vw, vh)).toBe(expected);
  });
});

describe('PlayerSheet', () => {
  it.each([
    [390, 844, 'bottom'],
    [834, 1194, 'bottom'],
    [1194, 834, 'side'],
    [1280, 720, 'side'],
  ])('%i×%i 에서는 %s 시트', async (vw, vh, mode) => {
    await setViewport(vw, vh);
    await render(<PlayerSheet open title="내 상태" onClose={() => undefined}>본문</PlayerSheet>);
    const sheet = q('[data-pz="sheet"]');
    expect(sheet).not.toBeNull();
    expect(sheet?.getAttribute('data-mode')).toBe(mode);
  });

  it('열려 있는 동안 창 크기가 바뀌면 분기가 따라간다(태블릿 회전)', async () => {
    await setViewport(834, 1194);
    await render(<PlayerSheet open title="채팅" onClose={() => undefined}>본문</PlayerSheet>);
    expect(q('[data-pz="sheet"]')?.getAttribute('data-mode')).toBe('bottom');
    await setViewport(1194, 834);
    expect(q('[data-pz="sheet"]')?.getAttribute('data-mode')).toBe('side');
  });

  it('dialog 역할·aria-modal·이름을 가지고 닫혀 있으면 아무것도 그리지 않는다', async () => {
    await setViewport(390, 844);
    await render(<PlayerSheet open={false} title="기기" onClose={() => undefined}>본문</PlayerSheet>);
    expect(q('[data-pz="sheet"]')).toBeNull();
    await render(<PlayerSheet open title="기기" onClose={() => undefined}>본문</PlayerSheet>);
    const dialog = q('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-label')).toBe('기기');
    expect(dialog?.textContent).toContain('본문');
  });

  it('닫기 버튼·Esc·시트 바깥 pointerdown 으로 닫히고, 시트 안·도크 pointerdown 은 닫지 않는다', async () => {
    await setViewport(390, 844);
    const onClose = vi.fn();
    await render(
      <div>
        <nav data-pz="dock"><button type="button" id="dock-btn">내 상태</button></nav>
        <button type="button" id="outside">바깥</button>
        <PlayerSheet open title="소리" onClose={onClose}><button type="button" id="inside">안쪽</button></PlayerSheet>
      </div>,
    );
    const press = (el: Element | null) => act(async () => { el?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });

    await press(q('#inside'));
    await press(q('#dock-btn'));
    expect(onClose).not.toHaveBeenCalled();

    await press(q('#outside'));
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(2);

    await act(async () => { q<HTMLButtonElement>('[aria-label="닫기"]')?.click(); });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('열면 포커스가 시트로 들어가고, 닫으면 열었던 버튼으로 돌아간다', async () => {
    await setViewport(390, 844);
    function Harness(): ReactNode {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" id="opener" onClick={() => setOpen(true)}>열기</button>
          <PlayerSheet open={open} title="채팅" onClose={() => setOpen(false)}>본문</PlayerSheet>
        </div>
      );
    }
    await render(<Harness />);
    const opener = q<HTMLButtonElement>('#opener');
    opener?.focus();
    await act(async () => { opener?.click(); });
    expect(q('[role="dialog"]')?.contains(document.activeElement)).toBe(true);

    await act(async () => { q<HTMLButtonElement>('[aria-label="닫기"]')?.click(); });
    expect(q('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('tall 이면 data-tall 이 붙는다(채팅처럼 높이 고정이 필요한 시트)', async () => {
    await render(<PlayerSheet open tall title="채팅" onClose={() => undefined}>본문</PlayerSheet>);
    expect(q('[data-pz="sheet"]')?.getAttribute('data-tall')).toBe('true');
  });
});

describe('PlayerDock', () => {
  const items: DockItem[] = [
    { key: 'status', label: '내 상태', icon: <svg data-icon="status" /> },
    { key: 'chat', label: '채팅', icon: <svg data-icon="chat" />, badge: 2 },
    { key: 'signal', label: '조용한 신호', icon: <svg data-icon="signal" /> },
    { key: 'sound', label: '소리', icon: <svg data-icon="sound" /> },
    { key: 'device', label: '기기', icon: <svg data-icon="device" /> },
  ];

  it('항목마다 같은 클래스의 버튼을 만들고 인라인 폭을 주지 않는다(균등 분배는 CSS 가 맡는다)', async () => {
    await render(<PlayerDock items={items} active={null} onSelect={() => undefined} />);
    const dock = q('[data-pz="dock"]');
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-pz="dk"]')];
    expect(dock?.getAttribute('aria-label')).toBe('클래스 도구');
    expect(buttons).toHaveLength(5);
    expect(new Set(buttons.map((b) => b.className)).size).toBe(1);
    expect(buttons.every((b) => !b.style.width && !b.style.flex)).toBe(true);
    expect(buttons.map((b) => b.textContent?.replace(/\d+$/, ''))).toEqual(['내 상태', '채팅', '조용한 신호', '소리', '기기']);
  });

  it('누른 항목이 aria-pressed 이고 같은 항목을 다시 누르면 null 로 토글된다', async () => {
    const onSelect = vi.fn();
    await render(<PlayerDock items={items} active="chat" onSelect={onSelect} />);
    const pressed = [...document.querySelectorAll('[data-pz="dk"]')].map((b) => b.getAttribute('aria-pressed'));
    expect(pressed).toEqual(['false', 'true', 'false', 'false', 'false']);

    const buttons = document.querySelectorAll<HTMLButtonElement>('[data-pz="dk"]');
    await act(async () => { buttons[0]?.click(); });
    expect(onSelect).toHaveBeenLastCalledWith('status');
    await act(async () => { buttons[1]?.click(); });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('누르면 그 버튼에 포커스를 준다(Safari 는 클릭해도 포커스가 가지 않아 시트 닫힘 후 복귀 대상이 사라진다)', async () => {
    await render(<PlayerDock items={items} active={null} onSelect={() => undefined} />);
    const first = document.querySelectorAll<HTMLButtonElement>('[data-pz="dk"]')[0];
    await act(async () => { first?.click(); });
    expect(document.activeElement).toBe(first);
  });

  it('안읽음 배지는 0 이면 숨기고 99 를 넘으면 99+ 로 줄인다', async () => {
    await render(
      <PlayerDock
        items={[
          { key: 'a', label: 'A', icon: <svg />, badge: 0 },
          { key: 'b', label: 'B', icon: <svg />, badge: 120 },
          { key: 'c', label: 'C', icon: <svg />, badge: 7 },
        ]}
        active={null}
        onSelect={() => undefined}
      />,
    );
    const badges = [...document.querySelectorAll('[data-pz="dk"]')].map((b) => b.querySelector('.pz-dk__badge')?.textContent ?? null);
    expect(badges).toEqual([null, '99+', '7']);
  });
});

describe('StatusRing', () => {
  it('정적 게이지: 호 길이는 fraction 으로 정해지고 접근성 이름을 가진다', async () => {
    await render(
      <StatusRing fraction={0.72} core="gauge" label="이완도" value={72} unit="%" ariaLabel="이완도 72퍼센트" />,
    );
    const ring = q('[data-pz="ring"]');
    expect(ring?.getAttribute('role')).toBe('img');
    expect(ring?.getAttribute('aria-label')).toBe('이완도 72퍼센트');
    expect(ring?.textContent).toContain('이완도');
    expect(ring?.textContent).toContain('72');
    expect(ring?.querySelector('circle.pz-ring__val')?.getAttribute('stroke-dasharray')).toBe('72 100');
  });

  it('fraction 은 0~1 로 자르고, null 이면 값 호를 그리지 않는다', async () => {
    await render(<StatusRing fraction={1.7} core="gauge" label="집중도" value={100} unit="%" ariaLabel="a" />);
    expect(q('circle.pz-ring__val')?.getAttribute('stroke-dasharray')).toBe('100 100');
    await render(<StatusRing fraction={-1} core="gauge" label="집중도" value={0} unit="%" ariaLabel="a" />);
    expect(q('circle.pz-ring__val')?.getAttribute('stroke-dasharray')).toBe('0 100');
    await render(<StatusRing fraction={null} tone="idle" core="msg" title="밴드 없이 참여 중이에요" ariaLabel="b" />);
    expect(q('circle.pz-ring__val')).toBeNull();
    expect(q('[data-pz="ring"]')?.getAttribute('data-tone')).toBe('idle');
  });

  it('msg 코어는 제목·보조문구를, dots 는 요청할 때만 그린다', async () => {
    await render(<StatusRing fraction={null} tone="idle" core="msg" title="밴드를 연결하는 중이에요" subtitle="잠시만요" ariaLabel="c" />);
    expect(q('[data-pz="ring"]')?.textContent).toContain('밴드를 연결하는 중이에요');
    expect(q('.pz-ring__dots')).toBeNull();
    await render(<StatusRing fraction={null} tone="idle" core="msg" title="밴드를 연결하는 중이에요" dots ariaLabel="c" />);
    expect(q('.pz-ring__dots')?.querySelectorAll('i')).toHaveLength(3);
  });

  it('mini 변형은 가운데에 children 을 넣는다(상담사 타일·6지표 격자)', async () => {
    await render(<StatusRing variant="mini" fraction={0.5} colorVar="--m-focus" ariaLabel="d"><b>68</b><small>집중</small></StatusRing>);
    const ring = q('[data-pz="ring"]');
    expect(ring?.getAttribute('data-variant')).toBe('mini');
    expect(ring?.textContent).toContain('68');
    expect(ring?.textContent).toContain('집중');
    expect(q<SVGCircleElement>('circle.pz-ring__val')?.getAttribute('style')).toContain('--m-focus');
  });

  it('호흡 지시 문구와 애니메이션 인라인 스타일이 렌더 결과에 없다', async () => {
    await render(
      <div>
        <StatusRing fraction={0.4} core="gauge" label="호흡" value={11} unit="회/분" ariaLabel="호흡 11회/분" />
        <StatusRing fraction={null} tone="idle" core="msg" title="밴드를 연결하는 중이에요" dots ariaLabel="e" />
      </div>,
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/호흡에 집중|숨을 (들이|내쉬)|들이쉬|내쉬|호흡하세요|천천히 호흡|심호흡/);
    expect(html).not.toMatch(/animation/i);
  });
});

describe('NoticeBanner', () => {
  it.each(['info', 'caution', 'coral', 'live'] as const)('%s 톤: 아이콘과 텍스트를 함께 가진다(색만으로 전달 금지)', async (tone) => {
    await render(<NoticeBanner tone={tone} icon={<svg data-icon="x" />}>접촉이 약해요</NoticeBanner>);
    const el = q('.pz-notice');
    expect(el?.getAttribute('data-tone')).toBe(tone);
    expect(el?.getAttribute('role')).toBe('status');
    expect(el?.querySelector('.pz-notice__icon svg')).not.toBeNull();
    expect(el?.textContent).toContain('접촉이 약해요');
  });

  it('variant 에 따라 기본 data-pz 가 chip=guide, banner=banner 이고 pz 로 바꿀 수 있다', async () => {
    await render(<NoticeBanner tone="info" icon={<svg />}>칩</NoticeBanner>);
    expect(q('.pz-notice')?.getAttribute('data-pz')).toBe('guide');
    await render(<NoticeBanner tone="coral" variant="banner" icon={<svg />}>배너</NoticeBanner>);
    expect(q('.pz-notice')?.getAttribute('data-pz')).toBe('banner');
    await render(<NoticeBanner tone="info" variant="banner" pz="info-card" icon={<svg />}>x</NoticeBanner>);
    expect(q('.pz-notice')?.getAttribute('data-pz')).toBe('info-card');
  });

  it('action 슬롯을 우측에 두고, 있을 때만 data-has-action 을 붙인다(전체 폭 배너는 왼쪽 정렬)', async () => {
    await render(<NoticeBanner tone="info" variant="banner" icon={<svg />} action={<button type="button">마이크 켜기</button>}>마이크 꺼짐</NoticeBanner>);
    expect(q('.pz-notice__action button')?.textContent).toBe('마이크 켜기');
    expect(q('.pz-notice')?.getAttribute('data-has-action')).toBe('true');
    await render(<NoticeBanner tone="info" variant="banner" icon={<svg />}>마이크 꺼짐</NoticeBanner>);
    expect(q('.pz-notice')?.hasAttribute('data-has-action')).toBe(false);
  });
});

describe('NoticeOverlay — 배너를 흐름 밖에 띄워 형제 요소 자리를 밀지 않는다(verify P11)', () => {
  const playerDir = resolve(__dirname, '../src/components/class/player');
  const readCss = (path: string): string => readFileSync(resolve(playerDir, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  let style: HTMLStyleElement;
  beforeEach(() => {
    // jsdom 은 레이아웃을 계산하지 못하므로 getComputedStyle 이 읽는 공용 CSS 의 배치 선언으로 "흐름에서 빠졌는지"를 본다
    style = document.createElement('style');
    style.textContent = readCss('shared/player-shared.css').replace(/@import[^;]+;/g, '');
    document.head.append(style);
  });
  afterEach(() => style.remove());

  const withBanner = (
    <div className="stage" style={{ position: 'relative' }}>
      <NoticeOverlay>
        <NoticeBanner tone="coral" variant="banner" icon={<svg />}>연결이 불안정해요</NoticeBanner>
      </NoticeOverlay>
      <p data-pz="below">본문</p>
    </div>
  );

  const overlayStyle = (): CSSStyleDeclaration => {
    const el = q('.pz-overlay');
    expect(el).not.toBeNull();
    return getComputedStyle(el as HTMLElement);
  };

  it('흐름에서 빠진 절대 배치로 기준 요소의 위쪽 가장자리에 붙는다(자리를 차지하지 않는다)', async () => {
    await render(withBanner);
    const cs = overlayStyle();
    expect(cs.position).toBe('absolute');
    expect(cs.top).toBe('0px');
    expect(cs.left).toBe('0px');
    expect(cs.right).toBe('0px');
  });

  it('배너를 위→아래로 쌓고(8px 간격, S10) 가운데 정렬한다', async () => {
    await render(withBanner);
    const cs = overlayStyle();
    expect(cs.display).toBe('flex');
    expect(cs.flexDirection).toBe('column');
    expect(cs.alignItems).toBe('center');
    expect(cs.gap).toBe('8px');
  });

  it('겹쳐 올라가되 포인터는 배너 자신만 받는다(뒤 요소 클릭을 막지 않고, 배너 버튼은 누를 수 있다)', async () => {
    await render(withBanner);
    const cs = overlayStyle();
    expect(cs.pointerEvents).toBe('none');
    expect(Number(cs.zIndex)).toBeGreaterThan(0);
    expect(getComputedStyle(q('.pz-notice') as HTMLElement).pointerEvents).toBe('auto');
  });

  it('오버레이 배너는 불투명 바탕이라 뒤 요소의 글자가 비쳐 보이지 않는다', () => {
    const rule = readCss('shared/player-shared.css').match(/\.pz-overlay\s*>\s*\.pz-notice\[data-variant="banner"\]\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule?.[1]).toMatch(/background:[^;]*#[0-9A-Fa-f]{6}\s*;/);
  });

  it('배너가 없으면 아무것도 그리지 않는다(빈 박스 0)', async () => {
    await render(<div id="host"><NoticeOverlay>{null}{false}</NoticeOverlay></div>);
    expect(q('#host')?.childElementCount).toBe(0);
  });

  it('회원 무대·상담사 본문은 배너 높이만큼 padding 을 예약하지 않고, 오버레이의 기준 요소(position:relative)이다', () => {
    const member = readCss('member/member-player.css');
    const host = readCss('host/host-player.css');
    expect(member).not.toMatch(/--banner-h/);
    expect(member).toMatch(/\.mp-stage\s*\{[^}]*position:\s*relative/);
    expect(host).toMatch(/\.hp-main\s*\{[^}]*position:\s*relative/);
  });
});

describe('IconCircleButton', () => {
  it('aria-label 을 가진 button(type=button)이고 클릭을 전달한다', async () => {
    const onClick = vi.fn();
    await render(<IconCircleButton label="나가기" icon={<svg />} onClick={onClick} pz="leave" />);
    const btn = q<HTMLButtonElement>('button');
    expect(btn?.getAttribute('aria-label')).toBe('나가기');
    expect(btn?.type).toBe('button');
    expect(btn?.getAttribute('data-pz')).toBe('leave');
    await act(async () => { btn?.click(); });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disabled 면 클릭이 전달되지 않는다', async () => {
    const onClick = vi.fn();
    await render(<IconCircleButton label="전송" icon={<svg />} onClick={onClick} disabled />);
    await act(async () => { q<HTMLButtonElement>('button')?.click(); });
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('PlayerTopBar', () => {
  it('member 변형: 좌·중·우 슬롯과 측정 훅(topbar/title)을 가진다', async () => {
    await render(<PlayerTopBar variant="member" left={<b id="l">L</b>} center={<b id="c">C</b>} right={<b id="r">R</b>} />);
    const bar = q('[data-pz="topbar"]');
    expect(bar).not.toBeNull();
    expect(bar?.querySelector('[data-pz="title"] #c')).not.toBeNull();
    const slots = bar?.querySelectorAll('.pz-topbar__slot') ?? [];
    expect(slots).toHaveLength(2);
    expect(slots[0]?.querySelector('#l')).not.toBeNull();
    expect(slots[1]?.querySelector('#r')).not.toBeNull();
  });

  it('host 변형: 측정 훅이 top/ttl 이다', async () => {
    await render(<PlayerTopBar variant="host" left={<b />} center={<b id="c" />} right={<b />} />);
    expect(q('[data-pz="top"]')).not.toBeNull();
    expect(q('[data-pz="ttl"] #c')).not.toBeNull();
  });

  it('right 가 없어도 같은 크기의 빈 슬롯을 남겨 좌우 대칭을 유지한다(S3)', async () => {
    await render(<PlayerTopBar variant="member" left={<b />} center={<b />} />);
    expect(document.querySelectorAll('.pz-topbar__slot')).toHaveLength(2);
  });
});

describe('PlayerShell', () => {
  const dock = <PlayerDock items={[{ key: 'a', label: 'A', icon: <svg /> }]} active={null} onSelect={() => undefined} />;

  it('루트에 측정 훅·장소·시트 상태를 노출한다', async () => {
    await setViewport(1280, 720);
    await render(
      <PlayerShell place="offline" sheetOpen={false} top={<PlayerTopBar variant="member" left={<b />} center={<b />} />} dock={dock} sheet={null}>
        <div id="stage" />
      </PlayerShell>,
    );
    const app = q('[data-pz="app"]');
    expect(app?.getAttribute('data-place')).toBe('offline');
    expect(app?.getAttribute('data-sheet-open')).toBe('false');
    expect(app?.getAttribute('data-sheet-mode')).toBe('side');
  });

  it('시트가 열리면 상단 바·본문만 inert 가 되고 도크는 계속 눌린다', async () => {
    await setViewport(390, 844);
    await render(
      <PlayerShell
        place="online"
        sheetOpen
        top={<PlayerTopBar variant="member" left={<b />} center={<b />} />}
        dock={dock}
        sheet={<PlayerSheet open title="채팅" onClose={() => undefined}>본문</PlayerSheet>}
      >
        <div id="stage" />
      </PlayerShell>,
    );
    expect(q('[data-pz="app"]')?.getAttribute('data-sheet-open')).toBe('true');
    expect(q('[data-pz="app"]')?.getAttribute('data-sheet-mode')).toBe('bottom');
    expect(q('.pz-shell__top')?.hasAttribute('inert')).toBe(true);
    expect(q('.pz-shell__stage')?.hasAttribute('inert')).toBe(true);
    expect(q('.pz-shell__dock')?.hasAttribute('inert')).toBe(false);
    expect(q('[data-pz="sheet"]')).not.toBeNull();
  });

  it('시트가 닫혀 있으면 inert 가 없다', async () => {
    await render(
      <PlayerShell place="online" sheetOpen={false} top={<b />} dock={dock} sheet={null}>
        <div id="stage" />
      </PlayerShell>,
    );
    expect(q('.pz-shell__top')?.hasAttribute('inert')).toBe(false);
    expect(q('.pz-shell__stage')?.hasAttribute('inert')).toBe(false);
  });

  it('배경은 backdrop 슬롯에 넣는다', async () => {
    await render(
      <PlayerShell place="online" sheetOpen={false} top={<b />} dock={dock} sheet={null} backdrop={<PlayerBackdrop imageSrc="/images/background8.webp" />}>
        <div id="stage" />
      </PlayerShell>,
    );
    const bg = q('[data-pz="backdrop"]');
    expect(bg).not.toBeNull();
    expect(bg?.getAttribute('aria-hidden')).toBe('true');
    expect(bg?.innerHTML).toContain('background8.webp');
  });
});

describe('player-tokens.css · player-shared.css — 토큰·정책 강제', () => {
  const dir = resolve(__dirname, '../src/components/class/player/shared');
  const css = ['player-tokens.css', 'player-shared.css'].map((f) => readFileSync(resolve(dir, f), 'utf8')).join('\n');
  const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');
  const body = stripComments(css);

  it('터치 영역 토큰은 44px 이다', () => {
    expect(body).toMatch(/--tap:\s*44px/);
  });

  it('글자 크기 토큰은 12px 이상이고 12px 미만의 font-size 선언이 없다', () => {
    const tokens = [...body.matchAll(/--fs-(\d+):\s*(\d+)px/g)].map((m) => Number(m[2]));
    expect(tokens.length).toBeGreaterThanOrEqual(6);
    expect(Math.min(...tokens)).toBeGreaterThanOrEqual(12);
    const literal = [...body.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    expect(literal.filter((px) => px < 12)).toEqual([]);
  });

  it('지표 고유색 --m-* 6개가 정의돼 있다', () => {
    for (const name of ['focus', 'relax', 'emotion', 'bpm', 'resp', 'hrv']) {
      expect(body).toMatch(new RegExp(`--m-${name}:\\s*#[0-9A-Fa-f]{6}`));
    }
  });

  it('블러(glassmorphism)를 쓰지 않는다', () => {
    expect(body).not.toMatch(/backdrop-filter|filter:\s*blur|blur\(/);
  });

  it('전역 셀렉터(:root·html·body·*)로 앱 전체를 오염시키지 않는다', () => {
    const selectors = [...body.matchAll(/(^|[{}])\s*([^{}@]+)\{/g)].map((m) => (m[2] ?? '').trim());
    const globals = selectors.filter((s) => /^(:root|html|body|\*)(\s|,|$)/.test(s));
    expect(globals).toEqual([]);
  });

  it('호 전환(transition)은 허용하지만 animation 은 점 순차 페이드 하나뿐이다', () => {
    const names = [...body.matchAll(/animation(?:-name)?:\s*([a-zA-Z0-9_-]+)/g)]
      .map((m) => m[1])
      .filter((n): n is string => n !== undefined && n !== 'none');
    const ringRules = body.split('}').filter((rule) => /\.pz-ring/.test(rule.split('{')[0] ?? '') && /animation/.test(rule));
    expect(ringRules.every((rule) => /\.pz-ring__dots/.test(rule.split('{')[0] ?? ''))).toBe(true);
    expect(names.filter((n) => n !== 'pz-dot-fade' && n !== 'pz-sheet-in-bottom' && n !== 'pz-sheet-in-side')).toEqual([]);
  });

  it('prefers-reduced-motion 에서 animation·transition 을 모두 끈다', () => {
    const block = body.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\}\s*\}/);
    expect(block?.[0]).toMatch(/animation:\s*none\s*!important/);
    expect(block?.[0]).toMatch(/transition:\s*none\s*!important/);
  });

  it('이모지 문자가 없다', () => {
    expect(css).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('링 지름(--ring)은 부모가 정하도록 .pz-ring 자신에게는 선언하지 않는다(상속 덮어쓰기 방지)', () => {
    const ringRules = body.split('}').filter((rule) => /^\s*\.pz-ring\s*\{/.test(rule));
    expect(ringRules.length).toBeGreaterThan(0);
    expect(ringRules.filter((rule) => /--ring\s*:/.test(rule))).toEqual([]);
    expect(body).toMatch(/width:\s*var\(--ring,\s*\d+px\)/);
  });

  it('바깥 여백 토큰(--pz-pad)은 8의 배수다(균형.md S10)', () => {
    const pads = [...body.matchAll(/--pz-pad:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(pads.length).toBeGreaterThanOrEqual(2);
    expect(pads.filter((px) => px % 8 !== 0)).toEqual([]);
  });
});

describe('ClassChatPanel embedded — 시트 안에 넣는 변형', () => {
  const room: ChatRoom = {
    id: 'session-room', room_type: 'session', session_id: 'session-1', host_id: 'host',
    name: '클래스 채팅', peer_name: null, peer_id: null, session_title: '명상 클래스',
    session_scheduled_at: null, participant_count: 3, created_at: '2026-09-28T00:00:00Z',
    unread_count: 3,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      isAuthenticated: true,
      accessToken: 'access-token',
      user: {
        id: 'host', name: '상담사', email: 'host@example.com', role: 'counselor',
        verified_tier: 'fully_verified', onboarding_completed: true, auth_provider: 'email',
        counselors: [{ id: 'host', name: '상담사', profile_image: null }],
      },
    });
    useChatStore.setState({ rooms: [room], messagesByRoom: {}, activeRoomId: null });
    vi.mocked(getChatRoom).mockResolvedValue(room);
    vi.mocked(getSessionChatRoom).mockResolvedValue({ room_id: 'session-room', room_type: 'session' });
  });
  afterEach(() => {
    useAuthStore.setState({ isAuthenticated: false, accessToken: null, user: null });
  });

  const embeddedProps = { sessionId: 'session-1', enabled: true, roomId: 'session-room', onCollapsedChange: () => undefined };

  it('펼쳐 있으면 고정 오버레이(aside)·접기 헤더 없이 ChatRoom 만 그린다', async () => {
    await render(createElement(ClassChatPanel, { ...embeddedProps, embedded: true, collapsed: false }));
    expect(container.textContent).toContain('CHAT_ROOM:session-room');
    expect(document.querySelector('aside')).toBeNull();
    expect(document.querySelector('[aria-label="클래스 채팅 접기"]')).toBeNull();
    expect(container.innerHTML).not.toContain('fixed');
  });

  it('접힘(=시트 닫힘)이면 아무것도 그리지 않는다', async () => {
    await render(createElement(ClassChatPanel, { ...embeddedProps, embedded: true, collapsed: true }));
    expect(container.textContent).toBe('');
    expect(document.querySelector('[aria-label="클래스 채팅 펼치기"]')).toBeNull();
  });

  it('안읽음 수를 onUnreadChange 로 알려 도크 배지를 그릴 수 있게 한다', async () => {
    const onUnreadChange = vi.fn();
    await render(createElement(ClassChatPanel, { ...embeddedProps, embedded: true, collapsed: true, onUnreadChange }));
    expect(onUnreadChange).toHaveBeenLastCalledWith(3);
  });

  it('embedded 를 주지 않으면 기존 오버레이 동작 그대로다(접기 헤더·aside)', async () => {
    await render(createElement(ClassChatPanel, { ...embeddedProps, collapsed: false }));
    expect(document.querySelector('aside')).not.toBeNull();
    expect(document.querySelector('[aria-label="클래스 채팅 접기"]')).not.toBeNull();
  });
});

describe('공용 CSS — 앱 전역 타이포 방어(.pz-root 범위)와 역할별 CSS의 중복 제거', () => {
  const read = (path: string): string => readFileSync(resolve(__dirname, '..', 'src/components/class/player', path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const shared = read('shared/player-shared.css');

  it('mb-tokens.css 의 h1~h3·p 글꼴·자간이 다크 화면으로 새지 않도록 .pz-root 안에서 되돌린다', () => {
    expect(shared).toMatch(/\.pz-root :is\(h1, h2, h3, p\)\s*\{[^}]*font-family:\s*inherit/);
    expect(shared).toMatch(/\.pz-root :is\(h1, h2, h3, p\)\s*\{[^}]*letter-spacing:\s*normal/);
  });

  it('클래스 없는 제목·문단은 부모 색을 따르고, 시트 제목·링 숫자·링 제목은 밝은 글자색을 명시한다', () => {
    expect(shared).toMatch(/\.pz-root :is\(h1, h2, h3, p\):not\(\[class\]\)\s*\{[^}]*color:\s*inherit/);
    expect(shared).toMatch(/\.pz-sheet__head h2[^{]*\{[^}]*color:\s*var\(--tx-hi\)/);
    expect(shared).toMatch(/\.pz-ring__num[^{]*\{[^}]*color:\s*var\(--tx-hi\)/);
    expect(shared).toMatch(/\.pz-ring__title[^{]*\{[^}]*color:\s*var\(--tx-hi\)/);
  });

  it('회원·상담사 CSS 에는 전역 타이포 임시 보정(:has, .pz-root :is)과 reduced-motion 복제가 없다', () => {
    for (const file of ['member/member-player.css', 'host/host-player.css']) {
      const css = read(file);
      expect(css, file).not.toMatch(/:has\(/);
      expect(css, file).not.toMatch(/\.pz-root :is\(h1/);
      expect(css, file).not.toMatch(/prefers-reduced-motion/);
    }
  });

  it('PlayerBackdrop 은 어느 셸(.pz-shell·.hp-ending)에서든 position 을 공용 CSS 가 정한다', () => {
    expect(shared).toMatch(/\.pz-backdrop\s*\{[^}]*position:\s*absolute/);
    expect(read('host/host-player.css')).not.toMatch(/\.hp-ending > \.pz-backdrop/);
  });
});
