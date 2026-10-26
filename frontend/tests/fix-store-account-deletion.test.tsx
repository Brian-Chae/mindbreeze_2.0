// @vitest-environment jsdom
// [MB261026][FIX] 공개 계정 삭제·지원 페이지와 명상 클래스 중심 공개 문구 (verify.md V1~V8)
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../src/stores/authStore';
import AccountDeletionPage from '../src/pages/account-deletion-page';
import { SupportPage } from '../src/pages/support-page';
import PrivacyPolicyPage from '../src/pages/PrivacyPolicyPage';
import LandingPage from '../src/pages/LandingPage';
import {
  DELETION_DATA_ROWS,
  DELETION_GRACE_DAYS,
  DELETION_NOTICE_LINES,
  DELETION_SUPPORT_EMAIL,
  IN_APP_DELETION_STEPS,
  OUTSIDE_APP_REQUEST_LINES,
} from '../src/lib/account-deletion-copy';
import { PRIVACY_CONTACT_EMAIL, PRIVACY_POLICY_VERSION, RAW_RETENTION_DAYS } from '../src/lib/privacy-policy';
import { findPublicCopyViolations, SERVICE_SUBTITLE } from '../src/lib/legal-copy';

const routing = vi.hoisted(() => ({
  router: null as ReturnType<typeof import('react-router-dom')['createMemoryRouter']> | null,
  native: false,
}));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, createBrowserRouter: (routes: Parameters<typeof actual.createMemoryRouter>[0]) => {
    routing.router = actual.createMemoryRouter(routes);
    return routing.router;
  } };
});
vi.mock('../src/lib/native/use-status-bar', () => ({ useStatusBar: () => {} }));
vi.mock('../src/lib/native/keyboard', () => ({ initNativeKeyboard: async () => {} }));
vi.mock('../src/lib/native/platform', () => ({ isNativeApp: () => routing.native }));
// 로그인·404 화면은 표식만 남겨, 공개 페이지가 그쪽으로 새지 않았는지 확인한다.
vi.mock('../src/pages/LoginPage', () => ({ default: () => createElement('output', null, 'LOGIN-PAGE') }));
vi.mock('../src/pages/ClientLoginPage', () => ({ default: () => createElement('output', null, 'LOGIN-PAGE') }));
vi.mock('../src/pages/NotFoundPage', () => ({ default: () => createElement('output', null, 'NOT-FOUND') }));

const FORBIDDEN_CLAIMS = [/즉시 삭제/, /바로 삭제/, /\d+\s*(영업)?일\s*(안|이내)에\s*(처리|삭제|완료)/, /\d{3}-\d{2}-\d{5}/, /사업자\s*등록\s*번호/];

let root: Root | undefined;
afterEach(() => {
  if (root) flushSync(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllEnvs();
});
const show = (node: ReactNode) => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root?.render(createElement(MemoryRouter, null, node)));
  return host;
};

describe('V1·V2 공개 라우트는 로그인 없이 열린다(실제 App 라우터)', () => {
  let appRoot: Root | undefined;
  let previous: ReturnType<typeof useAuthStore.getState> | undefined;
  afterEach(async () => {
    if (appRoot) await act(async () => appRoot!.unmount());
    appRoot = undefined;
    if (previous) useAuthStore.setState(previous);
    routing.native = false;
  });
  afterAll(() => routing.router?.dispose());

  async function open(path: string) {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    previous = useAuthStore.getState();
    useAuthStore.setState({ isInitialized: true, isAuthenticated: false, user: null, initialize: async () => {} });
    const { default: App } = await import('../src/App');
    await routing.router!.navigate(path);
    const container = document.createElement('div');
    appRoot = createRoot(container);
    await act(async () => appRoot!.render(createElement(App)));
    await vi.waitFor(() => expect(container.querySelector('h1')).not.toBeNull(), { timeout: 5000 });
    return container;
  }

  for (const native of [false, true]) {
    it(`${native ? '앱' : '웹'}: /account-deletion`, async () => {
      routing.native = native;
      const view = await open('/account-deletion');
      expect(routing.router!.state.location.pathname).toBe('/account-deletion');
      expect(view.querySelector('h1')?.textContent).toBe('MIND BREEZE 계정 삭제 요청');
      expect(view.textContent).not.toMatch(/LOGIN-PAGE|NOT-FOUND/);
      expect(view.querySelector('input[type="email"]')).not.toBeNull();
    });
    it(`${native ? '앱' : '웹'}: /support`, async () => {
      routing.native = native;
      const view = await open('/support');
      expect(routing.router!.state.location.pathname).toBe('/support');
      expect(view.querySelector('h1')?.textContent).toBe('MIND BREEZE 고객 지원');
      expect(view.textContent).not.toMatch(/LOGIN-PAGE|NOT-FOUND/);
    });
  }
});

describe('V3·V4 계정 삭제 페이지 — Google Play 삭제 URL 항목과 방침 정합', () => {
  it('앱·개발자 이름, 앱 안 삭제 단계, 앱 밖 요청, 삭제·보관 데이터를 모두 보여 준다', () => {
    const host = show(<AccountDeletionPage />);
    const text = host.textContent ?? '';
    for (const term of ['MIND BREEZE 2.0', '룩시드랩스', SERVICE_SUBTITLE, '설정', '개인정보 · 약관', '계정 삭제', DELETION_SUPPORT_EMAIL]) {
      expect(text).toContain(term);
    }
    for (const line of [...IN_APP_DELETION_STEPS, ...OUTSIDE_APP_REQUEST_LINES, ...DELETION_NOTICE_LINES]) expect(text).toContain(line);
    for (const row of DELETION_DATA_ROWS) {
      expect(text).toContain(row.label);
      expect(text).toContain(row.detail);
    }
    expect(host.querySelectorAll('ol li')).toHaveLength(IN_APP_DELETION_STEPS.length);
    expect(host.querySelector(`a[href^="mailto:${DELETION_SUPPORT_EMAIL}"]`)).not.toBeNull();
    expect(host.querySelector('a[href="/privacy#account-deletion"]')).not.toBeNull();
    expect(host.querySelector('input[type="email"]')).not.toBeNull();
  });

  it('기간·문의처는 방침 상수와 같다(30일·90일·연구 동의 예외·백업)', () => {
    expect(DELETION_GRACE_DAYS).toBe(30);
    expect(RAW_RETENTION_DAYS).toBe(90);
    expect(DELETION_SUPPORT_EMAIL).toBe(PRIVACY_CONTACT_EMAIL);
    const rows = DELETION_DATA_ROWS.map((r) => `${r.label} ${r.detail}`).join(' ');
    expect(rows).toContain(`${DELETION_GRACE_DAYS}일 후 영구 삭제`);
    expect(rows).toContain(`${RAW_RETENTION_DAYS}일이 지나면 삭제`);
    expect(rows).toContain('연구 활용 동의를 철회로 처리');
    expect(rows).toContain('데이터베이스 14일, 파일 이전 버전 30일');
    expect(rows).toContain('정해진 주기로 실행');
    expect(OUTSIDE_APP_REQUEST_LINES.join(' ')).toContain('접수만으로 계정이 삭제되지는 않아요');
  });
});

describe('V5 공개 문구 금지어·과장 표현', () => {
  it('삭제·지원 페이지에 금지어, 처리 기한 보장, 즉시 삭제, 사업자등록번호가 없다', () => {
    for (const node of [<AccountDeletionPage key="d" />, <SupportPage key="s" />]) {
      const host = show(node);
      const text = host.textContent ?? '';
      expect(findPublicCopyViolations(text)).toEqual([]);
      for (const pattern of FORBIDDEN_CLAIMS) expect(text).not.toMatch(pattern);
      flushSync(() => root?.unmount());
      root = undefined;
    }
  });
});

describe('V6 상담·AI 비공개 랜딩은 명상 클래스 중심', () => {
  it('상담·AI off: 부제를 보여 주고 상담·AI를 출시 기능처럼 안내하지 않는다', () => {
    vi.stubEnv('VITE_COUNSELING_ENABLED', 'false');
    vi.stubEnv('VITE_AI_ENABLED', 'false');
    const host = show(<LandingPage />);
    const text = host.textContent ?? '';
    expect(text).toContain(SERVICE_SUBTITLE);
    expect(text).not.toMatch(/상담|내담자|AI/);
    expect(findPublicCopyViolations(text)).toEqual([]);
    expect(host.querySelector('a[href="/support"]')).not.toBeNull();
    expect(host.querySelector('a[href="/account-deletion"]')).not.toBeNull();
  });

  it('상담 on: 기존 상담 소개 문구를 유지한다(플래그 경로 무변경)', () => {
    vi.stubEnv('VITE_COUNSELING_ENABLED', 'true');
    vi.stubEnv('VITE_AI_ENABLED', 'false');
    const host = show(<LandingPage />);
    const text = host.textContent ?? '';
    for (const term of ['상담과 명상, 사람에게 더 가까이', '상담센터 · 상담사 · 명상가를 위한 통합 플랫폼', '상담센터와 개인 전문가 모두 사용할 수 있나요?', '세션을 준비하고']) {
      expect(text).toContain(term);
    }
  });

  it('지원 페이지 FAQ도 상담·AI off에서는 상담·AI 안내가 없다', () => {
    vi.stubEnv('VITE_COUNSELING_ENABLED', 'false');
    vi.stubEnv('VITE_AI_ENABLED', 'false');
    const host = show(<SupportPage />);
    expect(host.textContent).not.toMatch(/상담|내담자|AI/);
    expect(host.textContent).toContain('계정은 어떻게 삭제하나요?');
  });
});

describe('V7 개인정보 처리방침', () => {
  it('최신 버전 2.2를 유지하고 계정 삭제 안내 링크를 둔다', () => {
    expect(PRIVACY_POLICY_VERSION).toBe('2.3');
    const host = show(<PrivacyPolicyPage />);
    const section = host.querySelector('section#account-deletion');
    expect(section?.querySelector('a[href="/account-deletion"]')).not.toBeNull();
  });
});

describe('V8 index.html 메타', () => {
  it('title·description은 새 부제 기준이고 상담·AI가 없다', () => {
    const html = readFileSync(resolve(__dirname, '../index.html'), 'utf-8');
    const title = html.match(/<title>(.*)<\/title>/)?.[1] ?? '';
    const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';
    expect(title).toContain(SERVICE_SUBTITLE);
    expect(description).toContain(SERVICE_SUBTITLE);
    expect(`${title} ${description}`).not.toMatch(/상담|AI/);
    expect(SERVICE_SUBTITLE).toBe('뇌과학 기반 명상 클래스 서비스');
  });
});
