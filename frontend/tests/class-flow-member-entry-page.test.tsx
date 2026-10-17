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
vi.mock('../src/lib/api/class-flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/class-flow')>()),
  getEntryState: (...a: unknown[]) => getEntryState(...a),
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
