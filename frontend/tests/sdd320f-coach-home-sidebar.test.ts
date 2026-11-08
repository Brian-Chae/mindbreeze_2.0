// SDD-320 F-0 — 회원 홈 2열·좌측 메뉴 정합·코치 홈 재구성(소스 대조)
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildMemberNavItems } from '../src/components/ui-v2/ui-v2-member-sidebar';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const FORBIDDEN = /점수|종합점수|좋음|나쁨|보증|100%/;
const badges = { notificationBadge: 0, chatBadge: 0, reportBadge: 0, sessionBadge: 0 };

describe('회원 PC 사이드바', () => {
  it('라벨은 시안과 같이 대화, 항목 링크는 기존 회원 메뉴와 같다', () => {
    const items = buildMemberNavItems(badges, true);
    expect(items.map((i) => i.label)).toEqual(['홈', '내 클래스', '내 상담', '대화', '리포트', '알림', '설정']);
    expect(items.map((i) => i.to)).toEqual(['/app', '/app/classes', '/app/counseling', '/app/chat', '/app/reports', '/app/notifications', '/app/profile']);
  });
  it('상담 비공개면 내 상담 항목을 숨긴다', () => expect(buildMemberNavItems(badges, false).some((i) => i.to === '/app/counseling')).toBe(false));
  it('알림 배지는 알림·초대 중 큰 값', () => expect(buildMemberNavItems({ ...badges, notificationBadge: 2, sessionBadge: 5 }, true).find((i) => i.to === '/app/notifications')?.badge).toBe(5));
  it('회원 쉘만 새 사이드바를 쓰고 레거시 SidebarNav 는 수정하지 않았다', () => {
    expect(read('src/components/ui-v2/ui-v2-client-shell.tsx')).toContain('UiV2MemberSidebar');
    expect(read('src/components/layout/SidebarNav.tsx')).not.toContain('UiV2');
  });
  it('서버 연결 표시·로그아웃 유지, \"회원 전용\" 문구 없음', () => {
    const src = read('src/components/ui-v2/ui-v2-member-sidebar.tsx');
    expect(src).toContain('서버연결');
    expect(src).toContain('로그아웃');
    expect(src).not.toContain('회원 전용');
  });
});

describe('좌측 메뉴 CSS', () => {
  const css = read('src/styles/ui-v2-pc.css');
  it('활성 항목 밑줄(::after)과 코치 전용 문구 숨김', () => {
    expect(css).toContain('a[aria-current="page"]::after');
    expect(css).toMatch(/html\.u2-coach \[data-shell-variant\] > aside \[data-sidebar-brand\] > div:last-child \{ display: none; \}/);
  });
  it('금지 표현 없음', () => expect(css).not.toMatch(FORBIDDEN));
});

describe('회원 홈 2열', () => {
  const src = read('src/pages/client/ui-v2/ui-v2-home-page.tsx');
  it('담당 코치는 좌열(일정 뒤)에 있다', () => {
    const left = src.indexOf('u2-pc-main');
    const side = src.indexOf('u2-pc-side');
    const coach = src.indexOf('<CounselorSection />');
    expect(left).toBeGreaterThan(-1);
    expect(coach).toBeGreaterThan(left);
    expect(coach).toBeLessThan(side);
  });
});

describe('코치 홈(ui-v2)', () => {
  const home = read('src/pages/coach/ui-v2/ui-v2-coach-home-page.tsx');
  const app = read('src/App.tsx');
  it('시안 제목과 기존 진입점 유지', () => {
    expect(home).toContain('오늘의 흐름을 준비해요');
    for (const keep of ['/classes/now', '/classes/new', '/upload-status', '/clients', '/chat/lucy', 'counselorCode']) expect(home).toContain(keep);
  });
  it('플래그 ∧ counselor 일 때만 분기, 청크는 플래그 삼항 안', () => {
    expect(app).toMatch(/useV2 = import\.meta\.env\.VITE_UI_V2 === 'true' && role === 'counselor'/);
    expect(app).toMatch(/VITE_UI_V2 === 'true'\s*\n?\s*\? import\('\.\/pages\/coach\/ui-v2\/ui-v2-coach-home-page'\)/);
  });
  it('레거시 DashboardPage 는 수정하지 않았다', () => expect(read('src/pages/DashboardPage.tsx')).not.toContain('u2f'));
  it('금지 표현 없음', () => {
    expect(home).not.toMatch(FORBIDDEN);
    expect(read('src/styles/ui-v2-coach-pc.css')).not.toMatch(FORBIDDEN);
  });
});
