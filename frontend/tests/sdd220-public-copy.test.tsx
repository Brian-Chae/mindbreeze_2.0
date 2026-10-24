// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router-dom';
import { PRIVACY_ARTICLES } from '../src/lib/privacy-policy';
import { TermsPage } from '../src/pages/terms-page';
import { CrisisHelpPage } from '../src/pages/crisis-help-page';
import { MeasurementGuidePage } from '../src/pages/measurement-guide-page';
import { NativeOrganizationGate } from '../src/components/routing/native-organization-gate';
import { findPublicCopyViolations, WELLNESS_DISCLAIMER } from '../src/lib/legal-copy';
import RegisterPage from '../src/pages/RegisterPage';
import RegisterOrganizationPage from '../src/pages/register/RegisterOrganizationPage';
import LandingPage from '../src/pages/LandingPage';
const platform = vi.hoisted(() => ({ native: true }));
vi.mock('../src/lib/native/platform', () => ({ isNativeApp: () => platform.native }));
let root: Root | undefined;
afterEach(() => { if (root) { flushSync(() => root?.unmount()); root = undefined; } document.body.replaceChildren(); vi.unstubAllEnvs(); platform.native = true; });
const show = (node: ReactNode) => { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); flushSync(() => root?.render(<MemoryRouter>{node}</MemoryRouter>)); return { unmount: () => { flushSync(() => root?.unmount()); root = undefined; host.remove(); } }; };
describe('SDD-220 공개 정책', () => {
  it('약관에 연령, 제재, 탈퇴와 운영 책임자를 고지한다', () => {
    show(<TermsPage />);
    for (const text of ['14세', '30일', '채용욱', '금지행위']) expect(document.body.textContent).toContain(text);
    expect(document.body.textContent).toContain('회원가입은 만 14세 이상');
    expect(document.body.textContent).toContain('학교·기관');
    expect(document.body.textContent).toContain('보호자의 서면 동의');
    expect(document.body.textContent).toContain('만 14세 미만도 비회원으로 코드 입장');
    expect(document.body.textContent).not.toContain('만 14세 이상 이용할 수 있습니다');
  });
  it('방침은 선택 동의와 탈퇴, 위탁, 광고 미사용을 구분한다', () => {
    const text = JSON.stringify(PRIVACY_ARTICLES);
    for (const term of ['30일', '재가입', 'AWS S3', 'Resend', 'FCM', 'LiveKit', '광고', '선택', '현재 제공하지']) expect(text).toContain(term);
    expect(text).not.toContain('보관 기한을 두지 않고');
  });
  it('위기 도움은 검증되지 않은 전화번호를 게시하지 않는다', () => {
    show(<CrisisHelpPage />);
    expect(document.querySelector('h1')?.textContent).toBe('긴급한 도움이 필요할 때');
    expect(document.querySelector('a[href^="tel:"]')).toBeNull();
  });
  it('측정 방법에 한계와 지표 이름을 설명한다', () => {
    show(<MeasurementGuidePage />);
    for (const term of ['2채널', '주파수', '개인차', '착용', '집중도', '이완도', '스트레스']) expect(document.body.textContent).toContain(term);
    expect(document.body.textContent).toContain(WELLNESS_DISCLAIMER);
  });
  it('면책 문장만 예외로 하고 결제 및 의료 효과 표현을 탐지한다', () => {
    expect(findPublicCopyViolations(WELLNESS_DISCLAIMER)).toEqual([]);
    for (const text of ['무료로 시작하기', '무료 체험', '효과 입증', '질병을 치료합니다', '진단 결과', '구독 요금']) expect(findPublicCopyViolations(text).length).toBeGreaterThan(0);
  });
  it('네이티브 기관 gate는 자식을 마운트하지 않는다', () => {
    show(<NativeOrganizationGate><form aria-label="기관 신청" /></NativeOrganizationGate>);
    expect(document.querySelector('form')).toBeNull();
    expect(document.body.textContent).toContain('기관 도입은 웹 또는 영업 문의로 진행됩니다');
    expect(document.querySelector('a[href^="mailto:"]')?.textContent).toBe('기관 도입 문의');
  });
  it('기관 페이지 직접 진입은 native에서 폼이 없고 web에서는 유지한다', () => {
    const native = show(<RegisterOrganizationPage />);
    expect(document.querySelector('form')).toBeNull();
    native.unmount();
    platform.native = false;
    show(<RegisterOrganizationPage />);
    expect(document.querySelector('form')).not.toBeNull();
  });
  it('역할 선택은 native에서 기관 선택을 숨기고 회원과 진행자는 유지한다', () => {
    const native = show(<RegisterPage />);
    expect(document.querySelector('a[href="/register/organization"]')).toBeNull();
    expect(document.querySelector('a[href="/register/client"]')).not.toBeNull();
    expect(document.querySelector('a[href="/register/counselor"]')).not.toBeNull();
    native.unmount();
    platform.native = false;
    show(<RegisterPage />);
    expect(document.querySelector('a[href="/register/organization"]')).not.toBeNull();
  });
  it('AI off 랜딩은 제공 약속과 금지 문구가 없고 on에서는 소개한다', () => {
    vi.stubEnv('VITE_AI_ENABLED', 'false');
    vi.stubEnv('VITE_STT_ENABLED', 'false');
    const view = show(<LandingPage />);
    expect(document.body.textContent).not.toMatch(/AI|위험 신호/);
    expect(findPublicCopyViolations(document.body.textContent ?? '')).toEqual([]);
    view.unmount();
    vi.stubEnv('VITE_AI_ENABLED', 'true');
    vi.stubEnv('VITE_STT_ENABLED', 'true');
    show(<LandingPage />);
    expect(document.body.textContent).toContain('AI');
  });
});
