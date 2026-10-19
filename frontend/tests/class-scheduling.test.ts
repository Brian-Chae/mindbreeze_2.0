import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api/client';
import { defaultSchedule, scheduleProblems, operationKeys, schedulingError, parseInviteEmails } from '../src/lib/class-structure/scheduling-model';
import { schedulingApi } from '../src/lib/api/class-scheduling';
import { apiClient } from '../src/lib/api/client';

describe('편성 입력과 재시도', () => {
  it('기본값 8회·60분·10명·밴드 선택·영상 꺼짐을 유지한다', () => {
    const value = defaultSchedule('u1', '2026-10-20');
    expect(value).toMatchObject({ planned_session_count: 8, duration_min: 60, capacity: 10, record_video: false, linkband_mode: 'optional' });
    expect(value.instructors).toEqual([{ user_id: 'u1', role: 'lead' }]);
  });
  it('정원·요일·주소·과거 날짜를 검사한다', () => {
    const value = { ...defaultSchedule('u1', '2026-10-19'), title: '명상', capacity: 51 };
    expect(scheduleProblems(value, '2026-10-20').join(' ')).toMatch(/정원.*50/);
    expect(scheduleProblems(value, '2026-10-20').join(' ')).toContain('시작 날짜');
    expect(scheduleProblems({ ...value, location_type: 'offline', recurrence_rule: { ...value.recurrence_rule, weekdays: [] } }, '2026-10-20').join(' ')).toMatch(/장소.*요일/);
  });
  it('동일 요청은 키를 유지하고 수정한 요청은 새 키를 사용한다', () => {
    const next = vi.fn().mockReturnValueOnce('a').mockReturnValueOnce('b');
    const key = operationKeys(next);
    expect(key({ title: 'A' })).toBe('a'); expect(key({ title: 'A' })).toBe('a');
    expect(key({ title: 'B' })).toBe('b'); expect(next).toHaveBeenCalledTimes(2);
  });
  it('이메일은 주소를 정규화하고 중복 제거한다', () => {
    expect(parseInviteEmails(' A@EXAMPLE.COM, a@example.com\nb@example.com ')).toEqual(['a@example.com', 'b@example.com']);
  });
  it('서버 내부 오류 원문 대신 한국어 안내를 반환한다', () => {
    expect(schedulingError(new ApiError(409, 'private sql', { detail: { code: 'stale_class' } }))).toContain('다른 변경');
    expect(schedulingError(new Error('private sql'))).not.toContain('private sql');
  });
  it('생성은 기존 단건 세션이 아닌 클래스 경로와 충돌 확인을 사용한다', async () => {
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue({ class_id: 'c1', revision: 1 });
    const payload = { operation_key: 'same-key', status: 'active' as const, schedule: defaultSchedule('u1', '2026-10-20'), force: true, confirmed_conflict_fingerprint: 'fp' };
    await schedulingApi.create(payload);
    expect(spy).toHaveBeenCalledWith('/classes', payload);
    spy.mockRestore();
  });
});
