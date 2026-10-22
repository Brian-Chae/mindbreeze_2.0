# 입장 코드 칸 비율 비교 — 디자인 검토용

앱 미적용. Brian이 선택한 뒤 별도 구현 지시를 받는다.

- 시안: `index.html` (파일로 직접 열기 가능, 이미지 상대 경로이므로 저장소 안에서 열기)
- Chrome headless 캡처: `chrome-1440.png`, `chrome-390.png` (전체 페이지)
- 재현: 저장소 루트에서 `node designs/code-entry-cell-ratio/capture.cjs`
- 실측: `measurements.json`. 1440·390·320px에서 페이지 가로 넘침 없음, 모든 칸이 카드 내부에 있음.
- 데스크톱 2×2 비교, 모바일 1열. 비교를 위해 한 카드에 세 상태를 모았다. 실제 /join 화면 전체 높이를 재현한 것은 아니다.

## 안별 판단

- A 원래 참고: 최대 96×64px / 36px / 간격 16px. 가로로 시원하지만 숫자 양옆 여백 과다. 480px 카드에서는 실측 95.5×63.66px. 과거 약 96×64를 비율로 재현했으며 과거의 유동 폭 CSS와 다름.
- B 현재: 64×84px / 36px / 간격 16px. 명확한 개별 칸, 세로 여백 과다.
- C: 56×64px / 36px / 간격 16px. 컴팩트한 모습, 숫자가 상대적으로 꽉 참.
- D 추천: 60×68px / 36px / 간격 16px. C와 비율은 거의 같고 전체 크기만 약간 커 숫자 주변에 여유가 생김. B보다 높이 16px 감소, 세로로 긴 느낌 완화.

390px 화면 카드 실측 358px: B/C/D는 명시 크기와 36px 글자를 그대로 유지한다. A는 65×43.33px, 글자 약 24.38px로 축소되어 터치 높이 44px에 못 미치므로 과거 비교용으로만 제시한다. 320px 보조 검증: D는 47.5×53.83px, 글자 28.5px로 비율 유지. 스크린샷은 정적 시각 검증이며 키보드·실제 입력 동작 검증은 범위 밖이다.

## 참고한 OTP 패턴

[Twilio OTP 폼 가이드](https://www.twilio.com/en-us/blog/developers/best-practices/best-practices-for-otp-input-forms-in-ios)의 자리별 시각적 분리 방식과 [nib Mesh OTP Input](https://www.meshdesignsystem.com/components/otp-input)의 상태 구분을 참고했다. 특정 은행 앱의 픽셀 실측이나 공통 규격으로 주장하지 않는다. 아래 치수는 이 화면의 36px 숫자와 카드 여백에 맞춘 디자인 제안이다.

## 실제 화면과의 일치 기준

`player-tokens.css`의 소프트 시트 토큰을 사용: 배경 rgba(24,12,36,.78), 테두리 rgba(255,255,255,.14), 라벤더 #B373EF, 글자 #F7F4F0/#CFC6D6. `background1.webp`를 고정하고 기존 스크림 색을 적용했다. `MemberBrandMark` SVG를 그대로 사용. 폰트는 실제 화면의 Pretendard 우선 스택이며 로컬에 없으면 시스템 폰트로 대체한다. DESIGN.md의 전역 화면과 달리 기존 /join의 몰입형 토큰을 보존한다.

## 적용 CSS 제안 (앱에 아직 반영하지 않음)

기존 색·테두리·모서리·폰트 굵기는 유지한다. 아래 네 블록 중 하나만 선택한다. 첫 줄은 반응형 글자 크기의 기준 컨테이너를 지정한다. `minmax`가 폭을 축소하고 `aspect-ratio`가 높이를 함께 줄인다. 글자도 같은 배율로 축소된다.

### A — 과거 비율 참고
```css
.pz-root .fm-code-card { container-type: inline-size; }
.pz-root .fm-codebox { grid-template-columns: repeat(4, minmax(0, 96px)); justify-content: center; gap: 16px; }
.pz-root .fm-codebox > span { aspect-ratio: 96 / 64; height: auto; }
.pz-root .fm-codebox input { font-size: min(36px, calc((100cqw - 48px) / 4 * .375)); line-height: 1; }
```

### B — 현재
```css
.pz-root .fm-code-card { container-type: inline-size; }
.pz-root .fm-codebox { grid-template-columns: repeat(4, minmax(0, 64px)); justify-content: center; gap: 16px; }
.pz-root .fm-codebox > span { aspect-ratio: 64 / 84; height: auto; }
.pz-root .fm-codebox input { font-size: min(36px, calc((100cqw - 48px) / 4 * .5625)); line-height: 1; }
```

### C — 살짝 세로
```css
.pz-root .fm-code-card { container-type: inline-size; }
.pz-root .fm-codebox { grid-template-columns: repeat(4, minmax(0, 56px)); justify-content: center; gap: 16px; }
.pz-root .fm-codebox > span { aspect-ratio: 56 / 64; height: auto; }
.pz-root .fm-codebox input { font-size: min(36px, calc((100cqw - 48px) / 4 * .642857143)); line-height: 1; }
```

### D — 균형형 (추천)
```css
.pz-root .fm-code-card { container-type: inline-size; }
.pz-root .fm-codebox { grid-template-columns: repeat(4, minmax(0, 60px)); justify-content: center; gap: 16px; }
.pz-root .fm-codebox > span { aspect-ratio: 60 / 68; height: auto; }
.pz-root .fm-codebox input { font-size: min(36px, calc((100cqw - 48px) / 4 * .6)); line-height: 1; }
```

## Brian 결정

A/B/C/D 중 한 안 선택. 추천은 D. 이번 작업은 디자인 산출물에서 종료하며 앱 적용은 별도 지시 후 진행한다.

## D안 앱 적용 검증 (2026-10-22)

Brian의 D안 선택 및 구현 지시에 따라 앱 CSS에 최대 60px·60/68 비율을 적용했다. 위 비교 시안은 당시 검토 자료로 보존한다. 실제 앱에서는 요청대로 좁은 화면에서도 숫자 36px/800을 유지한다(시안의 글자 축소 제안은 미적용). 모바일 전역 입력 16px !important 규칙을 이 코드 입력에만 한정한 속성 선택자로 재정의했다.

- 실제 `/join`: Chrome headless, 1440/390px 모두 네 칸 60×68px, 간격 16px, 글자 36px/800.
- 보조 320px: 47.5×53.828125px로 비율 유지 축소, 글자 36px/800, 가로 넘침 없음.
- 빈 상태·27·2784 모두 검증. 서버/API/socket 요청은 차단하고 로컬 프런트엔드만 실행.
- 실측 JSON: `app-measurements.json`, 화면: `app-1440.png`, `app-390.png`.
- 재현: Vite 로컬 5187 포트 실행 후 `node designs/code-entry-cell-ratio/measure-app.cjs`.
- 관련 vitest: entry-views, entry-page, entry, sdd216-entry-code 4파일 66개 통과.
- 타입 검사: `npx --prefix frontend tsc --noEmit -p frontend` 통과. 루트에 TypeScript가 없어 frontend 설치본을 지정했다.
