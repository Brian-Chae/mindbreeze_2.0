// @vitest-environment jsdom
// SDD-096 — 세션 직후 1탭 셀프 체크인: 계약 파싱 · 비교 파생 · API 호출 · SAM 패널 렌더/스킵

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildSubjectiveComparison,
  parseSubjectiveState,
  parseSubjectiveSlot,
  submitCheckin,
  CHECKIN_SKIP_STORAGE_KEY,
} from '../src/lib/api/checkin';
import { tokenStorage } from '../src/lib/api/client';
import { relaxationTrendFromTimeline } from '../src/lib/api/report';
import { SelfCheckinPanel } from '../src/components/class/SelfCheckinPanel';

const SESSION_ID = 'session-096';
const PARTICIPANT_ID = 'participant-096';

interface FetchCall {
  url: string;
  init: RequestInit;
  body: Record<string, unknown> | null;
}

let calls: FetchCall[] = [];

function mockFetch(): void {
  calls = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const rawBody = typeof init?.body === 'string' ? init.body : null;
    calls.push({
      url,
      init: init ?? {},
      body: rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : null,
    });
    if (url.includes('/auth/refresh')) {
      return new Response(JSON.stringify({ access_token: 'fresh-token' }), { status: 200 });
    }
    if (url.includes('/checkin')) {
      const sent = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
      const phase = sent.phase === 'before' ? 'before' : 'after';
      const slot = {
        arousal: sent.arousal ?? null,
        valence: sent.valence ?? null,
        note: sent.note ?? null,
        recorded_at: '2026-09-29T12:00:00+00:00',
      };
      return new Response(
        JSON.stringify({
          session_id: SESSION_ID,
          participant_id: PARTICIPANT_ID,
          phase,
          subjective_state: {
            scope: 'participant',
            before: phase === 'before' ? slot : null,
            after: phase === 'after' ? slot : null,
          },
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ detail: 'not mocked' }), { status: 404 });
  });
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  mockFetch();
  tokenStorage.clear();
  window.localStorage.clear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

// ── 1. 계약 파싱 ────────────────────────────────────────────────────────

describe('subjective_state 계약', () => {
  it('참여자 스코프 슬롯을 파싱하고 빈 값은 null 로 보존한다', () => {
    const state = parseSubjectiveState({
      scope: 'participant',
      before: { arousal: 4, valence: 2, note: '긴장될 것 같아요', recorded_at: 't1' },
      after: { arousal: null, valence: 5, note: null, recorded_at: 't2' },
    });
    expect(state).not.toBeNull();
    expect(state!.scope).toBe('participant');
    expect(state!.before?.arousal).toBe(4);
    // 미입력 축은 0 으로 치환하지 않는다
    expect(state!.after?.arousal).toBeNull();
    expect(state!.after?.valence).toBe(5);
  });

  it('두 시점 모두 비어 있으면 null (카드 미노출)', () => {
    expect(parseSubjectiveState({ scope: 'participant', before: null, after: null })).toBeNull();
    expect(parseSubjectiveState(null)).toBeNull();
    expect(parseSubjectiveState('nope')).toBeNull();
  });

  it('세션 스코프(상담사 뷰)는 참여자별 슬롯을 파싱한다', () => {
    const state = parseSubjectiveState({
      scope: 'session',
      participants: {
        'p-1': { before: null, after: { arousal: 3, valence: 4, note: null, recorded_at: 't' } },
        'p-2': { before: null, after: null },
      },
    });
    expect(state?.scope).toBe('session');
    expect(Object.keys(state?.participants ?? {})).toEqual(['p-1', 'p-2']);
    expect(state?.participants?.['p-1'].after?.valence).toBe(4);
    expect(state?.participants?.['p-2'].after).toBeNull();
  });

  it('범위 밖 값은 버린다(1~5만 유효)', () => {
    expect(parseSubjectiveSlot({ arousal: 9, valence: 2, note: null })).toEqual({
      arousal: null,
      valence: 2,
      note: null,
      recorded_at: null,
    });
  });
});

describe('예상 ↔ 결과 대비', () => {
  it('두 시점이 모두 있으면 델타 요약을 만든다', () => {
    const result = buildSubjectiveComparison(
      { arousal: 4, valence: 2, note: null, recorded_at: null },
      { arousal: 2, valence: 5, note: '가라앉았어요', recorded_at: null },
    );
    expect(result.hasBefore).toBe(true);
    expect(result.arousalDelta).toBe(-2);
    expect(result.valenceDelta).toBe(3);
    expect(result.summary).toBe('각성 4 → 2 (-2) · 정서 2 → 5 (+3)');
  });

  it('한쪽 값이 비면 그 축은 대비에서 제외한다(허수 대비 금지)', () => {
    const result = buildSubjectiveComparison(
      { arousal: 4, valence: null, note: null, recorded_at: null },
      { arousal: null, valence: 5, note: null, recorded_at: null },
    );
    expect(result.hasBefore).toBe(false);
    expect(result.summary).toBeNull();
    expect(result.arousalDelta).toBeNull();
  });
});

describe('EEG 이완도 추이', () => {
  it('처음·마지막 유효값을 돌려준다(null 은 건너뛴다)', () => {
    expect(
      relaxationTrendFromTimeline([
        { min: 0, concentration: null, relaxation: 12, stress: null },
        { min: 1, concentration: null, relaxation: null, stress: null },
        { min: 2, concentration: null, relaxation: 31, stress: null },
      ]),
    ).toEqual({ first: 12, last: 31 });
  });

  it('유효 표본이 1개 이하면 null (추이를 가장하지 않는다)', () => {
    expect(relaxationTrendFromTimeline([{ min: 0, concentration: null, relaxation: 9, stress: null }])).toBeNull();
    expect(relaxationTrendFromTimeline([])).toBeNull();
    expect(relaxationTrendFromTimeline(null)).toBeNull();
  });
});

// ── 2. API 호출 ─────────────────────────────────────────────────────────

describe('POST /sessions/{id}/checkin', () => {
  it('게스트(비로그인)는 participant_token 소유 증명으로 skipAuth 호출한다', async () => {
    await submitCheckin(SESSION_ID, {
      phase: 'after',
      arousal: 2,
      valence: 5,
      note: '몸이 가벼워졌어요',
      participant_id: PARTICIPANT_ID,
      participant_token: 'guest-token',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain(`/sessions/${SESSION_ID}/checkin`);
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(calls[0].body).toEqual({
      phase: 'after',
      arousal: 2,
      valence: 5,
      note: '몸이 가벼워졌어요',
      participant_id: PARTICIPANT_ID,
      participant_token: 'guest-token',
    });
  });

  it('로그인 회원은 액세스 토큰으로 본인 확인 후 호출한다', async () => {
    tokenStorage.set('member-token');
    await submitCheckin(SESSION_ID, { phase: 'before', arousal: 4 });

    const checkinCall = calls.find((call) => call.url.includes('/checkin'));
    expect(checkinCall).not.toBeUndefined();
    const headers = checkinCall!.init.headers as Record<string, string>;
    // 만료 대비 refresh 1회 후 최신 토큰으로 호출한다
    expect(headers.Authorization).toBe('Bearer fresh-token');
    // 선택하지 않은 축은 null 로 명시 전송한다(기본값 의존 금지)
    expect(checkinCall!.body).toEqual({
      phase: 'before',
      arousal: 4,
      valence: null,
      note: null,
      participant_id: null,
      participant_token: null,
    });
  });
});

// ── 3. 종료 화면 SAM 패널 ────────────────────────────────────────────────

async function renderPanel(onSubmitted = vi.fn()): Promise<void> {
  await act(async () => {
    root.render(
      createElement(SelfCheckinPanel, {
        sessionId: SESSION_ID,
        participantId: PARTICIPANT_ID,
        participantToken: 'guest-token',
        isLoggedIn: false,
        relaxationIndex: 42,
        onSubmitted,
      }),
    );
  });
}

function buttonByLabel(label: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button, `버튼 없음: ${label}`).not.toBeNull();
  return button!;
}

describe('SelfCheckinPanel', () => {
  it('각성·정서 2축 × 5단계 버튼을 렌더하고 선택 전에는 저장을 막는다', async () => {
    await renderPanel();
    expect(container.querySelector('[data-testid="self-checkin"]')).not.toBeNull();
    // 2축 × 5단계 = 10개 (수업 전 예상은 접힘 상태)
    expect(container.querySelectorAll('button[aria-label^="각성"]').length).toBe(5);
    expect(container.querySelectorAll('button[aria-label^="정서"]').length).toBe(5);
    expect(container.querySelector('[data-testid="checkin-before"]')).toBeNull();

    const submit = [...container.querySelectorAll('button')].find((b) => b.textContent === '체크인 남기기')!;
    expect(submit.disabled).toBe(true);
  });

  it('1탭 선택 후 저장하면 수업 후 슬롯만 POST 하고 완료 뷰를 보여준다', async () => {
    const onSubmitted = vi.fn();
    await renderPanel(onSubmitted);

    await act(async () => buttonByLabel('각성 2단계 조용해요').click());
    await act(async () => buttonByLabel('정서 5단계 아주 좋아요').click());
    const submit = [...container.querySelectorAll('button')].find((b) => b.textContent === '체크인 남기기')!;
    await act(async () => submit.click());

    expect(calls.filter((call) => call.url.includes('/checkin'))).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ phase: 'after', arousal: 2, valence: 5 });

    expect(container.querySelector('[data-testid="self-checkin-done"]')).not.toBeNull();
    expect(container.textContent).toContain('두뇌휴식도 42');
    expect(container.textContent).toContain('수업 후 · 각성 2 · 정서 5');
    const state = onSubmitted.mock.calls[0][0];
    expect(state.after.valence).toBe(5);
    expect(state.before).toBeNull();
  });

  it('수업 전 예상을 남기면 두 시점을 따로 저장하고 대비 요약을 보여준다', async () => {
    await renderPanel();

    await act(async () => buttonByLabel('각성 2단계 조용해요').click());
    await act(async () => buttonByLabel('정서 5단계 아주 좋아요').click());
    const toggle = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === '수업 전 예상도 남기기 (선택)',
    )!;
    await act(async () => toggle.click());
    // 수업 전 슬롯은 같은 축이 두 번 나타나므로 라벨로 구분한다
    await act(async () => buttonByLabel('수업 전 각성 4단계 조금 긴장돼요').click());
    await act(async () => buttonByLabel('수업 전 정서 2단계 불편해요').click());

    const submit = [...container.querySelectorAll('button')].find((b) => b.textContent === '체크인 남기기')!;
    await act(async () => submit.click());

    const checkinCalls = calls.filter((call) => call.url.includes('/checkin'));
    expect(checkinCalls.map((call) => call.body?.phase)).toEqual(['after', 'before']);
    expect(container.textContent).toContain('각성 4 → 2 (-2) · 정서 2 → 5 (+3)');
  });

  it('건너뛰기는 저장 호출 없이 패널을 숨기고 다시 묻지 않도록 기록한다', async () => {
    await renderPanel();
    expect(container.querySelector('[data-testid="self-checkin"]')).not.toBeNull();

    const skip = [...container.querySelectorAll('button')].find((b) => b.textContent === '건너뛰기')!;
    await act(async () => skip.click());

    expect(calls.filter((call) => call.url.includes('/checkin'))).toHaveLength(0);
    expect(container.querySelector('[data-testid="self-checkin"]')).toBeNull();
    expect(window.localStorage.getItem(CHECKIN_SKIP_STORAGE_KEY)).toBe(SESSION_ID);

    // 새로고침(재마운트)해도 다시 묻지 않는다
    await act(async () => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await renderPanel();
    expect(container.querySelector('[data-testid="self-checkin"]')).toBeNull();
  });
});
