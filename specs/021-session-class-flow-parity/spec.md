# SDD-021 — 클래스 시작 프로세스 1.0 패리티

## 목표
mindbreeze_2.0의 "클래스 시작" → 세션 진행 프로세스를 mind-breeze-app(1.0)과 동일한 UI/흐름으로 재현한다. 회원가입에서 이미 입력한 정보(성별/실명/생년월일/자리번호)는 반복 입력하지 않는다.

## 1차 MVP 스코프 (A 방향)
- 프로세스/UI 흐름을 1.0과 동일하게 재현
- EEG 실시간 데이터는 **placeholder(null)** 로 두고, Web Bluetooth/Looxid SDK 실연동은 후속(Phase 2)으로 분리

## 핵심 결정
1. 호스트 화면: SessionLivePage 재구성 (뇌파 모니터링 테이블 + DashboardBox 4종 + 코드 배너 + 시작 조건). 기존 녹음/마커/LiveKit 유지.
2. "클래스 시작" 조건: active 참가자 1명 이상 + 서버 검증.
3. 게스트 /join 확장: code → details → waiting → meditation(뇌파 차트 placeholder) → complete.
4. 입력 생략: 로그인 내담자는 계정 정보 사용(재입력 없음), 게스트는 이름만. 자리번호 입력 제거(표시 컬럼만 nullable 유지).
5. 세션코드 = access_code 재사용.

## 백엔드 변경
- `transition_status('start')`에 active 참가자 1명 이상 검증
- `GET /sessions/{id}/live-metrics` 호스트 모니터링 (참가자 목록 + 뇌파 metric 필드, 뇌파는 null placeholder)
- 게스트 by-code 상태 조회 (대기→명상 전이 감지)

## 프론트 변경
- SessionLivePage 재구성 (모니터링 테이블 + DashboardBox + 코드 배너 + 시작 조건)
- /join 확장 (waiting→meditation 전이 + 두뇌휴식도/차트 placeholder)

## 성공 기준
1. 호스트가 세션코드 안내 후 참가자 1명 이상일 때 "클래스 시작" 활성화
2. 시작 후 참가자 모니터링 테이블(이름/접촉/연결/배터리/두뇌휴식도/업로드) 표시
3. 게스트가 이름만으로 참여 → 대기 → 호스트 시작 시 명상 화면 자동 전환
4. 회원가입 정보 재입력 없음
