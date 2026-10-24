# SDD-243 FE 실제 Chrome 검증

- 대상: 실제 production build, 모든 API는 B01 합성 fixture/계약에 따른 테스트 응답.
- 환경: Chrome 155.0.8059.85, 플랫폼/기관 각각 1440×1000·390×844. 실제 서버·DB·ZIP·외부 웹소켓 연결 없음.
- 결과: 68장, 108검사 통과, pageerror0, page 가로 넘침0. 모달 화면 내 배치 및 모바일 CTA 실제 클릭 통과.
- 파일명: `{platform_admin|org_admin}-{1440|390}-{화면}.png`. 클래스·회차·참여자·측정 메타/EEG·6지표·PPG/ACC 미수집·feature·단건구간/회차/클래스/회원/상담사 대화상자·preview·작업·감사.
- `capture-results.json`: 화면별 배치/동작 검사와 요청 메서드·경로(합성 ID만).
- `verification-results.json`: 신규/메뉴/전체 테스트, 기준선17건 실패 대조, 타입/build, 소유권 결과.
- 재현: frontend cwd에서 `npm run build` 후 `node e2e/sdd243-capture.mjs`. HTTP 서버를 띄우지 않고 Playwright가 빌드 파일을 직접 제공한다.
- 원천 fixture에 없는 부분의 테스트 확장: 플랫폼 capabilities, export proof/감사, 회원/상담사 회차 wrapper, 상태/preview 유효시각. 실제 권한/인증/산출물 증거가 아니다.
