// @vitest-environment jsdom
// SDD-209 H1 — 만들기 마법사 뷰(FH02a·FH02b): 렌더·상호작용·문구
import { act, createElement, useReducer, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WizardView } from '../src/components/class/flow/host/CreateWizard';
import { FIXTURE_BASE, FIXTURE_MEMBERS, fixtureDraft } from '../src/lib/class/flow/host-fixture-data';
import { createInitialDraft, createInitialState, wizardReducer, type WizardDraft, type WizardState } from '../src/lib/class/class-wizard';

let root: Root;
let container: HTMLDivElement;

function Harness({ initial, onExit, conflictTitle }: { initial: WizardState; onExit?: () => void; conflictTitle?: string | null }): ReactNode {
  const [state, dispatch] = useReducer(wizardReducer, initial);
  return createElement(WizardView, { state, dispatch, onExit, base: FIXTURE_BASE, members: FIXTURE_MEMBERS, conflictTitle, onCsvText: () => undefined });
}

async function mount(step: WizardState['step'], patch: Partial<WizardDraft> = {}, onExit?: () => void, conflictTitle?: string | null, ui: Partial<WizardState['ui']> = {}): Promise<void> {
  const base = createInitialState({ ...createInitialDraft(), ...patch });
  const initial: WizardState = { ...base, step, ui: { ...base.ui, ...ui } };
  await act(async () => root.render(createElement(Harness, { initial, onExit, conflictTitle })));
}
const typeInto = async (el: HTMLInputElement, value: string): Promise<void> => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const text = (): string => container.textContent ?? '';
const click = async (el: Element | null): Promise<void> => { await act(async () => { (el as HTMLElement).click(); }); };
const byText = (sel: string, t: string): HTMLElement | null => [...container.querySelectorAll<HTMLElement>(sel)].find((el) => el.textContent?.includes(t)) ?? null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(window, { matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }) });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('FH02a 유형·방식·인원', () => {
  it('유형 4종·진행 방식·인원을 보이고 진행 점은 5개', async () => {
    await mount(1);
    expect(text()).toContain('어떤 클래스를 만들까요?');
    for (const label of ['임상심리상담', '최면심리상담', '명상', '기타', '온라인', '오프라인(대면)', '1:1', '그룹']) expect(text()).toContain(label);
    expect(container.querySelectorAll('[data-pz="flow-steps"] > i')).toHaveLength(5);
    expect(container.querySelectorAll('[data-pz="flow-cta"]')).toHaveLength(1);
  });

  it('1:1 을 고르면 최대 1명 고정 안내가 나온다', async () => {
    await mount(1);
    expect(text()).not.toContain('1:1은 참여자를 최대 1명으로 고정해요.');
    await click(byText('button', '1:1'));
    expect(text()).toContain('1:1은 참여자를 최대 1명으로 고정해요.');
  });

  it('오프라인이면 주소 입력, 온라인이면 하울링 안내', async () => {
    await mount(1);
    expect(text()).toContain('한 공간에서 여러 기기를 켜면 소리가 울릴 수 있어요.');
    await click(byText('button', '오프라인(대면)'));
    expect(container.querySelector('input[aria-label="장소 주소"]')).not.toBeNull();
  });

  it('기타 유형은 이름 입력을 보인다', async () => {
    await mount(1, { type: 'other', customName: '감정 코칭' });
    expect((container.querySelector('input[aria-label="기타 유형 이름"]') as HTMLInputElement).value).toBe('감정 코칭');
  });

  it('다음 버튼이 2단계로 이동시킨다', async () => {
    await mount(1);
    await click(container.querySelector('[data-pz="flow-cta"]'));
    expect(text()).toContain('기록과 분석을 정해요');
  });
});

describe('FH02a 정원 스텐퍼', () => {
  it('그룹 기본 정원 10명과 최대 안내', async () => {
    await mount(1);
    expect(text()).toContain('정원 10명');
    expect(text()).toContain('온라인 그룹은 최대 50명까지 정할 수 있어요.');
  });

  it('+/- 로 정원이 바뀐다', async () => {
    await mount(1);
    await click(container.querySelector('[aria-label="정원 늘리기"]'));
    expect(text()).toContain('정원 11명');
    await click(container.querySelector('[aria-label="정원 줄이기"]'));
    await click(container.querySelector('[aria-label="정원 줄이기"]'));
    expect(text()).toContain('정원 9명');
  });

  it('온라인 그룹 50명이면 + 가 비활성이고 안내가 바뀐다', async () => {
    await mount(1, { capacity: 50 });
    expect((container.querySelector('[aria-label="정원 늘리기"]') as HTMLButtonElement).disabled).toBe(true);
    expect(text()).toContain('온라인 그룹은 최대 50명이라 더 늘릴 수 없어요.');
  });

  it('오프라인 그룹은 최대 100명', async () => {
    await mount(1, { place: 'offline', capacity: 60 });
    expect((container.querySelector('[aria-label="정원 늘리기"]') as HTMLButtonElement).disabled).toBe(false);
    expect(text()).toContain('오프라인 그룹은 최대 100명까지 정할 수 있어요.');
  });

  it('1:1 은 스텐퍼 없이 1명 고정 안내', async () => {
    await mount(1, { size: 'solo' });
    expect(container.querySelector('[aria-label="정원 늘리기"]')).toBeNull();
    expect(text()).toContain('1:1은 참여자를 최대 1명으로 고정해요.');
  });
});

describe('FH02b LINK BAND·녹음', () => {
  it('필수여도 참가를 막지 않는 권장 문구', async () => {
    await mount(2, { band: 'required' });
    expect(text()).toContain('필수로 설정해도 참가자에게는 LINK BAND 사용을 권장해요. 없어도 참가할 수 있어요.');
  });

  it('AI 분석은 토글 없이 안내 행', async () => {
    await mount(2);
    expect(text()).toContain('AI 분석');
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(2);
  });

  it('오프라인은 영상 녹화 자리를 안내로 대체', async () => {
    await mount(2, { place: 'offline' });
    expect(text()).toContain('대면 클래스는 영상 녹화 없이 진행해요.');
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(1);
  });

  it('이전 버튼으로 1단계로 돌아간다', async () => {
    await mount(2);
    await click(byText('button', '이전'));
    expect(text()).toContain('어떤 클래스를 만들까요?');
  });
});

describe('나가기 확인 시트', () => {
  it('X 를 누르면 시트가 열리고 나가기가 onExit 을 부른다', async () => {
    let exited = 0;
    await mount(1, {}, () => { exited += 1; });
    await click(container.querySelector('[aria-label="나가기"]'));
    expect(text()).toContain('만들기를 그만둘까요?');
    expect(text()).toContain('입력한 내용은 저장되지 않아요.');
    await click([...container.querySelectorAll('button')].find((b) => b.textContent === '나가기') ?? null);
    expect(exited).toBe(1);
  });
});

describe('FH02c 일정', () => {
  it('지금 바로: 날짜·시·분 없이 안내와 소요 시간만', async () => {
    await mount(3, { when: 'now' });
    expect(text()).toContain('언제 열까요?');
    expect(text()).toContain('만들면 바로 열 수 있어요. 일정은 따로 저장되지 않아요.');
    expect(text()).toContain('소요 시간 · 5분 단위');
    expect(text()).not.toContain('예약 알림');
    for (const chip of ['30분', '45분', '50분', '60분', '90분']) expect(text()).toContain(chip);
  });

  it('시간 예약: 날짜·시·분과 예약 알림, 충돌 없음 안내', async () => {
    await mount(3, { timeMin: 915 }, undefined, null);
    expect(text()).toContain('내일 · 10월 18일 일');
    expect(text()).toContain('오후 3시');
    expect(text()).toContain('15분');
    expect(text()).toContain('이 시간에는 다른 클래스가 없어요.');
    for (const label of ['끄기', '하루 전', '1시간 전']) expect(text()).toContain(label);
  });

  it('충돌: 겹치는 클래스 제목과 겹쳐도 만들 수 있다는 안내', async () => {
    await mount(3, {}, undefined, '박지우 님 1차 상담');
    expect(text()).toContain('같은 시간에 박지우 님 1차 상담이 있어요. 겹쳐도 만들 수 있어요.');
  });

  it('90분은 1시간 30분으로 표기, +/- 는 5분씩', async () => {
    await mount(3, { durationMin: 90 });
    expect(text()).toContain('1시간 30분');
    await click(container.querySelector('[aria-label="소요 시간 늘리기"]'));
    expect(text()).toContain('1시간 35분');
  });
});

describe('FH02d 초대', () => {
  const members = fixtureDraft().members;

  it('선택 없음: 안내 문구와 {N}/{정원}명', async () => {
    await mount(4, { members: [] });
    expect(text()).toContain('누구를 초대할까요?');
    expect(text()).toContain('아직 선택한 회원이 없어요. 건너뛰고 나중에 초대해도 돼요.');
    expect(text()).toContain('0/10명');
    expect(text()).toContain('CSV 추가');
  });

  it('회원을 고르면 칩과 카운트가 바뀌고, 칩을 누르면 해제', async () => {
    await mount(4, { members: [] });
    await click(container.querySelector('button.fh-prow'));
    expect(text()).toContain('1/10명');
    expect(container.querySelector('[aria-label="김서연 선택 해제"]')).not.toBeNull();
    await click(container.querySelector('[aria-label="김서연 선택 해제"]'));
    expect(text()).toContain('0/10명');
  });

  it('1:1 은 1명을 고르면 나머지 행이 비활성', async () => {
    await mount(4, { size: 'solo', members: members.slice(0, 1) });
    expect(text()).toContain('1명 · 1:1은 최대 1명이에요');
    const rows = [...container.querySelectorAll<HTMLButtonElement>('button.fh-prow')];
    expect(rows.filter((r) => !r.disabled)).toHaveLength(1);
  });

  it('정원이 차면 선택하지 않은 행이 비활성', async () => {
    await mount(4, { capacity: 3, members: members.slice(0, 3) });
    const rows = [...container.querySelectorAll<HTMLButtonElement>('button.fh-prow')];
    expect(rows.filter((r) => r.disabled)).toHaveLength(9);
    expect(text()).toContain('3/3명');
  });

  it('검색은 이름·이메일로 거르고 결과 수를 보인다', async () => {
    await mount(4, { members: [] }, undefined, null, { memberQuery: '서' });
    expect(text()).toContain('검색 결과 3명');
    await typeInto(container.querySelector('input[aria-label="회원 검색"]') as HTMLInputElement, 'zzz');
    expect(text()).toContain('검색 결과가 없어요.');
  });

  it('비회원 이메일 탭: 안내·형식 오류·추가·삭제, 정원에 포함하지 않음', async () => {
    await mount(4, { members: [] }, undefined, null, { inviteTab: 'email' });
    expect(text()).toContain('비회원은 이메일로 초대할 수 있어요');
    expect(text()).toContain('메일에 입장 코드가 들어가요');
    const input = container.querySelector('input[aria-label="초대할 이메일"]') as HTMLInputElement;
    await typeInto(input, 'minsu@');
    await click(byText('button', '추가'));
    expect(text()).toContain('이메일 형식을 확인해 주세요.');
    await typeInto(input, 'minsu@example.com');
    await click(byText('button', '추가'));
    expect(text()).toContain('이메일 1명 · 초대 인원은 정원에 포함하지 않아요');
    expect(text()).toContain('minsu@example.com');
    await click(container.querySelector('[aria-label="minsu@example.com 삭제"]'));
    expect(text()).toContain('이메일 0명');
  });
});

describe('FH02e 확인', () => {
  it('요약 행·고지 문구·이름 입력, 마지막 버튼은 클래스 만들기', async () => {
    await mount(5, fixtureDraft({ emails: ['hana.park@example.com'] }));
    expect(text()).toContain('이렇게 만들까요?');
    expect(text()).toContain('명상 · 온라인 · 그룹 · 정원 10명');
    expect(text()).toContain('내일 오후 3:15 · 50분');
    expect(text()).toContain('LINK BAND 선택 · 음성 녹음 · AI 분석 · 영상 녹화');
    expect(text()).toContain('3명 초대 · 김서연 외 2명 · 이메일 1명');
    expect(text()).toContain('LINK BAND는 진단·치료 목적이 아니에요. 리포트 반영은 참가자가 직접 정해요.');
    expect((container.querySelector('[data-pz="flow-cta"]') as HTMLElement).textContent).toContain('클래스 만들기');
  });

  it('연필을 누르면 해당 단계로 가고 값이 보존된다', async () => {
    await mount(5, fixtureDraft({ title: '내 클래스' }));
    await click(container.querySelector('[aria-label="일정 수정"]'));
    expect(text()).toContain('언제 열까요?');
    await click(byText('button', '다음'));
    await click(byText('button', '다음'));
    expect((container.querySelector('input[aria-label="클래스 이름"]') as HTMLInputElement).value).toBe('내 클래스');
  });

  it('오프라인 1:1 요약: 영상 녹화 없음·장소 포함', async () => {
    await mount(5, fixtureDraft({ place: 'offline', size: 'solo', band: 'none', when: 'now', members: [] }));
    expect(text()).toContain('1:1 · 서울 강남구 테헤란로 152 7층');
    expect(text()).toContain('LINK BAND 사용 안 함 · 음성 녹음 · AI 분석');
    expect(text()).not.toContain('영상 녹화');
    expect(text()).toContain('초대 없이 만들어요');
  });

  it('제출 중에는 만들기 버튼이 비활성', async () => {
    const initial: WizardState = { ...createInitialState(fixtureDraft()), step: 5 };
    await act(async () => root.render(createElement(WizardView, { state: initial, dispatch: () => undefined, submitting: true, base: FIXTURE_BASE })));
    expect((container.querySelector('[data-pz="flow-cta"]') as HTMLButtonElement).disabled).toBe(true);
  });
});
