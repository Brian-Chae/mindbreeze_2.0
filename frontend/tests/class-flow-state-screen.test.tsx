// @vitest-environment jsdom
// SDD-209 I2 (verify FL5) — FM10·FH10 상태 화면은 하나의 컴포넌트(FlowStateScreen)로 렌더된다: 제목·설명·주 버튼 1 + 보조 1
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowStateScreen } from '../src/components/class/flow/shared/FlowStateScreen';
import { HostStateScreen } from '../src/components/class/flow/host/HostStateScreen';
import { MemberStateScreen } from '../src/components/class/flow/member/MemberStateScreen';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const buttons = (): HTMLButtonElement[] => [...container.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.classList.contains('fl-btn'));

describe('공용 상태 화면', () => {
  it('참가자 카드형: 주 버튼 1 + 보조 1, 정보 쌍 2, 서버 문구 없음', async () => {
    const primary = vi.fn();
    const secondary = vi.fn();
    await act(async () => { root.render(<MemberStateScreen kind="cancelled" classTitle="저녁 명상" whenLabel="오늘 오후 3:00" onPrimary={primary} onSecondary={secondary} />); });
    expect(container.querySelector('[role="alert"] h1')?.textContent).toBe('클래스가 취소됐어요');
    expect(container.querySelectorAll('.fm-finfo > div')).toHaveLength(2);
    const [main, sub] = buttons();
    expect(main.getAttribute('data-pz')).toBe('flow-cta');
    expect(sub.getAttribute('data-kind')).toBe('soft');
    await act(async () => { main.click(); sub.click(); });
    expect(primary).toHaveBeenCalledTimes(1);
    expect(secondary).toHaveBeenCalledTimes(1);
  });

  it('상담사 바형: 같은 컴포넌트가 상단 바와 아이콘 행으로 그린다', async () => {
    const onAction = vi.fn();
    await act(async () => { root.render(<HostStateScreen kind="closed" waiting={3} closedAtText="오늘 오후 2:41" title="저녁 명상" onAction={onAction} />); });
    expect(container.querySelector('h1')?.textContent).toBe('클래스를 닫았어요');
    expect(container.querySelectorAll('.fhb-row').length).toBeGreaterThanOrEqual(2);
    const [main, sub] = buttons();
    await act(async () => { main.click(); sub.click(); });
    expect(onAction.mock.calls.map((c) => c[0])).toEqual(['clone', 'list']);
  });

  it('경고 톤은 role=alert(바형)·data-tone=warn(카드형)으로 드러난다', async () => {
    await act(async () => {
      root.render(<FlowStateScreen warn icon={null} heading="문제" lead="설명" primary={{ label: '확인', onClick: () => undefined }} secondary={{ label: '닫기', onClick: () => undefined }} />);
    });
    expect(container.querySelector('.fm-ficon')?.getAttribute('data-tone')).toBe('warn');
  });

  it('두 화면 파일은 자체 레이아웃을 갖지 않고 FlowStateScreen 만 쓴다', () => {
    for (const file of ['member/MemberStateScreen.tsx', 'host/HostStateScreen.tsx']) {
      const src = readFileSync(resolve(__dirname, '../src/components/class/flow', file), 'utf8');
      expect(src).toContain('FlowStateScreen');
      expect(src).not.toMatch(/MemberFullFrame|HostFlowFrame/);
    }
  });
});
