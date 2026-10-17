// @vitest-environment jsdom
// SDD-209 SH1 — 셸형 라이트 키트: StatusChip · MethodChips · ClassCard · ShellSheet
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusChip } from '../src/components/class/flow/shell/StatusChip';
import { MethodChips } from '../src/components/class/flow/shell/MethodChips';
import { ClassCard, type ClassCardData } from '../src/components/class/flow/shell/ClassCard';
import { ShellSheet } from '../src/components/class/flow/shell/ShellSheet';
import { CLASS_CHIP_KEYS } from '../src/lib/class/class-labels';

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

const DATA: ClassCardData = {
  id: 's1', typeLabel: '명상 클래스', title: '마음챙김 명상 4회차', whenLabel: '오늘 오후 3:00',
  place: 'online', mode: 'group', band: 'optional',
};

describe('StatusChip', () => {
  it('배지 키 8개 모두 라벨과 장식 아이콘을 그린다(글자 기호 없음)', async () => {
    for (const key of CLASS_CHIP_KEYS) {
      await render(<StatusChip chip={key} />);
      const el = q(`[data-chip="${key}"]`)!;
      expect(el.textContent!.trim().length).toBeGreaterThan(0);
      expect(el.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(/[✓✕←→‹›•○●×]/.test(el.textContent!)).toBe(false);
    }
  });
  it('밝은 면은 sh-chip, 사진 위 어두운 면은 sh-hchip', async () => {
    await render(<StatusChip chip="open" />);
    expect(q('[data-chip="open"]')!.className).toContain('sh-chip');
    expect(q('[data-chip="open"]')!.className).toContain('ok');
    await render(<StatusChip chip="open" dark />);
    expect(q('[data-chip="open"]')!.className).toContain('sh-hchip');
  });
  it('tone 으로 색만 바꿀 수 있다(상담사 취소는 warn)', async () => {
    await render(<StatusChip chip="cancelled" tone="warn" />);
    expect(q('[data-chip="cancelled"]')!.className).toContain('warn');
  });
});

describe('MethodChips', () => {
  it('온라인·그룹·LINK BAND 선택 3개', async () => {
    await render(<MethodChips place="online" mode="group" band="optional" />);
    const labels = [...document.querySelectorAll('[data-method]')].map((e) => e.textContent!.trim());
    expect(labels).toEqual(['온라인', '그룹', 'LINK BAND 선택']);
  });
  it('오프라인·1:1·사용 안 함', async () => {
    await render(<MethodChips place="offline" mode="one_on_one" band="none" />);
    const labels = [...document.querySelectorAll('[data-method]')].map((e) => e.textContent!.trim());
    expect(labels).toEqual(['오프라인', '1:1', 'LINK BAND 사용 안 함']);
  });
});

describe('ClassCard', () => {
  it('유형·제목·시각·방식·배지를 그린다', async () => {
    await render(<ClassCard data={DATA} chip="scheduled" onOpen={() => {}} />);
    const card = q('[data-testid="class-card"]')!;
    expect(card.textContent).toContain('명상 클래스');
    expect(card.textContent).toContain('마음챙김 명상 4회차');
    expect(card.textContent).toContain('오늘 오후 3:00');
    expect(card.textContent).toContain('LINK BAND 선택');
    expect(card.querySelector('[data-chip="scheduled"]')).not.toBeNull();
    expect(card.getAttribute('data-highlight')).toBeNull();
  });
  it('본문 탭 → onOpen, 입장 가능이면 강조 + 액션 버튼', async () => {
    const onOpen = vi.fn();
    const onAction = vi.fn();
    await render(<ClassCard data={DATA} chip="open" highlight onOpen={onOpen} action={{ label: '입장하기', onClick: onAction }} />);
    expect(q('[data-testid="class-card"]')!.getAttribute('data-highlight')).toBe('true');
    await act(async () => { q<HTMLButtonElement>('.sh-ccard__main')!.click(); });
    expect(onOpen).toHaveBeenCalledWith('s1');
    await act(async () => { q<HTMLButtonElement>('[data-testid="class-card-action"]')!.click(); });
    expect(onAction).toHaveBeenCalledWith('s1');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
  it('보조 줄(초대한 상담사 등)을 그린다', async () => {
    await render(<ClassCard data={{ ...DATA, subLine: '박서연 상담사가 초대했어요' }} chip="invited" onOpen={() => {}} />);
    expect(q('[data-testid="class-card"]')!.textContent).toContain('박서연 상담사가 초대했어요');
  });
});

describe('ShellSheet', () => {
  it('열면 body 포털에 모달 시트, 닫으면 없음', async () => {
    await render(<ShellSheet open={false} title="클래스 신청하기" onClose={() => {}}>본문</ShellSheet>);
    expect(q('[role="dialog"]')).toBeNull();
    await render(<ShellSheet open title="클래스 신청하기" description="신청 메시지를 보내요" onClose={() => {}} footer={<button type="button">보내기</button>}>본문</ShellSheet>);
    const dialog = q('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('data-pz')).toBe('flow-sheet');
    expect(dialog.textContent).toContain('클래스 신청하기');
    expect(dialog.textContent).toContain('신청 메시지를 보내요');
    expect(dialog.textContent).toContain('본문');
    expect(dialog.textContent).toContain('보내기');
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toBe('클래스 신청하기');
  });
  it('Esc·닫기 버튼·바깥 탭으로 닫힌다', async () => {
    const onClose = vi.fn();
    await render(<ShellSheet open title="t" onClose={onClose}>x</ShellSheet>);
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => { q<HTMLButtonElement>('[data-testid="shell-sheet-close"]')!.click(); });
    expect(onClose).toHaveBeenCalledTimes(2);
    await act(async () => { q<HTMLElement>('[data-layer="sheet"]')!.click(); });
    expect(onClose).toHaveBeenCalledTimes(3);
  });
  it('시트 안쪽 탭은 닫지 않는다 · tone=dark 는 어두운 시트', async () => {
    const onClose = vi.fn();
    await render(<ShellSheet open title="t" tone="dark" onClose={onClose}>x</ShellSheet>);
    await act(async () => { q<HTMLElement>('[role="dialog"]')!.click(); });
    expect(onClose).not.toHaveBeenCalled();
    expect(q('[role="dialog"]')!.getAttribute('data-tone')).toBe('dark');
  });
});
