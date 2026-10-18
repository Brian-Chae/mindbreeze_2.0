// @vitest-environment jsdom
// SDD-210 N-6 — 개인정보 처리방침 페이지: 라우트 렌더 · 필수 항목 · 금지어 · 화면 문구 정합
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PrivacyPolicyPage from '../src/pages/PrivacyPolicyPage';
import { PrivacyPolicyLink } from '../src/components/legal/PrivacyPolicyLink';
import { PRIVACY_ARTICLES, RAW_RETENTION_DAYS } from '../src/lib/privacy-policy';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderPage(): string {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={['/privacy']}>
        <Routes>
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return container.textContent ?? '';
}

const src = (rel: string): string => readFileSync(resolve(__dirname, '..', rel), 'utf-8');

describe('/privacy 페이지', () => {
  it('시행일·버전을 표기한다', () => {
    const text = renderPage();
    expect(text).toContain('2026년 10월 22일');
    expect(text).toContain('버전 1.0');
    expect(container.querySelector('h1')?.textContent).toBe('개인정보 처리방침');
  });

  it('금지 문구(초안·법률 검토·자리표시자)를 노출하지 않는다', () => {
    const text = renderPage();
    for (const banned of ['초안', '법률 검토', '검토 필요', 'TODO', '{', '}', '미정', '임시']) {
      expect(text, banned).not.toContain(banned);
    }
  });

  it('공식 문서체로 서술한다(해요체 어미 없음)', () => {
    const text = renderPage();
    expect(text).not.toMatch(/(해요|돼요|예요|이에요|세요)[.\s]/);
  });

  it('N-6 필수 항목 1~7을 본문에 포함한다', () => {
    const text = renderPage();
    // 1 기록 원본 N일 후 삭제(세션 종료일 기준, 정기 삭제)
    expect(text).toContain(`클래스 종료일부터 ${RAW_RETENTION_DAYS}일이 지나면 삭제`);
    expect(text).toContain('정해진 주기로 실행');
    // 2 연구 목적 활용 동의(선택, 미동의 참여 가능, 철회 한계)
    expect(text).toContain('연구 목적 활용 동의');
    expect(text).toContain('동의하지 않아도 서비스를 이용하고 클래스에 참여할 수 있습니다');
    expect(text).toContain('되돌릴 수 없습니다');
    // 3 무기한 보관 범위와 비보관 항목
    expect(text).toContain('보관 기한을 두지 않고 계속 보관');
    expect(text).toContain('생년·월');
    expect(text).toContain('이메일, 전화번호, 이름 원문');
    // 4 재식별 위험
    expect(text).toContain('본인을 알아볼 가능성이 완전히 없다고는 할 수 없습니다');
    // 5 비회원 개인정보(이름·성별·생년월일·이메일, 리포트 발송)
    expect(text).toContain('이름, 성별, 생년월일, 이메일');
    expect(text).toContain('리포트 이메일 발송');
    // 6 4자리 입장 코드
    expect(text).toContain('4자리 숫자 입장 코드');
    // 7 시행일·개정 이력
    expect(text).toContain('개정 이력');
    // 원본 삭제는 플랫폼 관리자만, 리포트 반영 거부해도 참여 가능
    expect(text).toContain('플랫폼 관리자만');
    expect(text).toContain('반영하지 않기로 선택하여도 클래스에 그대로 참여');
  });

  it('조항 id 가 중복되지 않고 목차가 조항 수와 같다', () => {
    renderPage();
    const ids = PRIVACY_ARTICLES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(container.querySelectorAll('nav[aria-label="목차"] a')).toHaveLength(ids.length);
  });
});

describe('방침 링크·화면 문구 정합', () => {
  it('PrivacyPolicyLink 는 /privacy 새 탭 링크다', () => {
    act(() => root.render(<PrivacyPolicyLink />));
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('/privacy');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toContain('noopener');
  });

  it('진입점 화면(로그인·가입·입장 동의·설정)이 방침 링크를 사용한다', () => {
    for (const rel of [
      'src/pages/LoginPage.tsx',
      'src/components/auth/ConsentCheckList.tsx',
      'src/components/class/flow/member/NoticeStepView.tsx',
      'src/pages/SettingsPage.tsx',
      'src/pages/settings/ClientSettingsPage.tsx',
    ]) {
      expect(src(rel), rel).toContain('PrivacyPolicyLink');
    }
  });

  it('App 라우트에 공개 /privacy 가 있고 RoleGuard 로 감싸지 않는다', () => {
    expect(src('src/App.tsx')).toMatch(/<Route path="\/privacy" element=\{<PrivacyPolicyPage \/>\} \/>/);
  });

  it('녹음 동의 모달·입장 고지의 보관 기간이 방침 값과 일치한다', () => {
    const modal = src('src/components/session/ConsentModal.tsx');
    expect(modal).not.toContain('30일');
    expect(modal).toContain('RAW_RETENTION_DAYS');
    const notice = src('src/components/class/flow/member/NoticeStepView.tsx');
    expect(notice).toContain('생년·월');
    expect(notice).not.toContain('성별·생년월일이');
    for (const rel of ['src/pages/class/EntryPage.tsx', 'src/pages/sessions/ClassPlayerPage.tsx']) {
      expect(src(rel), rel).toContain('RAW_RETENTION_DAYS');
      expect(src(rel), rel).not.toContain('VITE_RETENTION_RAW_DAYS');
    }
  });
});
