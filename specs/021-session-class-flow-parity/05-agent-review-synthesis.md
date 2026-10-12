# SDD-021 에이전트 리뷰 종합

## 실행한 에이전트
- Claude: 백엔드/실시간 (stdout 요약 회수)
- Codex: API/구현 (문서 완성)
- Cursor: UX (문서 완성)
- Gemini: 실패 (command not found)

## 공통 합의
1. 호스트 화면 = SessionLivePage 재구성 (뇌파 모니터링 테이블 + DashboardBox 4종 + 코드 배너 + 시작 조건), 신규 화면 아님
2. 게스트 = /join 확장 (code → details → consent? → waiting → meditation → complete)
3. 회원가입 입력 생략: 성별/실명/생년월일/자리번호 입력 제거. 로그인 사용자는 계정 정보, 게스트는 이름만.
4. "클래스 시작" 조건 = active 참가자 1명 이상 + 연결 (프론트 disable + 서버 검증)
5. 자리번호(seatNumber): 입력 생략, nullable 컬럼/표시만 유지
6. 세션코드 = access_code 재사용, "수강생에게 클래스 코드 알려주세요" 배너

## 핵심 블로커 (3개 에이전트 일치)
1. **EEG 데이터 소스 미구현** — 웹에 BLE/Looxid SDK 전무. EEGRecord는 배치 저장용.
2. **실시간 채널 부재** — /record 네임스페이스만 있고 세션 라이브 채널 없음
3. **start 서버 검증 없음** — session_service에서 참가자 수 검증 없이 start 허용

## 최종 설계 방향 (통합)
- 호스트: SessionLivePage에 모니터링 테이블 + DashboardBox + 코드 배너 + 시작/종료 (기존 녹음/마커/LiveKit 유지)
- 게스트: /join 확장 + waiting→meditation 자동 전이 + 두뇌휴식도/BrainChart/타이머
- EEG: Socket.IO /session-live 네임스페이스 + window aggregation (250Hz → 1초 요약)
- 입력 생략: 로그인 내담자는 계정 정보, 게스트는 이름만

## Gemini 실패 기록
- 로그: /tmp/mb-022-gemini-run.log (command not found: gemini)
