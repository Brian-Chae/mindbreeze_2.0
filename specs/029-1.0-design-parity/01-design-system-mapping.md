# 01 — 디자인 시스템 매핑 (1.0 → 2.0 반응형 Tailwind)

> codex 워커 hang으로 Supervisor가 직접 작성. 1.0 Color.ts/Texts.tsx/Buttons.tsx/mb-tokens.css 분석 근거.

## 1. 색상 — 이미 정합 (mb-tokens.css)

2.0 웹의 `frontend/src/mb-tokens.css`에 1.0 보라색 팔레트가 이미 토큰으로 존재한다. 추가 작업 불필요.

| 1.0 Color.ts | 값 | 2.0 mb-tokens.css |
|--------------|-----|-------------------|
| C5F0080 (primary) | #5F0080 | --mb-purple-100, --mb-primary |
| C5E4FFF (강조) | #5E4FFF | --mb-electric |
| CD2AEFC (secondary) | #D2AEFC | --mb-primary-soft |
| CB373EF (lavender) | #B373EF | --mb-lavender |
| C1F1F1F (텍스트) | #1F1F1F | --mb-fg |
| CF2F3F8 / CEFEFEF | #F2F3F8 / #EFEFEF | 배경/경계 |
| CFF453A / CFC5555 (에러) | #FF453A / #FC5555 | 경고/접촉불량 |
| C000000 (검정, 명상 배경) | #000000 | --mb-bg-deep |

## 2. 타이포 매핑 (1.0 Texts.tsx → 반응형 Tailwind)

1.0은 고정 px(14~130px). 웹에선 `clamp()`로 반응형. weight 500/600/700/800 → font-medium/semibold/bold/extrabold.

| 1.0 | 크기/행간 | weight | 반응형 Tailwind |
|-----|-----------|--------|-----------------|
| Text14 | 14/22 | 500 | text-sm font-medium |
| Text16 | 16/24 | 500 | text-base |
| Text16B | 16/24 | 600 | text-base font-semibold |
| Text18 | 18/26 | 500 | text-lg |
| Text20 | 20/28 | 500 | text-xl |
| Text24 | 24/32 | 500 | text-2xl |
| Text28 | 28/40 | 500 | text-3xl |
| Text36 | 36/44 | 500 | text-4xl |
| Text38B | 38/48 | 600 | text-4xl font-semibold |
| Text70 ("AI 분석중") | 70/100 | 500 | text-[clamp(40px,6vw,70px)] |
| Text130B (두뇌휴식도) | 130/182 | 600 | text-[clamp(64px,10vw,130px)] font-semibold leading-none |

핵심: 명상 화면의 초대형 두뇌휴식도(130px)와 "AI 분석중"(70px)은 `clamp()`로 모바일에서 과하게 크지 않게, 데스크톱에서 1.0과 동일하게.

## 3. 버튼 매핑 (1.0 Buttons.tsx → .mb-btn 계열)

| 1.0 | 2.0 |
|-----|-----|
| variant=contained, type=primary (#5F0080) | .mb-btn (이미 존재) |
| variant=contained, type=secondary (#D2AEFC) | .mb-btn--soft (이미 존재) |
| variant=outlined | .mb-btn--ghost (이미 존재) |
| variant=text | .mb-btn--text (신규 추가 필요) |
| borderRadius=12 | rounded-xl (12px) |
| disabled (배경 #DDDEE7) | .mb-btn:disabled (이미 존재) |
| size smaller/small/medium/large (48/80/119/179px) | w/h 고정 or min-w-[119px] 등 |

## 4. 컴포넌트 매핑

| 1.0 | 2.0 반응형 구현 |
|-----|-----------------|
| ScreenWrapper (헤더 + padding 20) | AppShell + p-4 md:p-6 (이미 유사) |
| Table (모니터링 컬럼) | SessionMonitorTable (이미 존재, 모바일은 수평스크롤) |
| BlinkingText ("AI 분석중") | CSS @keyframes opacity blink (1.0과 동일한 깜빡임 주기) |
| FadingImageBackground | 04-nature-background-fade.md 참조 (CSS transition 교차 페이드) |
| Space / Containers(Row/Center) | flex gap 유틸 |

## 5. asset 이식 (완료)

- background1~10.jpg → `frontend/public/images/background1~10.webp` (webp, 1920px, 89% 절감 → 총 1.6MB). 04 문서 참조.
- svg 아이콘(ble_connected/disconnected, arrow_back 등) → 필요 시 `public/icons/`로 이식 (MVP는 대체 아이콘 사용 가능)

## 6. 반응형 breakpoint 전략

| breakpoint | 대응 |
|-----------|------|
| < 640px (모바일) | 1.0 원형. 명상 화면 세로 레이아웃, 두뇌휴식도 clamp 하한, 테이블 수평스크롤/카드화 |
| 640~1024px (태블릿) | 중간 |
| > 1024px (데스크톱) | 호스트 콘솔 풀 테이블, 명상 화면 1.0과 동일 |

## 결정 포인트

1. 초대형 숫자(130px)는 `clamp()`로 반응형 (모바일 64px~데스크톱 130px)
2. BlinkingText는 CSS keyframes로 재현 (React Native Animated 대체)
3. .mb-btn--text variant 신규 추가 (1.0 variant=text 대응)
4. 색상은 이미 정합 — 재정의 금지, mb-tokens.css 재사용
5. asset은 webp 최적화 완료 — 추가 jpg 사용 금지
