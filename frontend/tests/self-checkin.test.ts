// @vitest-environment jsdom
// 사전·사후 설문(집중·편안함·감정 3축) — 계약 파싱 · API 호출 · 패널 렌더/스킵

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
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
        emotion: sent.emotion ?? null,
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
      before: { arousal: 4, valence: 2, emotion: null, note: '긴장될 것 같아요', recorded_at: 't1' },
      after: { arousal: null, valence: 5, emotion: 4, note: null, recorded_at: 't2' },
    });
    expect(state).not.toBeNull();
    expect(state!.scope).toBe('participant');
    expect(state!.before?.arousal).toBe(4);
    // 미입력 축은 0 으로 치환하지 않는다
    expect(state!.after?.arousal).toBeNull();
    expect(state!.after?.valence).toBe(5);
    expect(state!.after?.emotion).toBe(4);
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
        'p-1': { before: null, after: { arousal: 3, valence: 4, emotion: 2, note: null, recorded_at: 't' } },
        'p-2': { before: null, after: null },
      },
    });
    expect(state?.scope).toBe('session');
    expect(Object.keys(state?.participants ?? {})).toEqual(['p-1', 'p-2']);
    expect(state?.participants?.['p-1'].after?.valence).toBe(4);
    expect(state?.participants?.['p-1'].after?.emotion).toBe(2);
    expect(state?.participants?.['p-2'].after).toBeNull();
  });

  it('범위 밖 값은 버린다(1~5만 유효)', () => {
    expect(parseSubjectiveSlot({ arousal: 9, valence: 2, note: null })).toEqual({
      arousal: null,
      valence: 2,
      emotion: null,
      note: null,
      recorded_at: null,
    });
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
      emotion: 4,
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
      emotion: 4,
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
      emotion: null,
      note: null,
      participant_id: null,
      participant_token: null,
    });
  });
});

// ── 3. 종료 화면 사전·사후 설문 패널 ─────────────────────────────────────

async function renderPanel(onSubmitted = vi.fn()): Promise<void> {
  await act(async () => {
    root.render(
      createElement(SelfCheckinPanel, {
        sessionId: SESSION_ID,
        participantId: PARTICIPANT_ID,
        participantToken: 'guest-token',
        isLoggedIn: false,
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
  it('사전(수업 전)·사후(수업 후) 각 3축 × 5단계 버튼을 렌더하고 선택 전에는 저장을 막는다', async () => {
    await renderPanel();
    expect(container.querySelector('[data-testid="self-checkin"]')).not.toBeNull();
    expect(container.textContent).toContain('오늘의 클래스는 어떠셨나요?');
    expect(container.textContent).toContain('수업 전에는 어땠나요?');
    expect(container.textContent).toContain('수업 후에는 어땠나요?');

    // 사전·사후 × 3축(집중·편안함·감정) × 5단계 = 30개
    for (const phase of ['수업 전 ', '수업 후 ']) {
      expect(container.querySelectorAll(`button[aria-label^="${phase}집중"]`).length).toBe(5);
      expect(container.querySelectorAll(`button[aria-label^="${phase}편안함"]`).length).toBe(5);
      expect(container.querySelectorAll(`button[aria-label^="${phase}감정"]`).length).toBe(5);
    }

    const submit = [...container.querySelectorAll('button')].find((b) => b.textContent === '설문 남기기')!;
    expect(submit.disabled).toBe(true);
  });

  it('사후만 선택하면 after 슬롯만 POST 하고 완료 시 카드 없이 패널을 숨긴다', async () => {
    const onSubmitted = vi.fn();
    await renderPanel(onSubmitted);

    await act(async () => buttonByLabel('수업 후 집중 2단계 산만').click());
    await act(async () => buttonByLabel('수업 후 편안함 5단계 매우 편안').click());
    await act(async () => buttonByLabel('수업 후 감정 4단계 긍정적').click());
    const submit = [...container.querySelectorAll('button')].find((b) => b.textContent === '설문 남기기')!;
    await act(async () => submit.click());

    expect(calls.filter((call) => call.url.includes('/checkin'))).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ phase: 'after', arousal: 2, valence: 5, emotion: 4 });

    // 완료 카드 제거 — 패널 자체가 사라지고 종료 화면의 '수업이 종료되었습니다'만 남는다
    expect(container.querySelector('[data-testid="self-checkin"]')).toBeNull();
    expect(container.querySelector('[data-testid="self-checkin-done"]')).toBeNull();
    expect(onSubmitted).toHaveBeenCalled();
  });

  it('사전·사후 모두 남기면 after → before 순서로 2회 POST 한다(사전·사후 변화 저장)', async () => {
    await renderPanel();

    // 사전: 집중 3 · 편안함 2
    await act(async () => buttonByLabel('수업 전 집중 3단계 보통').click());
    await act(async () => buttonByLabel('수업 전 편안함 2단계 불편').click());
    // 사후: 집중 4 · 감정 5
    await act(async () => buttonByLabel('수업 후 집중 4단계 집중').click());
    await act(async () => buttonByLabel('수업 후 감정 5단계 매우 긍정적').click());
    const submit = [...container.querySelectorAll('button')].find((b) => b.textContent === '설문 남기기')!;
    await act(async () => submit.click());

    const checkinCalls = calls.filter((call) => call.url.includes('/checkin'));
    expect(checkinCalls).toHaveLength(2);
    // 사후(수업 후)를 먼저 저장한다
    expect(checkinCalls[0].body).toMatchObject({ phase: 'after', arousal: 4, valence: null, emotion: 5 });
    // 사전(수업 전)을 이어 저장한다(사전 슬롯에는 소감을 싣지 않는다)
    expect(checkinCalls[1].body).toMatchObject({ phase: 'before', arousal: 3, valence: 2, emotion: null, note: null });

    expect(container.querySelector('[data-testid="self-checkin"]')).toBeNull();
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
