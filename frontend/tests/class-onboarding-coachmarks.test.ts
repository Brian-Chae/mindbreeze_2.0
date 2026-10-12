// @vitest-environment jsdom
// 개선 9: 클래스 온보딩 코치마크 — 최초 1회 노출 · 순차 스텝 · 건너뛰기 · 다시 보지 않기
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ClassOnboardingCoachmarks } from '../src/components/class/ClassOnboardingCoachmarks';
import {
  CLASS_ONBOARDING_STORAGE_KEY,
  buildCoachmarkSteps,
  isClassOnboardingSeen,
  isSpeakingManaged,
  markClassOnboardingSeen,
} from '../src/lib/class/class-onboarding';

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

function checkbox(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
}

/** 다음 버튼을 눌러 원하는 스텝까지 이동 */
async function advance(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await act(async () => {
      button('다음')?.click();
    });
  }
}

const ONLINE_GROUP = { locationType: 'online', participantMode: 'group', maxParticipants: 12 } as const;
const ONLINE_ONE_ON_ONE = { locationType: 'online', participantMode: 'one_on_one', maxParticipants: 2 } as const;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
});

// ── 스텝 구성(순수 로직) ───────────────────────────────────────────

it('온라인 그룹(≤20)은 손들기를 포함한 4개 스텝을 만든다', () => {
  const steps = buildCoachmarkSteps(ONLINE_GROUP);
  expect(steps.map((s) => s.id)).toEqual(['publish', 'hand', 'speaker', 'immersive']);
  expect(isSpeakingManaged(ONLINE_GROUP)).toBe(true);
});

it('온라인 1:1은 상시 송출 안내를 만들고 손들기 스텝은 넣지 않는다', () => {
  const steps = buildCoachmarkSteps(ONLINE_ONE_ON_ONE);
  expect(steps.map((s) => s.id)).toEqual(['publish', 'speaker', 'immersive']);
  expect(steps[0].title).toContain('1:1');
  expect(isSpeakingManaged(ONLINE_ONE_ON_ONE)).toBe(false);
});

it('오프라인 또는 정원 20명 초과 그룹은 손들기 대상이 아니다', () => {
  expect(isSpeakingManaged({ locationType: 'offline', participantMode: 'group', maxParticipants: 30 })).toBe(false);
  expect(isSpeakingManaged({ locationType: 'online', participantMode: 'group', maxParticipants: 30 })).toBe(false);
  expect(buildCoachmarkSteps({ locationType: 'online', participantMode: 'group', maxParticipants: 30 })
    .some((s) => s.id === 'hand')).toBe(false);
});

// ── 노출 게이트 ────────────────────────────────────────────────────

it('노출 이력이 있으면 아무것도 렌더하지 않는다', async () => {
  markClassOnboardingSeen();
  expect(isClassOnboardingSeen()).toBe(true);
  await render(createElement(ClassOnboardingCoachmarks, ONLINE_GROUP));
  expect(container.textContent).toBe('');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('최초 진입 시 첫 스텝(기본 뮤트)부터 노출하고 진행 표시를 보여준다', async () => {
  await render(createElement(ClassOnboardingCoachmarks, ONLINE_GROUP));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(container.textContent).toContain('1 / 4');
  expect(container.textContent).toContain('마이크는 기본 뮤트예요');
  expect(button('다음')).toBeDefined();
  expect(button('완료')).toBeUndefined();
  // 첫 스텝에서는 이전 버튼이 비활성화된다
  expect(button('이전')?.disabled).toBe(true);
});

// ── 순차 이동 ──────────────────────────────────────────────────────

it('다음·이전으로 스텝을 순차 이동한다', async () => {
  await render(createElement(ClassOnboardingCoachmarks, ONLINE_GROUP));
  await advance(1);
  expect(container.textContent).toContain('발언은 [손 들기]로 요청해요');
  expect(container.textContent).toContain('2 / 4');
  await advance(1);
  expect(container.textContent).toContain('3 / 4');
  expect(container.textContent).toContain('스피커는 언제든 켜고 끌 수 있어요');
  await act(async () => {
    button('이전')?.click();
  });
  expect(container.textContent).toContain('2 / 4');
});

it('마지막 스텝은 [완료] 버튼을 보여준다', async () => {
  await render(createElement(ClassOnboardingCoachmarks, ONLINE_GROUP));
  await advance(3);
  expect(container.textContent).toContain('4 / 4');
  expect(container.textContent).toContain('몰입 모드 — 화면 끄기');
  expect(button('완료')).toBeDefined();
});

// ── 닫기 동작 ──────────────────────────────────────────────────────

it('[건너뛰기]는 즉시 닫되 [다시 보지 않기]가 꺼져 있으면 저장하지 않는다', async () => {
  await render(createElement(ClassOnboardingCoachmarks, { ...ONLINE_GROUP }));
  await act(async () => {
    button('건너뛰기')?.click();
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(isClassOnboardingSeen()).toBe(false);
});

it('[다시 보지 않기]를 체크하고 건너뛰면 영구 저장한다', async () => {
  await render(createElement(ClassOnboardingCoachmarks, ONLINE_GROUP));
  await act(async () => {
    checkbox().click();
  });
  await act(async () => {
    button('건너뛰기')?.click();
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(isClassOnboardingSeen()).toBe(true);
});

it('마지막 스텝을 완료하면 저장하고 onFinish를 1회 호출한다', async () => {
  let finished = 0;
  await render(
    createElement(ClassOnboardingCoachmarks, {
      ...ONLINE_GROUP,
      onFinish: () => {
        finished += 1;
      },
    }),
  );
  await advance(3);
  await act(async () => {
    button('완료')?.click();
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(isClassOnboardingSeen()).toBe(true);
  expect(finished).toBe(1);
});

it('Escape 키로 스텝 진행과 무관하게 닫을 수 있다', async () => {
  await render(createElement(ClassOnboardingCoachmarks, ONLINE_GROUP));
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('forceOpen이면 노출 이력이 있어도 강제로 연다', async () => {
  markClassOnboardingSeen();
  await render(createElement(ClassOnboardingCoachmarks, { ...ONLINE_GROUP, forceOpen: true }));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(container.textContent).toContain('마이크는 기본 뮤트예요');
});

it('게스트(비로그인)도 세션 모드만으로 동일하게 안내한다', async () => {
  // localStorage가 비어 있으면 인증 여부와 무관하게 노출된다
  expect(localStorage.getItem(CLASS_ONBOARDING_STORAGE_KEY)).toBeNull();
  await render(createElement(ClassOnboardingCoachmarks, ONLINE_ONE_ON_ONE));
  expect(container.textContent).toContain('1:1 수업은 상시 송출이에요');
  expect(container.textContent).toContain('1 / 3');
});
