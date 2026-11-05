# v4 — 기존 소셜 로그인 버튼 반영

기존 Google·Apple 버튼으로 해석해 로고와 스타일을 적용했다. Android 전용 로그인은 신설하지 않는다.
- Google: 기존 icon_google.svg, 흰 배경/보라 글자/20px 로고. LoginPage.tsx:192–195.
- Apple: 기존 icon_apple.svg, 검정 배경/흰 글자/18px 로고. AppleLoginButton.tsx:101–110.
- 공통: 높이52px, pill, 로고와 글자 간격12px. 기존 v1~v3 보존.
- HTML 우선 검토 요청 유지: 브라우저 렌더 미검증, JS 구문·자산 동일성·HTTP 확인만 수행.
