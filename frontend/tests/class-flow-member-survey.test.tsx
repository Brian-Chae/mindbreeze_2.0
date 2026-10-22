// @vitest-environment jsdom
// SDD-209 M3 — FM06b 오늘의 상태 설문(3축 5단계 + 전할 말) · 시작 후 시트 · 입장 자격 체크인
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StartedSheet } from '../src/components/class/flow/member/StartedSheet';
import { SurveyStepView, type SurveyStepViewProps } from '../src/components/class/flow/member/SurveyStepView';
import { SURVEY_NOTE_MAX, emptySurveyDraft, surveyHasValue, surveyPayload } from '../src/lib/class/flow/member-survey';
import { remainingPrepLabels } from '../src/lib/class/flow/member-prep';

const post = vi.fn();
vi.mock('../src/lib/api/client', () => ({
  ApiError: class extends Error {},
  apiClient: { post: (...a: unknown[]) => post(...a), get: vi.fn(), put: vi.fn() },
  tokenStorage: { getAccess: () => null },
  refreshAccessToken: vi.fn(),
}));
import { submitEntryCheckin } from '../src/lib/api/class-flow';

let root: Root;
let container: HTMLDivElement;
async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(node); });
}
const qa = <T extends Element = HTMLElement>(sel: string): T[] => [...document.querySelectorAll<T>(sel)];
const text = (): string => document.body.textContent ?? '';
const btn = (label: string): HTMLButtonElement | undefined => qa<HTMLButtonElement>('button').find((b) => (b.textContent ?? '').trim() === label);
const noop = (): void => undefined;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  post.mockReset();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function survey(over: Partial<SurveyStepViewProps> = {}): SurveyStepViewProps {
  return {
    question: 1, draft: emptySurveyDraft(), steps: { total: 5, current: 1 }, saving: false, errorText: null,
    onSelect: noop, onNote: noop, onNext: noop, onSkip: noop, onBack: noop, onExit: noop, ...over,
  };
}

describe('설문 순수 로직', () => {
  it('값이 하나라도 있어야 제출 의미가 있다(축 선택 또는 전할 말)', () => {
    expect(surveyHasValue(emptySurveyDraft())).toBe(false);
    expect(surveyHasValue({ answers: { arousal: 4, valence: null, emotion: null }, note: '' })).toBe(true);
    expect(surveyHasValue({ answers: { arousal: null, valence: null, emotion: null }, note: '  목이 불편해요 ' })).toBe(true);
    expect(surveyHasValue({ answers: { arousal: null, valence: null, emotion: null }, note: '   ' })).toBe(false);
  });
  it('요청 페이로드는 phase=before, 미입력은 null, 전할 말은 자르고 200자 제한', () => {
    expect(surveyPayload({ answers: { arousal: 4, valence: 3, emotion: null }, note: '  안녕 ' }, 'p1')).toEqual({
      phase: 'before', arousal: 4, valence: 3, emotion: null, note: '안녕', participant_id: 'p1',
    });
    expect(surveyPayload(emptySurveyDraft(), 'p1').note).toBeNull();
    expect(surveyPayload({ answers: emptySurveyDraft().answers, note: 'a'.repeat(300) }, 'p1').note).toHaveLength(SURVEY_NOTE_MAX);
  });
  it('시작 후 시트의 남은 준비는 현재 단계부터 센다', () => {
    expect(remainingPrepLabels(['a', 'b', 'c', 'd', 'e'], 'b')).toEqual(['오늘의 상태', 'LINK BAND', '기기']);
    expect(remainingPrepLabels(['a', 'b', 'c', 'd', 'e'], 'c')).toEqual(['LINK BAND', '기기']);
    expect(remainingPrepLabels(['a', 'b', 'e'], 'b')).toEqual(['오늘의 상태']);
    expect(remainingPrepLabels(['a', 'b', 'c', 'e'], 'd')).toEqual([]);
  });
});

describe('FM06b 화면', () => {
  it('q1~q3: 질문·5단계 라벨(숫자 라벨 없음)·다음 비활성(선택 전)·건너뛰기', async () => {
    const expected: Array<[1 | 2 | 3, string, string[]]> = [
      [1, '지금 집중은 어떤가요?', ['매우 산만', '산만', '보통', '집중', '매우 집중']],
      [2, '지금 몸은 얼마나 편안한가요?', ['매우 불편', '불편', '보통', '편안', '매우 편안']],
      [3, '지금 기분은 어떤가요?', ['매우 부정적', '부정적', '보통', '긍정적', '매우 긍정적']],
    ];
    for (const [question, heading, labels] of expected) {
      await render(<SurveyStepView {...survey({ question })} />);
      expect(text()).toContain(heading);
      expect(text()).toContain('가장 가까운 느낌을 하나 골라 주세요.');
      expect(qa('[role="radio"]').map((r) => r.textContent)).toEqual(labels);
      expect(text()).not.toMatch(/\b[1-5]\s*점|\b[1-5]\/5/);
      expect(btn('다음')!.disabled).toBe(true);
      expect(btn('건너뛰기')).toBeDefined();
    }
  });
  it('상단 칩은 집중·편안함·감정·전할 말, 현재 칸 강조', async () => {
    await render(<SurveyStepView {...survey({ question: 2 })} />);
    expect(qa('.fm-ax').map((e) => e.textContent)).toEqual(['집중', '편안함', '감정', '전할 말']);
    expect(qa('.fm-ax').map((e) => e.getAttribute('data-state'))).toEqual(['done', 'on', null, null]);
  });
  it('선택하면 다음이 켜지고 선택 이벤트가 축·값으로 전달된다', async () => {
    const onSelect = vi.fn();
    await render(<SurveyStepView {...survey({ question: 1, onSelect })} />);
    await act(async () => { qa('[role="radio"]')[3]!.click(); });
    expect(onSelect).toHaveBeenCalledWith('arousal', 4);
    await render(<SurveyStepView {...survey({ question: 1, draft: { answers: { arousal: 4, valence: null, emotion: null }, note: '' }, onSelect })} />);
    expect(btn('다음')!.disabled).toBe(false);
    expect(qa<HTMLButtonElement>('[role="radio"]').map((r) => r.tabIndex)).toEqual([-1, -1, -1, 0, -1]);
    expect(qa('[role="radio"]').map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'true', 'false']);
  });
  it('현재 문항을 알리고 방향키·Home·End로 원래 값을 선택하고 포커스를 옮긴다', async () => {
    const onSelect = vi.fn();
    await render(<SurveyStepView {...survey({ onSelect })} />);
    expect(document.querySelector('.fm-ax[aria-current="step"]')?.textContent).toBe('집중');
    const radios = qa<HTMLButtonElement>('[role="radio"]');
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    for (const [index, key, target, value] of [[0, 'ArrowRight', 1, 2], [1, 'End', 4, 5], [4, 'ArrowDown', 0, 1], [0, 'ArrowLeft', 4, 5], [4, 'Home', 0, 1]] as const) {
      await act(async () => { radios[index]!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
      expect(onSelect).toHaveBeenLastCalledWith('arousal', value);
      expect(document.activeElement).toBe(radios[target]);
    }
  });
  it('q4: 전할 말(선택) · 글자 수 · 200자 제한 · 남기고 계속하기/건너뛰기', async () => {
    const onNote = vi.fn();
    await render(<SurveyStepView {...survey({ question: 4, draft: { answers: emptySurveyDraft().answers, note: '목이 조금 불편해요' }, onNote })} />);
    expect(text()).toContain('상담사에게 전하고 싶은 말이 있나요?');
    expect(text()).toContain('선택이에요. 적지 않아도 괜찮아요.');
    expect(text()).toContain('10 / 200');
    const area = document.querySelector('textarea')!;
    expect(area.maxLength).toBe(200);
    expect(btn('남기고 계속하기')!.disabled).toBe(false);
    expect(btn('건너뛰기')).toBeDefined();
  });
  it('저장 실패 문구와 저장 중 비활성', async () => {
    await render(<SurveyStepView {...survey({ question: 4, errorText: '저장하지 못했어요. 건너뛰고 계속할 수 있어요.' })} />);
    expect(qa('[role="alert"]').map((e) => e.textContent)).toEqual(['저장하지 못했어요. 건너뛰고 계속할 수 있어요.']);
    expect(btn('건너뛰기')!.disabled).toBe(false);
    await render(<SurveyStepView {...survey({ question: 4, saving: true })} />);
    expect(btn('남기고 계속하기')!.disabled).toBe(true);
  });
  it('시작 후 시트: 남은 준비 · 지금 입장하기 · 준비 이어서 하기, 시트가 열리면 하단 푸터는 inert', async () => {
    const onEnterNow = vi.fn();
    const onContinue = vi.fn();
    await render(
      <SurveyStepView
        {...survey({ question: 2 })}
        startedSheet={<StartedSheet open remaining={['오늘의 상태', 'LINK BAND', '기기']} onEnterNow={onEnterNow} onContinue={onContinue} />}
        sheetOpen
      />,
    );
    expect(text()).toContain('상담사가 클래스를 시작했어요');
    expect(text()).toContain('남은 준비: 오늘의 상태 · LINK BAND · 기기');
    expect(text()).toContain('건너뛴 준비는 입장한 뒤 진행 화면의 도구에서 이어서 할 수 있어요.');
    expect(document.querySelector('[data-pz="flow-foot"]')?.closest('[inert]')).not.toBeNull();
    await act(async () => { btn('지금 입장하기')!.click(); });
    expect(onEnterNow).toHaveBeenCalledTimes(1);
    await act(async () => { btn('준비 이어서 하기')!.click(); });
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

describe('입장 자격 체크인', () => {
  it('phase=before 체크인을 입장 자격 헤더와 함께 보낸다(참여자 토큰 아님)', async () => {
    post.mockResolvedValue({});
    await submitEntryCheckin('s1', 'cred', { phase: 'before', arousal: 4, valence: null, emotion: null, note: null, participant_id: 'p1' });
    expect(post).toHaveBeenCalledWith(
      '/sessions/s1/checkin',
      { phase: 'before', arousal: 4, valence: null, emotion: null, note: null, participant_id: 'p1' },
      { skipAuth: true, headers: { 'X-Entry-Credential': 'cred' } },
    );
  });
});
