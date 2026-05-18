/**
 * MIND BREEZE — Style Dictionary 빌드 (Node 직접 실행).
 *
 * 입력: design-system/tokens/**\/*.json (W3C $value/$type 포맷)
 * 출력: design-system/build/outputs/
 *   - css/tokens.base.css   → 브랜드 원시 + 시스템 스케일 + UI 컴포넌트 (var() 참조)
 *   - css/tokens.light.css  → :root { 시맨틱 별칭 = 라이트 매핑 }
 *   - css/tokens.dark.css   → [data-theme="dark"] { 시맨틱 별칭 = 다크 매핑 }
 *   - css/tokens.css        → 위 셋의 진입 글루
 *   - tailwind/preset.cjs   → Tailwind preset (CSS 변수 참조)
 *   - ts/tokens.ts          → TS 상수 (자동완성용)
 *
 * 핵심 아키텍처:
 *   base 빌드는 light 토큰을 reference resolution 목적으로만 포함하고 출력에서 필터링.
 *   outputReferences:true 로 UI 토큰은 var() 형태로 출력 → 테마 전환은 CSS 캐스케이드가 처리.
 */

import StyleDictionary from 'style-dictionary';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tokensDir = resolve(__dirname, '../tokens');
const outDir = resolve(__dirname, 'outputs');

const SEMANTIC_ROOTS = ['surface', 'ink', 'brand', 'accent', 'status', 'border', 'overlay'];

const baseSources = [
  `${tokensDir}/brand/**/*.json`,
  `${tokensDir}/system/light.json`, // ← reference resolution 전용. 출력에서는 필터.
  `${tokensDir}/system/spacing.json`,
  `${tokensDir}/system/radius.json`,
  `${tokensDir}/system/shadow.json`,
  `${tokensDir}/system/typography.json`,
  `${tokensDir}/system/motion.json`,
  `${tokensDir}/ui/**/*.json`,
];

/** ────────── transformGroup ────────── */
StyleDictionary.registerTransformGroup({
  name: 'mb/css',
  transforms: ['attribute/cti', 'name/kebab', 'time/seconds', 'html/icon', 'size/rem', 'color/css'],
});

StyleDictionary.registerTransformGroup({
  name: 'mb/js',
  transforms: ['attribute/cti', 'name/camel', 'size/rem', 'color/hex'],
});

/** ────────── Tailwind preset 포맷 ────────── */
StyleDictionary.registerFormat({
  name: 'tailwind/preset',
  format: ({ dictionary }) => {
    const buckets = {
      colors: {},
      spacing: {},
      borderRadius: {},
      boxShadow: {},
      fontFamily: {},
      fontSize: {},
      fontWeight: {},
      lineHeight: {},
      letterSpacing: {},
    };

    dictionary.allTokens.forEach((token) => {
      const cssVar = `var(--${token.name})`;
      const path = token.path;
      const root = path[0];
      const type = token.$type || token.type;

      if (type === 'color') {
        if (root === 'color') {
          const [, family, shade] = path;
          buckets.colors[family] ??= {};
          buckets.colors[family][shade ?? 'DEFAULT'] = cssVar;
        } else if (SEMANTIC_ROOTS.includes(root)) {
          buckets.colors[path.join('-')] = cssVar;
        }
        return;
      }
      if (root === 'spacing') buckets.spacing[path.slice(1).join('-')] = cssVar;
      if (root === 'radius') buckets.borderRadius[path.slice(1).join('-')] = cssVar;
      if (root === 'shadow') buckets.boxShadow[path.slice(1).join('-')] = cssVar;
      if (root === 'font' && path[1] === 'family') buckets.fontFamily[path[2]] = cssVar;
      if (root === 'font' && path[1] === 'weight') buckets.fontWeight[path[2]] = cssVar;
      if (root === 'fontSize') buckets.fontSize[path.slice(1).join('-')] = cssVar;
      if (root === 'lineHeight') buckets.lineHeight[path.slice(1).join('-')] = cssVar;
      if (root === 'letterSpacing') buckets.letterSpacing[path.slice(1).join('-')] = cssVar;
    });

    return `/**\n * AUTO-GENERATED — do not edit.\n * Source: design-system/tokens/**\\/*.json\n */\nmodule.exports = {\n  theme: { extend: ${JSON.stringify(buckets, null, 2)} }\n};\n`;
  },
});

/** ────────── TS 토큰 포맷 ────────── */
StyleDictionary.registerFormat({
  name: 'ts/tokens',
  format: ({ dictionary }) => {
    const toKebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    const entries = dictionary.allTokens
      .map((t) => {
        const kebabName = t.path.map(toKebab).join('-');
        return `  '${t.name}': 'var(--${kebabName})',`;
      })
      .join('\n');
    return `/**\n * AUTO-GENERATED — do not edit.\n */\nexport const tokens = {\n${entries}\n} as const;\n\nexport type TokenName = keyof typeof tokens;\n`;
  },
});

// 테마는 빌트인 css/variables 포맷을 사용 (selector 옵션 지원).

/** ────────── 베이스 빌드 (테마 무관) ────────── */
const baseConfig = {
  source: baseSources,
  log: { verbosity: 'verbose', warnings: 'disabled' },
  platforms: {
    css: {
      transformGroup: 'mb/css',
      buildPath: `${outDir}/css/`,
      files: [
        {
          destination: 'tokens.base.css',
          format: 'css/variables',
          options: { outputReferences: true, selector: ':root' },
          // 시맨틱 컬러는 light/dark 빌드에서 출력 — base에서는 제외
          filter: (token) => {
            const type = token.$type || token.type;
            if (type === 'color' && SEMANTIC_ROOTS.includes(token.path[0])) return false;
            return true;
          },
        },
      ],
    },
    tailwind: {
      transformGroup: 'mb/css',
      buildPath: `${outDir}/tailwind/`,
      files: [{ destination: 'preset.cjs', format: 'tailwind/preset' }],
    },
    ts: {
      transformGroup: 'mb/js',
      buildPath: `${outDir}/ts/`,
      files: [{ destination: 'tokens.ts', format: 'ts/tokens' }],
    },
  },
};

/** ────────── 테마 빌드 팩토리 ────────── */
const themeConfig = (themeName, selector) => ({
  source: [
    `${tokensDir}/brand/**/*.json`,
    `${tokensDir}/system/${themeName}.json`,
  ],
  log: { verbosity: 'silent', warnings: 'disabled' },
  platforms: {
    css: {
      transformGroup: 'mb/css',
      buildPath: `${outDir}/css/`,
      files: [
        {
          destination: `tokens.${themeName}.css`,
          format: 'css/variables',
          options: { selector, outputReferences: false },
          filter: (token) => {
            const type = token.$type || token.type;
            return type === 'color' && SEMANTIC_ROOTS.includes(token.path[0]);
          },
        },
      ],
    },
  },
});

/** ────────── 빌드 실행 ────────── */
const sdBase = new StyleDictionary(baseConfig);
await sdBase.buildAllPlatforms();

const sdLight = new StyleDictionary(themeConfig('light', ':root'));
await sdLight.buildAllPlatforms();

const sdDark = new StyleDictionary(themeConfig('dark', '[data-theme="dark"]'));
await sdDark.buildAllPlatforms();

console.log('\n✓ MIND BREEZE 디자인 토큰 빌드 완료\n  → design-system/build/outputs/\n');
