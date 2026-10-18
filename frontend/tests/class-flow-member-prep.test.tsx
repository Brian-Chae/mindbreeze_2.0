// @vitest-environment jsdom
// SDD-209 M2 — 준비 초안·요약 행 · FM06a 고지/리포트 반영 선택/연구 동의 · FM06e 요약
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoticeStepView, type NoticeStepViewProps } from '../src/components/class/flow/member/NoticeStepView';
import { ReadySummaryView } from '../src/components/class/flow/member/ReadySummaryView';
import { buildSummaryRows, emptyPrepDraft, parseRetentionDays, type PrepDraft } from '../src/lib/class/flow/member-prep';

let root: Root;
let container: HTMLDivElement;
async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(node); });
}
const qa = <T extends Element = HTMLElement>(sel: string): T[] => [...document.querySelectorAll<T>(sel)];
const text = (): string => document.body.textContent ?? '';
const noop = (): void => undefined;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function notice(over: Partial<NoticeStepViewProps> = {}): NoticeStepViewProps {
  return {
    place: 'online', size: 'group', bandMode: 'opt', title: '마음챙김 명상 · 4회차', hostName: '채용욱', retentionDays: 90,
    reportChoice: 'excluded', researchConsent: false, researchSaveFailed: false, steps: { total: 5, current: 0 },
    onReportChoice: noop, onResearchChange: noop, onNext: noop, onBack: noop, onExit: noop, ...over,
  };
}
const btn = (label: string): HTMLButtonElement | undefined => qa<HTMLButtonElement>('button').find((b) => (b.textContent ?? '').trim() === label);

describe('요약 행 (buildSummaryRows)', () => {
  const draft = (over: Partial<PrepDraft> = {}): PrepDraft => ({ ...emptyPrepDraft(), ...over });
  it('기본: 리포트 제외 · 연구 미동의 · 설문 · 밴드 · 기기 행과 이동 단계', () => {
    const rows = buildSummaryRows({ place: 'online', bandMode: 'opt', draft: draft({ survey: 'done', bandOutcome: 'connected', mic: 'on', camOn: false }) });
    expect(rows.map((r) => [r.key, r.label, r.value, r.goto])).toEqual([
      ['report', null, '리포트 반영하지 않아요', 'a'],
      ['research', null, '연구 목적 활용에 동의하지 않았어요', 'a'],
      ['survey', '오늘의 상태', '남겼어요', 'b'],
      ['band', 'LINK BAND', '연결됐어요 · 접촉 양호', 'c'],
      ['device', '기기', '마이크 정상 · 카메라 꺼짐', 'd'],
    ]);
  });
  it('반영·동의하면 문구가 바뀐다', () => {
    const rows = buildSummaryRows({ place: 'online', bandMode: 'opt', draft: draft({ reportChoice: 'included', researchConsent: true }) });
    expect(rows[0]!.value).toBe('리포트 반영해요');
    expect(rows[1]!.value).toBe('연구 목적 활용에 동의했어요');
  });
  it('밴드 사용 안 함은 `사용 안 해요`, 미연결은 `LINK BAND 없이 참가해요`(경고색 아님)', () => {
    expect(buildSummaryRows({ place: 'online', bandMode: 'none', draft: draft() }).find((r) => r.key === 'band')).toMatchObject({ value: '사용 안 해요', goto: null, warn: false });
    expect(buildSummaryRows({ place: 'online', bandMode: 'req', draft: draft({ bandOutcome: 'skipped' }) }).find((r) => r.key === 'band')).toMatchObject({ value: 'LINK BAND 없이 참가해요', warn: false });
  });
  it('오프라인은 기기 행 대신 참여 방식, 설문 건너뜀, 마이크 꺼짐은 경고 표시', () => {
    const off = buildSummaryRows({ place: 'offline', bandMode: 'opt', draft: draft({ survey: 'skipped' }) });
    expect(off.find((r) => r.key === 'device')).toMatchObject({ label: '참여 방식', value: '현장에서 함께해요', goto: null });
    expect(off.find((r) => r.key === 'survey')!.value).toBe('건너뛰었어요');
    const nomic = buildSummaryRows({ place: 'online', bandMode: 'opt', draft: draft({ mic: 'off' }) }).find((r) => r.key === 'device');
    expect(nomic).toMatchObject({ value: '마이크 꺼짐 · 카메라 꺼짐', warn: true });
  });
  it('보관 기간 환경값 파싱(없거나 잘못되면 null)', () => {
    expect(parseRetentionDays('90')).toBe(90);
    expect(parseRetentionDays(' 30 ')).toBe(30);
    expect(parseRetentionDays('')).toBeNull();
    expect(parseRetentionDays(undefined)).toBeNull();
    expect(parseRetentionDays('0')).toBeNull();
    expect(parseRetentionDays('abc')).toBeNull();
  });
});

describe('FM06a 고지·리포트 반영 선택·연구 동의', () => {
  it('고지 영역: 녹음과 AI 기록 · 뇌파 · 영상 · 보관 기간(서버 값)', async () => {
    await render(<NoticeStepView {...notice()} />);
    expect(text()).toContain('시작 전에 확인해 주세요');
    expect(text()).toContain('채용욱 상담사와 함께하는 마음챙김 명상 · 4회차');
    expect(text()).toContain('녹음과 AI 기록');
    expect(text()).toContain('음성을 녹음하고 AI가 기록지를 만들어요');
    expect(text()).toContain('뇌파 측정(LINK BAND를 쓸 때만)');
    expect(text()).toContain('영상(카메라를 켤 때만)');
    expect(text()).toContain('기록 원본(뇌파·음성·영상)은 90일이 지나면 삭제돼요');
  });
  it('밴드 사용 안 함이면 뇌파 안내가 없고, 오프라인이면 대면·현장 녹음 문구·영상 안내 없음', async () => {
    await render(<NoticeStepView {...notice({ bandMode: 'none', size: 'solo' })} />);
    expect(text()).not.toContain('뇌파 측정');
    await render(<NoticeStepView {...notice({ place: 'offline', steps: { total: 4, current: 0 } })} />);
    expect(text()).toContain('현장 대화를 녹음하고 AI가 기록지를 만들어요');
    expect(text()).not.toContain('영상(카메라를 켤 때만)');
    expect(qa('.fl-chip').map((c) => c.textContent)).toContain('대면');
  });
  it('보관 기간을 모르면 기간 숫자를 지어내지 않는다', async () => {
    await render(<NoticeStepView {...notice({ retentionDays: null })} />);
    expect(text()).not.toMatch(/\d+일이 지나면/);
    expect(text()).toContain('정해진 기간이 지나면 삭제돼요');
  });
  it('리포트 반영 선택: 기본 `반영하지 않아요`, 선택 안 함은 안내, 반영 선택 시 확인 문구. 주 버튼은 항상 활성', async () => {
    const onReportChoice = vi.fn();
    const onNext = vi.fn();
    await render(<NoticeStepView {...notice({ onReportChoice, onNext })} />);
    const radios = qa('[role="radio"]');
    expect(radios.map((r) => [r.textContent, r.getAttribute('aria-checked')])).toEqual([['반영하지 않아요', 'true'], ['반영해요', 'false']]);
    expect(text()).toContain('반영하지 않아도 클래스에는 그대로 참여할 수 있어요');
    expect(text()).toContain('이미 보낸 리포트는 되돌릴 수 없어요');
    await act(async () => { (radios[1] as HTMLElement).click(); });
    expect(onReportChoice).toHaveBeenCalledWith('included');

    await render(<NoticeStepView {...notice({ reportChoice: null })} />);
    expect(qa('[role="radio"]').map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false']);
    expect(text()).toContain('고르지 않으면 반영하지 않는 것으로 진행돼요');
    expect(btn('확인하고 계속하기')!.disabled).toBe(false);

    await render(<NoticeStepView {...notice({ reportChoice: 'included', onNext })} />);
    expect(text()).toContain('이번 클래스의 내 기록이 리포트에 반영돼요');
    await act(async () => { btn('확인하고 계속하기')!.click(); });
    expect(onNext).toHaveBeenCalledTimes(1);
  });
  it('연구 동의는 별도 블록·별도 체크(기본 해제)이고 리포트 선택과 독립이며 고지가 모두 있다', async () => {
    const onResearchChange = vi.fn();
    const onReportChoice = vi.fn();
    await render(<NoticeStepView {...notice({ onResearchChange, onReportChoice })} />);
    const box = qa('[role="checkbox"]');
    expect(box).toHaveLength(1);
    expect(box[0]!.getAttribute('aria-checked')).toBe('false');
    expect(box[0]!.textContent).toContain('동의해요');
    expect(text()).toContain('연구 목적 데이터 활용에 동의할까요? (선택)');
    for (const line of [
      '동의하면 비식별 처리한 뇌파·맥박·움직임 데이터와 지표, 암호화한 이름 ID·성별·생년·월이 삭제 기한 없이 계속 보관돼요',
      '이메일·전화번호·이름·녹음 내용은 보관하지 않아요',
      '동의하지 않아도 클래스에 참여할 수 있어요',
      '철회하려면 운영팀에 요청해 주세요',
      '비식별 처리해도 다른 정보와 결합하면 본인을 알아볼 가능성이 완전히 없지는 않아요',
    ]) expect(text()).toContain(line);
    await act(async () => { (box[0] as HTMLElement).click(); });
    expect(onResearchChange).toHaveBeenCalledWith(true);
    expect(onReportChoice).not.toHaveBeenCalled();
    // 동의 상태가 리포트 선택 표시를 바꾸지 않는다
    await render(<NoticeStepView {...notice({ researchConsent: true })} />);
    expect(qa('[role="checkbox"]')[0]!.getAttribute('aria-checked')).toBe('true');
    expect(qa('[role="radio"]').map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false']);
  });
  it('연구 동의 저장 실패 안내는 미동의로 진행하며 계속하기를 막지 않는다', async () => {
    await render(<NoticeStepView {...notice({ researchSaveFailed: true })} />);
    expect(text()).toContain('연구 동의를 저장하지 못했어요. 미동의로 진행해요.');
    expect(qa('[role="checkbox"]')[0]!.getAttribute('aria-checked')).toBe('false');
    expect(btn('확인하고 계속하기')!.disabled).toBe(false);
  });
  it('금지 표현이 없다(밴드 강제·OTP 등)', async () => {
    await render(<NoticeStepView {...notice({ bandMode: 'req' })} />);
    expect(text()).not.toMatch(/연결해야 입장|입장할 수 없어요|수동 기록|OTP|6자리/);
  });
});

describe('FM06e 준비 완료 요약', () => {
  it('요약 행 탭은 해당 단계로 이동하고, 주 버튼은 입장 대기', async () => {
    const onGoto = vi.fn();
    const onReady = vi.fn();
    const rows = buildSummaryRows({ place: 'online', bandMode: 'opt', draft: emptyPrepDraft() });
    await render(<ReadySummaryView displayName="지은" rows={rows} steps={{ total: 5, current: 4 }} onGoto={onGoto} onReady={onReady} onBack={noop} onExit={noop} />);
    expect(text()).toContain('준비를 마쳤어요');
    expect(text()).toContain('지은님, 상담사가 시작하면 자동으로 입장해요.');
    expect(text()).toContain('항목을 눌러 다시 바꿀 수 있어요.');
    const report = qa<HTMLButtonElement>('button').find((b) => b.textContent?.includes('리포트 반영하지 않아요'));
    await act(async () => { report!.click(); });
    expect(onGoto).toHaveBeenCalledWith('a');
    await act(async () => { btn('입장 대기')!.click(); });
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});
