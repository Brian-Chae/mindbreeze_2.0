// @vitest-environment jsdom
// SDD-209 T2a — 몰입형 프리미티브 + PlayerShell/PlayerSheet/PlayerTopBar 추가 props(기본값 = 현행 동작)
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerShell } from '../src/components/class/player/shared/PlayerShell';
import { PlayerSheet } from '../src/components/class/player/shared/PlayerSheet';
import { PlayerTopBar } from '../src/components/class/player/shared/PlayerTopBar';
import {
  FlowBody, FlowButton, FlowCard, FlowChip, FlowCol, FlowFoot, FlowH1, FlowList, FlowSheet, FlowSteps, FlowSub,
} from '../src/components/class/flow/shared/flow-primitives';

let root: Root;
let container: HTMLDivElement;
async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(node); });
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

describe('PlayerShell — 추가 props 기본값 = 현행', () => {
  it('기본: 도크 영역 렌더, 클래스 pz-root pz-shell, 추가 속성 없음', async () => {
    await render(<PlayerShell place="online" sheetOpen={false} top="T" dock="D" sheet={null}>본문</PlayerShell>);
    const el = q('[data-pz="app"]')!;
    expect(el.className).toBe('pz-root pz-shell');
    expect(el.getAttribute('data-flow')).toBeNull();
    expect(q('.pz-shell__dock')?.textContent).toBe('D');
  });
  it('dock 생략 + className: 도크 영역이 없고 클래스가 덧붙는다', async () => {
    await render(<PlayerShell place="online" sheetOpen={false} top="T" sheet={null} className="fl-root">본문</PlayerShell>);
    expect(q('.pz-shell__dock')).toBeNull();
    expect(q('[data-pz="app"]')!.className).toBe('pz-root pz-shell fl-root');
  });
  it('flow 모드: data-flow 와 stage 측정 훅(flow-col 아님 — 컬럼은 FlowCol 이 소유)', async () => {
    await render(<PlayerShell place="offline" sheetOpen={false} top="T" sheet={null} flow>본문</PlayerShell>);
    expect(q('[data-pz="app"]')!.getAttribute('data-flow')).toBe('true');
    expect(q('main')!.getAttribute('data-pz')).toBe('flow-stage');
  });
});

describe('PlayerShell — 시트가 열리면(FR6)', () => {
  it('기본(진행 화면): 도크는 계속 눌린다(inert 아님)', async () => {
    await render(<PlayerShell place="online" sheetOpen top="T" dock="D" sheet={<span>S</span>}>본문</PlayerShell>);
    expect(q('.pz-shell__dock')!.hasAttribute('inert')).toBe(false);
    expect(q('.pz-shell__top')!.hasAttribute('inert')).toBe(true);
  });
  it('flow: 푸터(dock)도 inert', async () => {
    await render(<PlayerShell place="online" sheetOpen flow top="T" dock="D" sheet={<span>S</span>}>본문</PlayerShell>);
    expect(q('.pz-shell__dock')!.hasAttribute('inert')).toBe(true);
  });
  it('flow 이지만 시트가 닫혀 있으면 inert 아님', async () => {
    await render(<PlayerShell place="online" sheetOpen={false} flow top="T" dock="D" sheet={null}>본문</PlayerShell>);
    expect(q('.pz-shell__dock')!.hasAttribute('inert')).toBe(false);
  });
});

describe('PlayerSheet — 추가 props 기본값 = 현행', () => {
  it('기본: data-pz=sheet, 닫기 라벨, footer 없음', async () => {
    await render(<PlayerSheet open title="도구" onClose={() => {}}>내용</PlayerSheet>);
    expect(q('[data-pz="sheet"]')).not.toBeNull();
    expect(q('button[aria-label="닫기"]')).not.toBeNull();
    expect(q('.pz-sheet__foot')).toBeNull();
  });
  it('pz·footer·closeLabel: 본문 스크롤 밖에 푸터가 고정된다', async () => {
    await render(
      <PlayerSheet open title="확인" pz="flow-sheet" closeLabel="취소" footer={<button type="button">계속</button>} onClose={() => {}}>
        내용
      </PlayerSheet>,
    );
    expect(q('[data-pz="flow-sheet"]')).not.toBeNull();
    expect(q('button[aria-label="취소"]')).not.toBeNull();
    const foot = q('.pz-sheet__foot')!;
    expect(foot.textContent).toBe('계속');
    expect(foot.parentElement).toBe(q('[data-pz="flow-sheet"]'));
    expect(q('.pz-sheet__body')!.contains(foot)).toBe(false);
  });
  it('dismissOnOutside=false 면 바깥 pointerdown 으로 닫히지 않는다', async () => {
    const onClose = vi.fn();
    await render(<><button type="button" id="out">밖</button><PlayerSheet open title="x" dismissOnOutside={false} onClose={onClose}>a</PlayerSheet></>);
    await act(async () => { q('#out')!.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(onClose).not.toHaveBeenCalled();
  });
  it('기본은 바깥 pointerdown 으로 닫힌다(현행)', async () => {
    const onClose = vi.fn();
    await render(<><button type="button" id="out">밖</button><PlayerSheet open title="x" onClose={onClose}>a</PlayerSheet></>);
    await act(async () => { q('#out')!.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('PlayerTopBar — 추가 props 기본값 = 현행', () => {
  it('member/host 훅 이름 유지, slotWidth 없으면 인라인 스타일 없음', async () => {
    await render(<PlayerTopBar variant="member" center="제목" />);
    expect(q('[data-pz="topbar"]')!.getAttribute('style')).toBeNull();
    expect(q('[data-pz="title"]')).not.toBeNull();
    await render(<PlayerTopBar variant="host" center="제목" />);
    expect(q('[data-pz="top"]')).not.toBeNull();
    expect(q('[data-pz="ttl"]')).not.toBeNull();
  });
  it('flow 변형: flow-top/flow-title 훅, slotWidth 96 → 좌·우 슬롯 같은 폭 변수', async () => {
    await render(<PlayerTopBar variant="flow" slotWidth={96} left="L" center="제목" right="R" />);
    const bar = q<HTMLElement>('[data-pz="flow-top"]')!;
    expect(bar.style.getPropertyValue('--pz-top-slot')).toBe('96px');
    expect(q('[data-pz="flow-title"]')!.textContent).toBe('제목');
  });
});

describe('몰입형 프리미티브', () => {
  it('FlowBody > FlowCol > FlowCard 구조와 측정 훅', async () => {
    await render(
      <FlowBody><FlowCol><FlowH1>제목</FlowH1><FlowSub>설명</FlowSub><FlowCard>카드</FlowCard></FlowCol></FlowBody>,
    );
    expect(q('[data-pz="flow-col"] [data-pz="flow-card"]')).not.toBeNull();
    expect(q('h1')!.className).toContain('fl-h1');
  });
  it('FlowFoot: 주 버튼은 flow-cta, 보조는 아님. 비활성은 aria-disabled 가 아닌 disabled', async () => {
    await render(
      <FlowFoot>
        <FlowButton kind="primary" disabled>다음</FlowButton>
        <FlowButton kind="ghost">건너뛰기</FlowButton>
      </FlowFoot>,
    );
    const foot = q('[data-pz="flow-foot"]')!;
    expect(foot.querySelectorAll('[data-pz="flow-cta"]')).toHaveLength(1);
    expect(q<HTMLButtonElement>('[data-pz="flow-cta"]')!.disabled).toBe(true);
    expect(foot.querySelectorAll('button')).toHaveLength(2);
  });
  it('FlowSteps: 개수 = 단계 수, 현재 단계 표시', async () => {
    await render(<FlowSteps total={5} current={2} />);
    const dots = document.querySelectorAll('[data-pz="flow-steps"] > i');
    expect(dots).toHaveLength(5);
    expect(dots[0].className).toBe('done');
    expect(dots[2].className).toBe('on');
    expect(q('[data-pz="flow-steps"]')!.getAttribute('aria-label')).toBe('5단계 중 3단계');
    expect(document.querySelectorAll('[data-pz="flow-steps"] > i[aria-current="step"]')).toHaveLength(1);
    expect(dots[2].getAttribute('aria-current')).toBe('step');
  });
  it('FlowChip: 톤 + 아이콘 자리 + 라벨(색만으로 구분하지 않는다)', async () => {
    await render(<FlowChip tone="warn" icon={<svg data-testid="ic" />}>접촉 필요</FlowChip>);
    const chip = q('.fl-chip')!;
    expect(chip.getAttribute('data-tone')).toBe('warn');
    expect(chip.textContent).toBe('접촉 필요');
    expect(chip.querySelector('svg')).not.toBeNull();
  });
  it('FlowList 는 role=list, 항목은 listitem', async () => {
    await render(<FlowList><li>a</li><li>b</li></FlowList>);
    expect(q('[data-pz="flow-list"]')!.tagName).toBe('UL');
  });
  it('FlowSheet: PlayerSheet 위임 + flow-sheet 훅 + 푸터', async () => {
    await render(<FlowSheet open title="확인" onClose={() => {}} footer={<span>푸터</span>}>본문</FlowSheet>);
    expect(q('[data-pz="flow-sheet"][role="dialog"]')).not.toBeNull();
    expect(q('.pz-sheet__foot')!.textContent).toBe('푸터');
  });
});

describe('flow-shared.css', () => {
  const css = readFileSync(resolve(__dirname, '../src/components/class/flow/shared/flow-shared.css'), 'utf8');
  it('모든 규칙이 .pz-root 로 스코프되고 :root·body 를 건드리지 않는다', () => {
    expect(css).not.toMatch(/(^|\n)\s*(:root|body|html)\b/);
    const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((b) => b.split('{')[0].trim()).filter((s) => s && !s.startsWith('@') && !s.startsWith('from') && !s.startsWith('to'));
    const loose = selectors.filter((s) => s.split(',').some((part) => !part.trim().startsWith('.pz-root') && !part.trim().startsWith(':where(.pz-root)')));
    expect(loose).toEqual([]);
  });
  it('.fl-h1·.fl-h2 는 글자색을 직접 정한다(전역 h1/h2 색에 눌리지 않게)', () => {
    expect(css).toMatch(/\.pz-root \.fl-h1[^{]*\{[^}]*color:/);
    expect(css).toMatch(/\.pz-root \.fl-h2[^{]*\{[^}]*color:/);
  });
  it('11px 이하 글자 크기 없음', () => {
    for (const m of css.matchAll(/font-size:\s*(\d+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(12);
  });
});
