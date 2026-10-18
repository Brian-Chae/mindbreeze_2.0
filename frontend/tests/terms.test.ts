// SDD-215 — 기존 키의 반환값을 보존하고 가산 키·영역별 호칭을 정확히 검증한다.
import { describe, expect, it } from 'vitest';
import { TERM_KEYS, term, type TermArea, type TermKey } from '../src/lib/terms';

/** 현행 내비 리터럴의 복사본. 사전 값이 바뀌면 이 표도 의도적으로 같이 갱신해야 한다. */
const GOLDEN = {
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
} as const satisfies Partial<Record<TermKey, string>>;

const ADDED_GOLDEN = {
  'meditation-class': { meditation: '명상 클래스', counseling: '명상 클래스' },
  counseling: { meditation: '상담', counseling: '상담' },
  'my-class': { meditation: '내 클래스', counseling: '내 클래스' },
  'my-counseling': { meditation: '내 상담', counseling: '내 상담' },
  members: { meditation: '구성원', counseling: '구성원' },
  instructor: { meditation: '지도사', counseling: '상담사' },
} as const satisfies Record<Exclude<TermKey, keyof typeof GOLDEN>, Record<TermArea, string>>;
const AREAS: TermArea[] = ['meditation', 'counseling'];

describe('FE-TERM 용어 사전', () => {
  it('FE-TERM-01 모든 키·영역 값이 현행 리터럴과 같다', () => {
    for (const key of Object.keys(GOLDEN) as (keyof typeof GOLDEN)[]) {
      for (const area of AREAS) expect(term(key, area), `${key}/${area}`).toBe(GOLDEN[key]);
    }
  });
  it('FE-TERM-01b 영역 기본값은 meditation 이다', () => {
    for (const key of Object.keys(GOLDEN) as (keyof typeof GOLDEN)[]) expect(term(key)).toBe(GOLDEN[key]);
  });
  it('FE-TERM-02 기존 16개와 가산 6개 키가 중복 없이 골든과 일치한다', () => {
    expect(TERM_KEYS).toHaveLength(22);
    expect(new Set(TERM_KEYS).size).toBe(22);
    expect([...TERM_KEYS].sort()).toEqual([...Object.keys(GOLDEN), ...Object.keys(ADDED_GOLDEN)].sort());
  });
  it('FE-TERM-02b 가산 키의 두 영역 값과 기본값을 고정한다', () => {
    for (const key of Object.keys(ADDED_GOLDEN) as (keyof typeof ADDED_GOLDEN)[]) {
      for (const area of AREAS) expect(term(key, area), `${key}/${area}`).toBe(ADDED_GOLDEN[key][area]);
      expect(term(key)).toBe(ADDED_GOLDEN[key].meditation);
    }
  });
  it('FE-TERM-03 미지 키는 조용히 대체하지 않고 던진다', () => {
    expect(() => term('없는-키' as TermKey)).toThrow();
    expect(() => term('constructor' as TermKey)).toThrow();
  });
});
