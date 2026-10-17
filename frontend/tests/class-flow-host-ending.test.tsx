// @vitest-environment jsdom
// SDD-209 H8 — FH09 종료 확인·종료 씬: steps[ready] 판정(수동 기록 포함)·문구·잠금
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EndConfirmScreen, EndingScene } from '../src/components/class/flow/host/EndingScreen';
import { ENDING_FIXTURES } from '../src/lib/class/flow/host-ending-fixtures';
import { deriveEnding, endConfirmLines, endedDurationMin, isEndingDone } from '../src/lib/class/flow/host-ending-model';

const view = (k: keyof typeof ENDING_FIXTURES) => deriveEnding(ENDING_FIXTURES[k]);
const uis = (k: keyof typeof ENDING_FIXTURES): string[] => view(k).steps.map((s) => s.ui);

describe('deriveEnding — 서버 steps 4키 1:1', () => {
  it('단계별 진행: 저장 → 음성 인식 → AI 요약 → 완료, 진행률 25/50/75/100', () => {
    expect(uis('end-saving')).toEqual(['now', 'todo', 'todo', 'todo']);
    expect(uis('end-stt')).toEqual(['done', 'now', 'todo', 'todo']);
    expect(uis('end-ai')).toEqual(['done', 'done', 'now', 'todo']);
    expect(uis('end-done')).toEqual(['done', 'done', 'done', 'done']);
    expect([view('end-saving').pct, view('end-stt').pct, view('end-ai').pct, view('end-done').pct]).toEqual([25, 50, 75, 100]);
    expect(view('end-stt').steps.map((s) => s.word)).toEqual(['완료', '진행 중', '기다리는 중', '기다리는 중']);
  });

  it('완료 판정은 steps[ready] — generation_status 가 partial 이어도 ready=done 이면 완료, ready=active 면 진행 중', () => {
    expect(view('manual-ing').done).toBe(false);
    expect(view('manual-done').done).toBe(true);
    expect(isEndingDone(ENDING_FIXTURES['manual-done'].steps, 'partial')).toBe(true);
    expect(isEndingDone(ENDING_FIXTURES['manual-ing'].steps, 'partial')).toBe(false);
    expect(isEndingDone(null, 'ready')).toBe(true);
    expect(isEndingDone(null, 'partial')).toBe(false);
  });

  it('수동 기록: 앞 3단계 건너뜀(녹음 없음·건너뜀), 마지막만 메모로 만드는 중 → 완료', () => {
    const ing = view('manual-ing');
    expect(ing.manual).toBe(true);
    expect(ing.steps.map((s) => s.ui)).toEqual(['skip', 'skip', 'skip', 'now']);
    expect(ing.steps.map((s) => s.word)).toEqual(['녹음 없음', '건너뜀', '건너뜀', '메모로 만드는 중']);
    expect(ing.pct).toBe(70);
    expect(ing.sub).toBe('수동 기록 모드로 진행했어요. 녹음 없이 내 메모로 리포트를 만들어요.');
    const done = view('manual-done');
    expect(done.steps[3]).toMatchObject({ ui: 'done', word: '완료' });
    expect(done.pct).toBe(100);
    expect(done.sub).toBe('수동 기록 모드로 진행했어요. 내 메모로 리포트를 만들었어요.');
  });

  it('조회 전(steps null)에도 멈추지 않고 첫 단계 진행 중으로 보인다', () => {
    const v = deriveEnding({ steps: null, generationStatus: null, progress: null, reason: null, manual: false, durationMin: null, headcount: null, excluded: 0 });
    expect(v.steps.map((s) => s.ui)).toEqual(['now', 'todo', 'todo', 'todo']);
    expect(v.sub).toBe('녹음이 저장됐고 리포트를 만들고 있어요.');
  });

  it('서버 진행률이 있으면 그 값을 쓰되 완료 전에는 99 를 넘기지 않는다', () => {
    expect(deriveEnding({ ...ENDING_FIXTURES['end-stt'], progress: 63 }).pct).toBe(63);
    expect(deriveEnding({ ...ENDING_FIXTURES['end-stt'], progress: 100 }).pct).toBe(99);
  });

  it('함께한 시간·인원은 값이 있을 때만 말한다(없으면 지어내지 않는다)', () => {
    expect(view('end-done').sub).toBe('48분 동안 8명이 함께했어요. 리포트가 준비됐어요.');
    expect(view('end-ai').sub).toBe('48분 동안 8명이 함께했어요. 녹음이 저장됐고 리포트를 만들고 있어요.');
    expect(deriveEnding({ ...ENDING_FIXTURES['end-done'], durationMin: null, headcount: null }).sub).toBe('리포트가 준비됐어요.');
    expect(deriveEnding({ ...ENDING_FIXTURES['end-done'], headcount: null }).sub).toBe('48분 동안 진행했어요. 리포트가 준비됐어요.');
  });

  it('제외 참가자 안내: 0명이면 없고, 있으면 그룹 공통 요약 제외 + 원본 보관', () => {
    expect(view('end-ai').excludedNotice).toBeNull();
    expect(view('excluded-common').excludedNotice).toEqual({ title: '리포트에 반영하지 않은 참가자 2명이 있어 그룹 공통 요약은 제외돼요', sub: '원본은 설정 기간 동안 보관돼요' });
  });

  it('실패 단계는 fail 로 보이고 사유 문구가 붙는다', () => {
    const v = deriveEnding({
      ...ENDING_FIXTURES['end-ai'],
      reason: 'stt_failed',
      steps: [{ key: 'save', label: '', state: 'done' }, { key: 'stt', label: '', state: 'failed' }, { key: 'summary', label: '', state: 'pending' }, { key: 'ready', label: '', state: 'pending' }],
    });
    expect(v.steps[1]).toMatchObject({ ui: 'fail', word: '완료하지 못했어요' });
    expect(v.reasonText).toBe('음성 인식에 실패해 AI 요약을 만들지 못했어요.');
  });

  it('완료 전엔 3~5분 칩과 계속 만들어진다 안내, 완료 후엔 기록 안내', () => {
    expect(view('end-ai')).toMatchObject({ etaChip: true, foot: '화면을 닫아도 리포트는 계속 만들어져요', cardTitle: '리포트를 만들고 있어요' });
    expect(view('end-done')).toMatchObject({ etaChip: false, foot: '리포트는 기록에서 언제든 볼 수 있어요', cardTitle: '리포트가 준비됐어요' });
  });

  it('종료 확인 3줄: 인원 모르면 숫자 없이, 0명이면 줄 제거', () => {
    expect(endConfirmLines(8)[2]).toBe('참여 중인 회원 8명의 화면도 함께 끝나요');
    expect(endConfirmLines(null)[2]).toBe('참여 중인 회원의 화면도 함께 끝나요');
    expect(endConfirmLines(0)).toHaveLength(2);
  });
});

let root: Root;
let container: HTMLDivElement;
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
const left = { label: '홈으로', icon: null };
const click = async (el: Element | null | undefined): Promise<void> => { await act(async () => { (el as HTMLElement).click(); }); };
const btn = (t: string): HTMLButtonElement | undefined => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(t));

describe('EndConfirmScreen', () => {
  const mount = async (busy: boolean, onEnd = vi.fn(), onContinue = vi.fn()): Promise<void> => {
    await act(async () => root.render(createElement(EndConfirmScreen, { title: '마음챙김', sub: '진행 중', headcount: 8, busy, left, onEnd, onContinue })));
  };

  it('시안 문구와 두 버튼, 끝내기를 눌러야 호출된다', async () => {
    const onEnd = vi.fn();
    const onContinue = vi.fn();
    await mount(false, onEnd, onContinue);
    const t = container.querySelector('[role="dialog"]')?.textContent ?? '';
    for (const s of ['클래스를 끝낼까요?', '녹음과 녹화가 저장돼요', '상담사·회원 리포트가 자동으로 만들어져요', '참여 중인 회원 8명의 화면도 함께 끝나요', '클래스 끝내기', '계속 진행']) expect(t).toContain(s);
    expect(onEnd).not.toHaveBeenCalled();
    await click(btn('클래스 끝내기'));
    expect(onEnd).toHaveBeenCalledTimes(1);
    await click(btn('계속 진행'));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('끝내는 중에는 두 버튼 모두 잠그고 문구가 바뀐다(중복 종료 방지)', async () => {
    await mount(true);
    expect(btn('끝내는 중이에요')?.disabled).toBe(true);
    expect(btn('계속 진행')?.disabled).toBe(true);
  });
});

describe('EndingScene', () => {
  const mount = async (k: keyof typeof ENDING_FIXTURES, onOpenRecord = vi.fn()): Promise<void> => {
    await act(async () => root.render(createElement(EndingScene, { view: view(k), title: '마음챙김', left, onOpenRecord })));
  };

  it('진행 중: 4단계 목록·진행률·3~5분 칩·기록 보기 버튼, /record 로 자동 점프하지 않는다', async () => {
    const onOpenRecord = vi.fn();
    await mount('end-stt', onOpenRecord);
    expect(container.textContent).toContain('클래스가 끝났어요');
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(4);
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
    expect(container.textContent).toContain('보통 3~5분');
    expect(container.textContent).toContain('화면을 닫아도 리포트는 계속 만들어져요');
    expect(onOpenRecord).not.toHaveBeenCalled();
    await click(btn('기록 보기'));
    expect(onOpenRecord).toHaveBeenCalledTimes(1);
  });

  it('완료: 완료 칩, 3~5분 칩 없음', async () => {
    await mount('end-done');
    expect(container.textContent).toContain('리포트가 준비됐어요');
    expect(container.textContent).not.toContain('보통 3~5분');
  });

  it('제외 안내와 수동 기록 문구', async () => {
    await mount('excluded-common');
    expect(container.textContent).toContain('그룹 공통 요약은 제외돼요');
    await mount('manual-ing');
    expect(container.textContent).toContain('메모로 만드는 중');
  });
});

describe('endedDurationMin — 서버 ended_at 기준 함께한 시간', () => {
  it('started_at~ended_at 분 단위 반올림, 1분 미만은 1분', () => {
    expect(endedDurationMin('2026-10-17T01:00:00Z', '2026-10-17T01:48:10Z')).toBe(48);
    expect(endedDurationMin('2026-10-17T01:00:00Z', '2026-10-17T01:00:20Z')).toBe(1);
  });

  it('값이 없거나 역전·비정상이면 null(시간을 말하지 않는다)', () => {
    expect(endedDurationMin(null, '2026-10-17T01:00:00Z')).toBeNull();
    expect(endedDurationMin('2026-10-17T01:00:00Z', undefined)).toBeNull();
    expect(endedDurationMin('2026-10-17T02:00:00Z', '2026-10-17T01:00:00Z')).toBeNull();
    expect(endedDurationMin('x', 'y')).toBeNull();
  });
});

describe('ClassPlayerPage 종료 연결(D-5①)', () => {
  it('finishSession 이 /record 로 자동 이동하지 않고 응답을 반영한다', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(`${process.cwd()}/src/pages/sessions/ClassPlayerPage.tsx`, 'utf8');
    const body = src.slice(src.indexOf('const finishSession'), src.indexOf('수업 경과 타이머'));
    expect(body).toContain('setSession(ended)');
    expect(body).not.toContain('navigate(`/sessions/${id}/record`)');
    expect(src).toContain("isEnded ? 'ending'");
  });
});
