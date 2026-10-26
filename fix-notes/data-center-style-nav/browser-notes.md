# Chrome 화면·상태·대비 검증

- 실행: Playwright `chromium.launch({ channel: 'chrome', headless: true })`, Chrome 155.0.8059.85, 1440×1000·390×1000.
- 실제 제품 React 화면·셸·CSS를 import한 localhost Vite harness를 사용했다. 모든 API 응답은 합성 mock이며 외부 네트워크는 차단했다. .env는 읽지 않았다(`envDir:false`). 실제 dev 서버·DB·인증의 동작 증거는 아니다.
- 기존 `frontend/src/index.css`의 `../design-system/build/outputs/css/tokens.css`는 이 워크트리에서 잘못 해석된다. harness transform에서 저장소 루트의 추적 중인 동일 토큰 파일로 해석했다. 제품 글로벌 소스는 변경하지 않았다.

## 재현·검증 결과

- 수정 전 develop e0d4c3f4 원본 data-center.css를 Chrome에 주입해 다운로드 설정 hover 실패를 재현했다. 기본 흰색/#69518f는 6.6157:1, hover 흰색/#f4effa는 1.1306:1이었다. `baseline-red.json`, `baseline-red-normal.png`, `baseline-red-hover.png` 참조.
- 수정 후 총 3,120 상태 표본(780 버튼 화면 사례 × 기본·hover·focus·disabled), AA 4.5:1 미달 0, 런타임 pageerror 0. 전체 최소 8.7480:1, disabled 최소 9.3568:1.
- 다운로드 설정: 기본·focus 흰색/#6e1a8c 9.5915:1, hover 흰색/#5f0080 11.6778:1, disabled #404040/#f2f3f8 9.3568:1.
- 활성 버튼 focus 표본 696/696이 실제 `:focus-visible`이며 `rgb(124,58,237) solid 2px` 외곽선을 가진다. 원래 disabled인 84개 표본은 포커스 대상이 아니다.
- disabled 검사는 원래 비활성 버튼을 포함하고, 활성 버튼에도 DOM disabled 속성을 일시 설정해 각 스타일 가족을 측정한 뒤 복원했다. 실제 서버 상태를 변경하지 않았다.
- 대비는 computed foreground/background를 조상 배경과 알파 합성한 뒤 sRGB 상대 휘도 공식으로 계산했다. `browser-summary.json`은 집계, `final-contrast.json`, `supplement-contrast.json`, `metrics-contrast.json`은 개별 근거이다.

## 화면 범위·직접 확인

- 기관 관리자·상담사 명상 클래스 목록·상세를 두 폭에서 캡처했다.
- 데이터 센터 클래스·회차·참여자·다운로드 대화상자·미리보기·EEG/PPG/ACC·feature·6대 지표·개요·사용자·동의/연구·연구 배치·보관/삭제·삭제 후보·계정 삭제·표준·다운로드 작업/감사·링크 재인증·회원/상담사 탐색·더보기 버튼을 캡처·감사했다.
- `comparison-{1440,390}-{list,detail}.png`는 실제 각 화면 캡처를 브라우저에서 나란히 배치한 비교본이다. `final-{1440,390}-download-hover.png`는 hover 상태이다. `metrics-*`는 화면 아래 feature/지표/더보기 상태를 추가로 보여 준다.
- 직접 이미지 확인: 명상 클래스·데이터 센터의 흰 카드, 보라 버튼, 둥근 입력/선택, 표 스타일을 비교했다. 모바일 탭 겹침을 발견해 `flex-shrink:0` 보정을 요청했고, 수정 후 나란히 캡처에서 겹침 해소를 확인했다. 기본·hover 흰 버튼 글자와 disabled 진회색 글자가 선명하다. 모바일 대화상자는 내부 스크롤과 고정된 하단 생성 버튼을 유지한다.
- 문서 전체 가로 넘침은 두 폭에서 0이다. 390에서 긴 탭·테이블은 의도한 내부 가로 스크롤이다(`geometry.json`).

## 재실행

저장소 루트에서 아래 순서로 실행한다. 첫 명령은 별도 터미널에서 계속 실행한다.

```sh
node fix-notes/data-center-style-nav/serve.mjs
node fix-notes/data-center-style-nav/baseline-red.mjs
node fix-notes/data-center-style-nav/capture.mjs final
node fix-notes/data-center-style-nav/supplement.mjs
node fix-notes/data-center-style-nav/metrics.mjs
node fix-notes/data-center-style-nav/geometry.mjs
node fix-notes/data-center-style-nav/compare.mjs
node fix-notes/data-center-style-nav/summarize.mjs
```

`baseline-1440-*`, `verified-*`는 개발 중 이전 산출물이며 최종 검증 근거에서 제외한다. 최종 파일은 `final-*`, `supplement-*`, `metrics-*`, `comparison-*`, `baseline-red-*`이다.
