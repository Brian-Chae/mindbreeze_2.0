// @vitest-environment jsdom
// 개선 8: 그룹 익명 집계 상태 지표(적응형 페이싱) — 순수 로직 + 단일 게이지 + Socket.IO 계약
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io-client';
import { GroupAggregateGauge } from '../src/components/session/GroupAggregateGauge';
import {
  BASELINE_SCORE,
  CLASS_AGGREGATE_EVENT,
  DEFAULT_MIN_WEARERS,
  PACE_META,
  buildGaugeModel,
  clampScore,
  isClassAggregateEvent,
  isSampleSufficient,
  markerPercent,
  metricOffset,
  normalizeAggregate,
  type ClassAggregateEvent,
} from '../src/lib/class/group-aggregate';
import { subscribeClassAggregate } from '../src/lib/socket';

/** 소켓은 계약(이벤트명)만 검증하면 되므로 최소 fake 로 대체한다 */
function fakeSocket(connected: boolean) {
  const emit = vi.fn();
  const on = vi.fn();
  const off = vi.fn();
  return {
    socket: { connected, emit, on, off } as unknown as Socket,
    emit,
    on,
    off,
  };
}

/** 표본 충분한 정상 집계 payload (백엔드 class:aggregate 계약) */
function aggregate(over: Partial<ClassAggregateEvent> = {}): ClassAggregateEvent {
  return {
    session_id: 's1',
    at: '2026-09-29T10:00:00+00:00',
    wearer_count: 5,
    calibrated_count: 5,
    min_wearers: 3,
    calibration_sec: 120,
    baseline_relative: true,
    sample_status: 'ok',
    relaxation: { mean: 68, stability_ratio: 0.8 },
    focus: { mean: 42, stability_ratio: 0.6 },
    pace: 'hold',
    pace_hint: '그룹이 기준선을 유지하고 있습니다 — 지금 흐름을 이어가세요.',
    ...over,
  };
}

/** 표본 부족 payload (착용자 2명 < MIN_WEARERS) */
function insufficient(): ClassAggregateEvent {
  return aggregate({
    wearer_count: 2,
    calibrated_count: 1,
    sample_status: 'insufficient',
    relaxation: { mean: null, stability_ratio: null },
    focus: { mean: null, stability_ratio: null },
    pace: 'insufficient',
    pace_hint: '밴드 착용 인원이 적어 그룹 상태를 판단하지 않습니다 — 개인 카드를 참고하세요.',
  });
}

let root: Root;
let container: HTMLDivElement;

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

function text(): string {
  return container.textContent ?? '';
}

function marker(key: 'relaxation' | 'focus'): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-marker="${key}"]`);
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

// ── 계약 · 순수 로직 ────────────────────────────────────────────────

describe('그룹 집계 계약', () => {
  it('이벤트명은 백엔드와 동일한 class:aggregate 이다', () => {
    expect(CLASS_AGGREGATE_EVENT).toBe('class:aggregate');
  });

  it('기준선은 게이지 가운데(50)이고 4가지 페이스를 모두 표현한다', () => {
    expect(BASELINE_SCORE).toBe(50);
    expect(DEFAULT_MIN_WEARERS).toBe(3);
    for (const pace of ['insufficient', 'slow_down', 'hold', 'deepen'] as const) {
      expect(PACE_META[pace].label).not.toBe('');
      expect(PACE_META[pace].chipClass).not.toBe('');
    }
  });

  it('계약 밖 payload 는 걸러낸다', () => {
    expect(isClassAggregateEvent(aggregate())).toBe(true);
    expect(normalizeAggregate(aggregate())?.wearer_count).toBe(5);

    expect(isClassAggregateEvent(null)).toBe(false);
    expect(isClassAggregateEvent({})).toBe(false);
    expect(isClassAggregateEvent({ ...aggregate(), sample_status: 'maybe' })).toBe(false);
    expect(isClassAggregateEvent({ ...aggregate(), pace: 'rush' })).toBe(false);
    expect(normalizeAggregate({ ...aggregate(), wearer_count: 'many' })).toBeNull();
  });

  it('누락 필드는 안전한 기본값으로 접는다(크래시 금지)', () => {
    const normalized = normalizeAggregate({
      sample_status: 'ok',
      pace: 'hold',
      wearer_count: 4,
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.min_wearers).toBe(DEFAULT_MIN_WEARERS);
    expect(normalized?.relaxation).toEqual({ mean: null, stability_ratio: null });
    expect(normalized?.baseline_relative).toBe(true);
    expect(isSampleSufficient(normalized as ClassAggregateEvent)).toBe(true);
  });

  it('표본 부족은 sample_status·착용자 수 어느 쪽이 부족해도 흐림으로 판정한다', () => {
    expect(isSampleSufficient(aggregate())).toBe(true);
    expect(isSampleSufficient(insufficient())).toBe(false);
    // 서버가 ok 라 해도 착용자가 기준 미만이면 흐리게(방어)
    expect(isSampleSufficient(aggregate({ wearer_count: 2 }))).toBe(false);
  });

  it('게이지 값은 0-100으로 클램프하고 null 은 유지한다', () => {
    expect(clampScore(-10)).toBe(0);
    expect(clampScore(140)).toBe(100);
    expect(clampScore(null)).toBeNull();
    expect(clampScore(Number.NaN)).toBeNull();
    // 값이 없으면 기준선(가운데)에 둔다 — 위치로 의미를 만들어내지 않는다
    expect(markerPercent(null)).toBe(50);
    expect(markerPercent(68)).toBe(68);
  });

  it('기준선 대비 편차는 부호 있는 정수다', () => {
    expect(metricOffset(62)).toBe(12);
    expect(metricOffset(42)).toBe(-8);
    expect(metricOffset(50)).toBe(0);
    expect(metricOffset(null)).toBeNull();
  });
});

describe('게이지 표시 모델', () => {
  it('집계가 없으면 흐린 대기 상태를 만든다', () => {
    const model = buildGaugeModel(null);
    expect(model.dimmed).toBe(true);
    expect(model.sampleLabel).toBe('집계 대기');
    expect(model.markers.every((m) => m.value === null && m.percent === 50)).toBe(true);
    expect(model.markers.every((m) => m.text.includes('산출 대기'))).toBe(true);
  });

  it('표본이 충분하면 이완·집중 두 마커를 기준선 대비로 배치한다', () => {
    const model = buildGaugeModel(aggregate());
    expect(model.dimmed).toBe(false);
    expect(model.sampleLabel).toBe('착용 5명');
    const [relaxation, focus] = model.markers;
    expect(relaxation.key).toBe('relaxation');
    expect(relaxation.percent).toBe(68);
    expect(relaxation.text).toBe('이완 기준선 +18 · 안정 80%');
    expect(focus.percent).toBe(42);
    expect(focus.text).toBe('집중 기준선 -8 · 안정 60%');
  });

  it('표본이 적으면 점수를 숨기고 흐림 + 표본 적음 라벨로 표시한다', () => {
    const model = buildGaugeModel(insufficient());
    expect(model.dimmed).toBe(true);
    expect(model.sampleLabel).toBe('표본 적음 · 착용 2명');
    expect(model.markers.every((m) => m.value === null)).toBe(true);
    expect(model.markers.every((m) => m.text.includes('산출 대기'))).toBe(true);
    expect(model.paceLabel).toBe(PACE_META.insufficient.label);
  });

  it('적응형 페이싱 — 이완이 기준선 아래면 느추기, 충분+안정이면 깊게', () => {
    const slow = buildGaugeModel(
      aggregate({ relaxation: { mean: 30, stability_ratio: 0.9 }, pace: 'slow_down' }),
    );
    expect(slow.pace).toBe('slow_down');
    expect(slow.paceLabel).toBe(PACE_META.slow_down.label);

    const deepen = buildGaugeModel(
      aggregate({
        relaxation: { mean: 72, stability_ratio: 0.9 },
        pace: 'deepen',
        pace_hint: '그룹이 안정적으로 이완했습니다 — 안내를 한 단계 깊게 가도 좋습니다.',
      }),
    );
    expect(deepen.pace).toBe('deepen');
    expect(deepen.hint).toContain('한 단계 깊게');
  });
});

// ── 컴포넌트 ────────────────────────────────────────────────────────

describe('GroupAggregateGauge', () => {
  it('이완·집중 마커와 안내 문구를 단일 게이지에 렌더한다', async () => {
    await render(createElement(GroupAggregateGauge, { aggregate: aggregate() }));

    const gauge = container.querySelector('[data-testid="group-aggregate-gauge"]');
    expect(gauge).not.toBeNull();
    expect(gauge?.getAttribute('data-sample')).toBe('ok');
    expect(gauge?.getAttribute('data-dimmed')).toBe('false');

    // 게이지 축은 하나 — 기준선 눈금 1개 + 마커 2개
    expect(container.querySelectorAll('[data-testid="gauge-baseline"]').length).toBe(1);
    expect(container.querySelectorAll('[data-marker]').length).toBe(2);
    expect(marker('relaxation')?.style.left).toBe('calc(68% - 1.5px)');
    expect(marker('focus')?.style.left).toBe('calc(42% - 1.5px)');

    expect(text()).toContain('그룹 상태');
    expect(text()).toContain('익명 집계');
    expect(text()).toContain('이완 기준선 +18');
    expect(text()).toContain('집중 기준선 -8');
    expect(text()).toContain('착용 5명');
    // 순위·경쟁 표현은 쓰지 않는다
    expect(text()).not.toContain('1위');
    expect(text()).not.toContain('등수');
  });

  it('표본이 적으면 흐리게 표시하고 점수는 숨긴다', async () => {
    await render(createElement(GroupAggregateGauge, { aggregate: insufficient() }));

    const gauge = container.querySelector('[data-testid="group-aggregate-gauge"]');
    expect(gauge?.getAttribute('data-sample')).toBe('insufficient');
    expect(gauge?.getAttribute('data-dimmed')).toBe('true');
    expect(gauge?.className).toContain('opacity-45');
    expect(text()).toContain('표본 적음 · 착용 2명');
    // 숫자 노출 없음 — 마커는 기준선 위치에만 남는다
    expect(marker('relaxation')?.getAttribute('data-value')).toBe('');
    expect(text()).not.toContain('기준선 +');
    expect(text()).toContain('착용자가 3명 이상');
  });

  it('집계 수신 전에는 대기 상태의 흐린 게이지를 유지한다', async () => {
    await render(createElement(GroupAggregateGauge, { aggregate: null }));
    const gauge = container.querySelector('[data-testid="group-aggregate-gauge"]');
    expect(gauge?.getAttribute('data-sample')).toBe('pending');
    expect(gauge?.getAttribute('data-dimmed')).toBe('true');
    expect(text()).toContain('집계 대기');
  });
});

// ── Socket.IO 헬퍼 ─────────────────────────────────────────────────

describe('Socket.IO 헬퍼', () => {
  it('subscribeClassAggregate 는 구독/해제를 같은 핸들러로 위임한다', () => {
    const { socket, on, off } = fakeSocket(true);
    const handler = vi.fn();

    const unsubscribe = subscribeClassAggregate(socket, handler);
    expect(on).toHaveBeenCalledWith('class:aggregate', handler);

    unsubscribe();
    expect(off).toHaveBeenCalledWith('class:aggregate', handler);
  });
});
