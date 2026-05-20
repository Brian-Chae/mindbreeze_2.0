# SDD-01 — Homepage UI Kit 이식

## 미션
`design-system/handoff/mind-breeze-design-system/project/ui_kits/homepage/`의 UI Kit JSX 컴포넌트들을 React + TypeScript + Tailwind(mb-tokens)로 변환하여, 현재 `frontend/src/pages/LandingPage.tsx`를 완전히 교체한다.

## 소스 파일 (UI Kit → 변환 대상)
- `design-system/handoff/.../ui_kits/homepage/Nav.jsx` → `frontend/src/components/landing/Nav.tsx`
- `design-system/handoff/.../ui_kits/homepage/Hero.jsx` → `frontend/src/components/landing/Hero.tsx`
- `design-system/handoff/.../ui_kits/homepage/FeatureCards.jsx` → `frontend/src/components/landing/FeatureCards.tsx`
- `design-system/handoff/.../ui_kits/homepage/PeopleSection.jsx` → `frontend/src/components/landing/PeopleSection.tsx`
- `design-system/handoff/.../ui_kits/homepage/ProcessSection.jsx` → `frontend/src/components/landing/ProcessSection.tsx`
- `design-system/handoff/.../ui_kits/homepage/CTASection.jsx` → `frontend/src/components/landing/CTASection.tsx` (Footer 포함)
- 위 컴포넌트들을 조합한 `frontend/src/pages/LandingPage.tsx` (기존 파일 교체)

## 디자인 토큰
- Tailwind preset (`design-system/build/outputs/tailwind/preset.cjs`)이 이미 적용되어 있음
- purple/gray/green/red/blue/yellow 팔레트가 mb-tokens 값으로 덮어써져 있음
- `bg-purple-900` → `#5f0080`, `text-gray-800` → `#1f1f1f` 등 자동 매핑
- `mb-btn`, `mb-eyebrow`, `mb-card`, `mb-h1`, `mb-h2` 등의 유틸 클래스는 `frontend/src/mb-tokens.css`에 정의되어 있음 — 이 클래스들은 그대로 사용 가능

## 변환 규칙
1. **인라인 스타일 → Tailwind 클래스**: 모든 `style={{}}` 객체를 Tailwind 클래스로 변환
   - `color: "#5F0080"` → `text-purple-900` (preset이 #5f0080으로 매핑)
   - `color: "#0A0A0A"` → `text-gray-900` 또는 `text-gray-950`
   - `background: "#EBE6E2"` → `bg-[#EBE6E2]` (크림 배경은 preset 범위 밖이므로 arbitrary)
   - `background: "#FFFFFF"` → `bg-white`
   - `fontFamily: "var(--mb-font-sans)"` → `font-sans` (preset에서 Pretendard로 override됨)
   - `fontFamily: "var(--mb-font-text)"` → `font-[var(--mb-font-text)]` 또는 기본
   - `padding: "18px 32px"` → `px-8 py-[18px]`
   - `borderRadius: 28` → `rounded-[28px]`
   - `gap: 12` → `gap-3` / `gap: 20` → `gap-5` / `gap: 36` → `gap-9`

2. **Asset 경로**:
   - `../../assets/images/hero_landing.png` → `/mb-design/assets/images/hero_landing.png`
   - `../../assets/logo_symbol_dark.svg` → `/mb-design/assets/logo_symbol_dark.svg`
   - `../../assets/images/feature_*.png` → `/mb-design/assets/images/feature_*.png`
   - `../../assets/images/portrait_*.png` → `/mb-design/assets/images/portrait_*.png`
   - `../../assets/images/background*.jpg` → `/mb-design/assets/images/background*.jpg`

3. **콘텐츠**: 현재 기획에 맞게 텍스트 조정
   - Hero: "뇌과학 IT기업, 룩시드랩스" → 유지
   - Nav: "지도사 로그인" → "로그인" (기존 앱 라우트 `/login`으로)
   - Nav: "서비스 신청" → "무료로 시작하기" (기존 앱 라우트 `/register`로)
   - CTA: "지도사를 위한 도구" → 유지
   - Footer: Looxid Labs 정보 유지

4. **TypeScript**: 각 컴포넌트는 React.FC 타입, props 인터페이스 정의

5. **반응형**: UI Kit은 1280px 기준이지만, Tailwind로 반응형 대응 (md:, lg: 브레이크포인트)

6. **기존 코드**: `LandingPage.tsx`는 새 컴포넌트로 완전히 교체. 기존 `frontend/src/components/landing/` 디렉토리의 파일들도 교체.

## 작업 순서
1. PeopleSection.jsx, ProcessSection.jsx 읽기
2. 각 컴포넌트를 TypeScript + Tailwind로 변환하여 파일 생성
3. LandingPage.tsx 교체
4. `cd frontend && npm run build` 검증

## 주의
- UI Kit의 원본 디자인을 최대한 그대로 재현할 것 (레이아웃, 여백, 폰트 사이즈, 색상)
- `mb-btn`, `mb-eyebrow`, `mb-h1` 등의 클래스는 `frontend/src/mb-tokens.css`에 이미 정의되어 있으므로 그대로 className으로 사용 가능
- 인라인 스타일을 Tailwind 클래스로 변환할 때, mb-tokens.css의 유틸 클래스(`mb-btn`, `mb-eyebrow` 등)가 있으면 우선 사용
- Footer도 CTASection.tsx에 포함되어 있으니 같이 변환
