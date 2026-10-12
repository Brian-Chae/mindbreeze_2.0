# SDD-021 연구 브리프 — 클래스 시작 프로세스 1.0 패리티 재현

## Brian 요구 (원문)
> "클래스 시작을 누르면 진행되는 프로세스가 지금 이상해. 기존의 mind-breeze-app 의 코드를 정확하게 분석하고 완전히 동일한 프로세스로 진행되도록 해줘. 그런데 여기서 회원 가입하면서 했던 일들이 있기때문에 그걸 반복 입력할 필요는없으니까 그걸 빼고 해줘. 이거 매우 중요한 거니까 오케스트레이션해서 정확하게 동일한 UI 와 흐름인데 생략할 수 있는건 생각해서 진행하도록 만들어줘."

## 1.0 (mind-breeze-app, React Native) 프로세스 — 기준 원본

### 호스트(상담사/운영자)
1. **LectureScreen**: 클래스 목록(생성일/세션코드/클래스명). 각 행 "입장" 버튼 → Session. "클래스 추가"/"보관된 클래스"/"프로필 설정" 헤더.
2. **SessionScreen** (세션 진행 핵심):
   - `getSession(code)` + `getSessionLogs(code)` 실시간 폴링(OPERATOR_INTERVAL_TIME)
   - Socket 연결 → OPERATOR.init(join room)
   - 시작 전 안내: "수강생에게 세션코드({code})를 알려주세요"
   - **"클래스 시작" 버튼** — `connected && sessionLogs.length > 0` 일 때만 활성화 → `OPERATOR.startSession(session._id)`
   - 시작 후 **참가자 실시간 모니터링 테이블**: 자리번호/이름/접촉상태(센서)·기기연결/배터리/평균두뇌휴식도/현재두뇌휴식도/데이터업로드현황
   - DashboardBox 4개: 참여자/접촉불량/기기연결실패/밴드배터리부족
   - **"클래스 종료"** → `OPERATOR.finishSession` → Lecture 복귀
   - 시작 전 "클래스 정보" 모달, 참가자 롱프레스 → 자리번호/이름 수정 모달

### 게스트(참가자)
1. **SeatNumberScreen**: 자리번호 입력(태블릿/밴드박스 표시) → AsyncStorage 저장
2. **GuestConsentScreen**: 서비스 이용동의(이용약관/개인정보 처리방침) + 블루투스 초기화
3. **GuestSignInScreen**: 4단계 PagerView — 코드(세션코드 검증) → 성별 → 실명 → 생년월일 → `signInGuest` + `postSessionLog(code, seatNumber)`
4. **GuestWaitingScreen**: 대기(비디오 배경 + 웰컴 3단계). 호스트 시작 감지(sessionLogState STARTED) → GuestMeditation 자동 전환
5. **GuestMeditationScreen**: 명상 — 진행시간 타이머 + **두뇌휴식도(실시간 뇌파%)** + BrainChart 뇌파 차트 + 밴드 연결/LeadOff. 종료/완료 시 GuestComplete
6. **GuestCompleteScreen**: 수업 종료 → **리포트 신청(휴대전화번호 입력)** → signOut

### 핵심 데이터 (SessionLog)
- seatNumber, userId, sessionId, sessionLogState(READY/STARTED/COMPLETED), recordIds, efficiencies[](두뇌휴식도), avgEfficiency, deviceStatus(접촉상태), bandBattery

## 2.0 (mindbreeze_2.0, React 웹) 현재 프로세스
1. **SessionListPage** → **SessionCreatePage**(클래스 생성) → **SessionDetailPage**(상세/참여자/코드)
2. **SessionDetailPage**: "시작" 버튼 → `transitionSession(id, 'start')` → `/sessions/{id}/live`
3. **SessionLivePage**: 화상회의(LiveKit) + 녹음 + 마커 중심. **참가자 뇌파 실시간 모니터링 테이블 없음**
4. **ClassJoinPage**(/join): 클래스 코드 → 세션 확인 → 게스트 이름(또는 로그인) → 대기(waiting, 폴링)

## 핵심 차이 (재구현 대상)
| 영역 | 1.0 | 2.0 현재 | 조치 |
|---|---|---|---|
| 호스트 세션 화면 | SessionScreen(참가자 뇌파 모니터링 테이블 + 시작/종료) | SessionLivePage(화상/녹음/마커, 뇌파 테이블 없음) | 뇌파 모니터링 테이블 재현 |
| 클래스 시작 조건 | 참가자(sessionLogs) 존재 + 연결 시 활성화 | 조건 없음 | 참가자 존재 시 활성화 |
| 게스트 진입 | 자리번호→동의→로그인(코드/성별/실명/생일)→대기 | /join(코드→이름→대기) | 로그인 입력 생략 |
| 게스트 명상 | 두뇌휴식도 + BrainChart + 타이머 | 없음 | 명상 화면 재현 |
| 게스트 완료 | 리포트 신청(전화번호) | 없음 | (선택) 완료 흐름 |
| 세션코드 | code(자리번호와 함께) | access_code | access_code 사용 |

## 반드시 답해야 할 쟁점
1. 호스트 SessionLivePage(또는 신규 화면)에 1.0 SessionScreen의 참가자 뇌파 모니터링 테이블(자리번호/이름/접촉상태/기기연결/배터리/평균두뇌휴식도/현재두뇌휴식도/데이터업로드현황 + DashboardBox 4종)을 어떻게 재현할지.
2. "클래스 시작"을 참가자가 1명 이상 있을 때만 활성화하는 조건 재현 여부.
3. 게스트 진입에서 "회원가입 입력(성별/실명/생년월일) 반복 제거" — 내담자(client) 로그인 사용자는 기존 정보 활용, 게스트는 이름만. 자리번호(seatNumber)는 웹에서 생략할지.
4. 게스트 명상 화면(두뇌휴식도 + 뇌파 차트)을 웹에서 어떻게 구현할지. EEG 실시간 데이터는 2.0에서 어떤 채널(WebSocket/Web Bluetooth Looxid SDK)로 받는지.
5. 1.0의 "세션코드 알려주기" 안내 문구와 대기→명상→완료 상태 전이를 2.0 세션 상태(ready/scheduled/in_progress/paused/completed)에 어떻게 매핑할지.
6. 클래스 목록(LectureScreen) ↔ 세션 목록(SessionListPage) UI 차이와 "입장" 진입점 정합.
7. 리포트 신청(GuestComplete) 흐름을 포함할지, 2.0 기존 리포트(Report)와 어떻게 연결할지.

## 검토 대상 파일
1.0: src/screens/LectureScreen, SessionScreen, SeatNumberScreen, GuestConsentScreen, GuestSignInScreen, GuestWaitingScreen, GuestMeditationScreen, GuestCompleteScreen, src/reducers/session, src/api/SessionApi.ts
2.0: frontend/src/pages/sessions/SessionListPage/SessionDetailPage/SessionLivePage/SessionCreatePage, frontend/src/pages/class-join-page.tsx, frontend/src/lib/api/session.ts, frontend/src/hooks/(useSocket/useBand/useLiveKit), backend/app/api/v1/session.py, backend/app/schemas/session.py, backend/app/models(session/eeg)

## 산출물 규칙
- 코드 수정 금지, 설계 문서만. 한국어. 코드 근거 인용.
- 무비판 동의 금지. 1.0과 다른 부분·웹 환경 한계 명시.
- 최소 8개 이상 구체 리스크/결정 포인트.
