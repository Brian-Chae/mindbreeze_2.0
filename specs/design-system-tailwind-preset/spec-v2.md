# Design System → Tailwind Preset v2 — 기본 색상 덮어쓰기

## 문제
v1 preset이 `extend`로 되어 있어 `bg-mb-primary` 같은 새 클래스만 추가됐고, 기존 컴포넌트들의 `bg-purple-600`, `text-gray-500` 같은 Tailwind 기본 클래스는 여전히 Tailwind 기본 색상을 사용 중. 디자인 토큰이 실제 컴포넌트에 적용되지 않음.

## 작업: Tailwind 기본 색상을 mb-tokens로 덮어쓰기

### 1. `design-system/build/outputs/tailwind/preset.cjs` 수정
`extend.colors` → `colors` (직접 정의)로 변경하여 Tailwind 기본 색상 팔레트를 mb-tokens 값으로 완전히 대체.

매핑 규칙:
- `purple` 팔레트 → `mb-purple-*` 토큰으로 매핑 (50~900)
  - `purple.50`: `#f5edfc` (mb-purple-cream)
  - `purple.100`: `#d2aefc` (mb-pale)
  - `purple.200`: `#d2beff` (mb-pale-alt)
  - `purple.300`: `#b373ef` (mb-lavender)
  - `purple.400`: `#a775d6` (mb-purple-50)
  - `purple.500`: `#9577d0` (mb-purple-60)
  - `purple.600`: `#875eb3` (mb-purple-70)
  - `purple.700`: `#7d3399` (mb-purple-80)
  - `purple.800`: `#6e1a8c` (mb-purple-90)
  - `purple.900`: `#5f0080` (mb-purple-100, mb-primary)
  - `purple.950`: `#4c0066` (mb-primary-hover)

- `gray` 팔레트 → mb-fg/muted/bg 계열로 매핑
  - `gray.50`: `#ffffff` (mb-white)
  - `gray.100`: `#f2f3f8` (mb-bg-10)
  - `gray.200`: `#efefef` (mb-bg-20, mb-divider)
  - `gray.300`: `#e8e8e8` (mb-bg-30)
  - `gray.400`: `#dddee7` (mb-border, mb-divider-strong)
  - `gray.500`: `#a2a3ad` (mb-disabled)
  - `gray.600`: `#6f6f6f` (mb-gray-60, mb-fg-muted)
  - `gray.700`: `#404040` (mb-label-60)
  - `gray.800`: `#1f1f1f` (mb-label-70, mb-fg)
  - `gray.900`: `#191a1e` (mb-label-80)
  - `gray.950`: `#000000` (mb-black)

- `green` 팔레트 → mb-success/data-green 계열
  - `green.50`: `#f0f9f5` (mb-data-green-cream)
  - `green.400`: `#93e5b9` (mb-data-green-light)
  - `green.500`: `#59ce90` (mb-success, mb-data-green)

- `red` 팔레트 → mb-danger 계열
  - `red.400`: `#fc5555` (mb-danger-soft)
  - `red.500`: `#ff453a` (mb-danger)
  - `red.700`: `#d33f3f` (mb-danger-deep)

- `blue` 팔레트 → mb-info/data-blue 계열
  - `blue.400`: `#7878fa33` (mb-data-blue-light)
  - `blue.500`: `#7878fa` (mb-info, mb-data-blue)

- `yellow` 팔레트 → mb-warning/data-yellow 계열
  - `yellow.500`: `#efc14c` (mb-warning, mb-data-yellow)

- `white`와 `black`도 mb-white, mb-black으로

- 기존 `colors.mb.*` 네임스페이스는 유지 (직접 mb 토큰 사용 원할 때)

- `fontFamily`도 override: `sans` → mb-font-sans 값 등

### 2. 빌드 검증
`cd frontend && npm run build` 성공해야 함

### 3. 변경 확인
기존 컴포넌트들에서 `bg-purple-600`, `text-gray-500` 등의 클래스가 mb-tokens 색상으로 자동 적용되는지 확인
