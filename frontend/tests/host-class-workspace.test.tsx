// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HostClassWorkspace } from '../src/pages/sessions/ClassPlayerPage';
import type { SessionLiveMetric } from '../src/lib/api/session';

let root: Root;
let container: HTMLDivElement;
const row = (id: string, value: number | null): SessionLiveMetric => ({
  participant_id: id, display_name: id, is_guest: false, band_connected: value !== null,
  device_status: 'ok', band_battery: 80, avg_efficiency: null, current_efficiency: value,
  upload_status: 'completed', last_eeg_at: new Date().toISOString(), heart_rate: 70, respiratory_rate: 14,
});
async function render(rows = [row('가람', 70), row('나래', 40), row('다온', null)], elapsed = 100, overrides: Partial<ComponentProps<typeof HostClassWorkspace>> = {}) {
  await act(async () => root.render(createElement(HostClassWorkspace, {
    rows, extras: {}, signals: {}, aggregate: null, elapsed, running: true,
    left: null, tools: null, statusBar: null, filter: null, ...overrides,
  })));
}
async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => (element as HTMLElement).click());
}
const button = (text: string) => [...container.querySelectorAll('button')].find(el => el.textContent === text) ?? null;
const names = () => [...container.querySelectorAll('.hcp-person-name')].map(el => el.textContent);
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-03T00:00:00Z'));
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });

it('없는 성별·나이·설문은 카드와 상세에서 생략한다', async () => {
  await render();
  expect(container.querySelector('.hcp-demographics')).toBeNull();
  await click(container.querySelector('.hcp-person'));
  expect(container.querySelector('.hcp-survey')).toBeNull();
  expect(container.querySelector('.hcp-sheet .hcp-demographics')).toBeNull();
});
it('회원 성별·만 나이·설문을 카드, 상세, 테이블에 연결한다', async () => {
  await render([{ ...row('회원', 70), gender: 'female', birth_date: '2001-10-03', concerns: ['수면', '스트레스'] }]);
  expect(container.querySelector('.hcp-demographics')?.textContent).toBe('여 · 25세');
  await click(container.querySelector('.hcp-person'));
  expect(container.querySelector('.hcp-sheet .hcp-demographics')?.textContent).toBe('여 · 25세');
  expect(container.querySelector('.hcp-survey')?.textContent).toContain('사전 설문');
  expect(container.querySelector('.hcp-survey p')?.textContent).toBe('수면 · 스트레스');
  await click(button('닫기')); await click(button('모두'));
  expect(container.querySelector('tbody .hcp-demographics')?.textContent).toBe('여 · 25세');
});
it.each([
  ['male', '2001-10-04', '남 · 24세'],
  ['other', '2001-10-02', '기타 · 25세'],
  [null, '2001-10-03', '25세'],
  ['female', null, '여'],
  ['male', '잘못된 날짜', '남'],
  ['male', '2027-01-01', '남'],
  ['male', '2001-02-30', '남'],
])('성별 %s, 생년월일 %s의 누락과 생일 경계를 처리한다', async (gender, birth_date, expected) => {
  await render([{ ...row('참가자', 70), gender, birth_date }]);
  expect(container.querySelector('.hcp-demographics')?.textContent).toBe(expected);
});
it('게스트는 성별과 나이만 표시하고 설문은 숨긴다', async () => {
  await render([{ ...row('게스트', 70), is_guest: true, gender: 'male', birth_date: '2001-10-03', concerns: ['노출 금지'] }]);
  await click(container.querySelector('.hcp-person'));
  expect(container.querySelector('.hcp-sheet .hcp-demographics')?.textContent).toBe('남 · 25세');
  expect(container.querySelector('.hcp-survey')).toBeNull();
});
it('기본 이완도 오름차순과 단일 선택, 순환 중 정렬 기준을 유지한다', async () => {
  await render(); expect(names()).toEqual(['나래', '가람', '다온']);
  expect(button('이완도')?.getAttribute('aria-pressed')).toBe('true');
  await act(async () => vi.advanceTimersByTime(10000));
  expect(container.querySelectorAll('.hcp-toolbar [aria-pressed="true"]')).toHaveLength(1);
  expect(button('정서안정도')?.getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelector('.hcp-sort')?.textContent).toContain('이완도');
});
it('모두는 입장순 테이블이며 헤더로 현재값 오름/내림차순 정렬한다', async () => {
  await render(); await click(button('모두'));
  const tableNames = () => [...container.querySelectorAll('tbody th button')].map(el => el.firstChild?.textContent);
  expect(tableNames()).toEqual(['가람', '나래', '다온']);
  await click(container.querySelectorAll('thead th button')[2]);
  expect(tableNames()).toEqual(['나래', '가람', '다온']);
  await click(container.querySelectorAll('thead th button')[2]);
  expect(tableNames()).toEqual(['가람', '나래', '다온']);
  await click(container.querySelector('tbody tr'));
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
});
it('상세는 버튼·바깥·Esc로 닫히고 카드 포커스를 복구한다', async () => {
  await render(); const card = container.querySelector<HTMLButtonElement>('.hcp-person')!;
  for (const method of ['button', 'outside', 'escape']) {
    card.focus(); await click(card);
    expect(container.querySelectorAll('.hcp-sheet .hcp-mind')).toHaveLength(3);
    expect(container.querySelectorAll('.hcp-sheet .hcp-body')).toHaveLength(3);
    if (method === 'escape') await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    else await click(method === 'button' ? button('닫기') : container.querySelector('.hcp-backdrop'));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(card);
  }
});
it('상세를 연 참가자가 퇴장하면 순환이 다시 동작한다', async () => {
  await render(); await click(container.querySelector('.hcp-person'));
  await render([row('가람', 70)]);
  await act(async () => vi.advanceTimersByTime(10000));
  expect(button('정서안정도')?.getAttribute('aria-pressed')).toBe('true');
});
it('179초는 현재값, 180초 이력부터 3분 평균 변화량으로 자동 정렬한다', async () => {
  for (const second of [...Array.from({ length: 60 }, (_, i) => i * 3), 179, 180]) {
    vi.setSystemTime(new Date(Date.parse('2026-10-03T00:00:00Z') + second * 1000));
    await render([row('가람', second < 180 ? 90 : 60), row('나래', 40)], second);
    if (second === 179) expect(names()).toEqual(['나래', '가람']);
  }
  expect(names()).toEqual(['가람', '나래']);
  expect(container.querySelector('.hcp-person')?.textContent).toContain('-30');
});
it('밴드 미사용·수신 끊김·3분 미만 추이를 구분하고 0건 미확인 pill은 숨긴다', async () => {
  await render([row('측정', 70), { ...row('미사용', null), last_eeg_at: null }, row('단절', null)]);
  const cards = [...container.querySelectorAll('.hcp-person')];
  expect(cards[0].querySelector('.hcp-person-change')?.textContent).toBe('추이 대기');
  expect(cards[1].querySelector('.hcp-person-change')?.textContent).toBe('밴드 미사용');
  expect(cards[2].querySelector('.hcp-person-change')?.textContent).toBe('수신 끊김');
  expect(container.querySelector('.hcp-unread')).toBeNull();
  await click(cards[1]);
  expect(container.querySelector('.hcp-sheet')?.textContent).not.toContain('추이 대기');
});
it('상세 평균 틱과 점선은 유효 그룹 표본이 있을 때만 표시한다', async () => {
  const rows = [row('가람', 60), row('나래', 70), row('다온', 80)];
  await render(rows); await click(container.querySelector('.hcp-person'));
  expect(container.querySelectorAll('.hcp-sheet .hcp-tick')).toHaveLength(1);
  expect(container.querySelector('.hcp-sheet .hcp-average-label')?.textContent).toContain('—');
  expect(container.querySelectorAll('.hcp-sheet .hcp-bars .hcp-average-line')).toHaveLength(2);
  expect(container.querySelector('.hcp-body-legend')?.textContent).toContain('최근 수신 범위');
  await render(rows.slice(0, 2));
  expect(container.querySelector('.hcp-sheet .hcp-tick')).toBeNull();
  expect(container.querySelector('.hcp-sheet .hcp-bars .hcp-average-line')).toBeNull();
});

it('참가자 0명에서는 상태 안내만 보이고 빈 테이블은 숨긴다', async () => {
  await render([]); await click(button('모두'));
  expect(container.querySelector('.hcp-empty')?.getAttribute('role')).toBe('status');
  expect(container.querySelector('table')).toBeNull();
  expect(container.querySelector('.hcp-person')).toBeNull();
});
it('전원 밴드 미사용이면 그룹은 표본 없음이며 신호 0건은 중공 배지만 남긴다', async () => {
  await render([row('가람', null)]);
  expect(container.querySelector('.hcp-group')?.textContent).toContain('표본 없음');
  expect(container.querySelector('.hcp-group .hcp-dial')).toBeNull();
  expect(container.querySelectorAll('.hcp-signal-row .hcp-zero')).toHaveLength(3);
  expect(container.querySelector('.hcp-unread')).toBeNull();
});
it('테이블 수치 클릭으로 연 상세도 닫으면 참가자 버튼에 포커스를 돌린다', async () => {
  await render(); await click(button('모두'));
  await click(container.querySelector('tbody td'));
  expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
  const close = button('닫기');
  expect(document.activeElement).toBe(close);
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })));
  expect(document.activeElement).toBe(close);
  await click(close);
  expect(document.activeElement).toBe(container.querySelector('tbody th button'));
});
it('상세 모달은 목록 외의 미디어·도구도 비활성화하고 닫으면 복원한다', async () => {
  await render();
  await click(container.querySelector('.hcp-person'));
  expect(container.querySelector('.hcp-host')?.hasAttribute('inert')).toBe(true);
  expect(container.querySelector('.hcp-toolbar')?.hasAttribute('inert')).toBe(true);
  await click(button('닫기'));
  expect(container.querySelector('.hcp-host')?.hasAttribute('inert')).toBe(false);
  expect(container.querySelector('.hcp-toolbar')?.hasAttribute('inert')).toBe(false);
});

// 대기 상태 분기를 잃거나 오디오를 중복 렌더하면 실패한다.
it.each(['open', 'in_progress', 'paused'] as const)('%s 상태에서 BGM과 그룹 흐름의 위치를 유지한다', async status => {
  await render(undefined, 100, {
    status, audio: createElement('section', { 'aria-label': '명상 가이드·BGM' }, 'BGM'),
  });
  expect(container.querySelectorAll('[aria-label="명상 가이드·BGM"]')).toHaveLength(1);
  expect(container.querySelector('.hcp-group') === null).toBe(status === 'open');
  const target = status === 'open' ? '.hcp-lobby-audio' : '.hcp-host';
  expect(container.querySelector(`${target} [aria-label="명상 가이드·BGM"]`)).not.toBeNull();
  expect(container.querySelector('.hcp-controls')).toBeNull();
});
it('몰입과 사용 안내를 기존처럼 켜고 끌 수 있다', async () => {
  await render();
  await click(button('몰입'));
  expect(container.querySelector('.hcp-immersed')).not.toBeNull();
  await click(button('사용 안내'));
  expect(container.querySelector('.hcp-coach')).not.toBeNull();
  await click(button('확인'));
  expect(container.querySelector('.hcp-coach')).toBeNull();
  await click(button('몰입 해제'));
  expect(container.querySelector('.hcp-immersed')).toBeNull();
});

it('데스크톱의 작은 목록 영역에서도 페이지 이동으로 모든 참가자에 접근한다', async () => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback([{ target, contentRect: { width: 400, height: 180 } } as ResizeObserverEntry], this);
    }
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  try {
    await render();
    expect(names()).toEqual(['나래', '가람']);
    await click(container.querySelector('[aria-label="다음 참가자 페이지"]'));
    expect(names()).toEqual(['다온']);
    await click(container.querySelector('[aria-label="이전 참가자 페이지"]'));
    await click(button('모두'));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    await click(container.querySelector('[aria-label="다음 참가자 페이지"]'));
    expect(container.querySelector('tbody')?.textContent).toContain('다온');
    await click(button('이완도'));
    await render([row('가람', 70)]);
    expect(names()).toEqual(['가람']);
  } finally { vi.unstubAllGlobals(); }
});
