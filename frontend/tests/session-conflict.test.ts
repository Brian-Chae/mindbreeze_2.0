import { describe, expect, it } from 'vitest';
import { ApiError, formatErrorDetail } from '../src/lib/api/client';
import { scheduleConflictFingerprint } from '../src/lib/api/session';

const conflict = { detail: { code: 'schedule_conflict', conflicts: [], conflict_fingerprint: 'fp1' } };

describe('클래스 시작 409 처리', () => {
  it('schedule_conflict detail 을 사용자 문구로 바꾼다', () => {
    expect(formatErrorDetail(conflict.detail)).toContain('겹치는');
  });
  it('409 schedule_conflict 에서 확인 지문을 꺼낸다', () => {
    expect(scheduleConflictFingerprint(new ApiError(409, 'x', conflict))).toBe('fp1');
  });
  it('다른 409/오류는 null', () => {
    expect(scheduleConflictFingerprint(new ApiError(409, 'x', { detail: '상태가 이미 변경되었습니다' }))).toBeNull();
    expect(scheduleConflictFingerprint(new Error('x'))).toBeNull();
  });
});
