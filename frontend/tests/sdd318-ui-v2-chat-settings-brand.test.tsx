// @vitest-environment jsdom
// SDD-318 addendum-2 — 채팅·설정 D안 분기, 설정 항목 보존, 로고 링크/라벨, 폰트 스코프.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UiV2Logo } from '../src/components/ui-v2/ui-v2-logo';

const root = resolve(import.meta.dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('분기: 진입점은 빌드 상수로만 D안을 고른다', () => {
  it('ClientAppPage·App 에 채팅/설정/하위 프로필 분기가 있고 기존 컴포넌트는 그대로 남는다', () => {
    const app = read('src/pages/client/ClientAppPage.tsx');
    for (const n of ['ui-v2-chat-page', 'ui-v2-settings-page', 'ui-v2-participation-profile-page']) expect(app).toContain(n);
    expect(app).toContain('<ClientChatPage />');
    expect(app).toContain('<ClientSettingsPage />');
    expect(read('src/App.tsx')).toContain('ui-v2-optional-profile-page');
    expect(read('src/App.tsx')).toContain('<OptionalProfilePage />');
  });
  it('상담사 쉘·사이드바·기존 채팅/설정 파일은 D안 식별자를 갖지 않는다', () => {
    for (const f of ['src/components/layout/SidebarNav.tsx', 'src/components/settings/settings-content.tsx', 'src/pages/client/ClientChatPage.tsx', 'src/components/chat/ChatRoom.tsx', 'src/components/chat/MessageBubble.tsx', 'src/pages/settings/optional-profile-page.tsx', 'src/pages/settings/participation-profile-page.tsx']) {
      expect(read(f), f).not.toMatch(/ui-v2|UiV2|isUiV2Enabled/);
    }
  });
});

describe('설정 항목 보존(현행 settings-content.tsx 의 모든 그룹·링크가 D안에도 있다)', () => {
  const legacy = read('src/components/settings/settings-content.tsx');
  const v2 = read('src/pages/client/ui-v2/ui-v2-settings-page.tsx');
  it('그룹 제목 전부', () => {
    const titles = Array.from(legacy.matchAll(/<Group title=\{?"?([^"}]+?)"?\}? description/g)).map((m) => m[1]);
    expect(titles.length).toBeGreaterThanOrEqual(10);
    for (const t of titles) expect(v2, t).toContain(t.startsWith('COUNSELOR_COPY') ? t : t);
  });
  it('이동 경로·본문 컴포넌트·동작 전부', () => {
    const tos = Array.from(legacy.matchAll(/to=\{?"?([^"}\s]+)"?\}?/g)).map((m) => m[1]).filter((t) => t.startsWith('/') || t === 'uploadStatusTo');
    expect(tos.length).toBeGreaterThanOrEqual(8);
    for (const t of new Set(tos)) expect(v2, t).toContain(t);
    for (const c of ['AccountSettings', 'NotificationGroups', 'WebPushCard', 'BlockedUsersList', 'CounselorManagementPanel', 'PrivacyConsentsSection', 'PrivacyPolicyLink', 'AccountDeletionSection', 'handleLogout', 'data-upload-status-link', '플레이그라운드 열기', '서버연결', '로그아웃']) {
      expect(v2, c).toContain(c);
    }
  });
  it('위험 동작(로그아웃)은 구분 클래스, 금지 표현 없음', () => {
    expect(v2).toContain('u2-danger');
    for (const f of ['ui-v2-settings-page', 'ui-v2-chat-page', 'ui-v2-participation-profile-page', 'ui-v2-optional-profile-page']) {
      expect(read(`src/pages/client/ui-v2/${f}.tsx`).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')).not.toMatch(/점수|종합점수|좋음|나쁨|완료율|보증|100\s*%/);
    }
  });
  it('하위 페이지는 같은 검증·저장 호출과 문구를 쓴다', () => {
    const o = read('src/pages/client/ui-v2/ui-v2-optional-profile-page.tsx');
    for (const s of ['/^010-?\\d{4}-?\\d{4}$/', 'updateUserMe', 'dismissClientProfile', '전화번호를 010-0000-0000 형식으로 입력해 주세요.', '나중에 하기', '이번에는 홈으로']) expect(o, s).toContain(s);
    const p = read('src/pages/client/ui-v2/ui-v2-participation-profile-page.tsx');
    for (const s of ['getClientProfile', 'updateClientProfile', '참여 프로필 저장됨', '참여 프로필을 불러오지 못했어요.']) expect(p, s).toContain(s);
  });
});

describe('채팅: 전송/읽음/실시간 코드는 기존 컴포넌트를 그대로 쓴다', () => {
  const chat = read('src/pages/client/ui-v2/ui-v2-chat-page.tsx');
  it('ChatRoom·RoomActionsMenu·ChatSortToggle·AiAgentPage 재사용 + isAiEnabled 가드', () => {
    for (const s of ['<ChatRoom ', '<RoomActionsMenu', '<ChatSortToggle', '<AiAgentPage', 'isAiEnabled()', 'LUCY_ROOM_ID', 'hideBottomNav', 'RoomSettingsModal']) expect(chat, s).toContain(s);
    expect(chat).not.toMatch(/sendMessage|markRoomRead|socket/i);
  });
});

describe('로고', () => {
  let container: HTMLDivElement; let rootNode: Root;
  beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); rootNode = createRoot(container); });
  afterEach(async () => { await act(async () => rootNode.unmount()); container.remove(); });
  it('홈 링크 + aria-label + 기존 심볼 파일 재사용 + 대문자 워드마크', async () => {
    await act(async () => rootNode.render(<MemoryRouter><UiV2Logo /></MemoryRouter>));
    const a = container.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('aria-label')).toBe('MIND BREEZE 홈');
    expect(a.getAttribute('href')).toBe('/app');
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/mb-design/assets/logo_symbol_dark.svg');
    expect(container.querySelector('.u2-logo-word')?.textContent?.replace(/\u00a0/g, ' ')).toBe('MIND BREEZE');
  });
  it('접힘 상태에서는 data-compact 로 워드마크를 숨긴다', async () => {
    await act(async () => rootNode.render(<MemoryRouter><UiV2Logo compact /></MemoryRouter>));
    expect(container.querySelector('a')?.hasAttribute('data-compact')).toBe(true);
  });
});

describe('폰트·CSS 스코프', () => {
  const css = read('src/styles/ui-v2-brand.css');
  it('자체 호스팅, swap, 외부 URL 없음, 가변 weight, OFL 파일 존재', () => {
    expect(css).toContain("font-family:'Pretendard MB'");
    expect(css).toContain('font-display:swap');
    expect(css).not.toMatch(/https?:\/\//);
    expect(css).toMatch(/font-weight:45 930/);
    expect(read('src/assets/fonts/Pretendard-OFL-1.1.txt')).toContain('SIL Open Font License, Version 1.1');
  });
  it('@font-face 외 모든 선택자는 .ui-v2 또는 [data-shell-variant="ui-v2"] 스코프', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@font-face\{[^}]*\}/g, '').replace(/@media[^{]*\{/g, '');
    const selectors = rules.split('}').map((r) => r.split('{')[0].trim()).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(5);
    for (const group of selectors) for (const sel of group.split(',').map((x) => x.trim())) expect(/^(\.ui-v2|\[data-shell-variant="ui-v2"\])/.test(sel), sel).toBe(true);
  });
  it('채팅·설정 추가 규칙도 .ui-v2 스코프, 직전 수정(코드로 입장 흰 글자) 유지', () => {
    const main = read('src/styles/ui-v2.css');
    expect(main).toContain('.ui-v2 a[data-testid="enter-with-code"]{color:#FFFFFF}');
    expect(read('src/index.css')).not.toContain('Pretendard MB');
    expect(read('src/components/layout/SidebarNav.tsx')).not.toContain('Pretendard MB');
  });
  it('워드마크 대문자 높이 ≈ 심볼 높이(Pretendard 대문자 0.707em × 17px ≈ 12px)', () => {
    const size = Number(/\.u2-logo-word\{[^}]*font-size:(\d+)px/.exec(css)?.[1]);
    const symbol = Number(/\.u2-logo-symbol\{[^}]*height:(\d+)px/.exec(css)?.[1]);
    expect(Math.abs(size * (1448 / 2048) - symbol) / symbol).toBeLessThan(0.15);
    expect(Number(/\.u2-logo\{[^}]*gap:(\d+)px/.exec(css)?.[1])).toBe(symbol / 2);
  });
});
void vi;
