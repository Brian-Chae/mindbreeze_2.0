/** @type {import('tailwindcss').Config} */
const preset = require('../design-system/build/outputs/tailwind/preset.cjs');

module.exports = {
  presets: [preset],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // SDD-196: 모바일 가독성 — 본문(text-sm)을 14→15px로 키우고 한글 행간 22px 고정.
      // text-xs(12px)는 최소 크기 하한으로 유지한다.
      fontSize: {
        sm: ['15px', { lineHeight: '22px' }],
      },
    },
  },
};
