// SDD-318 — 운영 번들(VITE_UI_V2 미설정/기본)에서 D안(UI_V2)이 활성 경로로 쓰이지 않는지 검사한다.
// 사용: node scripts/check-ui-v2-off.mjs <dist 디렉터리>
import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function checkUiV2Off(root) {
  const problems = [];
  const info = { files: 0, cssRules: 0, v2CssFiles: [] };
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = resolve(dir, entry.name);
      const name = relative(root, file).replaceAll('\\', '/');
      if (entry.isDirectory()) { await walk(file); continue; }
      if (!/\.(js|css|html)$/.test(name)) continue;
      const content = await readFile(file, 'utf8');
      info.files += 1;
      if (name.endsWith('.js')) {
        // ① 플래그 true 고정 금지
        if (/VITE_UI_V2:[`"']true[`"']/.test(content)) problems.push(`${name}: VITE_UI_V2=true 가 번들에 있음`);
        // ② D안 컴포넌트 식별자·청크가 JS 에 없어야 한다(분기 제거)
        if (/UiV2[A-Z][A-Za-z]+/.test(content)) problems.push(`${name}: UiV2* 컴포넌트가 번들에 포함됨`);
        if (/ui-v2-(home|classes|class-detail|reports|chat|settings|participation-profile|optional-profile)-page/.test(content)) problems.push(`${name}: D안 화면 청크 참조`);
        // SDD-321: 기관 관리자 D안 화면 청크
        if (/ui-v2-org-(dashboard|counselors|management|search|requests|shell|nav|parts)/.test(content)) problems.push(`${name}: 기관 D안 청크 참조`);
        // SDD-322: 알림 D안 화면 청크
        if (/ui-v2-(notifications-page|org-notifications-page|notification-center-page|notification-parts)|use-ui-v2-notifications/.test(content)) problems.push(`${name}: 알림 D안 청크 참조`);
        // SDD-320 후속: 코치 채팅·설정 D안 청크
        if (/ui-v2-coach-(chat|settings)-page|ui-v2-coach-screens|UiV2Coach[A-Z]/.test(content)) problems.push(`${name}: 코치 D안 화면 청크 참조`);
        // SDD-320 F: 코치 홈·목록 D안 청크, 회원 PC 사이드바
        if (/ui-v2-coach-(home|classes|clients|reports|report-detail)-page|UiV2CoachHomePage|UiV2MemberSidebar/.test(content)) problems.push(`${name}: 코치 홈·목록 D안 청크 참조`);
        // SDD-320: 코치 스코프 식별자
        if (/attachCoachScope|ui-v2-coach-scope|u2-coach|u2-live/.test(content)) problems.push(`${name}: 코치 D안 스코프(u2-coach)가 번들에 포함됨`);
        // SDD-320 G: 코치 알림·플레이그라운드 D안 청크
        if (/ui-v2-coach-notifications-page|ui-v2-coach-playground-page|ui-v2-playground-entry|UiV2CoachNotificationsPage|UiV2CoachPlaygroundPage|UiV2PlaygroundEntry/.test(content)) problems.push(`${name}: 코치 알림·플레이그라운드 D안 청크 참조`);
        // ③ 루트 클래스 부여 코드
        if (/className:`[^`]*ui-v2|className:"[^"]*ui-v2/.test(content)) problems.push(`${name}: ui-v2 루트 클래스 부여 코드`);
      }
      if (name.endsWith('.css') && /\.ui-v2\b|\.u2-/.test(content)) info.v2CssFiles.push(name);
      if (name.endsWith('.css') && /u2-notif-/.test(content)) problems.push(`${name}: 알림 D안 CSS(u2-notif-)가 운영 번들에 포함됨`);
      if (name.endsWith('.css') && /u2c-(new|roombar|list--room|pane--idle|lead)/.test(content)) problems.push(`${name}: 코치 D안 화면 CSS(u2c-)가 운영 번들에 포함됨`);
      if (name.endsWith('.css') && /u2-org-|u2-table/.test(content)) problems.push(`${name}: 기관 D안 CSS(u2-org-/u2-table)가 운영 번들에 포함됨`);
      if (name.endsWith('.css') && /\.u2f-(cols|table|cards|filters|tr)|\.u2-side-(item|menu|foot)/.test(content)) problems.push(`${name}: 코치 목록·회원 사이드바 D안 CSS(u2f-/u2-side-)가 운영 번들에 포함됨`);
      if (name.endsWith('.css') && /\.u2g-(noti|pg|stack|bar|notice)/.test(content)) problems.push(`${name}: 코치 알림·플레이그라운드 D안 CSS(u2g-)가 운영 번들에 포함됨`);
      if (name.endsWith('.css') && /html\.u2-live/.test(content)) problems.push(`${name}: 라이브 D안 스코프 CSS(html.u2-live)가 운영 번들에 포함됨`);
      if (name.endsWith('.css') && /html\.u2-coach/.test(content)) problems.push(`${name}: 코치 D안 스코프 CSS(html.u2-coach)가 운영 번들에 포함됨`);
      if (name.endsWith('.css') && /@media \(min-width:\s*1024px\)[^{]*\{[^}]*data-shell-variant="ui-v2"|data-shell-variant="ui-v2"\]\s*>\s*aside/.test(content)) problems.push(`${name}: PC 셸 D안 CSS(ui-v2-pc)가 운영 번들에 포함됨`);
      // 폰트: 운영 번들에는 Pretendard 자체 호스팅 파일/@font-face 가 없어야 한다(addendum-2 H8).
      if (/\.(css|js)$/.test(name) && /Pretendard\s*MB|PretendardVariable-KS/.test(content)) problems.push(`${name}: 자체 호스팅 Pretendard 참조가 운영 번들에 포함됨`);
    }
  }
  await walk(root);
  const names = (await readdir(resolve(root, 'assets')).catch(() => [])).filter((n) => /ui-v2|PretendardVariable|\.woff2?$/i.test(n));
  if (names.length) problems.push(`assets: ui-v2 청크 파일 ${names.join(', ')}`);
  if (problems.length) { const e = new Error(problems.join('\n')); e.info = info; throw e; }
  return info;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const info = await checkUiV2Off(resolve(process.argv[2] || 'dist'));
    console.log(`UI_V2 off 검사 통과: ${info.files}개 파일 검사, .ui-v2 CSS 포함 파일 ${info.v2CssFiles.length}개 (JS 활성 경로 없음)`);
  } catch (e) { console.error(`UI_V2 off 검사 실패:\n${e.message}`); process.exit(1); }
}
