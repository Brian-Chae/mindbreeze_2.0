// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/api/client';
import { setPageLeavingForTest, userErrorMessage } from '../src/lib/api/user-error';

afterEach(() => setPageLeavingForTest(false));

describe('userErrorMessage', () => {
  it('브라우저 원문 Failed to fetch 를 그대로 노출하지 않는다', () => {
    const text = userErrorMessage(new TypeError('Failed to fetch'), '실패');
    expect(text).not.toBeNull();
    expect(text).not.toMatch(/fetch/i);
  });
  it('Safari/Firefox 원문도 가린다', () => {
    expect(userErrorMessage(new Error('Load failed'), '실패')).not.toMatch(/load failed/i);
    expect(userErrorMessage(new Error('NetworkError when attempting to fetch resource.'), '실패')).not.toMatch(/fetch/i);
  });
  it('취소(AbortError)는 표시하지 않는다', () => {
    expect(userErrorMessage(new DOMException('요청 취소', 'AbortError'), '실패')).toBeNull();
  });
  it('페이지 이탈 중 끊긴 요청은 표시하지 않는다', () => {
    setPageLeavingForTest(true);
    expect(userErrorMessage(new TypeError('Failed to fetch'), '실패')).toBeNull();
  });
  it('서버가 준 한국어 문구는 유지한다', () => {
    expect(userErrorMessage(new ApiError(409, '이미 종료된 클래스예요', null), '실패')).toBe('이미 종료된 클래스예요');
  });
  it('Error 가 아니면 fallback', () => {
    expect(userErrorMessage('x', '실패')).toBe('실패');
  });
});
