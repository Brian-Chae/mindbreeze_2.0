// @vitest-environment jsdom
// SDD-209 M0 — 입장 코드·개인정보 순수 로직 + 입장 API 어댑터(모킹) + 입장 자격 저장.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
const get = vi.fn();
const put = vi.fn();
vi.mock('../src/lib/api/client', () => {
  class ApiError extends Error {
    status: number;
    data: unknown;
    constructor(status: number, message: string, data: unknown) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  return {
    ApiError,
    apiClient: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a) },
    tokenStorage: { getAccess: () => null },
    refreshAccessToken: vi.fn(),
  };
});

import { ApiError } from '../src/lib/api/client';
import {
  clearEntry, enterByCode, loadEntry, saveEntry, verifyEntryCode, ENTRY_HEADER, entryRequestOptions,
} from '../src/lib/api/class-flow';
import {
  birthToIso, classifyCodeError, emptyProfileDraft, isCompleteCode, maskEmail, sanitizeCodeInput, toEnterPayload, validateEntryProfile,
  type EntryProfileDraft,
} from '../src/lib/class/flow/member-entry';

const GOOD: EntryProfileDraft = {
  name: '지은', gender: 'female', birth: '1990.03.12', email: 'jieun@example.com', emailConfirm: 'jieun@example.com',
};

beforeEach(() => {
  post.mockReset();
  get.mockReset();
  put.mockReset();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('코드 입력 순수 로직', () => {
  it('숫자만 남기고 4자리로 자른다 (선행 0 보존, 문자열)', () => {
    expect(sanitizeCodeInput('0a04b2x99')).toBe('0042');
    expect(sanitizeCodeInput(' 00 00 ')).toBe('0000');
    expect(sanitizeCodeInput('')).toBe('');
  });
  it('4자리를 모두 채워야 완료', () => {
    expect(isCompleteCode('004')).toBe(false);
    expect(isCompleteCode('0042')).toBe(true);
    expect(isCompleteCode('0000')).toBe(true);
  });
  it('없는/틀린/종료 코드는 모두 같은 분류(invalid), 429 는 throttled', () => {
    expect(classifyCodeError(new ApiError(404, '세션을 찾을 수 없습니다', null))).toBe('invalid');
    expect(classifyCodeError(new ApiError(422, '형식', null))).toBe('invalid');
    expect(classifyCodeError(new ApiError(429, '제한', null))).toBe('throttled');
    expect(classifyCodeError(new ApiError(500, '서버', null))).toBe('error');
    expect(classifyCodeError(new TypeError('Failed to fetch'))).toBe('error');
  });
});

describe('개인정보 입력 검증', () => {
  it('생년월일은 연.월.일/연-월-일/숫자 8자리를 ISO 로 바꾸고 달력에 없는 날짜는 거부한다', () => {
    expect(birthToIso('1990.03.12')).toBe('1990-03-12');
    expect(birthToIso('1990-3-2')).toBe('1990-03-02');
    expect(birthToIso('19900312')).toBe('1990-03-12');
    expect(birthToIso('1990.13')).toBeNull();
    expect(birthToIso('1990.02.30')).toBeNull();
    expect(birthToIso('2999.01.01')).toBeNull();
    expect(birthToIso('')).toBeNull();
  });
  it('필수 누락·형식 오류·이메일 불일치를 항목별 인라인 문구로 돌려준다', () => {
    expect(validateEntryProfile(GOOD, 'guest')).toEqual({});
    const bad = validateEntryProfile({ name: ' ', gender: null, birth: '1990.13', email: 'jieun@', emailConfirm: '' }, 'guest');
    expect(bad.name).toBe('이름을 입력해 주세요');
    expect(bad.gender).toBe('성별을 선택해 주세요');
    expect(bad.birth).toBe('생년월일을 다시 확인해 주세요');
    expect(bad.email).toBe('이메일 형식을 확인해 주세요');
    expect(validateEntryProfile({ ...GOOD, emailConfirm: 'jieun@exampel.com' }, 'guest').emailConfirm).toBe('이메일이 서로 달라요');
  });
  it('로그인 회원은 이메일 재입력과 성별·생년월일 입력을 요구하지 않는다', () => {
    expect(validateEntryProfile({ ...emptyProfileDraft(), name: '지은', email: 'jieun@example.com' }, 'member')).toEqual({});
  });
  it('요청 바디는 코드 문자열 그대로(선행 0) + 프로필(ISO 생년월일)', () => {
    expect(toEnterPayload('0042', GOOD, 'guest')).toEqual({
      code: '0042', name: '지은', gender: 'female', birth_date: '1990-03-12', email: 'jieun@example.com',
    });
    expect(toEnterPayload('0042', GOOD, 'member')).toEqual({ code: '0042' });
  });
  it('이메일은 앞 두 글자만 남기고 가린다', () => {
    expect(maskEmail('jieun@example.com')).toBe('ji***@example.com');
    expect(maskEmail('a@b.co')).toBe('a***@b.co');
    expect(maskEmail('bad')).toBe('');
  });
});

describe('입장 API 어댑터', () => {
  it('코드 확인은 문자열 코드를 그대로 보내고 인증 없이 호출한다', async () => {
    post.mockResolvedValue({ title: '명상', scheduled_at: null, host_name: '채용욱' });
    const res = await verifyEntryCode('0042');
    expect(post).toHaveBeenCalledWith('/sessions/enter/verify', { code: '0042' }, { skipAuth: true });
    expect(res.host_name).toBe('채용욱');
  });
  it('입장은 바디만 보내고 비회원이면 인증 갱신을 건드리지 않는다(skipAuth)', async () => {
    post.mockResolvedValue({ entry_credential: 'cred', expires_at: null, participant_id: 'p1', is_guest: true, is_waitlisted: false, session: { id: 's1' } });
    await enterByCode({ code: '0042', name: '지은' });
    expect(post).toHaveBeenCalledWith('/sessions/enter', { code: '0042', name: '지은' }, { skipAuth: true, headers: {} });
  });
  it('입장 자격 헤더를 만든다', () => {
    expect(entryRequestOptions('abc')).toEqual({ skipAuth: true, headers: { [ENTRY_HEADER]: 'abc' } });
    expect(entryRequestOptions(null)).toEqual({ skipAuth: true, headers: {} });
  });
});

describe('입장 자격 저장 (탭 단위 sessionStorage)', () => {
  it('자격·참여자만 저장하고 코드·개인정보·localStorage 는 0', () => {
    saveEntry({ sessionId: 's1', credential: 'cred-1', expiresAt: '2030-01-01T00:00:00Z', participantId: 'p1', isGuest: true });
    const raw = window.sessionStorage.getItem('mb_entry_s1') ?? '';
    expect(loadEntry('s1')).toMatchObject({ credential: 'cred-1', participantId: 'p1', isGuest: true });
    for (const secret of ['0042', '지은', 'jieun', '1990']) expect(raw).not.toContain(secret);
    expect(window.localStorage.length).toBe(0);
    clearEntry('s1');
    expect(loadEntry('s1')).toBeNull();
  });
  it('만료된 자격은 읽지 않는다', () => {
    saveEntry({ sessionId: 's2', credential: 'c', expiresAt: '2000-01-01T00:00:00Z', participantId: 'p', isGuest: true });
    expect(loadEntry('s2')).toBeNull();
  });
});
