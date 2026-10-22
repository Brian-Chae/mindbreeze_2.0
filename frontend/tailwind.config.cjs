/** @type {import('tailwindcss').Config} */
const preset = require('../design-system/build/outputs/tailwind/preset.cjs');

module.exports = {
  presets: [preset],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      screens: { mobile: { max: '767px' } },
      // SDD-196: 모바일 가독성 — 본문(text-sm)을 14→15px로 키우고 한글 행간 22px 고정.
      // 기존 크기는 데스크톱 호환용으로 유지. 모바일은 mobile:text-mb-* 의미 토큰을 사용한다.
      fontSize: {
        sm: ['15px', { lineHeight: '22px' }],
        'mb-caption': ['var(--mobile-type-caption-size)', { lineHeight: 'var(--mobile-type-caption-leading)' }],
        'mb-label': ['var(--mobile-type-label-size)', { lineHeight: 'var(--mobile-type-label-leading)' }],
        'mb-compact': ['var(--mobile-type-compact-size)', { lineHeight: 'var(--mobile-type-compact-leading)' }],
        'mb-body': ['var(--mobile-type-body-size)', { lineHeight: 'var(--mobile-type-body-leading)' }],
        'mb-subtitle': ['var(--mobile-type-subtitle-size)', { lineHeight: 'var(--mobile-type-subtitle-leading)' }],
        'mb-title': ['var(--mobile-type-title-size)', { lineHeight: 'var(--mobile-type-title-leading)' }],
        'mb-hero': ['var(--mobile-type-hero-size)', { lineHeight: 'var(--mobile-type-hero-leading)' }],
        'mb-number': ['var(--mobile-type-number-size)', { lineHeight: 'var(--mobile-type-number-leading)' }],
      },
    },
  },
};
