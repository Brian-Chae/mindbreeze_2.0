// @vitest-environment jsdom
// SDD-209 M1 — FM05 입장 확인 · FM10 상태 화면 · EntryPage 입장 흐름(API 모킹)
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntryConfirmView } from '../src/components/class/flow/member/EntryConfirmView';
import { MemberStateScreen } from '../src/components/class/flow/member/MemberStateScreen';
import { ApiError } from '../src/lib/api/client';
import { saveEntry } from '../src/lib/api/class-flow';
import type { EntryStateDto } from '../src/lib/api/class-flow';

const getEntryState = vi.fn();
const setReportChoice = vi.fn();
const setResearchConsent = vi.fn();
const submitEntryCheckin = vi.fn();
vi.mock('../src/lib/api/class-flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/class-flow')>()),
  getEntryState: (...a: unknown[]) => getEntryState(...a),
  setReportChoice: (...a: unknown[]) => setReportChoice(...a),
  setResearchConsent: (...a: unknown[]) => setResearchConsent(...a),
  submitEntryCheckin: (...a: unknown[]) => submitEntryCheckin(...a),
}));

import EntryPage from '../src/pages/class/EntryPage';

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
  getEntryState.mockReset();
  setReportChoice.mockReset();
  setResearchConsent.mockReset();
  submitEntryCheckin.mockReset();
  window.sessionStorage.clear();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const confirmProps = {
  title: '마음챙김 명상 · 4회차', startLabel: '오늘 오후 3:00 시작', hostName: '채용욱', address: null,
  place: 'online' as const, size: 'group' as const, bandMode: 'opt' as const, displayName: '지은', identitySource: 'input' as const,
  wait: false, onEnter: noop, onBack: noop,
};

describe('FM05 입장 확인', () => {
  it('입력 요소가 없고 이름·방식 칩·입장하기가 있다', async () => {
    await render(<EntryConfirmView {...confirmProps} />);
    expect(qa('input, textarea, select')).toHaveLength(0);
    expect(text()).toContain('지은님');
    expect(text()).toContain('입력한 정보로 확인했어요');
    expect(text()).toContain('채용욱 상담사 진행');
    expect(qa('.fl-chip').map((c) => c.textContent)).toEqual(['온라인', '그룹', 'LINK BAND 선택']);
    expect(qa('button').some((b) => b.textContent === '입장하기')).toBe(true);
  });
  it('열리기 전에는 자동 입장 안내와 비활성 버튼', async () => {
    await render(<EntryConfirmView {...confirmProps} wait />);
    expect(text()).toContain('열리면 자동으로 입장해요 · 이 화면을 열어 두세요');
    const cta = qa<HTMLButtonElement>('button').find((b) => b.textContent === '열리면 자동으로 입장해요');
    expect(cta?.disabled).toBe(true);
  });
  it('오프라인은 장소 줄과 `오프라인`·1:1·LINK BAND 사용 안 함', async () => {
    await render(<EntryConfirmView {...confirmProps} place="offline" size="solo" bandMode="none" address="서울 강남구 테헤란로 123" />);
    expect(text()).toContain('서울 강남구 테헤란로 123');
    expect(qa('.fl-chip').map((c) => c.textContent)).toEqual(['오프라인', '1:1', 'LINK BAND 사용 안 함']);
  });
});

describe('FM10 상태 화면', () => {
  const copy: Array<[Parameters<typeof MemberStateScreen>[0]['kind'], string, string]> = [
    ['cancelled', '클래스가 취소됐어요', '클래스 목록 보기'],
    ['closed', '이미 끝난 클래스예요', '클래스 목록 보기'],
    ['notyet', '아직 열리지 않았어요', '입장 대기하기'],
    ['error', '잠시 문제가 생겼어요', '다시 시도'],
    ['offline', '네트워크 연결이 끊겼어요', '다시 연결'],
    ['entry-expired', '입장 정보가 만료됐어요', '코드 입력하기'],
  ];
  it.each(copy)('%s: 제목과 주 버튼 문구', async (kind, heading, primary) => {
    const onPrimary = vi.fn();
    await render(<MemberStateScreen kind={kind} classTitle="마음챙김 명상" whenLabel="오늘 오후 3:00" onPrimary={onPrimary} onSecondary={noop} />);
    expect(text()).toContain(heading);
    const button = qa<HTMLButtonElement>('button').find((b) => b.textContent === primary);
    expect(button).toBeDefined();
    await act(async () => { button?.click(); });
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });
  it('미오픈은 시작 시각을, 취소는 원래 일정을 보여 준다', async () => {
    await render(<MemberStateScreen kind="notyet" classTitle="명상" whenLabel="오늘 오후 3:00" onPrimary={noop} onSecondary={noop} />);
    expect(text()).toContain('오늘 오후 3:00에 열려요.');
    await render(<MemberStateScreen kind="cancelled" classTitle="명상" whenLabel="오늘 오후 3:00" onPrimary={noop} onSecondary={noop} />);
    expect(text()).toContain('원래 일정');
  });
});

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname}</p>;
}

function stateDto(over: Partial<EntryStateDto> = {}): EntryStateDto {
  return {
    session_id: 's1', status: 'open', guest_state: 'waiting', in_progress: false, ended: false, participant_id: 'p1',
    is_waitlisted: false, report_included: false, chat_enabled: false, band_connected: false, ...over,
  };
}

function seedEntry(): void {
  saveEntry({
    sessionId: 's1', credential: 'cred', expiresAt: null, participantId: 'p1', isGuest: true,
    classInfo: {
      title: '마음챙김 명상', hostName: '채용욱', scheduledAt: null, startedAt: null, durationMin: 50, locationType: 'online',
      locationAddress: null, participantMode: 'group', linkbandMode: 'optional', maxParticipants: 10, recordAudio: true, recordVideo: true,
    },
  });
}

function renderPage(): Promise<void> {
  return render(
    <MemoryRouter initialEntries={['/class/s1/enter']}>
      <Routes>
        <Route path="/class/:sessionId/enter" element={<EntryPage />} />
        <Route path="/join" element={<Where />} />
        <Route path="/" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EntryPage', () => {
  it('저장된 입장 자격으로 상태를 조회하고(헤더용 자격 전달) 열려 있으면 입장하기를 보여 준다', async () => {
    seedEntry();
    getEntryState.mockResolvedValue(stateDto({ status: 'open' }));
    await renderPage();
    expect(getEntryState).toHaveBeenCalledWith('s1', 'cred');
    expect(text()).toContain('마음챙김 명상');
    expect(qa('button').some((b) => b.textContent === '입장하기')).toBe(true);
  });
  it('아직 열리지 않았으면 자동 입장 안내', async () => {
    seedEntry();
    getEntryState.mockResolvedValue(stateDto({ status: 'scheduled' }));
    await renderPage();
    expect(text()).toContain('열리면 자동으로 입장해요 · 이 화면을 열어 두세요');
  });
  it('자격이 없으면 입장 정보 만료 → 코드 입력하기로 /join 이동', async () => {
    await renderPage();
    expect(text()).toContain('입장 정보가 만료됐어요');
    await act(async () => { qa<HTMLButtonElement>('button').find((b) => b.textContent === '코드 입력하기')?.click(); });
    expect(document.querySelector('[data-testid="where"]')?.textContent).toBe('/join');
  });
  it('조회가 401/403 이면 입장 정보 만료(자격 삭제), 다른 사람 참여자로 복귀하지 않는다', async () => {
    seedEntry();
    getEntryState.mockRejectedValue(new ApiError(401, '서버 원문 문구', null));
    await renderPage();
    expect(text()).toContain('입장 정보가 만료됐어요');
    expect(text()).not.toContain('서버 원문 문구');
    expect(window.sessionStorage.getItem('mb_entry_s1')).toBeNull();
  });
  it('취소된 클래스는 취소 안내', async () => {
    seedEntry();
    getEntryState.mockResolvedValue(stateDto({ status: 'cancelled' }));
    await renderPage();
    expect(text()).toContain('클래스가 취소됐어요');
  });
  it('네트워크 끊김은 화면을 잃지 않고 안내하며, 서버 오류 문구 원문은 노출하지 않는다', async () => {
    seedEntry();
    getEntryState.mockRejectedValue(new TypeError('Failed to fetch'));
    await renderPage();
    expect(text()).toContain('네트워크 연결이 끊겼어요');
    getEntryState.mockResolvedValue(stateDto({ status: 'open' }));
    await act(async () => { qa<HTMLButtonElement>('button').find((b) => b.textContent === '다시 연결')?.click(); });
    expect(qa('button').some((b) => b.textContent === '입장하기')).toBe(true);
  });
});

describe('EntryPage — 고지·리포트 반영 선택·연구 동의 (M2)', () => {
  async function toNotice(): Promise<void> {
    seedEntry();
    getEntryState.mockResolvedValue(stateDto({ status: 'open' }));
    await renderPage();
    await act(async () => { qa<HTMLButtonElement>('button').find((b) => b.textContent === '입장하기')?.click(); });
  }
  const find = (label: string): HTMLButtonElement | undefined => qa<HTMLButtonElement>('button').find((b) => (b.textContent ?? '').trim() === label);

  it('입장하기 → FM06a, 확인하고 계속하기로 리포트 선택을 고지 확인 증빙과 함께 1회 보낸다(기본 제외)', async () => {
    setReportChoice.mockResolvedValue({ participant_id: 'p1', report_included: false, changed: false });
    await toNotice();
    expect(text()).toContain('시작 전에 확인해 주세요');
    await act(async () => { find('확인하고 계속하기')?.click(); });
    expect(setReportChoice).toHaveBeenCalledTimes(1);
    expect(setReportChoice).toHaveBeenCalledWith('s1', 'cred', { participantId: 'p1', reportIncluded: false, noticeAcknowledged: true, noticeVersion: 'r5-1' });
    expect(setResearchConsent).not.toHaveBeenCalled(); // 연구 동의는 체크할 때만, 리포트 선택과 독립
  });
  it('`반영해요`를 고르면 reportIncluded=true 로 보낸다', async () => {
    setReportChoice.mockResolvedValue({ participant_id: 'p1', report_included: true, changed: true });
    await toNotice();
    await act(async () => { find('반영해요')?.click(); });
    await act(async () => { find('확인하고 계속하기')?.click(); });
    expect(setReportChoice).toHaveBeenCalledWith('s1', 'cred', expect.objectContaining({ reportIncluded: true }));
  });
  it('리포트 선택 저장이 실패해도 다음 단계로 진행한다', async () => {
    setReportChoice.mockRejectedValue(new ApiError(500, 'x', null));
    await toNotice();
    await act(async () => { find('확인하고 계속하기')?.click(); });
    expect(text()).not.toContain('시작 전에 확인해 주세요');
  });
  it('연구 동의 체크는 즉시 저장하고, 실패하면 미동의로 두며 안내한다(계속하기는 막지 않음)', async () => {
    setResearchConsent.mockResolvedValueOnce({ participant_id: 'p1', consented: true, changed: true });
    await toNotice();
    await act(async () => { qa('[role="checkbox"]')[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(setResearchConsent).toHaveBeenCalledWith('s1', 'cred', { participantId: 'p1', consented: true, noticeVersion: 'r5-1' });
    expect(qa('[role="checkbox"]')[0]!.getAttribute('aria-checked')).toBe('true');

    setResearchConsent.mockRejectedValueOnce(new ApiError(409, 'x', null));
    await act(async () => { qa('[role="checkbox"]')[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(text()).toContain('연구 동의를 저장하지 못했어요. 미동의로 진행해요.');
    // 해제 시도가 실패했으므로 서버에 남아 있는 동의 상태(true)를 거짓으로 보이지 않는다
    expect(qa('[role="checkbox"]')[0]!.getAttribute('aria-checked')).toBe('true');
    expect(find('확인하고 계속하기')!.disabled).toBe(false);
  });
});

describe('EntryPage — 오늘의 상태 (M3)', () => {
  const find = (label: string): HTMLButtonElement | undefined => qa<HTMLButtonElement>('button').find((b) => (b.textContent ?? '').trim() === label);
  const radio = (label: string): HTMLElement | undefined => qa('[role="radio"]').find((r) => r.textContent === label);
  async function toSurvey(status: EntryStateDto['status'] = 'open'): Promise<void> {
    seedEntry();
    setReportChoice.mockResolvedValue({ participant_id: 'p1', report_included: false, changed: false });
    getEntryState.mockResolvedValue(stateDto({ status }));
    await renderPage();
    await act(async () => { find('입장하기')?.click(); });
    await act(async () => { find('확인하고 계속하기')?.click(); });
  }

  it('3축 선택 → 전할 말 → 남기고 계속하기: 입장 자격으로 phase=before 체크인을 1회 저장하고 다음 단계로', async () => {
    submitEntryCheckin.mockResolvedValue(undefined);
    await toSurvey();
    expect(text()).toContain('지금 집중은 어떤가요?');
    await act(async () => { radio('집중')?.click(); });
    await act(async () => { find('다음')?.click(); });
    await act(async () => { radio('보통')?.click(); });
    await act(async () => { find('다음')?.click(); });
    await act(async () => { find('다음')?.click(); }); // 감정은 고르지 않으면 다음이 비활성이라 눌려도 그대로
    expect(find('다음')!.disabled).toBe(true);
    await act(async () => { radio('긍정적')?.click(); });
    await act(async () => { find('다음')?.click(); });
    expect(text()).toContain('상담사에게 전하고 싶은 말이 있나요?');
    const area = document.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(area, '목이 불편해요');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { find('남기고 계속하기')?.click(); });
    expect(submitEntryCheckin).toHaveBeenCalledTimes(1);
    expect(submitEntryCheckin).toHaveBeenCalledWith('s1', 'cred', {
      phase: 'before', arousal: 4, valence: 3, emotion: 4, note: '목이 불편해요', participant_id: 'p1',
    });
    expect(text()).not.toContain('상담사에게 전하고 싶은 말이 있나요?');
  });
  it('저장이 실패하면 안내를 보여 주고 머물되, 건너뛰기로 계속할 수 있다', async () => {
    submitEntryCheckin.mockRejectedValue(new ApiError(500, '서버 원문', null));
    await toSurvey();
    await act(async () => { radio('집중')?.click(); });
    await act(async () => { find('다음')?.click(); });
    await act(async () => { radio('보통')?.click(); });
    await act(async () => { find('다음')?.click(); });
    await act(async () => { radio('보통')?.click(); });
    await act(async () => { find('다음')?.click(); });
    await act(async () => { find('남기고 계속하기')?.click(); });
    expect(text()).toContain('저장하지 못했어요. 건너뛰고 계속할 수 있어요.');
    expect(text()).not.toContain('서버 원문');
    await act(async () => { find('건너뛰기')?.click(); });
    expect(text()).not.toContain('상담사에게 전하고 싶은 말이 있나요?');
  });
  it('건너뛰기는 저장 호출 없이 다음 단계로', async () => {
    await toSurvey();
    await act(async () => { find('건너뛰기')?.click(); });
    expect(submitEntryCheckin).not.toHaveBeenCalled();
    expect(text()).not.toContain('지금 집중은 어떤가요?');
  });
  it('시작된 뒤에 들어와도 단계를 막지 않고, 시트에서 준비 이어서 하기를 고르면 다시 묻지 않는다', async () => {
    await toSurvey('in_progress');
    expect(text()).toContain('상담사가 클래스를 시작했어요');
    expect(text()).toContain('남은 준비: 오늘의 상태 · LINK BAND · 기기');
    await act(async () => { find('준비 이어서 하기')?.click(); });
    expect(text()).not.toContain('상담사가 클래스를 시작했어요');
    expect(text()).toContain('지금 집중은 어떤가요?');
  });
});
