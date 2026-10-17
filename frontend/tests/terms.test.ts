// SDD-211 T1 — 용어 사전 골든 일치 (Phase 0 은 글자 불변: 모든 키·영역 값 == 현행 리터럴)
import { describe, expect, it } from 'vitest';
import { TERM_KEYS, term, type TermArea, type TermKey } from '../src/lib/terms';

/** 현행 내비 리터럴의 복사본. 사전 값이 바뀌면 이 표도 의도적으로 같이 갱신해야 한다. */
const GOLDEN: Record<TermKey, string> = {
  dashboard: '대시보드',
  home: '홈',
  'org-dashboard': '기관 대시보드',
  class: '클래스',
  client: '내담자',
  chat: '채팅',
  report: '리포트',
  playground: '플레이그라운드',
  notification: '알림',
  setting: '설정',
  'org-counselors': '상담사',
  'admin-orgs': '기관 관리',
  'admin-applications': '가입 신청',
  'admin-users': '상담사 관리',
  'admin-clients': '회원 관리',
  more: '더보기',
};
const AREAS: TermArea[] = ['meditation', 'counseling'];

describe('FE-TERM 용어 사전', () => {
  it('FE-TERM-01 모든 키·영역 값이 현행 리터럴과 같다', () => {
    for (const key of Object.keys(GOLDEN) as TermKey[]) {
      for (const area of AREAS) expect(term(key, area), `${key}/${area}`).toBe(GOLDEN[key]);
    }
  });
  it('FE-TERM-01b 영역 기본값은 meditation 이다', () => {
    for (const key of Object.keys(GOLDEN) as TermKey[]) expect(term(key)).toBe(GOLDEN[key]);
  });
  it('FE-TERM-02 키 개수는 16개로 고정되고 골든과 일치한다', () => {
    expect(TERM_KEYS).toHaveLength(16);
    expect([...TERM_KEYS].sort()).toEqual(Object.keys(GOLDEN).sort());
  });
  it('FE-TERM-03 미지 키는 조용히 대체하지 않고 던진다', () => {
    expect(() => term('없는-키' as TermKey)).toThrow();
    expect(() => term('constructor' as TermKey)).toThrow();
  });
});
