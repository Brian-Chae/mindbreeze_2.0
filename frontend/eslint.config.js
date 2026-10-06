// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([globalIgnores(['dist']), {
  files: ['**/*.{ts,tsx}'],
  extends: [
    js.configs.recommended,
    tseslint.configs.recommended,
    reactHooks.configs.flat.recommended,
    reactRefresh.configs.vite,
  ],
  languageOptions: {
    globals: globals.browser,
  },
  rules: {
    // React Compiler 미사용 — 컴파일러 전용 규칙은 소음이라 비활성 (CI게이트 오발동 수정)
    'react-hooks/set-state-in-effect': 'off',
    'react-hooks/refs': 'off',
    'react-hooks/purity': 'off',
    'react-hooks/static-components': 'off',
    'react-hooks/immutability': 'off',
    'react-hooks/preserve-manual-memoization': 'off',
    // 컴포넌트+헬퍼 혼합 export는 흔한 패턴 — Fast Refresh 규칙은 경고로 완화
    'react-refresh/only-export-components': 'warn',
    'react-hooks/exhaustive-deps': 'warn',
    // 이식된 EEG/DSP 라이브러리(src/lib/eeg/*)는 의도적으로 @ts-nocheck 사용 — 파일 단위
    // 타입 검증을 끄는 포팅 산출물이므로 ban-ts-comment의 ts-nocheck 플래그만 허용.
    '@typescript-eslint/ban-ts-comment': ['error', {
      'ts-expect-error': 'allow-with-description',
      'ts-ignore': true,
      'ts-nocheck': false,
      'minimumDescriptionLength': 3,
    }],
    // 인터페이스 준수용 미사용 파라미터/변수는 `_` 접두사 관례로 의도 표시.
    '@typescript-eslint/no-unused-vars': ['error', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
    }],
  },
}, ...storybook.configs["flat/recommended"], {
  // 이식된 EEG/DSP 라이브러리(src/lib/eeg/*)는 @ts-nocheck로 타입 검증을 끈 포팅 산출물.
  // 이식 코드의 `any`를 전부 타이핑하려면 DSP 로직 재작성 리스크가 크므로 이 디렉터리에 한해
  // no-explicit-any를 완화한다. 신규/타 디렉터리 코드에는 여전히 금지 규칙이 적용된다.
  files: ['src/lib/eeg/**/*.ts'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
  },
}, {
  // Storybook 8 + react-vite: @storybook/react-vite는 Meta/StoryObj 타입을 재수출하지 않아
  // 타입 전용 import가 @storybook/react(렌더러)에서만 가능하다. 규칙이 type-only import도
  // 렌더러 직수입으로 오판하므로 스토리 파일에 한해 완화.
  files: ['**/*.stories.tsx'],
  rules: {
    'storybook/no-renderer-packages': 'off',
  },
}])
