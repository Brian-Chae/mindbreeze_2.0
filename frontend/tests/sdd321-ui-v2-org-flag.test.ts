// SDD-321 — 기관 D안: 분기 정확성, CSS 스코프, 금지 표현, 공유 파일 무수정, 운영 번들 검사 스크립트.
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — 순수 JS 검사 모듈(타입 선언 없음)
import { checkUiV2Off } from '../scripts/check-ui-v2-off.mjs';

const root = resolve(import.meta.dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const ORG_ROUTES: Array<[string, string, string]> = [
  ['OrgSearchPage', './pages/org/ui-v2/ui-v2-org-search-page', './pages/org/OrgSearchPage'],
  ['OrgManagementPage', './pages/org/ui-v2/ui-v2-org-management-page', './pages/org/OrgManagementPage'],
  ['OrgCounselorsPage', './pages/org/ui-v2/ui-v2-org-counselors-page', './pages/org/OrgCounselorsPage'],
  ['MyRequestsPage', './pages/org/ui-v2/ui-v2-org-requests-page', './pages/org/MyRequestsPage'],
  ['OrgDashboardPage', './pages/org/ui-v2/ui-v2-org-dashboard-page', './pages/OrgDashboardPage'],
];

describe('D1 App.tsx 분기', () => {
  const app = read('src/App.tsx');
  for (const [name, v2, legacy] of ORG_ROUTES) {
    it(`${name}: 빌드 상수 삼항, off 쪽은 기존 import 와 같은 경로`, () => {
      const re = new RegExp(`const ${name} = lazy\\(\\(\\) => import\\.meta\\.env\\.VITE_UI_V2 === 'true'\\s*\\?\\s*import\\('${v2}'\\)\\.then\\(\\(module\\) => \\(\\{ default: module\\.UiV2Org\\w+ \\}\\)\\)\\s*:\\s*import\\('${legacy}'\\)\\);`);
      expect(app).toMatch(re);
    });
  }
  it('D2 라우트·가드가 그대로다', () => {
    expect(app).toContain('<Route path="/dashboard/org" element={<RoleGuard role="org_admin"><OrgDashboardPage /></RoleGuard>} />');
    expect(app).toContain('<Route path="/org/counselors" element={<RoleGuard role="org_admin"><OrgCounselorsPage /></RoleGuard>} />');
    expect(app).toContain('<Route path="/org/requests" element={<RoleGuard><MyRequestsPage /></RoleGuard>} />');
    expect(app).toContain('<Route path="/org/:org_id" element={<OrgManagementPage />} />');
  });
});

describe('CSS 스코프 (E3)', () => {
  it('ui-v2-org.css 의 모든 선택자는 .ui-v2 로 시작한다', () => {
    const css = read('src/styles/ui-v2-org.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors: string[] = [];
    const walk = (text: string) => {
      let i = 0;
      while (i < text.length) {
        const open = text.indexOf('{', i);
        if (open < 0) break;
        const head = text.slice(i, open).trim();
        let depth = 1; let j = open + 1;
        while (j < text.length && depth > 0) { if (text[j] === '{') depth += 1; else if (text[j] === '}') depth -= 1; j += 1; }
        const body = text.slice(open + 1, j - 1);
        if (head.startsWith('@media')) walk(body);
        else if (!head.startsWith('@keyframes')) selectors.push(head);
        i = j;
      }
    };
    walk(css);
    expect(selectors.length).toBeGreaterThan(40);
    for (const group of selectors) for (const sel of group.split(',').map((x) => x.trim())) {
      expect(sel.startsWith('.ui-v2'), `전역으로 새는 선택자: ${sel}`).toBe(true);
    }
  });
  it('모션 축소를 존중하고 터치 44px 를 보장한다', () => {
    const css = read('src/styles/ui-v2-org.css');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('min-height:44px');
  });
});

describe('공유 파일 무수정 (A5/A6)', () => {
  it('공유 쉘·전역 CSS·공용 D안 CSS 에 기관 D안 흔적이 없다', () => {
    for (const f of ['src/components/layout/AppShell.tsx', 'src/components/layout/SidebarNav.tsx', 'src/components/layout/MobileDrawer.tsx', 'src/components/layout/BottomTabBar.tsx', 'src/components/layout/floating-bottom-nav.tsx', 'src/index.css', 'tailwind.config.cjs']) {
      expect(read(f), f).not.toMatch(/ui-v2|UiV2|isUiV2Enabled|u2-org/);
    }
    expect(read('src/styles/ui-v2.css')).not.toContain('u2-org');
    expect(read('src/styles/ui-v2-brand.css')).not.toContain('u2-org');
  });
  it('기존 기관 화면 파일이 D안을 참조하지 않는다', () => {
    for (const f of ['src/pages/OrgDashboardPage.tsx', 'src/pages/org/OrgCounselorsPage.tsx', 'src/pages/org/OrgManagementPage.tsx', 'src/pages/org/OrgSearchPage.tsx', 'src/pages/org/MyRequestsPage.tsx']) {
      expect(read(f), f).not.toMatch(/ui-v2|UiV2/);
    }
  });
  it('재사용 컴포넌트(초대·정보 수정·퇴직 안내)는 그대로 쓴다', () => {
    const counselors = read('src/pages/org/ui-v2/ui-v2-org-counselors-page.tsx');
    expect(counselors).toContain("from '../../../components/counselor/counselor-info-editor'");
    expect(counselors).toContain('patchOrgCounselorProfile(orgId, editing.id, payload)');
    expect(counselors).toContain("from '../../../components/org/counselor-invite-section'");
    expect(read('src/pages/org/ui-v2/ui-v2-org-dashboard-page.tsx')).toContain("components/org/OrgRemovedNoticeDialog");
    expect(read('src/pages/org/ui-v2/ui-v2-org-management-page.tsx')).toContain("components/counselor/counselor-info-editor");
  });
});

describe('금지 표현 (B5)', () => {
  const dirs = ['src/pages/org/ui-v2'];
  const files = [
    ...dirs.flatMap((d) => readdirSync(resolve(root, d)).map((f) => `${d}/${f}`)),
    'src/components/ui-v2/ui-v2-org-shell.tsx',
    'src/components/ui-v2/ui-v2-org-nav.tsx',
  ].filter((f) => /\.tsx?$/.test(f));
  it('화면 문구에 점수·좋음·나쁨·완료율·보증·100% 가 없다', () => {
    expect(files.length).toBeGreaterThanOrEqual(9);
    for (const f of files) {
      const text = read(f).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(text, f).not.toMatch(/점수|종합점수|좋음|나쁨|완료율|보증|100\s*%/);
    }
  });
});

describe('check-ui-v2-off 확장 (A3/A4)', () => {
  const mk = (files: Record<string, string>) => {
    const dir = mkdtempSync(resolve(tmpdir(), 'sdd321-'));
    mkdirSync(resolve(dir, 'assets'), { recursive: true });
    for (const [n, c] of Object.entries(files)) writeFileSync(resolve(dir, n), c);
    return dir;
  };
  it('깨끗한 번들은 통과한다', async () => {
    const dir = mk({ 'assets/index.js': 'console.log(1)', 'assets/index.css': '.a{color:red}' });
    try { await expect(checkUiV2Off(dir)).resolves.toBeTruthy(); } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('UiV2Org 식별자·기관 D안 청크명·기관 D안 CSS 가 있으면 실패한다', async () => {
    for (const bad of [
      { 'assets/a.js': 'const x = UiV2OrgShell;' },
      { 'assets/a.js': 'import("./ui-v2-org-dashboard-page-abc.js")' },
      { 'assets/a.css': '.ui-v2 .u2-org-stat{color:red}' },
    ]) {
      const dir = mk(bad);
      try { await expect(checkUiV2Off(dir)).rejects.toThrow(); } finally { rmSync(dir, { recursive: true, force: true }); }
    }
  });
});
