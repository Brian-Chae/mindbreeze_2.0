// MIND BREEZE Tailwind Preset — frontend/src/mb-tokens.css 기반
// Tailwind 기본 색상 팔레트(purple/gray/green/red/blue/yellow/white/black)를
// mb-tokens 값으로 완전히 덮어쓴다. 기존 컴포넌트의 bg-purple-600, text-gray-500 같은
// 클래스가 자동으로 mb-tokens 색상으로 적용되도록 한다.

const fontSans = [
  '"Pretendard Variable"',
  'Pretendard',
  '"Noto Sans KR"',
  '-apple-system',
  'BlinkMacSystemFont',
  'system-ui',
  'Roboto',
  'sans-serif',
];

const fontText = [
  '"Noto Sans KR"',
  '"Pretendard Variable"',
  'Pretendard',
  '-apple-system',
  'BlinkMacSystemFont',
  'sans-serif',
];

const fontMono = [
  '"SF Mono"',
  'ui-monospace',
  'Menlo',
  'Consolas',
  'monospace',
];

const mbPurple = {
  50: '#f5edfc',
  100: '#d2aefc',
  200: '#d2beff',
  300: '#b373ef',
  400: '#a775d6',
  500: '#9577d0',
  600: '#875eb3',
  700: '#7d3399',
  800: '#6e1a8c',
  900: '#5f0080',
  950: '#4c0066',
};

const mbGray = {
  50: '#ffffff',
  100: '#f2f3f8',
  200: '#efefef',
  300: '#e8e8e8',
  400: '#dddee7',
  500: '#a2a3ad',
  600: '#6f6f6f',
  700: '#404040',
  800: '#1f1f1f',
  900: '#191a1e',
  950: '#000000',
};

const mbGreen = {
  50: '#f0f9f5',
  100: '#f0f9f5',
  200: '#93e5b9',
  300: '#93e5b9',
  400: '#93e5b9',
  500: '#59ce90',
  600: '#59ce90',
  700: '#59ce90',
  800: '#59ce90',
  900: '#59ce90',
};

const mbRed = {
  50: '#ffc9c7',
  100: '#ffc9c7',
  200: '#fc55554d',
  300: '#fc5555',
  400: '#fc5555',
  500: '#ff453a',
  600: '#ff453a',
  700: '#d33f3f',
  800: '#d33f3f',
  900: '#d33f3f',
};

const mbBlue = {
  50: '#f2f3f8',
  100: '#f2f3f8',
  200: '#7878fa33',
  300: '#7878fa33',
  400: '#7878fa33',
  500: '#7878fa',
  600: '#7878fa',
  700: '#5e4fff',
  800: '#5e4fff',
  900: '#5e4fff',
};

const mbYellow = {
  50: '#fdf6e3',
  100: '#fdf6e3',
  200: '#f7e3a3',
  300: '#f3d478',
  400: '#efc14c',
  500: '#efc14c',
  600: '#efc14c',
  700: '#c79a2e',
  800: '#c79a2e',
  900: '#c79a2e',
};

module.exports = {
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      white: '#ffffff',
      black: '#000000',
      purple: mbPurple,
      gray: mbGray,
      slate: mbGray,
      zinc: mbGray,
      neutral: mbGray,
      stone: mbGray,
      green: mbGreen,
      emerald: mbGreen,
      red: mbRed,
      rose: mbRed,
      blue: mbBlue,
      indigo: mbBlue,
      sky: mbBlue,
      yellow: mbYellow,
      amber: mbYellow,
      mb: {
          purple: {
            100: '#5f0080',
            90: '#6e1a8c',
            80: '#7d3399',
            70: '#875eb3',
            60: '#9577d0',
            50: '#a775d6',
          },
          lavender: '#b373ef',
          'lavender-alpha': '#b373efb2',
          pale: '#d2aefc',
          'pale-alt': '#d2beff',
          'purple-cream': '#f5edfc',

          cream: '#ebe6e2',
          'cream-deep': '#ece6e2',

          mint: '#01f0c8',
          electric: '#5e4fff',
          'electric-alpha': '#5e4fff4d',

          data: {
            green: '#59ce90',
            'green-light': '#93e5b9',
            'green-cream': '#f0f9f5',
            khaki: '#5e704f',
            'khaki-light': '#84aa59',
            blue: '#7878fa',
            'blue-light': '#7878fa33',
            'blue-cream': '#f2f3f8',
            pink: '#e15895',
            'pink-light': '#fa78d5',
            orange: '#e6593d',
            yellow: '#efc14c',
            mint: '#89ccd5',
            'deep-mint': '#57849c',
            red: '#f9746b',
            'red-light': '#ffc9c7',
          },

          white: {
            DEFAULT: '#ffffff',
            90: '#ffffffe6',
            80: '#ffffffcc',
            70: '#ffffffb2',
            60: '#ffffff99',
            20: '#ffffff33',
          },
          'bg-10': '#f2f3f8',
          'bg-20': '#efefef',
          'bg-30': '#e8e8e8',
          border: '#dddee7',
          disabled: '#a2a3ad',
          'disabled-bg': '#b3b4b6',
          'gray-60': '#6f6f6f',
          'label-60': '#404040',
          'label-70': '#1f1f1f',
          'label-80': '#191a1e',
          black: {
            DEFAULT: '#000000',
            20: '#00000033',
            40: '#00000066',
            70: 'rgba(0,0,0,0.7)',
          },

          danger: {
            DEFAULT: '#ff453a',
            deep: '#d33f3f',
            soft: '#fc5555',
            tint: '#fc55554d',
          },
          warning: '#efc14c',
          success: '#59ce90',
          info: '#7878fa',

          bg: {
            DEFAULT: '#ffffff',
            soft: '#f5edfc',
            warm: '#ebe6e2',
            deep: '#5f0080',
          },
          fg: {
            DEFAULT: '#1f1f1f',
            soft: 'rgba(0,0,0,0.7)',
            muted: '#6f6f6f',
            disabled: '#a2a3ad',
            'on-brand': '#ffffff',
            'on-brand-soft': '#c6aef6',
          },
          primary: {
            DEFAULT: '#5f0080',
            hover: '#4c0066',
            press: '#3a004f',
            soft: '#d2aefc',
          },
          accent: '#01f0c8',
          link: '#5f0080',
          divider: {
            DEFAULT: '#efefef',
            strong: '#dddee7',
          },
        },
      },

    extend: {
      fontFamily: {
        sans: fontSans,
        'mb-sans': fontSans,
        'mb-text': fontText,
        'mb-mono': fontMono,
      },

      fontSize: {
        'mb-8': ['8px', { lineHeight: '1.4' }],
        'mb-12': ['12px', { lineHeight: '1.5' }],
        'mb-14': ['14px', { lineHeight: '1.5' }],
        'mb-16': ['16px', { lineHeight: '1.5' }],
        'mb-18': ['18px', { lineHeight: '1.5' }],
        'mb-20': ['20px', { lineHeight: '1.4' }],
        'mb-24': ['24px', { lineHeight: '1.4' }],
        'mb-28': ['28px', { lineHeight: '1.35' }],
        'mb-36': ['36px', { lineHeight: '1.3' }],
        'mb-38': ['38px', { lineHeight: '1.3' }],
        'mb-40': ['40px', { lineHeight: '1.3' }],
        'mb-48': ['48px', { lineHeight: '1.2' }],
        'mb-70': ['70px', { lineHeight: '1.15' }],
        'mb-130': ['130px', { lineHeight: '1.05' }],

        'mb-title': ['40px', { lineHeight: '54px', letterSpacing: '-0.0336em' }],
        'mb-subtitle': ['28px', { lineHeight: '38px', letterSpacing: '-0.0236em' }],
        'mb-heading': ['20px', { lineHeight: '28px', letterSpacing: '-0.012em' }],
        'mb-label': ['16px', { lineHeight: '24px', letterSpacing: '0.0057em' }],
        'mb-body': ['14px', { lineHeight: '22px', letterSpacing: '0.0145em' }],
        'mb-caption': ['12px', { lineHeight: '18px', letterSpacing: '0.0252em' }],
      },

      spacing: {
        'mb-2': '2px',
        'mb-4': '4px',
        'mb-8': '8px',
        'mb-12': '12px',
        'mb-16': '16px',
        'mb-20': '20px',
        'mb-24': '24px',
        'mb-32': '32px',
        'mb-40': '40px',
        'mb-60': '60px',
        'mb-80': '80px',
      },

      borderRadius: {
        'mb-xs': '4px',
        'mb-sm': '8px',
        'mb-md': '12px',
        'mb-lg': '16px',
        'mb-xl': '22px',
        'mb-2xl': '24px',
        'mb-3xl': '42px',
        'mb-4xl': '48px',
        'mb-pill': '9999px',
      },

      boxShadow: {
        'mb-sm': '0 1px 1px rgba(25,26,30,0.06)',
        'mb-md': '0 8px 12px rgba(95,0,128,0.08)',
        'mb-lg': '0 12px 30px rgba(95,0,128,0.18)',
        'mb-card': '0 4px 12px rgba(0,0,0,0.05)',
      },

      transitionTimingFunction: {
        'mb-ease': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        'mb-ease-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },

      transitionDuration: {
        'mb-fast': '120ms',
        'mb-base': '220ms',
        'mb-slow': '420ms',
      },
    },
  },
};
