# SDD-063 구현 전 검증 계획

작성 시점: 구현 전. coordinator에 계획 및 게이트 확인 요청 후 구현한다.

- 상단 행동 3개가 /join, /login, /register로 정확히 이동한다.
- 서비스 / LINK BAND / 리포트 / 고객센터가 실제 섹션으로 스크롤한다.
- 360 / 390 / 768 / 1440px에서 가로 넘침이 없다.
- 모바일 메뉴 열기/닫기·Escape·링크 선택 시 닫기·키보드 접근을 확인한다.
- 기관·상담사·명상가 각각 문제와 해결을 확인한다.
- 공식 LINK BAND 페이지에서 확인한 사양만 사용한다.
- 리포트는 기존 NarrativeSections를 사용하고 예시 데이터 표시, 열기/닫기 및 포커스 복원을 확인한다.
- LINK BAND 미착용 이용 가능 안내를 유지한다.
- 신규 inline style 없이 Tailwind만 사용한다.
- 이미지 크기·lazy·async decode, 미리보기 지연 로딩을 확인한다.
- 매 루프 npm run build 성공 및 실제 Chromium 시각 확인 근거를 summary.md에 기록한다.

## 승인 기록

구현 전 coordinator가 orchestration ask에 “승인합니다. 진행하세요”로 응답했다. 승인 후 위 계획에 따라 구현을 시작했다. 실제 검증 결과는 summary.md와 evidence/에 기록한다.
