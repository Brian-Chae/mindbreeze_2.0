# 자연 이미지 배경 페이드 (FadingImageBackground) — 1.0 → 2.0 이식 기획

> 사용자 강조: 1.0 명상 화면의 완성도는 "자연 이미지가 조용히 바뀌는 배경 페이드"에서 나왔다. 이를 2.0 웹에 동일하게 반영한다.

## 1.0 동작 분석 (코드 근거: FadingImageBackground.tsx)

| 항목 | 값 | 설명 |
|------|-----|------|
| 이미지 | background1~10.jpg (10장) | 자연 풍경. 각 700KB~3.3MB |
| 전환 간격 | `IMAGE_CHANGE_INTERVAL = 20000ms` | 20초마다 |
| 페이드 시간 | `FADE_DURATION = 1000ms` | 1초 교차 페이드 |
| 전환 방식 | `Animated.parallel` (fadeAnim1 1→0 + fadeAnim2 0→1 동시) | 현재 이미지 페이드아웃 + 다음 이미지 페이드인 |
| 크롭 | `resizeMode="cover"` | 화면을 채우도록 크롭 |
| 선택 | `getRandomImage` (이전과 다른 것, 중복 방지) | 무작위 순환 |
| 레이어 | 2개 absolute View 겹침 | 교차 페이드용 |
| 배경색 | ScreenWrapper `backgroundColor=#000000` (검정) | 명상 화면 전체 검정 위에 이미지 |

핵심 UX: 검정 화면 위에 자연 이미지가 cover로 깔리고, 20초마다 1초 페이드로 조용히 교차 전환되며, 그 위에 두뇌휴식도(130px 흰색)·진행시간·뇌파 차트가 얹힌다.

## 2. 2.0 웹 반응형 포팅 설계

### 컴포넌트 — `FadingImageBackground.tsx` (React + CSS transition)

React Native `Animated` → CSS `opacity` transition으로 치환:

```tsx
// 두 이미지 레이어를 absolute로 겹치고, opacity를 CSS transition으로 교차 페이드
<div className="absolute inset-0">
  <div className="absolute inset-0 transition-opacity duration-1000"
       style={{ opacity: currentVisible ? 1 : 0, backgroundImage: `url(${current})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
  <div className="absolute inset-0 transition-opacity duration-1000"
       style={{ opacity: currentVisible ? 0 : 1, backgroundImage: `url(${next})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
</div>
```

- 20초 `setInterval` + 1초 `transition-opacity duration-1000` (duration-1000 = 1s)
- `background-size: cover` + `background-position: center` = resizeMode cover
- 무작위 + 이전 이미지와 다른 것(중복 방지) 로직 유지
- 검정 배경(`bg-black`) 위에 얹기

### asset 이식 + 최적화

- background1~10.jpg를 `frontend/public/images/`로 복사
- **크기 최적화 필수**: 원본 총 ~15MB(각 0.7~3.3MB)는 웹에서 과함. webp 또는 1920px 폭 압축으로 각 150~400KB 이하, 총 2~4MB 목표
- 반응형: 모바일은 720p, 데스크톱은 1080p+ 이미지 (srcset 또는 두 해상도 세트)

### GuestMeditationPanel 적용

- 2.0 명상 화면(`class-join-page`의 meditation 단계)에서 FadingImageBackground를 배경으로, 그 위에 두뇌휴식도/차트/타이머를 얹음
- 1.0의 검정 배경 + 흰색 초대형 두뇌휴식도(130px) + "AI 분석중" 깜빡임을 동일하게

## 결정 포인트

1. **이미지 라이선스/출처** — background1~10.jpg가 자체 보유/구매 자산인지 확인 (외부 저작권이면 교체 필요)
2. **최적화 포맷** — webp(용량 우수) vs jpg(호환) — webp가 2026년 브라우저에서 전부 지원되므로 webp 권장
3. **반응형 이미지** — 단일 최적화본 vs srcset 2해상도 — MVP는 단일 1080p webp, P1에서 srcset
4. **성능** — 10장 프리로드(link rel=preload) vs 레이지 — 명상 화면 진입 시 프리로드
5. **절전 고려** — 1.0의 화면 끄기(절전) 기능과 배경 페이드의 조합 (절전 시 페이드 정지)

## 한 줄 결론

1.0 명상 화면의 완성도 핵심은 **검정 화면 위 자연 이미지가 20초마다 1초 페이드로 조용히 교차 전환되는 배경**이다. 2.0 웹에는 CSS `opacity transition`으로 동일한 교차 페이드를 재현하고, background1~10.jpg를 webp로 최적화해 이식하며, 그 위에 초대형 두뇌휴식도·차트·타이머를 얹는다.
