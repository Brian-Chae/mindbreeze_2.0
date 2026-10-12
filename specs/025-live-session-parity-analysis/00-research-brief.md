# MindBreeze 1.0 라이브 세션 처리 분석 → 2.0 개선 기획 브리프

## 목적
mind-breeze-app(지도사/참여자 서비스) + mind-breeze-api(실시간/저장)의 라이브 세션 처리를 분석해, 현재 구현 중인 MB 2.0(SDD-021~024)과 비교하고 더 완벽한 서비스가 되기 위한 개선 기획을 도출한다.

## A. 1.0 라이브 세션 처리 (코드 근거)

### 실시간 채널 — socket.gateway.ts (NestJS Socket.IO)
- `joinRoom`(참여자) → room join + `join-room-user` emit (지도사에게 참석 알림)
- `joinRoomForOperator`(지도사) → room join
- `start`(지도사, OPERATOR 역할) → sessionLog STARTED 전이 + `start-meditation` broadcast (참여자 화면 전환)
- `finish`(지도사) → sessionLog COMPLETED + `finish-meditation` broadcast + 모든 소켓 room 퇴장
- **역할 가드**: `@Roles(Role.OPERATOR)` — start/finish는 지도사만

### 데이터 모델 (MongoDB)
- `Session`: lectureId, name, description (수업 기본)
- `SessionLog`(참여자별): userId, sessionId, seatNumber, sessionLogState(READY/STARTED/COMPLETED), efficiencies[], efficiencies60[], avgEfficiency, deviceStatus(CLEAR/CONNECTION_FAILURE/SENSOR_FAILURE/UNKNOWN), bandBattery, birthday, startedAt/completedAt, playGroupId, feedback, reportStatus(PENDING_ANALYSIS/PENDING_REVIEW/COMPLETED/ERROR), s3Url, s3FileCount
- `SessionReport`(참여자별): user_id, session_log_id, stress/attention/emotion 각 label+score+rates[]+graph_data[], total_meditation_score, data_credibility

### 데이터 제공 방식 — SessionApi.ts
- 코드 기반 접근: getSession(code), postSessionLog({code,seatNumber}), getSessionLog(code), getCheckCode(code), getSessionLogs({code})(지도사 전체)
- updateSessionLog: PATCH 시 빈 속성이면 요청 스킵 (불필요 네트워크 방지)
- S3: postSessionLogToS3(sessionLogId) → presigned URL → putObject
- 재시도: postSessionLogRetry

### 지도사 UI — SessionScreen
- 세션코드 배너 + 참가자 모니터링 테이블(자리/이름/접촉/기기/배터리/평균·현재두뇌휴식도/업로드현황)
- DashboardBox 4종: 참여자/접촉불량/기기연결실패/밴드배터리부족
- "클래스 시작" disabled = !connected || sessionLogs.length===0
- 1초 폴링(OPERATOR_INTERVAL_TIME) + socket joinRoom 실시간 병행
- 참가자 행 롱프레스 → 자리번호/이름 수정 (patchSessionLogUser)

### 참여자 UI — GuestMeditationScreen
- useBand → chartData(효율%) → patchSessionLog(실시간 PATCH)
- leadOff(접촉불량) → isAnalyzingRef 토글 → "AI 분석중" 표시
- 두뇌휴식도 큰 숫자(Text130B) + BrainChart + Timer
- 화면 끄기/켜기(절전), 종료 시 uploadRemainingRecord + release
- useSessionLogUploader → 1초마다 효율 PATCH

### 핵심 훅
- useSocket: func.current.OPERATOR(init/startSession/finishSession/release) vs func.current.GUEST(init/release) — **역할별 소켓 API 분리**
- useBand / useBandConnectionState / useSessionLogUploader

## B. 잘 구현된 부분 (2.0에 반영 가치)

1. **playGroupId** — 세션 시작 시 그룹 ID 발급, 재시작 시 기존 유지 (이어하기). 2.0 없음.
2. **재연결 복구** — AsyncStorage에 code 저장, loadSessionLog로 복구. 소켓 끊김 중 종료 시 COMPLETED 처리.
3. **DeviceStatus 4종** — CLEAR/CONNECTION_FAILURE/SENSOR_FAILURE/UNKNOWN (접촉불량 vs 기기연결실패 구분).
4. **접촉불량 LeadOff UX** — 밴드 미착용/접촉불량 시 "AI 분석중" + LeadOffModal 안내.
5. **효율 2해상도** — efficiencies[](실시간) + efficiencies60[](60초 집계) + avgEfficiency.
6. **지도사 모니터링 세분화** — DashboardBox 4종(참여자/접촉불량/연결실패/배터리부족) + 60초 무응답 행 강조.
7. **리포트 파이프라인 상태** — ReportStatus(PENDING_ANALYSIS→PENDING_REVIEW→COMPLETED/ERROR) + 오류 코멘트.
8. **raw S3 보존** — s3Url + s3FileCount (raw EEG 재분석 자산).
9. **updateSessionLog 빈 값 스킵** — 불필요 PATCH 방지.

## C. 2.0 현재 구현과 비교

| 항목 | 1.0 | 2.0 현재 |
|------|-----|----------|
| 실시간 채널 | Socket.IO start/finish/joinRoom | SDD-024 /session-live WS ✅ |
| 참여자 기록 | SessionLog(참여자별) | Participant + EEGFeatureWindow |
| 지도사 모니터링 | 1초 폴링 + socket | WS 실시간 ✅ |
| 상태 전이 | READY→STARTED→COMPLETED | session status |
| playGroupId | ✅ | ❌ 없음 |
| 재연결 복구 | ✅ AsyncStorage | ❌ 미구현 |
| DeviceStatus 세분화 | ✅ 4종 | quality 파생(valid/degraded)만 |
| 접촉불량 UX | ✅ LeadOff+AI분석중 | ❌ 미구현 |
| 효율 2해상도 | ✅ | 1초 시계열만 |
| raw S3 | ✅ presigned | ❌ 후속 |
| 리포트 파이프라인 | ✅ ReportStatus 4단계 | AI 요약+승인 게이트 |

## D. 개선 기획 (리뷰 에이전트가 도출할 것)

각 에이전트는 위 비교를 기반으로 2.0에 반영할 개선 사항을 구체화하라. 특히:
- playGroupId(그룹 재생/이어하기)를 2.0 세션 모델에 어떻게 넣을지
- 재연결 복구(웹: localStorage/sessionStorage로 code 저장 + 복구) 설계
- DeviceStatus 세분화(접촉불량/연결실패)를 2.0 quality 체계와 결합
- 접촉불량 LeadOff UX를 웹(호스트/게스트)으로 이식
- 효율 2해상도 + raw S3 업로드를 2.0 EEG 파이프라인에 통합

## 검토 대상 파일
- 1.0: mind-breeze-api/src/socket/socket.gateway.ts, session/{session,session-log,session-report}.schema.ts, session.service.ts, mind-breeze-app/src/api/SessionApi.ts, reducers/{session,socket}/index.ts, screens/{SessionScreen,GuestMeditationScreen}/index.tsx, hooks/useSocket.ts
- 2.0: backend/app/ws/session_live_namespace.py, backend/app/models/{eeg_feature,session,record}.py, backend/app/services/session_service.py, frontend/src/hooks/{useBand,useSessionLiveSocket}.ts, frontend/src/pages/sessions/SessionLivePage.tsx

## 규칙
- 코드 수정 금지, 기획 문서만. 한국어. 코드 근거 인용.
- 무비판 동의 금지. 1.0의 단점(폴링 의존, MongoDB, 효율 단일지표)도 지적.
- 2.0 개선안을 우선순위(P0/P1/P2)로 제시.
