// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClassListResponse, CounselingListResponse, ClassSummaryDto, CounselingSummaryDto } from '../src/lib/api/class-structure';
import type { ReadState } from '../src/lib/class-structure/read-model';
import { MemberClassesPage } from '../src/pages/client/member-classes-page';
import { MemberClassDetailPage } from '../src/pages/client/member-class-detail-page';
import { Routes, Route } from 'react-router-dom';
import { MemberStructureHomePage } from '../src/pages/client/member-structure-home-page';

const hooks = vi.hoisted(() => ({ home: vi.fn(), classes: vi.fn(), detail: vi.fn(), retry: vi.fn() }));
vi.mock('../src/hooks/use-class-structure', () => ({ useMixedHome: hooks.home, useClasses: hooks.classes, useClassDetail: hooks.detail }));
// 알림·채팅의 외부 요청 없이 페이지 표시 계약만 검사한다.
vi.mock('../src/components/class/structure/structure-shell', () => ({ StructureShell: ({ title, children, role }: { title: string; children: ReactNode; role: string }) => <main data-role={role}><h1>{title}</h1>{children}</main> }));
const row = {
  area: 'meditation',
  id: 'class-1', title: '호흡 명상', status: 'active', schedule_mode: 'fixed', planned_session_count: 8,
  progress: { completed: 0, total: 8 }, session_count: 2, has_open_session: false,
  next_session: { id: 'next-3', seq: 3, scheduled_at: '2099-11-20T10:00:00+09:00', status: 'scheduled', host: { id: 'host', name: '김지도' } },
} satisfies ClassSummaryDto;
const counsel = {
  area: 'counseling', client_display: null, modality_default: null,
  id: 'relation-1', status: 'active', counselor: { id: 'counselor', name: '이상담' }, session_count: 2,
  next_session: { id: 'c-next', seq: 7, scheduled_at: '2099-11-19T10:00:00+09:00', status: 'scheduled' }, latest_session: null,
} satisfies CounselingSummaryDto;
let classes: ReadState<ClassListResponse>;
let counseling: ReadState<CounselingListResponse>;
let cleanup: (() => void) | undefined;
function render(node: ReactNode, path = '/app') {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  flushSync(() => root.render(createElement(MemoryRouter, { initialEntries: [path] }, node)));
  cleanup = () => { flushSync(() => root.unmount()); container.remove(); };
  return container;
}
beforeEach(() => {
  vi.clearAllMocks();
  classes = { status: 'success', data: { classes: [row], total: 1 } };
  counseling = { status: 'success', data: { relationships: [counsel], total: 1 } };
  hooks.home.mockImplementation(() => ({ classes, counseling, retry: hooks.retry }));
});
afterEach(() => cleanup?.());

describe('MC01 회원 홈', () => {
  it('두 영역 중 가장 이른 제공 일정을 표시하고 기존 입장 흐름으로 연결한다', () => {
    const view = render(<MemberStructureHomePage />);
    expect(view.querySelector('[aria-label="다음 일정"]')?.textContent).toContain('상담 7회차');
    expect(view.querySelector('[aria-label="다음 일정"] a')?.getAttribute('href')).toBe('/class/c-next/enter');
    expect(view.textContent).toContain('이상담');
    expect(view.querySelector('a[href="/app/classes/class-1"]')).not.toBeNull();
    expect(view.querySelector('a[href="/app/counseling/relation-1"]')).not.toBeNull();
    expect(view.querySelector('main')?.dataset.role).toBe('member');
  });
  it.each(['classes', 'counseling'] as const)('%s 한쪽 실패만 오류로 표시하고 나머지는 유지한다', (failed) => {
    if (failed === 'classes') classes = { status: 'error', message: '목록을 불러오지 못했어요' };
    else counseling = { status: 'error', message: '목록을 불러오지 못했어요' };
    const view = render(<MemberStructureHomePage />);
    expect(view.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(view.textContent).toContain('확인된 다음 일정');
    expect(view.textContent).toContain(failed === 'classes' ? '이상담' : '호흡 명상 · 3회차');
    flushSync(() => view.querySelector('button')?.click());
    expect(hooks.retry).toHaveBeenCalledTimes(1);
  });
  it.each(['classes', 'counseling', 'both'] as const)('%s 빈 목록도 두 영역 링크를 유지한다', (empty) => {
    if (empty !== 'counseling') classes = { status: 'success', data: { classes: [], total: 0 } };
    if (empty !== 'classes') counseling = { status: 'success', data: { relationships: [], total: 0 } };
    const view = render(<MemberStructureHomePage />);
    expect(view.querySelector('a[href="/app/classes"]')).not.toBeNull();
    expect(view.querySelector('a[href="/app/counseling"]')).not.toBeNull();
    if (empty === 'both') expect(view.textContent).toContain('예정된 일정이 없어요');
    expect(view.textContent).not.toContain('연결이 필요');
  });
  it('과거 일정과 취소 일정으로 다음 일정을 만들지 않는다', () => {
    classes = { status: 'success', data: { classes: [{ ...row, next_session: { ...row.next_session, scheduled_at: '2000-01-01T00:00:00Z' } }], total: 1 } };
    counseling = { status: 'success', data: { relationships: [{ ...counsel, next_session: { ...counsel.next_session, status: 'cancelled' } }], total: 1 } };
    const view = render(<MemberStructureHomePage />);
    expect(view.querySelector('[aria-label="다음 일정"]')?.textContent).toContain('예정된 일정이 없어요');
    expect(view.querySelector('[aria-label="다음 일정"] a')).toBeNull();
  });
  it('일부 목록만 받으면 전체 다음 일정으로 단정하지 않는다', () => {
    classes = { status: 'success', data: { classes: [row], total: 5 } };
    expect(render(<MemberStructureHomePage />).textContent).toContain('확인된 다음 일정');
  });
});

// 개인 상태 추론·호스트 정보 노출·회차 재번호화 회귀를 검사한다.

const detailData = {
  detail: { ...row, location_type: 'online', location_address: null, linkband_mode: 'none', record_audio: false, capacity: 0, participant_mode: 'open', default_duration_min: 60,
    host_view: { access_code: 'SECRET-ACCESS', instructors: [{ user_id: 'private', name: '비공개강사', role: 'lead', status: 'active' }] } },
  sessions: { sessions: [
    { id: 's1', seq: 1, scheduled_at: null, status: 'completed', session_kind: 'regular', host: { id: 'h', name: null } },
    { id: 's3', seq: 3, scheduled_at: '2099-11-20T10:00:00+09:00', status: 'cancelled', session_kind: 'regular', host: { id: 'h', name: '김지도' } },
    { id: 's7', seq: 7, scheduled_at: null, status: 'scheduled', session_kind: 'regular', host: { id: 'h', name: null } },
    { id: 'missing', seq: null, scheduled_at: null, status: 'scheduled', session_kind: 'regular', host: { id: 'h', name: null } },
  ], total: 4 },
};
function detailPage(path = '/app/classes/class-1?sessionId=s3') {
  return render(<Routes><Route path="/app/classes/:classId" element={<MemberClassDetailPage />} /></Routes>, path);
}
describe('MC02 내 클래스', () => {
  it('서버 클래스 상태로만 그룹을 나누며 완료 회차로 개인 완료를 만들지 않는다', () => {
    hooks.classes.mockReturnValue({ state: { status: 'success', data: { classes: [row, { ...row, id: 'completed', title: '완료 클래스', status: 'completed' }, { ...row, id: 'cancelled', title: '취소 클래스', status: 'cancelled' }], total: 3 } }, retry: hooks.retry });
    const view = render(<MemberClassesPage />, '/app/classes');
    expect(view.querySelector('[aria-label="참여 중"]')?.textContent).toContain('호흡 명상');
    expect(view.querySelector('[aria-label="완료"]')?.textContent).toContain('완료 클래스');
    expect(view.querySelector('[aria-label="기타 상태"]')?.textContent).toContain('취소 클래스');
    expect(view.textContent).not.toMatch(/수료|참석|결석|보강 대기|이탈/);
    expect(view.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('0');
    expect(view.querySelector('a[href="/app/classes/class-1"]')).not.toBeNull();
    expect(hooks.detail).not.toHaveBeenCalled();
  });
  it.each(['loading', 'error', 'not_found', 'empty'] as const)('%s 상태를 구분하고 회원 목록으로 복귀한다', (status) => {
    hooks.classes.mockReturnValue({ state: status === 'empty' ? { status: 'success', data: { classes: [], total: 0 } } : { status }, retry: hooks.retry });
    const view = render(<MemberClassesPage />);
    expect(view.textContent).toContain({ loading: '불러오는 중이에요', error: '목록을 불러오지 못했어요', not_found: '내용을 찾을 수 없어요', empty: '아직 클래스가 없어요' }[status]);
    if (status === 'not_found') expect(view.querySelector('a')?.getAttribute('href')).toBe('/app/classes');
    if (status === 'error') { flushSync(() => view.querySelector('button')?.click()); expect(hooks.retry).toHaveBeenCalledTimes(1); }
  });
});
describe('MC03 내 클래스 상세', () => {
  beforeEach(() => hooks.detail.mockReturnValue({ state: { status: 'success', data: detailData }, retry: hooks.retry }));
  it('가시 회차 1/3/7과 누락을 유지하고 쿼리 회차만 선택하며 회원 경로로 이동한다', () => {
    const view = detailPage();
    const rows = [...view.querySelectorAll('[data-session-id]')];
    expect(rows).toHaveLength(4);
    expect(rows.map((item) => item.getAttribute('data-session-id'))).toEqual(['s1', 's3', 's7', 'missing']);
    expect(rows[0].textContent).toContain('1회차');
    expect(rows[1].textContent).toContain('3회차');
    expect(rows[2].textContent).toContain('7회차');
    expect(rows[3].textContent).toContain('데이터 없음');
    expect(rows[1].getAttribute('aria-current')).toBe('true');
    expect(rows.filter((item) => item.hasAttribute('aria-current'))).toHaveLength(1);
    expect(rows[1].querySelector('a')?.getAttribute('href')).toBe('/app/classes/class-1?sessionId=s3');
    expect(rows[1].textContent).toContain('취소');
    expect(hooks.detail).toHaveBeenCalledWith('class-1');
  });
  it('호스트 코드·강사 목록·개인 출석·수료·미제공 탭을 노출하지 않는다', () => {
    const view = detailPage();
    expect(view.textContent).not.toMatch(/SECRET-ACCESS|비공개강사|참석|결석|수료|리포트|설정|보강/);
    expect(view.textContent).toContain('클래스 진행');
    expect(view.textContent).toContain('0/8');
    expect(view.textContent).toContain('진행 중');
    expect(view.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(view.textContent).toContain('데이터 없음');
  });
  it('개요와 회차 탭을 전환해 제공된 0·false를 보존한다', () => {
    const view = detailPage();
    const overview = view.querySelector<HTMLButtonElement>('[role="tab"]');
    flushSync(() => overview?.click());
    expect(overview?.getAttribute('aria-selected')).toBe('true');
    expect(view.querySelector('[role="tabpanel"]')?.textContent).toContain('정원0');
    expect(view.querySelector('[role="tabpanel"]')?.textContent).toContain('음성 녹음아니요');
    expect(view.textContent).not.toContain('SECRET-ACCESS');
  });
  it('없는 회차를 쿼리로 지정해도 행을 만들어내지 않는다', () => {
    const view = detailPage('/app/classes/class-1?sessionId=hidden');
    expect(view.querySelectorAll('[data-session-id]')).toHaveLength(4);
    expect(view.querySelector('[aria-current]')).toBeNull();
  });
  it('진행 분모 0이면 비율을 만들지 않는다', () => {
    hooks.detail.mockReturnValue({ state: { status: 'success', data: { ...detailData, detail: { ...detailData.detail, progress: { completed: 0, total: 0 } } } }, retry: hooks.retry });
    const view = detailPage();
    expect(view.textContent).toContain('0/0');
    expect(view.querySelector('[role="progressbar"]')).toBeNull();
  });
  it('상세 404는 회원 목록으로만 복귀한다', () => {
    hooks.detail.mockReturnValue({ state: { status: 'not_found' }, retry: hooks.retry });
    const view = detailPage();
    expect(view.textContent).toContain('내용을 찾을 수 없어요');
    expect(view.querySelector('a')?.getAttribute('href')).toBe('/app/classes');
  });
});

describe('회원 표시 경계', () => {
  it('일부 조회 실패 뒤 다음 일정이 없으면 로딩 안내를 남기지 않는다', () => {
    classes = { status: 'success', data: { classes: [], total: 0 } };
    counseling = { status: 'error', message: '목록을 불러오지 못했어요' };
    const view = render(<MemberStructureHomePage />);
    expect(view.querySelector('[aria-label="다음 일정"]')?.textContent).toContain('확인된 예정 일정이 없어요');
    expect(view.textContent).not.toContain('확인하고 있어요');
  });
  it('상세 탭은 방향키와 Home·End로 포커스와 선택이 함께 이동한다', () => {
    hooks.detail.mockReturnValue({ state: { status: 'success', data: detailData }, retry: hooks.retry });
    const view = detailPage();
    const tabs = [...view.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0]);
    flushSync(() => tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[0]);
    flushSync(() => tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    expect(document.activeElement).toBe(tabs[1]);
    flushSync(() => tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    expect(document.activeElement).toBe(tabs[0]);
  });
});
