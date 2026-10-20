// @vitest-environment jsdom
// SDD-209 M8 — FM09 종료·리포트(회원 1탭 · 비회원 자동 발송 안내 · 제외 상태) · 오늘 상태 남기기
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// SDD-220: 이 테스트는 AI 공개(on) 문구를 검증한다 — 기본값 off 라 모듈 수준에서 켠다(단언 불변).
vi.stubEnv('VITE_AI_ENABLED', 'true');
import { EndView, type EndViewProps } from '../src/components/class/flow/member/EndView';
import { durationMinutes, maskEmail } from '../src/lib/class/flow/member-format';
import { emptySurveyDraft } from '../src/lib/class/flow/member-survey';

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
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function props(over: Partial<EndViewProps> = {}): EndViewProps {
  return {
    place: 'online', title: '마음챙김 명상 · 4회차', duration: '30분', reportMode: 'member', maskedEmail: 'se***@example.com', checkinDone: false,
    sheet: 'none', checkinDraft: emptySurveyDraft(), working: false, errorText: null,
    onOpenReport: noop, onOpenCheckin: noop, onCloseSheet: noop, onRequestReport: noop, onSelectAxis: noop, onNote: noop, onSubmitCheckin: noop, onHome: noop,
    ...over,
  };
}

describe('순수 함수', () => {
  it('이메일 마스킹은 앞 2글자만 보인다', () => {
    expect(maskEmail('seoyeon@example.com')).toBe('se***@example.com');
    expect(maskEmail('a@example.com')).toBe('a***@example.com');
    expect(maskEmail('ab@example.com')).toBe('ab***@example.com');
    expect(maskEmail('not-an-email')).toBeNull();
    expect(maskEmail('')).toBeNull();
  });
  it('함께한 시간은 서버 시각 차이를 분으로(올림 없이 반올림), 값이 없거나 역전이면 null', () => {
    expect(durationMinutes('2026-10-17T15:00:00+09:00', '2026-10-17T15:30:10+09:00')).toBe(30);
    expect(durationMinutes('2026-10-17T15:00:00+09:00', '2026-10-17T15:00:20+09:00')).toBe(0);
    expect(durationMinutes(null, '2026-10-17T15:30:00+09:00')).toBeNull();
    expect(durationMinutes('2026-10-17T15:30:00+09:00', '2026-10-17T15:00:00+09:00')).toBeNull();
  });
});

describe('FM09 종료 카드', () => {
  it('회원: 문구·정보 3줄·리포트 받기·오늘 상태 남기기·홈으로, 점수·퍼센트·대시보드 표현 없음', async () => {
    await render(<EndView {...props()} />);
    expect(text()).toContain('수고하셨어요');
    expect(text()).toContain('리포트는 준비되면 메일로 보내 드려요.');
    expect(qa('.fm-finfo span').map((e) => e.textContent)).toEqual(['클래스', '함께한 시간', '리포트']);
    expect(text()).toContain('30분');
    expect(text()).toContain('준비되면 메일 발송');
    expect(text()).toContain('AI 기록과 리포트를 만드는 데 몇 분 걸릴 수 있어요.');
    expect(btn('리포트 받기')).toBeDefined();
    expect(btn('오늘 상태 남기기')).toBeDefined();
    expect(btn('홈으로')).toBeDefined();
    expect(text()).not.toMatch(/\d+\s*%|대시보드로/);
  });
  it('체크인 완료 시 비활성 `오늘 상태를 남겼어요`', async () => {
    await render(<EndView {...props({ checkinDone: true })} />);
    expect(btn('오늘 상태를 남겼어요')!.disabled).toBe(true);
    expect(btn('오늘 상태 남기기')).toBeUndefined();
  });
  it('제외: 신청 버튼 없음·안내 문구, 오늘 상태 남기기가 주 버튼', async () => {
    await render(<EndView {...props({ reportMode: 'excluded', maskedEmail: null })} />);
    expect(text()).toContain('이번 클래스는 내 기록이 리포트에 반영되지 않아요');
    expect(text()).toContain('보낼 리포트가 없어요');
    expect(text()).toContain('종료 전에는 설정에서 바꿀 수 있어요. 종료 뒤에는 상담사에게 요청해 주세요.');
    expect(btn('리포트 받기')).toBeUndefined();
    expect(btn('오늘 상태 남기기')!.getAttribute('data-kind')).toBe('primary');
  });
  it('비회원: 마스킹된 이메일로 자동 발송 안내, 이메일 입력·인증 DOM 없음, 신청 버튼 없음', async () => {
    await render(<EndView {...props({ reportMode: 'guest', maskedEmail: 'se***@example.com' })} />);
    expect(text()).toContain('리포트를 se***@example.com 로 보내 드려요');
    expect(text()).toContain('상담사 확인 후 메일 발송');
    expect(text()).toContain('상담사가 확인하면 자동으로 보내져요.');
    expect(btn('리포트 받기')).toBeUndefined();
    expect(qa('input')).toHaveLength(0);
    expect(text()).not.toMatch(/인증|OTP/);
  });
  it('비회원이지만 마스킹할 이메일을 모르면(새로고침) 입력한 이메일로 안내', async () => {
    await render(<EndView {...props({ reportMode: 'guest', maskedEmail: null })} />);
    expect(text()).toContain('리포트를 입력한 이메일로 보내 드려요');
  });
  it('함께한 시간을 모르면 `-`', async () => {
    await render(<EndView {...props({ duration: null })} />);
    expect(qa('.fm-finfo div').map((d) => d.textContent)).toContain('함께한 시간-');
  });
});

describe('FM09 시트', () => {
  it('리포트 시트(회원): 마스킹 이메일·안내·1탭 신청, 이메일 입력·인증 DOM 0', async () => {
    const onRequestReport = vi.fn();
    await render(<EndView {...props({ sheet: 'report', onRequestReport })} />);
    expect(text()).toContain('받는 이메일');
    expect(text()).toContain('se***@example.com');
    expect(text()).toContain('리포트는 상담사가 확인한 뒤 계정 이메일로 보내 드려요. 영업일 기준 1~2일 걸릴 수 있어요.');
    expect(qa('[data-pz="flow-sheet"] input')).toHaveLength(0);
    expect(text()).not.toMatch(/인증 코드|재발송/);
    await act(async () => { btn('리포트 신청하기')!.click(); });
    expect(onRequestReport).toHaveBeenCalledTimes(1);
  });
  it('신청 완료 시트와 중복 신청(진행 중) 비활성', async () => {
    await render(<EndView {...props({ sheet: 'reportsent' })} />);
    expect(text()).toContain('신청했어요');
    expect(text()).toContain('상담사가 확인하면 이메일로 보내 드려요.');
    expect(btn('확인')).toBeDefined();
    await render(<EndView {...props({ sheet: 'report', working: true })} />);
    expect(btn('리포트 신청하기')!.disabled).toBe(true);
  });
  it('신청 실패는 해요체 안내(서버 문구 없음)', async () => {
    await render(<EndView {...props({ sheet: 'report', errorText: '신청하지 못했어요. 잠시 후 다시 시도해 주세요.' })} />);
    expect(qa('[role="alert"]').map((e) => e.textContent)).toEqual(['신청하지 못했어요. 잠시 후 다시 시도해 주세요.']);
  });
  it('체크인 시트: 안내·3축 5단계·한 줄 소감·남기기/건너뛰기, 빈 상태에서는 남기기 비활성', async () => {
    await render(<EndView {...props({ sheet: 'checkin' })} />);
    expect(text()).toContain('오늘 상태 남기기');
    expect(text()).toContain('뇌파를 측정하지 않아도 이 기록은 리포트에 남아요.');
    expect(qa('[role="radiogroup"]').map((g) => g.getAttribute('aria-label'))).toEqual(['집중', '편안함', '감정']);
    expect(qa('[data-pz="flow-sheet"] [role="radio"]')).toHaveLength(15);
    expect(text()).toContain('한 줄 소감 (선택)');
    expect(btn('남기기')!.disabled).toBe(true);
    expect(btn('건너뛰기')).toBeDefined();
  });
  it('체크인 선택 후 남기기 활성, 선택·제출 콜백', async () => {
    const onSelectAxis = vi.fn();
    const onSubmitCheckin = vi.fn();
    const draft = { answers: { arousal: 4 as const, valence: 3 as const, emotion: 4 as const }, note: '' };
    await render(<EndView {...props({ sheet: 'checkin', checkinDraft: draft, onSelectAxis, onSubmitCheckin })} />);
    expect(btn('남기기')!.disabled).toBe(false);
    await act(async () => { qa('[data-pz="flow-sheet"] [role="radio"]')[0]!.click(); });
    expect(onSelectAxis).toHaveBeenCalledWith('arousal', 1);
    await act(async () => { btn('남기기')!.click(); });
    expect(onSubmitCheckin).toHaveBeenCalledTimes(1);
  });
  it('시트가 열리면 종료 카드는 inert', async () => {
    await render(<EndView {...props({ sheet: 'checkin' })} />);
    expect(document.querySelector('.fm-fv')?.closest('[inert]')).not.toBeNull();
  });
});

// ── EndContainer: 신청·체크인 호출 ──
const requestReportEmail = vi.fn();
const submitEntryCheckin = vi.fn();
vi.mock('../src/lib/api/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/session')>()),
  requestReportEmail: (...a: unknown[]) => requestReportEmail(...a),
}));
vi.mock('../src/lib/api/class-flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/class-flow')>()),
  submitEntryCheckin: (...a: unknown[]) => submitEntryCheckin(...a),
}));
import { EndContainer } from '../src/components/class/flow/member/EndContainer';

describe('EndContainer', () => {
  const base = {
    sessionId: 's1', credential: 'cred', participantId: 'p1', place: 'online' as const, title: '명상', duration: '30분',
    reportMode: 'member' as const, maskedEmail: 'se***@example.com', accountEmail: 'seoyeon@example.com', onHome: noop,
  };
  it('리포트 신청: 계정 이메일로 1회, 인증 토큰 없이. 완료 시트 후 재신청은 서버를 다시 부르지 않는다', async () => {
    requestReportEmail.mockReset();
    requestReportEmail.mockResolvedValue({ status: 'pending_review', message: '' });
    await render(<EndContainer {...base} />);
    await act(async () => { btn('리포트 받기')!.click(); });
    await act(async () => { btn('리포트 신청하기')!.click(); });
    expect(requestReportEmail).toHaveBeenCalledTimes(1);
    expect(requestReportEmail).toHaveBeenCalledWith('s1', { participant_id: 'p1', email: 'seoyeon@example.com', email_verify_token: null });
    expect(text()).toContain('신청했어요');
    await act(async () => { btn('확인')!.click(); });
    await act(async () => { btn('리포트 받기')!.click(); });
    expect(text()).toContain('신청했어요');
    expect(requestReportEmail).toHaveBeenCalledTimes(1);
  });
  it('리포트 신청 실패는 시트에 안내하고 서버 문구는 숨긴다', async () => {
    requestReportEmail.mockReset();
    requestReportEmail.mockRejectedValue(new Error('서버 원문'));
    await render(<EndContainer {...base} />);
    await act(async () => { btn('리포트 받기')!.click(); });
    await act(async () => { btn('리포트 신청하기')!.click(); });
    expect(text()).toContain('신청하지 못했어요. 잠시 후 다시 시도해 주세요.');
    expect(text()).not.toContain('서버 원문');
  });
  it('오늘 상태 남기기: 입장 자격으로 phase=after 저장 후 완료 표기, 실패하면 안내', async () => {
    submitEntryCheckin.mockReset();
    submitEntryCheckin.mockResolvedValue(undefined);
    await render(<EndContainer {...base} />);
    await act(async () => { btn('오늘 상태 남기기')!.click(); });
    expect(btn('남기기')!.disabled).toBe(true);
    await act(async () => { qa('[data-pz="flow-sheet"] [role="radio"]')[3]!.click(); });
    await act(async () => { btn('남기기')!.click(); });
    expect(submitEntryCheckin).toHaveBeenCalledWith('s1', 'cred', { phase: 'after', arousal: 4, valence: null, emotion: null, note: null, participant_id: 'p1' });
    expect(btn('오늘 상태를 남겼어요')!.disabled).toBe(true);

    submitEntryCheckin.mockReset();
    submitEntryCheckin.mockRejectedValue(new Error('x'));
    await render(<EndContainer key="s2" {...base} sessionId="s2" />);
    await act(async () => { btn('오늘 상태 남기기')!.click(); });
    await act(async () => { qa('[data-pz="flow-sheet"] [role="radio"]')[0]!.click(); });
    await act(async () => { btn('남기기')!.click(); });
    expect(text()).toContain('저장하지 못했어요. 건너뛰고 계속할 수 있어요.');
  });
});
