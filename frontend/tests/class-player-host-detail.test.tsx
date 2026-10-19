// @vitest-environment jsdom
// SDD-208 H3 — 1:1 큰 회원 카드(C05·C06)·오프라인 헤드(C04)·참가자 상세 시트
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playerCases } from '../src/lib/class/fixtures/host-cases';
import { HARNESS_BACKDROP_SRC, type PlayerCaseContext } from '../src/lib/class/player-harness';

let root: Root;
let container: HTMLDivElement;

function ctxFor(query = ''): PlayerCaseContext {
  const params = new URLSearchParams(query);
  return { sheet: params.get('sheet') || null, detail: params.get('detail') || null, backdropSrc: HARNESS_BACKDROP_SRC, params };
}
async function renderCase(id: string, query = ''): Promise<void> {
  const node: ReactNode = playerCases[id].render(ctxFor(query));
  await act(async () => { root.render(node); });
}
async function setViewport(width: number, height: number): Promise<void> {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  await act(async () => { window.dispatchEvent(new Event('resize')); });
}
const all = (sel: string, scope: ParentNode = document): HTMLElement[] => [...scope.querySelectorAll<HTMLElement>(sel)];
const one = (sel: string, scope: ParentNode = document): HTMLElement | null => scope.querySelector<HTMLElement>(sel);
const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const buttonByText = (label: string, scope: ParentNode = document): HTMLElement | null =>
  all('button', scope).find((b) => text(b).includes(label) || b.getAttribute('aria-label')?.includes(label)) ?? null;
async function click(el: HTMLElement | null): Promise<void> {
  expect(el, '클릭 대상').not.toBeNull();
  await act(async () => { el?.click(); });
}
const sheet = (): HTMLElement | null => one('[data-pz="sheet"]');

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await setViewport(1280, 720);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

/* ───────── H3 — 1:1·오프라인 헤드·상세 시트 ───────── */

describe('H3 1:1 카드(C05·C06)', () => {
  it('C05: 그리드 대신 큰 회원 카드 + 6지표 3×2 + 5분 추이 + 체크인 응답', async () => {
    await renderCase('C05');
    expect(all('[data-pz="tile"]')).toHaveLength(0);
    const solo = one('[data-pz="solo"]');
    expect(solo).not.toBeNull();
    const minis = all('[data-pz="mini"]', solo ?? document);
    expect(minis.map((m) => text(m.querySelector('.hp-mini__ml')))).toEqual(['집중', '이완', '감정', 'BPM', '호흡', 'HRV']);
    expect(minis.map((m) => m.dataset.sel)).toEqual([undefined, 'true', undefined, undefined, undefined, undefined]);
    expect(text(one('[data-pz="trend"]'))).toContain('최근 5분 · 이완도');
    const qas = one('[data-pz="qas"]');
    expect(text(qas)).toContain('체크인 응답');
    expect(text(qas)).toContain('마음의 날씨');
    expect(text(qas)).toContain('잔잔해요');
  });

  it('C05: 띠 라벨은 "강조해서 보는 지표"이고 그룹 평균은 없다', async () => {
    await renderCase('C05');
    const strip = text(one('[data-pz="mstrip"]'));
    expect(strip).toContain('강조해서 보는 지표');
    expect(strip).not.toContain('그룹 평균');
    expect(text(one('[data-pz="chipline"]'))).toContain('밴드 연결됨');
  });

  it('C05: 회원이 카메라를 켜지 않았으면 회원 영상 자리가 DOM 에 없다(확정 결정 #1)', async () => {
    await renderCase('C05');
    expect(one('[data-pz="member-video"]')).toBeNull();
  });

  it('C05: 회원 영상 트랙이 있으면 영상 자리가 나타나고 상담사 쪽에 카메라를 켜는 UI 는 없다', async () => {
    const stream = {} as MediaStream;
    const { HostLiveView } = await import('../src/components/class/player/host/HostLiveView');
    const { buildHostCaseInput } = await import('../src/lib/class/fixtures/host-cases');
    const { deriveHostCase, HOST_SELF_BAND_NONE } = await import('../src/lib/class/host-player-case');
    const { useHostUi } = await import('../src/components/class/player/host/useHostUi');
    const spec = buildHostCaseInput('C05');
    function Probe(): ReactNode {
      const { ui, actions } = useHostUi(spec.ui);
      return (
        <HostLiveView
          hostCase={deriveHostCase(spec.input)} participants={spec.input.participants} ui={ui} uiActions={actions}
          meta={{ title: 't', elapsedSec: 1, durationMin: 30, accessCode: 'X' }} queue={[]} speakingPanel={null}
          preCheckins={[]} quietSignals={{ following: 0, difficult: 0, resting: 0 }} selfBand={HOST_SELF_BAND_NONE}
          chat={{ unread: 0, enabled: false, busy: false, onToggleEnabled: () => undefined, render: () => null }}
          media={{ recording: { state: 'idle', elapsedSec: 0, onStart: () => undefined, onPause: () => undefined, onResume: () => undefined, onStop: () => undefined }, video: null, marker: null }}
          codeCopied={false} selfStream={null} memberStream={stream} trendOf={() => [50, 52, 51, 55]}
          actions={{ close: () => undefined, end: () => undefined, retryNetwork: () => undefined, revoke: () => undefined, toggleMic: () => undefined, toggleCam: () => undefined, recheckPermission: () => undefined, copyCode: () => undefined, connectSelfBand: () => undefined, disconnectSelfBand: () => undefined }}
          backdropSrc={HARNESS_BACKDROP_SRC}
        />
      );
    }
    await act(async () => { root.render(<Probe />); });
    expect(one('[data-pz="member-video"]')).not.toBeNull();
    expect(buttonByText('카메라 켜기', one('[data-pz="solo"]') ?? document)).toBeNull();
  });

  it('C06 오프라인 1:1: 셀프뷰 없이 요약 패널 + 큰 회원 카드 + 녹음 칩', async () => {
    await renderCase('C06');
    expect(one('[data-pz="selfview"]')).toBeNull();
    expect(one('[data-pz="sumpanel"]')).not.toBeNull();
    expect(one('[data-pz="solo"]')).not.toBeNull();
    expect(text(one('[data-pz="chipline"]'))).toContain('녹음 중 08:12');
  });
});

describe('H3 오프라인 헤드(C04) — 셀프뷰·카메라 토글 DOM 없음', () => {
  it('C04: 셀프뷰 슬롯이 없고 요약 패널(녹음·체크인·밴드)이 그 자리를 채운다', async () => {
    await renderCase('C04');
    expect(one('[data-pz="selfview"]')).toBeNull();
    expect(all('video')).toHaveLength(0);
    const panel = text(one('[data-pz="sumpanel"]'));
    expect(panel).toContain('녹음');
    expect(panel).toContain('08:12');
    expect(panel).toContain('체크인');
    expect(panel).toContain('7/8'); // 현재 접속과 별개로 저장된 체크인 완료를 보존한다.
    expect(panel).toContain('밴드');
    expect(panel).toContain('5/8');
  });

  it('C04: 도크 세 번째 항목은 "녹음"이다', async () => {
    await renderCase('C04');
    expect(text(all('[data-pz="dk"]')[2])).toContain('녹음');
  });
});

describe('H3 참가자 상세 시트', () => {
  it('타일을 누르면 상세 시트가 열리고 타일이 눌림 표시가 된다', async () => {
    await renderCase('C01');
    await click(one('[data-pz="tile"][data-participant-id="p2"]'));
    expect(sheet()).not.toBeNull();
    expect(text(sheet())).toContain('민준');
    expect(one('[data-pz="tile"][data-participant-id="p2"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('연결된 참가자: 6지표 + 최근 5분 추이 + 체크인 응답', async () => {
    await renderCase('C01', 'sheet=detail&detail=3');
    const s = sheet();
    expect(text(s)).toContain('지우');
    expect(text(s)).toContain('연결됨');
    expect(all('[data-pz="mini"]', s ?? document)).toHaveLength(6);
    expect(text(s)).toContain('최근 5분 · 이완도');
    expect(text(s)).toContain('5분 전');
    expect(text(s)).toContain('체크인 응답');
    expect(text(s)).toContain('맑고 고요해요');
  });

  it.each([
    ['C01', '6', '연결이 2분 전부터 끊겼어요'],
    ['C01', '4', 'LINK BAND 없이 참여 중이에요'],
    ['C12', '2', '접촉이 불안정해요'],
  ])('%s 참가자 %s 는 추이 대신 안내 문구(끊김·미착용·접촉 불량)', async (id, who, message) => {
    await renderCase(id, `sheet=detail&detail=${who}`);
    expect(text(sheet())).toContain(message);
    expect(one('.hp-trend svg', sheet() ?? document)).toBeNull();
  });

  it('체크인 응답이 없으면 안내한다', async () => {
    await renderCase('C01', 'sheet=detail&detail=8');
    expect(text(sheet())).toContain('아직 체크인 응답이 없어요');
  });

  it('체크인 시트의 "살펴볼 응답"을 누르면 그 참가자 상세로 간다', async () => {
    await renderCase('C01', 'sheet=checkin');
    await click(buttonByText('서아', sheet() ?? document));
    expect(text(sheet())).toContain('체크인 응답');
    expect(one('[data-pz="tile"][data-participant-id="p5"]')?.getAttribute('aria-pressed')).toBe('true');
  });
});
