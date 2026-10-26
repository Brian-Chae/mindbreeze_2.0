// @vitest-environment jsdom
// SDD-220 트랙 ⓒ — 가입 연령·동의·Apple 버튼·탈퇴/동의 UI 계약 (TS12~TS15, TS16, TS20, TS24 프론트 부분)
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
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

// ── TS14 / TS15 / TS24: 동의 UI ─────────────────────────────────────
import { RecordingConsentCheck } from '../src/components/class/flow/member/RecordingConsentCheck';
import { EegConsentChoiceView } from '../src/components/class/flow/member/EegConsentChoiceView';
import { NoticeStepView } from '../src/components/class/flow/member/NoticeStepView';
import { PrivacyConsentsSection } from '../src/components/settings/privacy-consents';
import { RECORDING_HEADLINE, isRecordingConsentRequired, recordingNoticeLines } from '../src/lib/class/flow/recording-consent';

test('녹음·녹화 필수 동의: 헤드라인과 필수 체크, AI 꺼짐이면 “AI 기록” 문구가 없고 “녹음”은 유지', () => {
  const html = renderToStaticMarkup(createElement(RecordingConsentCheck, { checked: false, onChange: () => {} }));
  expect(html).toContain(RECORDING_HEADLINE);
  expect(html).toContain('이 클래스는 녹음·녹화될 수 있어요');
  expect(html).toMatch(/aria-required="true"/);
  expect(html).toMatch(/aria-checked="false"/);
  expect(html).toContain('녹음');
  expect(html).not.toContain('AI 기록');
  expect(recordingNoticeLines({ aiEnabled: false, online: true }).join(' ')).not.toMatch(/AI/);
  expect(recordingNoticeLines({ aiEnabled: true, online: true }).join(' ')).toMatch(/AI/);
});

test('서버의 RECORDING_CONSENT_REQUIRED 403 만 동의 화면으로 이어진다', () => {
  expect(isRecordingConsentRequired(new ApiError(403, 'x', { detail: { code: 'RECORDING_CONSENT_REQUIRED' } }))).toBe(true);
  expect(isRecordingConsentRequired(new ApiError(403, 'x', { detail: { code: 'OTHER' } }))).toBe(false);
  expect(isRecordingConsentRequired(new ApiError(401, 'x', { detail: { code: 'RECORDING_CONSENT_REQUIRED' } }))).toBe(false);
});

test('고지 화면: AI 꺼짐이면 “녹음과 AI 기록” 대신 “녹음”만 안내한다', async () => {
  const base = {
    place: 'online' as const, size: 'group' as const, bandMode: 'opt' as const, title: '명상', hostName: '진행자', retentionDays: 90,
    reportChoice: 'excluded' as const, researchConsent: false, researchSaveFailed: false, steps: { total: 5, current: 0 },
    onReportChoice: () => {}, onResearchChange: () => {}, onNext: () => {}, onBack: () => {}, onExit: () => {},
  };
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) });
  const box = document.createElement('div'); const root = createRoot(box);
  try {
    await act(async () => root.render(createElement(NoticeStepView, { ...base, aiEnabled: false })));
    await act(async () => box.querySelector<HTMLButtonElement>('[aria-label="기록 안내 자세히 보기"]')!.click());
    const off = box.textContent ?? '';
    expect(off).not.toContain('AI 기록');
    expect(off).not.toContain('AI가 기록지를');
    expect(off).toContain('녹음');
    await act(async () => root.render(createElement(NoticeStepView, base)));
    const on = box.textContent ?? '';
    expect(on).toContain('녹음과 AI 기록');
  } finally {
    await act(async () => root.unmount());
  }
});

test('뇌파 수집 선택 화면: 동의/미동의 둘 다 계속할 수 있고, 리포트·연구와 별개임을 알린다', () => {
  const html = renderToStaticMarkup(
    createElement(EegConsentChoiceView, {
      steps: { total: 5, current: 2 }, saving: false, error: null, onAgree: () => {}, onDecline: () => {}, onBack: () => {}, onExit: () => {},
    }),
  );
  expect(html).toContain('동의하고 LINK BAND 연결하기');
  expect(html).toContain('동의하지 않고 계속하기');
  expect(html).toContain('리포트 반영, 연구 활용 선택과는 별개예요');
});

test('설정 개인정보 섹션: 선택 동의 두 항목을 보여 주고 필수 동의는 다루지 않는다', () => {
  const html = renderToStaticMarkup(createElement(PrivacyConsentsSection));
  expect(html).toContain('개인정보 선택 동의');
  expect(html).not.toContain('서비스 이용약관');
});
