// @vitest-environment jsdom
// SDD-299 — 상담사 하단 메뉴 재편성: 독 라벨·시트별 기능 계약·정원 첫 구역·오프라인 숨김·구 라벨 0건
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playerCases } from '../src/lib/class/fixtures/host-cases';
import { HARNESS_BACKDROP_SRC, type PlayerCaseContext } from '../src/lib/class/player-harness';
import { ToolsSheet } from '../src/components/class/player/host/sheets/ToolsSheet';
import { HostCapacitySection } from '../src/components/class/player/host/HostSettingsSheet';

vi.mock('../src/lib/api/class-scheduling', () => ({ schedulingApi: { increaseCapacity: vi.fn() } }));

let root: Root;
let container: HTMLDivElement;
const ctxFor = (query = ''): PlayerCaseContext => {
  const params = new URLSearchParams(query);
  return { sheet: params.get('sheet') || null, detail: null, backdropSrc: HARNESS_BACKDROP_SRC, params };
};
async function renderCase(id: string, query = ''): Promise<void> {
  const node: ReactNode = playerCases[id].render(ctxFor(query));
  await act(async () => { root.render(node); });
}
const all = (sel: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLElement>(sel)];
const one = (sel: string, scope: ParentNode = document) => scope.querySelector<HTMLElement>(sel);
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const dockLabels = () => all('[data-pz="dk"]').map((d) => text(d.querySelector('.pz-dk__label')));
const sheetEl = () => one('[data-pz="sheet"]');

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('독 라벨', () => {
  it('온라인: 분석·채팅·미디어·설정', async () => {
    await renderCase('C01');
    expect(dockLabels()).toEqual(['분석', '채팅', '미디어', '설정']);
  });
  it('오프라인: 분석·채팅·녹음·설정', async () => {
    await renderCase('C04');
    expect(dockLabels()).toEqual(['분석', '채팅', '녹음', '설정']);
  });
  it.each(['metric', 'media', 'tools', 'chat'])('구 라벨 "지표 기준"·"도구" 0건 (sheet=%s)', async (key) => {
    await renderCase('C01', `sheet=${key}`);
    const body = text(document.body);
    expect(body).not.toContain('지표 기준');
    expect(body).not.toContain('도구');
  });
});

describe('분석 시트', () => {
  it('보는 지표·순환·정렬·손든 회원 우선(온라인)·표로 보기', async () => {
    await renderCase('C01', 'sheet=metric');
    const s = sheetEl();
    expect(text(s)).toContain('분석');
    expect(text(s)).toContain('실시간 표시 방식');
    expect(one('[role="switch"][aria-label="10초 순환"]', s!)).not.toBeNull();
    expect(one('[role="radiogroup"][aria-label="정렬"]', s!)).not.toBeNull();
    expect(one('[role="switch"][aria-label="손든 회원 우선"]', s!)).not.toBeNull();
    expect(one('[role="switch"][aria-label="표로 보기"]', s!)).not.toBeNull();
  });
});

describe('미디어 / 녹음 시트', () => {
  it('온라인 미디어: 카메라·마이크 토글, 정원 늘리기 없음', async () => {
    await renderCase('C01', 'sheet=media');
    const s = sheetEl();
    expect(text(s)).toContain('미디어');
    expect(one('[role="switch"][aria-label="카메라"]', s!)).not.toBeNull();
    expect(one('[role="switch"][aria-label="마이크"]', s!)).not.toBeNull();
    expect(text(s)).not.toContain('정원 늘리기');
  });
  it('오프라인 녹음: 카메라·마이크·전후면 전환 숨김, AI 기록 유지', async () => {
    await renderCase('C04', 'sheet=media');
    const s = sheetEl();
    expect(text(one('[data-pz="sheet"] h2, [data-pz="sheet"] [role="heading"]') ?? s)).toContain('녹음');
    expect(one('[role="switch"][aria-label="카메라"]', s!)).toBeNull();
    expect(one('[role="switch"][aria-label="마이크"]', s!)).toBeNull();
    expect(text(s)).not.toContain('전환');
    expect(text(s)).toContain('AI 기록');
  });
});

describe('설정 시트', () => {
  const capacity = { classId: 'c1', capacity: 40, revision: 3, admin: false, onChanged: vi.fn() };
  const base = { accessCode: '4829', codeCopied: false, onCopyCode: vi.fn(), selfBandText: '미착용', onOpenMyband: vi.fn(), onInvite: vi.fn(), onLeave: vi.fn() };
  const mount = (online: boolean) => act(async () => {
    root.render(createElement(ToolsSheet, { ...base, capacitySection: createElement(HostCapacitySection, { online, capacity, joined: 40, waiting: 10 }) }));
  });

  it('정원 늘리기가 첫 구역이고 온라인은 최대 50명', async () => {
    await mount(true);
    const titles = all('.hp-lbl', container).map((n) => text(n));
    expect(titles[0]).toContain('정원 늘리기');
    expect(titles[0]).toContain('최대 50명');
    expect(titles.slice(1)).toEqual(['참여 안내 (입장 코드)', '회원 초대', '내 밴드', '화면 이동']);
    expect(all('.hp-lbl', container).every((n) => n.dataset.title === 'true')).toBe(true);
  });
  it('오프라인은 최대 100명', async () => {
    await mount(false);
    expect(text(all('.hp-lbl', container)[0])).toContain('최대 100명');
  });
  it('정원 현황과 입력 폼이 같은 카드에 있다', async () => {
    await mount(true);
    expect(text(container)).toContain('현재 정원');
    expect(text(container)).toContain('입장 대기');
    expect(one('input', container)).not.toBeNull();
  });
  it('정원 정보가 없으면 정원 구역을 그리지 않는다', async () => {
    await act(async () => { root.render(createElement(ToolsSheet, base)); });
    expect(text(container)).not.toContain('정원 늘리기');
    expect(text(container)).toContain('참여 안내 (입장 코드)');
  });
});
