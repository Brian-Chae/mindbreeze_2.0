// SDD-320 후속 — 코치 채팅·설정 D안: 보존표(항목 누락 없음)·분기 조건·공유 파일 무수정·금지 표현.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (p: string): string => readFileSync(resolve(root, p), 'utf8');
const settings = read('src/pages/coach/ui-v2/ui-v2-coach-settings-page.tsx');
const chat = read('src/pages/coach/ui-v2/ui-v2-coach-chat-page.tsx');
const legacySettings = read('src/components/settings/settings-content.tsx');
const css = read('src/styles/ui-v2-coach-screens.css');
const app = read('src/App.tsx');

describe('코치 설정 보존표', () => {
  // 코치에게 보이는 기존 그룹 제목은 하나도 빠지면 안 된다(내담자 전용 그룹 제외).
  const groups = ['내 계정', '데이터 현황', '알림', '차단한 사용자', '기기 · LINK BAND', '개인정보 · 약관', '앱 정보'];
  it.each(groups)('그룹 "%s" 유지', (title) => {
    expect(legacySettings).toContain(`title="${title}"`);
    expect(settings).toContain(`title="${title}"`);
  });
  it.each(['AccountSettings', 'NotificationGroups', 'WebPushCard', 'PrivacyConsentsSection', 'AccountDeletionSection', 'BlockedUsersList', 'PrivacyPolicyLink'])('기존 컴포넌트 %s 재사용', (name) => {
    expect(settings).toContain(`<${name}`);
  });
  it.each(['/playground', '/upload-status', '/measurement-guide', '/reports?settings=operations'])('링크 %s 유지', (to) => {
    expect(settings).toContain(to);
  });
  it('로그아웃 호출·오류 문구 유지', () => {
    expect(settings).toContain('로그아웃에 실패했어요. 다시 시도해 주세요.');
    expect(settings).toContain('logout()');
  });
});

describe('코치 채팅 보존표', () => {
  it.each(['ChatRoom', 'CreateRoomModal', 'InviteMemberModal', 'RoomSettingsModal', 'RoomActionsMenu', 'ChatSortToggle', 'CounselorAgentPage', 'canInviteToRoom'])('%s 재사용', (name) => {
    expect(chat).toContain(name);
  });
  it('딥링크·루시 비공개 리다이렉트·방 포크 이동 유지', () => {
    expect(chat).toContain("searchParams.get('message')");
    expect(chat).toContain('isAiEnabled()');
    expect(chat).toContain("navigate('/chat', { replace: true })");
    expect(chat).toContain("mode === 'fork'");
  });
  it('전송·읽음·실시간 로직을 새로 만들지 않는다', () => {
    expect(chat).not.toMatch(/sendMessage|markRead|socket\.|io\(/);
  });
});

describe('분기·격리', () => {
  it('App.tsx 분기는 플래그 ∧ counselor 조건', () => {
    expect(app).toMatch(/VITE_UI_V2 === 'true' && role === 'counselor'/);
    // SDD-321 기관 정합: 설정·채팅 분기는 코치 ∨ 기관관리자
    expect(app.match(/\(role === 'counselor' \|\| role === 'org_admin'\)\) return <Suspense/g)?.length).toBe(2);
  });
  it('D안 청크 로드는 플래그 삼항 안에서만', () => {
    expect(app).toMatch(/VITE_UI_V2 === 'true'\s*\n?\s*\? import\('\.\/pages\/coach\/ui-v2\/ui-v2-coach-settings-page'\)/);
    expect(app).toMatch(/VITE_UI_V2 === 'true'\s*\n?\s*\? import\('\.\/pages\/coach\/ui-v2\/ui-v2-coach-chat-page'\)/);
  });
  it('신규 CSS 는 .u2c 래퍼 하위로 한정', () => {
    const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.split('{')[0].trim()).filter((x) => x && !x.startsWith('@'));
    for (const sel of selectors.flatMap((s) => s.split(','))) expect(sel.trim()).toMatch(/^\.ui-v2/);
  });
  it('금지 표현 0', () => {
    for (const src of [settings, chat]) expect(src).not.toMatch(/종합점수|좋음|나쁨|보증|100\s*%|점수/);
  });
  // SDD-323: SidebarNav.tsx 는 기관 '구성원' 메뉴 경로 변경(의도) 때문에 비교 목록에서 제외.
  it('공유·실시간 진행 파일 무수정(HEAD~2 기준 develop 이후 변경 없음)', () => {
    const changed = execSync('git diff --name-only 97a047cf -- .', { cwd: root }).toString();
    for (const f of ['AppShell.tsx', 'ChatRoom.tsx', 'settings-content.tsx', 'ui-v2-brand.css', 'ClassPlayerPage', 'SessionLivePage', 'InstantClassPage']) expect(changed).not.toContain(f);
  });
});
