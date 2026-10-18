// 용어 사전 — 내비게이션 항목 라벨의 단일 출처.
// 키는 화면 위치별 항목 정체성이다(같은 의미라도 글자가 다르면 키를 나눈다: dashboard / home / org-dashboard).
// Phase 0 은 구조만 만들고 두 영역의 값을 현행 글자와 동일하게 둔다. 값 분화는 Phase 2 에서 한다.

export type TermArea = 'meditation' | 'counseling';

export const TERM_KEYS = [
  'dashboard',
  'home',
  'org-dashboard',
  'class',
  'client',
  'chat',
  'report',
  'playground',
  'notification',
  'setting',
  'org-counselors',
  'admin-orgs',
  'admin-applications',
  'admin-users',
  'admin-clients',
  'more',
  'meditation-class',
  'counseling',
  'my-class',
  'my-counseling',
  'members',
  'instructor',
] as const;

export type TermKey = (typeof TERM_KEYS)[number];

/** 두 영역 값이 같은 항목을 한 줄로 적기 위한 헬퍼(Phase 2 에서 영역별로 풀어 쓴다). */
const same = (value: string): Record<TermArea, string> => ({ meditation: value, counseling: value });

const TERMS: Readonly<Record<TermKey, Readonly<Record<TermArea, string>>>> = {
  dashboard: same('대시보드'),
  home: same('홈'),
  'org-dashboard': same('기관 대시보드'),
  class: same('클래스'),
  client: same('내담자'),
  chat: same('채팅'),
  report: same('리포트'),
  playground: same('플레이그라운드'),
  notification: same('알림'),
  setting: same('설정'),
  'org-counselors': same('상담사'),
  'admin-orgs': same('기관 관리'),
  'admin-applications': same('가입 신청'),
  'admin-users': same('상담사 관리'),
  'admin-clients': same('회원 관리'),
  more: same('더보기'),
  'meditation-class': same('명상 클래스'),
  counseling: same('상담'),
  'my-class': same('내 클래스'),
  'my-counseling': same('내 상담'),
  members: same('구성원'),
  instructor: { meditation: '지도사', counseling: '상담사' },
};

export function term(key: TermKey, area: TermArea = 'meditation'): string {
  if (!(TERM_KEYS as readonly string[]).includes(key)) {
    throw new Error(`알 수 없는 용어 키: ${String(key)}`);
  }
  return TERMS[key][area];
}
