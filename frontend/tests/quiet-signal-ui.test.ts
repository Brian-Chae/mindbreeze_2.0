// @vitest-environment jsdom
// 개선 5: 무음 시그널 UI — 회원 3버튼(조용한 전송/실패 안내) · 상담사 카드 배지·상단 집계
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuietSignalButtons } from '../src/components/class/QuietSignalButtons';
import { QuietSignalSummary } from '../src/components/session/QuietSignalSummary';
import { SessionParticipantCardGrid } from '../src/components/session/SessionParticipantCardGrid';
import type { SessionLiveMetric } from '../src/lib/api/session';
import {
  SIGNAL_ACTIVE_MS,
  SIGNAL_FLASH_MS,
  countSignals,
  recordSignal,
} from '../src/lib/class/quiet-signal';

let root: Root;
let container: HTMLDivElement;

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

/** 텍스트로 버튼을 찾는다(기존 클래스 테스트 하네스와 동일한 방식) */
function button(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((el) => el.textContent === text);
}

function text(): string {
  return container.textContent ?? '';
}

/** 밴드 미착용 참여자 행 — 무음 시그널은 밴드 유무와 무관하다 */
function row(participantId: string, displayName: string): SessionLiveMetric {
  return {
    participant_id: participantId,
    user_id: null,
    display_name: displayName,
    is_guest: true,
    band_connected: false,
    device_status: null,
    band_battery: null,
    avg_efficiency: null,
    current_efficiency: null,
    upload_status: 'idle',
    last_eeg_at: null,
    raise_hand: false,
    speaking: false,
  };
}

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

// ── 회원 화면: 조용한 신호 버튼 3종 ─────────────────────────────────

describe('QuietSignalButtons', () => {
  it('3종 버튼을 렌더하고 클릭 시 해당 신호를 전송한다', async () => {
    const onSend = vi.fn(() => true);
    await render(createElement(QuietSignalButtons, { onSend }));

    expect(button('🌿잘 따라가요')).toBeDefined();
    expect(button('💧조금 어려워요')).toBeDefined();
    expect(button('🌙잠시 쉴게요')).toBeDefined();
    // 발언권과 독립 — 비활성 조건 없이 항상 누를 수 있다
    expect(button('🌿잘 따라가요')?.disabled).toBe(false);

    await act(async () => {
      button('🌿잘 따라가요')?.click();
    });

    expect(onSend).toHaveBeenCalledWith('following');
    expect(text()).toContain('상담사에게 조용히 전달했어요');
    expect(button('🌿잘 따라가요')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('미연결(전송 실패)이면 팝업 없이 조용한 안내 문구만 보여준다', async () => {
    const onSend = vi.fn(() => false);
    await render(createElement(QuietSignalButtons, { onSend }));

    await act(async () => {
      button('🌙잠시 쉴게요')?.click();
    });

    expect(onSend).toHaveBeenCalledWith('resting');
    expect(text()).toContain('전송하지 못했어요');
    expect(text()).not.toContain('상담사에게 조용히 전달했어요');
  });
});

// ── 상담사 화면: 카드 배지(은은·페이드) + 상단 집계 ─────────────────

describe('SessionParticipantCardGrid — 무음 시그널 배지', () => {
  const participants = [row('p1', '게스트A'), row('p2', '게스트B')];

  it('신호가 있는 참여자 카드에만 은은한 배지를 표시한다', async () => {
    const now = Date.now();
    const signals = recordSignal({}, 'p1', 'difficult', now);

    await render(
      createElement(SessionParticipantCardGrid, {
        participants,
        filter: null,
        selectedId: null,
        onSelect: vi.fn(),
        signals,
      }),
    );

    expect(text().split('조금 어려워요').length - 1).toBe(1);
    const badge = container.querySelector('.mb-quiet-signal');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('aria-label')).toBe('상태 신호: 조금 어려워요');
  });

  it('페이드 애니메이션은 카드 표시 시간(SIGNAL_FLASH_MS)으로 걸린다', async () => {
    await render(
      createElement(SessionParticipantCardGrid, {
        participants: [row('p1', '게스트A')],
        filter: null,
        selectedId: null,
        onSelect: vi.fn(),
        signals: recordSignal({}, 'p1', 'following', Date.now()),
      }),
    );

    const style = container.querySelector('style')?.textContent ?? '';
    expect(style).toContain(`mb-quiet-signal-fade ${SIGNAL_FLASH_MS}ms`);
  });

  it('signals 가 없으면(또는 다른 참여자만 있으면) 배지를 그리지 않는다', async () => {
    await render(
      createElement(SessionParticipantCardGrid, {
        participants,
        filter: null,
        selectedId: null,
        onSelect: vi.fn(),
        signals: { p_other: { type: 'following', at: Date.now() } },
      }),
    );

    expect(container.querySelector('.mb-quiet-signal')).toBeNull();
    expect(text()).not.toContain('잘 따라가요');
    expect(text()).toContain('게스트A'); // 카드 자체는 정상 표시
  });
});

describe('QuietSignalSummary — 상단 집계 카운트', () => {
  it('활성 신호가 없으면 아무것도 렌더하지 않는다', async () => {
    await render(createElement(QuietSignalSummary, { counts: countSignals({}, Date.now()) }));
    expect(container.textContent).toBe('');
  });

  it('유형별 카운트만 조용히 표시한다', async () => {
    let map = {};
    const now = Date.now();
    map = recordSignal(map, 'p1', 'following', now);
    map = recordSignal(map, 'p2', 'following', now);
    map = recordSignal(map, 'p3', 'difficult', now);

    await render(createElement(QuietSignalSummary, { counts: countSignals(map, now) }));

    expect(text()).toContain('조용한 신호');
    expect(text()).toContain('잘 따라가요 2');
    expect(text()).toContain('조금 어려워요 1');
    expect(text()).not.toContain('잠시 쉴게요'); // 카운트 0 인 유형은 숨김
  });

  it('TTL 이 지난 신호는 집계에서 빠진다', async () => {
    const now = Date.now();
    const stale = recordSignal({}, 'p1', 'resting', now - SIGNAL_ACTIVE_MS - 1);
    await render(
      createElement(QuietSignalSummary, { counts: countSignals(stale, now), }),
    );
    expect(container.textContent).toBe('');
  });
});
