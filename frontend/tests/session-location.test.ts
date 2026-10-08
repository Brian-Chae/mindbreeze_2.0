import { describe, expect, it } from 'vitest';
import { getLocationAddressDefault, getLocationAddressPayload, isLocationAddressVisible } from '../src/lib/class/session-location';

describe('세션 장소 입력', () => {
  it('서버가 반환한 세션 주소를 수정 폼 초기값으로 사용한다', () => {
    expect(getLocationAddressDefault({ location_address: '저장된 주소', organizationAddress: '기관 주소' })).toBe('저장된 주소');
  });
  it('기관 주소를 우선하고 없으면 상담사 주소를 사용한다', () => {
    expect(getLocationAddressDefault({ organizationAddress: '기관 주소', addressLine1: '상담사 주소' })).toBe('기관 주소');
    expect(getLocationAddressDefault({ organizationAddress: ' ', addressLine1: '대전', addressLine2: '101호' })).toBe('대전 101호');
    expect(getLocationAddressDefault({ location_address: null })).toBe('');
  });
  it('온라인 전환은 입력란을 숨기고 주소 전송을 생략한다', () => {
    expect(isLocationAddressVisible('online')).toBe(false);
    expect(getLocationAddressPayload('online', '오프라인 주소')).toBeUndefined();
    expect(isLocationAddressVisible('offline')).toBe(true);
    expect(getLocationAddressPayload('offline', ' 수정한 주소 ')).toBe('수정한 주소');
  });
  it('빈 주소는 서버 기본값을 사용하고 300자를 초과하면 막는다', () => {
    expect(getLocationAddressPayload('offline', ' ')).toBeUndefined();
    expect(getLocationAddressPayload('offline', '가'.repeat(300))).toHaveLength(300);
    expect(() => getLocationAddressPayload('offline', '가'.repeat(301))).toThrow('300자');
  });
});
