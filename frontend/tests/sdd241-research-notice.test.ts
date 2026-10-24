import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRIVACY_ARTICLES, PRIVACY_POLICY_VERSION } from '../src/lib/privacy-policy';
import { RESEARCH_NOTICE_VERSION } from '../src/lib/class/flow/member-prep';

describe('SDD-241 연구 사본 고지', () => {
  it('확장된 항목과 참여자 개인정보 제외를 게시한다', () => {
    const text = PRIVACY_ARTICLES.flatMap(article => article.items).join(' ');
    expect(PRIVACY_POLICY_VERSION).toBe('2.1');
    expect(text).not.toContain('이름은 암호화한 식별값으로만');
    expect(text).toContain('참여자 이름은 이름과 생년월일에서 생성한 HMAC 가명 식별값');
    for (const field of ['진행자 실명', '계정 ID', '역할', '측정 시작·종료', '프로그램', '참여자 이름 원문']) expect(text).toContain(field);
  });
  it('연구 동의 경로에 공통 고지를 노출하고 명시 버전을 전달한다', () => {
    expect(RESEARCH_NOTICE_VERSION).toBe('r5-2');
    for (const path of [
      'components/class/flow/member/NoticeStepView.tsx', 'components/auth/ConsentCheckList.tsx',
      'pages/LoginPage.tsx', 'components/settings/privacy-consents.tsx',
      'pages/client/guest-class-membership-page.tsx', 'components/class/structure/member-operations.tsx',
    ]) expect(readFileSync(resolve(__dirname, '../src', path), 'utf8'), path).toContain('RESEARCH_METADATA_NOTICE');
  });
});
