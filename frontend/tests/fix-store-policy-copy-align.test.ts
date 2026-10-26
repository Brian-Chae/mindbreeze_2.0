// 방침·약관·앱 문구 정합 — AI 제공 여부 단정 금지, 수집 항목·위탁 표·법정 항목 확인
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRIVACY_ARTICLES, PRIVACY_POLICY_VERSION, PROCESSOR_DISCLOSURES } from '../src/lib/privacy-policy';

const src = (rel: string): string => readFileSync(resolve(__dirname, '..', rel), 'utf-8');
const policyText = PRIVACY_ARTICLES.map((a) => `${a.title} ${a.items.join(' ')}`).join(' ');
const BANNED_ASSERTIONS = [/AI\s*미제공/, /AI\s*기능[은이]?\s*(현재\s*)?(제공하지|없)/, /현재\s*AI/, /AI\s*기능\s*없음/, /AI\s*(요약|분석)을?\s*제공하지/];

describe('AI 제공 여부 단정 문구 금지', () => {
  const files = [
    'src/lib/privacy-policy.ts',
    'src/lib/legal-copy.ts',
    'src/pages/terms-page.tsx',
    'src/components/settings/settings-content.tsx',
    'src/components/settings/session-note-prompt-toggle.tsx',
  ];
  it.each(files)('%s 에 단정 문구가 없다', (file) => {
    const text = src(file);
    for (const re of BANNED_ASSERTIONS) expect(text, `${file} ${re}`).not.toMatch(re);
  });
  it('방침은 기능별 외부 AI 전송 서술 대신 위탁 표에 Google을 둔다', () => {
    expect(policyText).not.toMatch(/AI 요약[^.]*Gemini/);
    expect(PROCESSOR_DISCLOSURES.some((p) => p.service.includes('Gemini') && p.recipient.includes('Google'))).toBe(true);
  });
});

describe('방침 2.3 내용', () => {
  it('버전 2.3', () => expect(PRIVACY_POLICY_VERSION).toBe('2.3'));
  it('전화번호·주소·프로필 사진을 선택 수집 항목으로 밝힌다', () => {
    expect(policyText).toMatch(/전화번호, 주소, 프로필 사진/);
    expect(policyText).toContain('입력하지 않아도 서비스를 이용할 수');
  });
  it('녹음·녹화는 필수 동의 후 입장으로 적는다', () => expect(policyText).toContain('필수 동의한 이후에 입장'));
  it('법정 필수 항목 제목이 모두 있다', () => {
    for (const k of ['수집하는 개인정보의 항목', '이용 목적', '보관', '제3자 제공', '처리 위탁 및 국외 이전', '이용자의 권리', '삭제', '개인정보 보호책임자', '방침 변경']) {
      expect(policyText, k).toContain(k);
    }
  });
});
