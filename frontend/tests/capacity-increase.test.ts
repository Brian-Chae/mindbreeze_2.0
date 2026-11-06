import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/api/client';
import {
  capacityInputMessage, capacityMax, capacityServerMessage, capacitySuccessMessage, validateCapacityInput,
} from '../src/lib/class/capacity-increase';

const ctx = { current: 40, occupied: 40, online: false };

describe('SDD-289 정원 늘리기 규칙', () => {
  it('상한은 오프라인 100 / 온라인 50', () => {
    expect(capacityMax(false)).toBe(100);
    expect(capacityMax(true)).toBe(50);
  });
  it('현재 정원 초과·상한 이내 정수만 통과', () => {
    expect(validateCapacityInput('41', ctx)).toEqual({ value: 41, error: null });
    expect(validateCapacityInput('100', ctx).error).toBeNull();
    expect(validateCapacityInput('101', ctx).error).toBe('over_max');
    expect(validateCapacityInput('51', { ...ctx, online: true }).error).toBe('over_max');
  });
  it('같거나 작은 값은 늘리기가 아니다', () => {
    expect(validateCapacityInput('40', ctx).error).toBe('not_increase');
    expect(validateCapacityInput('45', { current: 50, occupied: 40, online: false }).error).toBe('not_increase');
  });
  it('현재 입장 인원 미만은 거부', () => {
    expect(validateCapacityInput('30', ctx).error).toBe('below_occupied');
  });
  it('정수가 아니면 거부', () => {
    for (const raw of ['', 'abc', '41.5', '-3', '4 1']) expect(validateCapacityInput(raw, ctx).error).toBe('not_integer');
  });
  it('입력 오류 문구 3종과 금지 표현 없음', () => {
    const texts = (['below_occupied', 'not_increase', 'over_max', 'not_integer'] as const).map((e) => capacityInputMessage(e, ctx));
    expect(texts[0]).toContain('40명');
    expect(texts[2]).toContain('100명');
    for (const t of texts) expect(t).not.toMatch(/점수|종합|좋음|나쁨|완료|보증/);
  });
  it('서버 오류 코드를 한국어로 바꾼다', () => {
    const err = (code: string, status = 422) => new ApiError(status, 'x', { detail: { code } });
    expect(capacityServerMessage(err('capacity_below_occupied'))).toContain('입장 인원');
    expect(capacityServerMessage(err('reason_required'))).toContain('사유');
    expect(capacityServerMessage(err('stale_class', 409))).toContain('최신');
    expect(capacityServerMessage(err('unknown_code'))).toContain('다시 시도');
    expect(capacityServerMessage(new Error('boom'))).toContain('다시 시도');
  });
  it('성공 안내: 대기자 n명 입장, 0명이면 정원만', () => {
    expect(capacitySuccessMessage(50, 10)).toContain('10명을 입장 처리');
    expect(capacitySuccessMessage(50, 0)).toBe('정원을 50명으로 늘렸어요.');
    expect(capacitySuccessMessage(50, 10)).not.toMatch(/점수|종합|좋음|나쁨|보증|100%/);
  });
});
