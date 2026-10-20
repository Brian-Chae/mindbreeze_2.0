// SDD-220 트랙 ⓒ — 가입 연령·동의·Apple 버튼·탈퇴/동의 UI 계약 (TS12~TS15, TS16, TS20, TS24 프론트 부분)
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { BIRTH_DATE_MESSAGES, checkBirthDate, todayKst } from '../src/lib/auth/age';
import { hasRequiredConsents, toConsentPayload } from '../src/lib/auth/consents';
import { apiErrorCode } from '../src/lib/api/auth';
import { ApiError } from '../src/lib/api/client';
import { ConsentCheckList } from '../src/components/auth/ConsentCheckList';
import AppleLoginButton from '../src/components/auth/AppleLoginButton';
import LoginPage from '../src/pages/LoginPage';

vi.mock('@react-oauth/google', () => ({ useGoogleLogin: () => () => {} }));

// ── TS12: 만 14세 경계 ──────────────────────────────────────────────
test('생일 당일부터 만 14세 허용, 하루 미달은 거부', () => {
  expect(checkBirthDate('2012-10-20', '2026-10-20')).toBe('ok');
  expect(checkBirthDate('2012-10-21', '2026-10-20')).toBe('underage');
  expect(checkBirthDate('2012-02-29', '2026-02-28')).toBe('underage');
  expect(checkBirthDate('2012-02-29', '2026-03-01')).toBe('ok');
});

test('빈값·형식오류·미래 날짜는 각각 안내 문구가 있다', () => {
  expect(checkBirthDate('', '2026-10-20')).toBe('required');
  expect(checkBirthDate('2012-13-40', '2026-10-20')).toBe('invalid');
  expect(checkBirthDate('2999-01-01', '2026-10-20')).toBe('invalid');
  expect(BIRTH_DATE_MESSAGES.underage).toContain('만 14세');
});

test('한국 날짜 기준 오늘 — UTC 15시 이후는 다음 날', () => {
  expect(todayKst(new Date('2026-10-19T15:30:00Z'))).toBe('2026-10-20');
  expect(todayKst(new Date('2026-10-19T14:30:00Z'))).toBe('2026-10-19');
});

// ── TS14: 필수/선택 동의 분리 ───────────────────────────────────────
test('선택 동의 거부는 필수 동의 판정에 영향이 없다', () => {
  expect(hasRequiredConsents({ tos: true, privacy: true, sensitive: true, eeg: false, research: false })).toBe(true);
  expect(hasRequiredConsents({ tos: true, privacy: false, sensitive: true })).toBe(false);
});

test('제출 payload 는 선택 동의를 true 로 추정하지 않는다', () => {
  expect(toConsentPayload({ tos: true, privacy: true, sensitive: true })).toEqual({
    tos: true, privacy: true, sensitive: true, eeg: false, research: false,
  });
  expect(toConsentPayload({ tos: true, privacy: true, sensitive: true, eeg: true }).eeg).toBe(true);
});

test('동의 체크리스트: 필수 3 + 선택 2, 선택은 가입에 영향 없다고 안내', () => {
  const html = renderToStaticMarkup(
    createElement(ConsentCheckList, { consents: { tos: false, privacy: false, sensitive: false }, onChange: () => {} }),
  );
  expect((html.match(/\[필수\]/g) || []).length).toBe(3);
  expect((html.match(/\[선택\]/g) || []).length).toBe(2);
  expect(html).toMatch(/뇌파/);
  expect(html).toMatch(/영향이 없어요/);
});

// ── 서버 오류 코드 ──────────────────────────────────────────────────
test('apiErrorCode 는 detail.code 를 읽는다', () => {
  const err = new ApiError(409, '탈퇴 처리 중인 이메일이에요', { detail: { code: 'ACCOUNT_DELETION_PENDING', msg: 'x' } });
  expect(apiErrorCode(err)).toBe('ACCOUNT_DELETION_PENDING');
  expect(apiErrorCode(new ApiError(500, 'x', null))).toBeNull();
  expect(apiErrorCode(new Error('x'))).toBeNull();
});

// ── Apple 버튼 ──────────────────────────────────────────────────────
test('웹(비 iOS)에서는 Apple 버튼을 그리지 않는다', () => {
  expect(renderToStaticMarkup(createElement(AppleLoginButton, {}))).toBe('');
});

test('로그인 화면은 웹에서도 정상 렌더된다(Apple 은 iOS 에서만 노출)', () => {
  const html = renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: ['/login'] }, createElement(LoginPage)),
  );
  expect(html).toMatch(/Google로 회원 로그인/);
  expect(html).not.toMatch(/Apple로 계속하기/);
});

// ── TS16 / TS20: 계정 삭제 UI ───────────────────────────────────────
import { AccountDeletionSection } from '../src/components/settings/account-deletion';
import AccountDeletionPage from '../src/pages/account-deletion-page';
import { DELETION_NOTICE_LINES } from '../src/lib/account-deletion-copy';

test('설정 첫 화면에서 “계정 삭제” 버튼 한 번으로 안내에 들어간다(2탭 이내)', () => {
  const html = renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(AccountDeletionSection)),
  );
  expect(html).toMatch(/계정 삭제/);
  expect(html).not.toMatch(/role="dialog"/); // 닫힌 상태에서는 대화상자가 없다
});

test('삭제 안내는 즉시 로그아웃·30일·복구 불가·법정 보관 예외·재가입 제한을 모두 알린다', () => {
  const text = DELETION_NOTICE_LINES.join(' ');
  expect(text).toMatch(/로그아웃/);
  expect(text).toMatch(/30일/);
  expect(text).toMatch(/복구할 수 없어요/);
  expect(text).toMatch(/법령/);
  expect(text).toMatch(/다시 가입할 수 없어요/);
});

test('공개 삭제 요청 페이지는 로그인 없이 이메일 폼과 안내를 보여 준다', () => {
  const html = renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(AccountDeletionPage)),
  );
  expect(html).toMatch(/계정 삭제 요청/);
  expect(html).toMatch(/type="email"/);
  expect(html).toMatch(/30일/);
});
