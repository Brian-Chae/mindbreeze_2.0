// SDD-318 — UI_V2 플래그 on/off, 운영 define 고정, dev 주입, CSS 스코프, 금지 표현, 공유 쉘 무수정.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isUiV2Enabled } from '../src/lib/feature-flags';

const root = resolve(import.meta.dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
afterEach(() => vi.unstubAllEnvs());

describe('isUiV2Enabled', () => {
  it("'true' 일 때만 켜지고 기본은 꺼짐", () => {
    vi.stubEnv('VITE_UI_V2', 'true');
    expect(isUiV2Enabled()).toBe(true);
    for (const v of ['', 'false', '1', 'TRUE']) {
      vi.stubEnv('VITE_UI_V2', v);
      expect(isUiV2Enabled()).toBe(false);
    }
  });
  it('미설정이면 꺼짐', () => {
    vi.stubEnv('VITE_UI_V2', undefined as unknown as string);
    expect(isUiV2Enabled()).toBe(false);
  });
});

describe('운영 고정·dev 주입', () => {
  it("vite 운영 define 이 환경변수와 무관하게 'false' 로 고정한다", () => {
    expect(read('vite.config.ts')).toContain("'import.meta.env.VITE_UI_V2': JSON.stringify('false')");
  });
  it('deploy-dev.yml 만 true 를 주입하고 운영 워크플로는 건드리지 않는다', () => {
    const wf = (n: string) => readFileSync(resolve(root, '../.github/workflows', n), 'utf8');
    expect(wf('deploy-dev.yml')).toContain('VITE_UI_V2=true');
    expect(wf('deploy-prod.yml')).not.toContain('VITE_UI_V2');
    expect(wf('release-build.yml')).not.toContain('VITE_UI_V2=true');
  });
  it('진입점 분기는 빌드 상수(import.meta.env.VITE_UI_V2 === "true")만 쓴다', () => {
    for (const f of ['src/App.tsx', 'src/route-pages.ts', 'src/pages/client/ClientAppPage.tsx']) {
      expect(read(f)).toContain("import.meta.env.VITE_UI_V2 === 'true'");
    }
  });
});

describe('CSS 스코프', () => {
  it('ui-v2.css 의 모든 규칙은 .ui-v2 하위이거나 keyframes 안이다', () => {
    const css = read('src/styles/ui-v2.css').replace(/\/\*[\s\S]*?\*\//g, '');
    // 중괄호 깊이를 세어 규칙 선택자를 모은다. @media 는 내부로 들어가고 @keyframes 는 통째로 건너뛴다.
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
    expect(selectors.length).toBeGreaterThan(20);
    for (const group of selectors) {
      for (const sel of group.split(',').map((x) => x.trim())) {
        expect(sel.startsWith('.ui-v2'), `전역으로 새는 선택자: ${sel}`).toBe(true);
      }
    }
  });
  it('토큰 값이 시안 D 와 같다', () => {
    const css = read('src/styles/ui-v2.css');
    for (const v of ['#F4F4F7', '#FFFFFF', '#EEE5F5', '#25212C', '#68616F', '#5F0080', '#EAE7ED']) expect(css).toContain(v);
    expect(css).toContain('140px + env(safe-area-inset-bottom');
    expect(css).toContain('prefers-reduced-motion');
  });
  it('공유 파일(전역 CSS·프리셋·쉘)은 수정하지 않는다', () => {
    expect(read('src/index.css')).not.toContain('ui-v2');
    expect(read('tailwind.config.cjs')).not.toContain('ui-v2');
    for (const f of ['src/components/layout/AppShell.tsx', 'src/components/client/ClientShell.tsx', 'src/components/layout/floating-bottom-nav.tsx']) {
      expect(read(f)).not.toMatch(/ui-v2|UiV2|isUiV2Enabled/);
    }
  });
});

describe('금지 표현', () => {
  const files = [
    ...readdirSync(resolve(root, 'src/pages/client/ui-v2')).map((f) => `src/pages/client/ui-v2/${f}`),
    ...readdirSync(resolve(root, 'src/components/ui-v2')).map((f) => `src/components/ui-v2/${f}`),
  ].filter((f) => f.endsWith('.tsx'));
  it('화면 문구에 점수·좋음·나쁨·완료율·보증·100% 가 없다', () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const f of files) {
      const text = read(f).split('\n').filter((l) => !l.trim().startsWith('//') && !l.includes('width:')).join('\n');
      expect(text, f).not.toMatch(/점수|종합점수|좋음|나쁨|완료율|보증|100\s*%/);
    }
  });
});
