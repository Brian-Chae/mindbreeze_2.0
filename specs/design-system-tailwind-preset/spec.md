# Design System → Tailwind Preset 이식

## 개요
`frontend/src/mb-tokens.css`에 정의된 MIND BREEZE 디자인 토큰을 Tailwind CSS preset으로 변환하여, 모든 컴포넌트에서 토큰 기반 클래스를 사용할 수 있게 한다.

## 현재 문제
- `tailwind.config.cjs`가 `../design-system/build/outputs/tailwind/preset.cjs`를 참조하지만 파일이 존재하지 않음
- mb-tokens CSS 변수는 정의되어 있으나 Tailwind 테마에 연결되지 않아, 컴포넌트들이 `bg-purple-600`, `text-gray-500` 같은 하드코딩된 Tailwind 기본 색상을 사용 중
- 결과적으로 디자인 토큰이 전혀 적용되지 않고 있음

## 작업 내용

### 1. mb-tokens.css 분석 → Tailwind theme 변환
`frontend/src/mb-tokens.css` 파일을 분석하여 다음 Tailwind theme 키로 매핑:

- **colors**: `--mb-purple-*`, `--mb-*-fg/bg/*`, `--mb-data-*`, `--mb-white*`, `--mb-black*`, `--mb-danger/warning/success/info*`
  - 키 이름: `mb.{purple.100, primary, fg, bg, accent, ...}` 형태로 네임스페이스
  - 예: `--mb-primary: #5f0080` → `colors.mb.primary: '#5f0080'`
  - 예: `--mb-purple-100: #5f0080` → `colors.mb.purple[100]: '#5f0080'`
  - 예: `--mb-fg: #1f1f1f` → `colors.mb.fg: '#1f1f1f'`
  - 예: `--mb-bg: #fff` → `colors.mb.bg: '#ffffff'`

- **fontFamily**: `--mb-font-sans`, `--mb-font-text`, `--mb-font-mono`
  - `mb.sans`, `mb.text`, `mb.mono`

- **fontSize**: `--mb-text-*` (8,12,14,16,18,20,24,28,36,38,40,48,70,130)
  - `mb.xs` ~ `mb.7xl` 적절히 매핑 + lineHeight, letterSpacing 포함

- **spacing**: `--mb-space-*` (2,4,8,12,16,20,24,32,40,60,80)
  - Tailwind 기본 spacing 확장

- **borderRadius**: `--mb-radius-*` (xs,sm,md,lg,xl,2xl,3xl,4xl,pill)
  - `mb.xs` ~ `mb.pill`

- **boxShadow**: `--mb-shadow-*` (sm,md,lg,card)
  - `mb.sm` ~ `mb.card`

- **transitionTimingFunction / transitionDuration**: `--mb-ease*`, `--mb-duration-*`

### 2. preset.cjs 파일 생성
경로: `design-system/build/outputs/tailwind/preset.cjs`

```js
// MIND BREEZE Tailwind Preset — mb-tokens.css 기반
module.exports = {
  theme: {
    extend: {
      colors: { mb: { ... } },
      fontFamily: { mb: { ... } },
      fontSize: { ... },
      borderRadius: { ... },
      boxShadow: { ... },
      // ...
    }
  }
};
```

### 3. 검증
- `cd frontend && npm run build`가 성공해야 함
- 기존 컴포넌트들이 깨지지 않아야 함 (새 preset이 기존 Tailwind 기본 색상을 override하지 않도록 `extend` 사용)

## 주의사항
- `extend`를 사용하여 기존 Tailwind 클래스를 덮어쓰지 말 것
- CSS 변수의 `#fff` → `'#ffffff'` 등 6자리 hex로 정규화
- `rgba()` 값은 그대로 문자열로 유지
- fontFamily 값에서 따옴표 이스케이프 주의 (JSON-safe)
- fontSize는 `[size, { lineHeight, letterSpacing }]` 튜플 형식
