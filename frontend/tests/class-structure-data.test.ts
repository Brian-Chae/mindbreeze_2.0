import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient, ApiError } from '../src/lib/api/client';
import * as api from '../src/lib/api/class-structure';
import { asClassId, asRelationshipId } from '../src/lib/class-structure/read-model';

afterEach(() => vi.restoreAllMocks());

describe('읽기 wrapper', () => {
  it('다섯 GET 경로와 envelope를 보존하고 쿼리를 직렬화한다', async () => {
    const payload = { classes: [], total: 0 };
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue(payload);
    expect(await api.getClasses({ status: 'active & closed', page: 2, limit: 10 })).toBe(payload);
    await api.getClass(asClassId('a/b'));
    await api.getClassSessions(asClassId('a/b'));
    await api.getCounseling();
    await api.getCounselingDetail(asRelationshipId('r/1'));
    expect(get.mock.calls.map(([path]) => path)).toEqual([
      '/classes?status=active+%26+closed&page=2&limit=10', '/classes/a%2Fb',
      '/classes/a%2Fb/sessions', '/counseling', '/counseling/r%2F1',
    ]);
  });
  it('공통 인증 오류를 wrapper에서 변조하지 않는다', async () => {
    const error = new ApiError(404, '비공개 원문', { secret: true });
    vi.spyOn(apiClient, 'get').mockRejectedValue(error);
    await expect(api.getClass(asClassId('missing'))).rejects.toBe(error);
  });
  it('취소된 요청은 전송을 시작하지 않고 진행 중 결과도 폐기한다', async () => {
    const controller = new AbortController();
    controller.abort();
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ classes: [], total: 0 });
    await expect(api.getClasses(undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(get).not.toHaveBeenCalled();
    const active = new AbortController();
    get.mockImplementation(() => new Promise(() => {}));
    const request = api.getClasses(undefined, active.signal);
    active.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
});

const classFixture = (patch: Partial<api.ClassDetailDto> = {}): api.ClassDetailDto => ({
  id: 'class-1', title: '마음', status: 'active', schedule_mode: 'fixed', planned_session_count: 1,
  area: 'meditation', progress: { completed: 1, total: 1 }, session_count: 1,
  next_session: null, has_open_session: false, location_type: 'online', location_address: null,
  linkband_mode: 'none', record_audio: false, capacity: 0, participant_mode: 'registered', default_duration_min: 0,
  host_view: { access_code: 'SECRET', instructors: [] }, ...patch,
});
const counselingFixture = (patch: Partial<api.CounselingDetailDto> = {}): api.CounselingDetailDto => ({
  id: 'rel-1', status: 'active', area: 'counseling', counselor: { id: 'host-1', name: null },
  client_display: '내담자 미지정', modality_default: null, session_count: 2, next_session: null,
  latest_session: null, sessions: [2, 5].map((seq) => ({ id: `s-${seq}`, seq, scheduled_at: null,
    status: 'completed', type: 'clinical', record_status: null, report_status: 'ready' })), ...patch,
});

describe('표시 adapter', () => {
  it('0·false와 누락을 구분하고 클래스 상태를 회차 완료에서 추론하지 않는다', async () => {
    const { adaptHostClass, adaptMemberClass } = await import('../src/lib/class-structure/adapters');
    const { displayField } = await import('../src/lib/class-structure/read-model');
    expect(displayField(0)).toEqual({ kind: 'value', value: 0 });
    expect(displayField(false)).toEqual({ kind: 'value', value: false });
    expect(displayField(null)).toEqual({ kind: 'no_data', label: '데이터 없음' });
    expect(displayField(undefined)).toEqual({ kind: 'no_data', label: '데이터 없음' });
    const host = adaptHostClass(classFixture());
    expect(host.status).toEqual({ kind: 'value', value: 'active' });
    expect(host.capacity).toEqual({ kind: 'value', value: 0 });
    expect(host.recordAudio).toEqual({ kind: 'value', value: false });
    expect(host.hostView).toEqual({ accessCode: { kind: 'value', value: 'SECRET' }, instructors: [] });
    const member = adaptMemberClass(classFixture());
    expect(JSON.stringify(member)).not.toContain('SECRET');
    expect(member).not.toHaveProperty('hostView');
    expect(member.attendance).toEqual({ kind: 'no_data', label: '데이터 없음' });
    expect(adaptMemberClass(classFixture({ progress: undefined })).progress).toEqual({ kind: 'no_data', label: '데이터 없음' });
  });
  it('취소·누락 번호와 서버가 반환한 번호 빈칸을 그대로 보존한다', async () => {
    const { adaptClassSessions, adaptCounseling } = await import('../src/lib/class-structure/adapters');
    const rows: api.ClassSessionDto[] = [1, 3, 7, null].map((seq, index) => ({ id: `row-${index}`, seq,
      scheduled_at: null, status: index === 1 ? 'cancelled' : 'completed', session_kind: 'regular',
      host: { id: 'host-1', name: null }, host_state: null }));
    const copy = JSON.stringify(rows);
    const result = adaptClassSessions(rows);
    expect(result.map((row) => row.seq)).toEqual([1, 3, 7].map((value) => ({ kind: 'value', value })).concat([{ kind: 'no_data', label: '데이터 없음' }]));
    expect(result[1].status).toEqual({ kind: 'value', value: 'cancelled' });
    expect(JSON.stringify(rows)).toBe(copy);
    const counseling = adaptCounseling(counselingFixture());
    expect(counseling.title).toBe('상담 일정');
    expect(counseling.sessions.map((row) => row.seq)).toEqual([{ kind: 'value', value: 2 }, { kind: 'value', value: 5 }]);
    expect(counseling).not.toHaveProperty('personalCount');
    expect(counseling.counselorName).toEqual({ kind: 'no_data', label: '데이터 없음' });
    expect(counseling.sessions[0].reportStatus).toEqual({ kind: 'value', value: 'ready' });
    expect(counseling.sessions[0]).not.toHaveProperty('reportBody');
  });
  it('검증되지 않은 필수 ID를 링크 가능한 모델로 만들지 않는다', async () => {
    const { adaptHostClass } = await import('../src/lib/class-structure/adapters');
    expect(() => adaptHostClass(classFixture({ id: '' }))).toThrow();
  });
  it('혼합 홈은 서버 다음 일정만 비교하고 부분 실패를 보존한다', async () => {
    const { adaptMixedHome } = await import('../src/lib/class-structure/adapters');
    const classes = { status: 'success' as const, data: { classes: [classFixture({ next_session: {
      id: 'next-m', seq: 3, status: 'scheduled', scheduled_at: '2030-01-02T00:00:00Z', host: { id: 'h', name: '지도사' },
    } })], total: 40 } };
    const counseling = { status: 'success' as const, data: { relationships: [counselingFixture({ next_session: {
      id: 'next-c', seq: 5, status: 'scheduled', scheduled_at: '2030-01-01T00:00:00Z',
    } })], total: 1 } };
    const home = adaptMixedHome(classes, counseling, Date.parse('2029-01-01T00:00:00Z'));
    expect(home.next.kind === 'value' && home.next.value.sessionId).toBe('next-c');
    expect(home.nextIsComplete).toBe(true);
    expect(home.classes.status === 'success' && home.classes.data.total).toBe(40);
    const partial = adaptMixedHome(classes, { status: 'error', message: '목록을 불러오지 못했어요' }, 0);
    expect(partial.counseling.status).toBe('error');
    expect(partial.nextIsComplete).toBe(false);
    expect(adaptMixedHome({ status: 'success', data: { classes: [], total: 0 } },
      { status: 'success', data: { relationships: [], total: 0 } }).next.kind).toBe('no_data');
    classes.data.classes[0].next_session!.scheduled_at = '잘못된 날짜';
    expect(adaptMixedHome(classes, { status: 'success', data: { relationships: [], total: 0 } }).next.kind).toBe('no_data');
  });
});
