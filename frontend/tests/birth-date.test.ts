import { describe, expect, it } from 'vitest';
import {
  checkBirthInput,
  extractBirthDigits,
  formatBirthDigits,
  fromIsoBirthDate,
  toIsoBirthDate,
} from '../src/lib/auth/birth-date';

describe('birth-date 순수 로직', () => {
  it('숫자만 최대 8자리 추출', () => {
    expect(extractBirthDigits('1990.03.15')).toBe('19900315');
    expect(extractBirthDigits('1990-03-15abc')).toBe('19900315');
    expect(extractBirthDigits('199003151234')).toBe('19900315');
    expect(extractBirthDigits('abc 가')).toBe('');
  });
  it('자동 구분점 포맷', () => {
    expect(formatBirthDigits('1990')).toBe('1990');
    expect(formatBirthDigits('19900')).toBe('1990.0');
    expect(formatBirthDigits('199003')).toBe('1990.03');
    expect(formatBirthDigits('1990031')).toBe('1990.03.1');
    expect(formatBirthDigits('19900315')).toBe('1990.03.15');
    expect(formatBirthDigits('1990-03-15')).toBe('1990.03.15');
  });
  it('8자리일 때만 ISO', () => {
    expect(toIsoBirthDate('1990.03.15')).toBe('1990-03-15');
    expect(toIsoBirthDate('1990.03.1')).toBe('');
    expect(fromIsoBirthDate('1990-03-15')).toBe('1990.03.15');
    expect(fromIsoBirthDate('')).toBe('');
    expect(fromIsoBirthDate(null)).toBe('');
  });
  it('검증: signup 규칙', () => {
    const today = '2026-10-28';
    expect(checkBirthInput('', 'signup', today)).toBe('required');
    expect(checkBirthInput('1990.0', 'signup', today)).toBe('incomplete');
    expect(checkBirthInput('2023.13.01', 'signup', today)).toBe('invalid');
    expect(checkBirthInput('2030.01.01', 'signup', today)).toBe('invalid');
    expect(checkBirthInput('1899.12.31', 'signup', today)).toBe('invalid');
    expect(checkBirthInput('1999.02.29', 'signup', today)).toBe('invalid');
    expect(checkBirthInput('2013.10.29', 'signup', today)).toBe('underage');
    expect(checkBirthInput('2012.10.28', 'signup', today)).toBe('ok');
    expect(checkBirthInput('1990.03.15', 'signup', today)).toBe('ok');
  });
  it('검증: 나이 제한 없음(프로필 수정)', () => {
    const today = '2026-10-28';
    expect(checkBirthInput('2016.05.01', 'none', today)).toBe('ok');
    expect(checkBirthInput('2030.01.01', 'none', today)).toBe('invalid');
    expect(checkBirthInput('2020.02.30', 'none', today)).toBe('invalid');
  });
});
