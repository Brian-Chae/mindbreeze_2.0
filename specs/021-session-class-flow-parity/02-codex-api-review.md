## 수정/생성 파일 목록

### Frontend

1. `frontend/src/pages/sessions/SessionLivePage.tsx` 수정
   - 현재 역할: 녹음 + 마커 + 온라인 화상 회의 중심 라이브 화면이다(`frontend/src/pages/sessions/SessionLivePage.tsx:1`, `frontend/src/pages/sessions/SessionLivePage.tsx:161`).
   - 변경 역할: 1.0 `SessionScreen` 대응 호스트 콘솔로 확장한다. 기존 녹음/마커/LiveKit은 유지하고, 상단에는 클래스 코드 안내, 시작/종료 조건, DashboardBox 4종, 참가자 뇌파 모니터링 테이블을 추가한다.
   - 시작 버튼은 현재 `ready|scheduled`이면 항상 활성화된다(`frontend/src/pages/sessions/SessionLivePage.tsx:115`). `activeParticipants.length > 0` 조건을 반영해야 한다.

2. `frontend/src/pages/sessions/SessionDetailPage.tsx` 수정
   - 현재 상세 화면도 `ready|scheduled`에서 `start` 액션을 바로 노출하고, 시작 성공 시 `/sessions/{id}/live`로 이동한다(`frontend/src/pages/sessions/SessionDetailPage.tsx:25`, `frontend/src/pages/sessions/SessionDetailPage.tsx:87`).
   - 1.0 패리티를 위해 상세 화면의 `시작`도 동일하게 참가자 1명 이상 조건을 적용하거나, `입장` 버튼만 `/live`로 보내고 실제 `클래스 시작`은 `SessionLivePage`에서만 수행하게 정리한다.

3. `frontend/src/pages/sessions/SessionListPage.tsx` 수정
   - 1.0 `LectureScreen`의 클래스 목록/입장 역할에 대응한다.
   - 세션 카드/행에서 `입장`은 상세이 아니라 호스트 콘솔(`/sessions/{id}/live`) 진입점으로 고정하는 것이 1.0에 가깝다. 단, 편집/참여자 관리는 상세로 분리한다.

4. `frontend/src/components/session/SessionMonitorSummary.tsx` 생성
   - 1.0 DashboardBox 4종 대응 컴포넌트.
   - 표시 항목: 참여자 수, 접촉불량 수, 기기연결실패 수, 밴드배터리부족 수.
   - 데이터 소스: 신규 live metrics API/Socket payload.

5. `frontend/src/components/session/SessionMonitorTable.tsx` 생성
   - 1.0 참가자 실시간 모니터링 테이블 대응 컴포넌트.
   - 컬럼: 이름, 접촉상태, 기기연결, 배터리, 평균두뇌휴식도, 현재두뇌휴식도, 데이터업로드현황.
   - `seatNumber`는 기본 컬럼에서 제외하고, 운영자가 켤 수 있는 선택 컬럼으로만 둔다.

6. `frontend/src/components/session/SessionCodeBanner.tsx` 생성
   - 1.0의 “수강생에게 세션코드({code})를 알려주세요” 대응.
   - `Session.access_code`는 이미 6자리 코드로 발급/노출된다(`backend/app/models/session.py:24`, `frontend/src/pages/sessions/SessionDetailPage.tsx:231`).

7. `frontend/src/hooks/useSessionLiveMetrics.ts` 생성
   - 호스트 모니터링용 데이터 훅.
   - 초기 로드: `GET /sessions/{session_id}/live-metrics`.
   - 실시간 갱신: Socket.IO `/session-live` 또는 `/eeg` 네임스페이스 구독.
   - fallback: Socket 미연결 시 2~5초 polling. 현재 게스트 대기 화면은 5초 polling만 수행한다(`frontend/src/pages/class-join-page.tsx:63`).

8. `frontend/src/hooks/useLinkBand.ts` 또는 `frontend/src/hooks/useBand.ts` 생성
   - Web Bluetooth 지원 여부, 연결 상태, 배터리, LeadOff/접촉 상태, 실시간 EEG 샘플을 추상화한다.
   - Safari/Firefox 미지원 안내 UX를 이 훅의 capability 결과로 구동한다.

9. `frontend/src/pages/class-join-page.tsx` 수정 또는 분리
   - 현재 `/join`은 `code -> details -> waiting` 3단계만 있고, `in_progress`가 되어도 안내 문구만 표시한다(`frontend/src/pages/class-join-page.tsx:11`, `frontend/src/pages/class-join-page.tsx:243`).
   - 변경: `code -> details/consent -> waiting -> meditation -> complete`로 확장한다.
   - 단일 파일이 커지므로 `GuestWaitingPanel`, `GuestMeditationPanel`, `GuestCompletePanel` 컴포넌트로 분리한다.

10. `frontend/src/components/class/GuestMeditationPanel.tsx` 생성
    - 1.0 `GuestMeditationScreen` 대응.
    - 진행시간 타이머, 현재 두뇌휴식도 %, 평균 두뇌휴식도, BrainChart, 밴드 연결/LeadOff/배터리 상태를 표시한다.

11. `frontend/src/components/class/BrainRestChart.tsx` 생성
    - Recharts 기반 실시간 라인 차트.
    - 입력: `{ timestampMs, efficiency, rawAlpha?, rawTheta? }[]`.
    - EEG 미착용/미지원이면 차트를 숨기지 말고 “LINK BAND 미연결” 상태로 비워 둔다.

12. `frontend/src/lib/api/session.ts` 수정
    - `SessionParticipant`는 현재 `band_connected`, `linkband_device_id`, `consent_eeg`만 포함한다(`frontend/src/lib/api/session.ts:11`).
    - 신규 타입 추가: `SessionLiveMetric`, `SessionLiveMetricsResponse`, `GuestSessionStateResponse`, `LinkBandTelemetryPayload`.
    - 신규 함수 추가: `getSessionLiveMetrics`, `getGuestSessionState`, `submitLinkBandTelemetry`, `completeGuestSession`, `requestGuestReport`.

13. `backend/app/models/session.py` 수정
    - `SessionParticipant`에 1.0 `SessionLog` 역할을 보강한다.
    - 추가 후보: `seat_number`, `session_log_state`, `device_status`, `band_battery`, `avg_efficiency`, `current_efficiency`, `last_eeg_at`, `upload_status`, `completed_at`.
    - 현재 모델은 해당 live metric 필드가 없다(`backend/app/models/session.py:58`).

14. `backend/app/models/record.py` 수정 또는 `backend/app/models/eeg_live.py` 생성
    - 현재 `EEGRecord`는 세션 종료 후 저장성 레코드에 가깝고, `user_id`가 필수라 익명 게스트와 맞지 않는다(`backend/app/models/record.py:44`).
    - live stream 저장/집계를 위해 `EEGLiveSample` 또는 `SessionParticipantMetricSnapshot`을 별도 테이블/Redis key로 둔다.

15. `backend/app/schemas/session.py` 수정
    - `ParticipantInfo`가 live metric 필드를 갖지 않는다(`backend/app/schemas/session.py:55`).
    - 호스트용 응답과 게스트용 응답을 분리해 민감 데이터 노출을 제한한다.

16. `backend/app/api/v1/session.py` 수정
    - 현재 세션 API는 생성/조회/상태전이/코드참여/LiveKit 토큰만 제공한다(`backend/app/api/v1/session.py:24`, `backend/app/api/v1/session.py:105`, `backend/app/api/v1/session.py:149`).
    - 추가 엔드포인트:
      - `GET /sessions/{session_id}/live-metrics` 호스트 전용
      - `GET /sessions/by-code/{code}/state` 게스트 대기/명상 상태 조회
      - `POST /sessions/{session_id}/participants/{participant_id}/telemetry` 게스트 EEG/밴드 상태 업로드
      - `POST /sessions/{session_id}/participants/{participant_id}/complete` 게스트 완료 처리
      - `POST /sessions/{session_id}/participants/{participant_id}/report-request` 익명/로그인 참가자 리포트 신청

17. `backend/app/services/session_service.py` 수정
    - `transition_status`는 현재 참가자 수 검증 없이 `start`를 허용한다(`backend/app/services/session_service.py:310`).
    - `start` 시 active participant 1명 이상 검증을 서버에서도 강제해야 한다.
    - `join_session_by_code`는 `completed/cancelled`만 차단하고 `in_progress` 참여를 허용한다(`backend/app/services/session_service.py:570`). 수업 중 입장 허용 여부를 명시적으로 결정해야 한다.

18. `backend/app/ws/session_live_namespace.py` 생성
    - 현재 Socket.IO는 `/record`가 녹음 처리 상태만 브로드캐스트한다(`backend/app/ws/record_namespace.py:1`).
    - 1.0의 실시간 SessionLog 폴링/Socket 대응을 위해 `/session-live` 네임스페이스를 추가한다.

19. `backend/app/ws/__init__.py`, `backend/app/main.py` 수정
    - 신규 namespace 등록.
    - 이벤트: `subscribe_session`, `participant_metric`, `session_state_changed`, `participant_completed`.

20. Alembic migration 생성
    - `session_participants` live metric 컬럼 또는 신규 live metric 테이블 추가.
    - 익명 게스트 리포트 신청을 포함할 경우 `session_report_requests` 같은 별도 테이블 필요.

21. 테스트 파일 생성/수정
    - `backend/tests/test_sdd021_session_class_flow.py`
    - `frontend/src/pages/sessions/SessionLivePage.test.tsx`
    - `frontend/src/pages/class-join-page.test.tsx`
    - E2E: `frontend/e2e/session-class-flow-parity.spec.ts`

## 호스트 모니터링 화면 설계

`SessionLivePage`를 신규 라우트로 대체하지 말고, 기존 `/sessions/:id/live` 내부를 1.0 `SessionScreen` 대응 호스트 콘솔로 재구성한다. 이유는 2.0 라이브 화면이 이미 녹음, 마커, LiveKit, 종료 후 기록지 이동을 담당하고 있어(`frontend/src/pages/sessions/SessionLivePage.tsx:85`) 별도 화면을 만들면 “클래스 진행”이 두 갈래로 갈라지기 때문이다.

권장 레이아웃:

1. 상단: 클래스명, 상태, `access_code`, 복사 버튼, “수강생에게 클래스 코드({access_code})를 알려주세요” 안내.
2. 시작 전: 참가자 목록/대기 상태, 클래스 시작 버튼, 시작 불가 사유.
3. 시작 후: DashboardBox 4종.
4. 중앙: 참가자 실시간 모니터링 테이블.
5. 하단/우측: 기존 녹음, 마커, 온라인일 때 LiveKit 영역.

`클래스 시작` 조건:

- Frontend: `session.status in ['ready', 'scheduled'] && activeParticipants.length > 0 && !transitioning`.
- Backend: `transition_status(..., 'start')`에서 active participant 1명 이상을 검증한다.
- 대기열 참가자는 제외한다. 현재 프론트도 `is_waitlisted`로 active/waitlisted를 나눈다(`frontend/src/pages/sessions/SessionDetailPage.tsx:58`).
- `linkband_mode === 'required'`일 때는 참가자 1명 이상에 더해 `consent_eeg === true` 및 band 연결 준비 조건을 별도 차단으로 둘지 결정해야 한다. 1.0은 연결 여부와 sessionLogs 존재를 시작 조건으로 삼았지만, 2.0의 LINK BAND는 선택 사용 원칙이 있으므로 `required`일 때만 엄격 적용한다.

테이블 데이터 계약:

| 1.0 항목 | 2.0 필드 권장 | 출처 |
|---|---|---|
| 이름 | `displayName` | 로그인 사용자 이름 또는 `guest_name` |
| 접촉상태 | `deviceStatus` | Web Bluetooth/Looxid SDK telemetry |
| 기기연결 | `bandConnected` | `SessionParticipant.band_connected` + live heartbeat |
| 배터리 | `bandBattery` | telemetry |
| 평균두뇌휴식도 | `avgEfficiency` | 서버 집계 |
| 현재두뇌휴식도 | `currentEfficiency` | 최근 telemetry |
| 데이터업로드현황 | `uploadStatus`, `lastEegAt` | 서버 수신/저장 상태 |
| 자리번호 | `seatNumber?` | 기본 생략, 운영 설정 시만 |

API 응답 예시:

```ts
interface SessionLiveMetric {
  participantId: string;
  userId: string | null;
  isGuest: boolean;
  displayName: string;
  seatNumber: number | null;
  sessionLogState: 'READY' | 'STARTED' | 'COMPLETED';
  consentEeg: boolean;
  bandConnected: boolean;
  deviceStatus: 'ok' | 'lead_off' | 'disconnected' | 'unsupported' | 'unknown';
  bandBattery: number | null;
  avgEfficiency: number | null;
  currentEfficiency: number | null;
  uploadStatus: 'idle' | 'streaming' | 'delayed' | 'failed' | 'completed';
  lastEegAt: string | null;
}
```

보완 포인트:

1. 서버 검증 없는 프론트 disable은 우회 가능하므로 시작 조건은 백엔드에서 반드시 강제한다.
2. `SessionResponse.participants`에 모든 live metric을 섞으면 일반 상세/목록 API까지 무거워진다. 호스트 전용 `live-metrics` API를 분리한다.
3. 1.0의 `connected`는 Socket 연결 상태로 보이지만, 2.0에서는 Socket 연결과 밴드 연결이 다르다. 버튼 조건 문구도 “서버 연결”과 “밴드 연결”을 분리해야 한다.
4. `SessionDetailPage`와 `SessionLivePage` 양쪽에 시작 버튼이 있으면 조건 불일치가 발생한다. 실제 시작은 `SessionLivePage`로 단일화하는 편이 낫다.
5. 익명 게스트는 `user_id`가 없어 현재 `EEGRecord.user_id` 필수 구조에 저장할 수 없다. 참가자 PK 기반 저장 경로가 필요하다.
6. `participant_count`는 현재 대기열 포함 여부가 모호하다(`backend/app/services/session_service.py:551`). 시작 조건은 active participant만 사용해야 한다.
7. 실시간 metric은 DB write-through만으로 처리하면 250Hz EEG에 부적합하다. Redis/window aggregation 후 요약 저장을 기본으로 둔다.
8. 1.0의 자리번호 수정 모달은 웹 MVP에서는 제외하되, 운영 현장에서 태블릿/밴드 박스 매칭이 필요하면 `seatNumber`를 nullable로 선반영한다.
9. 온라인 LiveKit 연결과 오프라인 LINK BAND 모니터링은 독립 기능이다. `location_type='offline'`이어도 모니터링 화면은 동작해야 한다.
10. “클래스 종료”는 게스트 화면을 `complete`로 보내는 broadcast를 동반해야 한다. 현재 종료는 호스트 화면에서 기록지로 이동만 한다(`frontend/src/pages/sessions/SessionLivePage.tsx:94`).

## 게스트 명상 화면 설계

현재 `/join`은 클래스 코드 확인과 참여 등록까지만 수행하고, 시작 후 자동 전환이 없다. `in_progress`가 감지되어도 “호스트가 클래스를 시작했습니다.” 문구만 표시된다(`frontend/src/pages/class-join-page.tsx:243`). 1.0 `GuestWaitingScreen -> GuestMeditationScreen -> GuestCompleteScreen`을 재현하려면 `/join` 안에 게스트 상태 머신을 추가해야 한다.

권장 상태:

```ts
type JoinStep = 'code' | 'details' | 'consent' | 'waiting' | 'meditation' | 'complete';
```

흐름:

1. `code`: 기존 6자리 코드 입력 유지.
2. `details`: 로그인 사용자는 기존 계정 정보 사용, 게스트는 이름만 입력. 성별/실명/생년월일은 회원가입/온보딩에서 이미 받은 값이므로 반복 입력하지 않는다.
3. `consent`: LINK BAND 사용이 `optional|required`인 경우 EEG 동의와 Web Bluetooth 지원 안내를 표시한다. `none`이면 건너뛴다.
4. `waiting`: 클래스 코드와 클래스명을 표시하고, 호스트 시작을 polling/Socket으로 감지한다.
5. `meditation`: 타이머, 현재 두뇌휴식도, 평균 두뇌휴식도, BrainChart, 밴드 연결/접촉/배터리를 표시한다.
6. `complete`: 종료 안내, 로그인 사용자는 내담자 리포트로 연결, 게스트는 선택적으로 전화번호 기반 리포트 신청.

EEG 데이터 채널:

- 브라우저에서 직접 LINK BAND를 연결하는 경우: `useLinkBand`가 Web Bluetooth로 샘플/배터리/LeadOff를 받고, 1초 단위로 `POST telemetry` 또는 Socket `participant_metric`에 업로드한다.
- 서버/PC 브릿지로 수집하는 경우: 게스트 웹은 수신 전용이고, 브릿지가 `participant_id` 기준으로 서버에 업로드한다. 이 방식이면 Safari/Firefox 제약이 완화되지만 브릿지 앱/장비 매핑 계약이 추가된다.
- 2.0 웹 MVP 권장: Web Bluetooth 직접 연결을 1차로 설계하되, `linkband_mode='optional'`이면 미연결 상태에서도 명상 화면 진입을 허용한다.

게스트 API 계약:

- `GET /sessions/by-code/{code}`: 기존 참여 전 확인 유지.
- `POST /sessions/by-code/{code}/join`: 기존 참여 등록 유지. 응답의 `participant_id`를 localStorage/sessionStorage에 저장한다.
- `GET /sessions/by-code/{code}/state?participant_id=...`: 게스트가 자기 상태와 세션 상태를 인증 없이 확인한다. 응답은 민감한 참가자 목록을 포함하지 않는다.
- `POST /sessions/{session_id}/participants/{participant_id}/telemetry`: 밴드 상태/효율 업로드.
- `POST /sessions/{session_id}/participants/{participant_id}/complete`: 참가자 완료 상태 전이.
- `POST /sessions/{session_id}/participants/{participant_id}/report-request`: 전화번호 기반 리포트 신청. 익명 게스트만 사용한다.

보완 포인트:

1. `participant_id`는 현재 응답에 있으나 프론트가 저장하지 않는다(`frontend/src/lib/api/session.ts:106`, `frontend/src/pages/class-join-page.tsx:125`). waiting 이후 자기 상태 식별을 위해 반드시 저장해야 한다.
2. 게스트 인증 없는 API는 `participant_id`만으로 충분하지 않다. 최소한 join 시 `participant_token`을 발급해 state/telemetry/complete 요청에 사용해야 한다.
3. 로그인 사용자는 `joinSessionByCode(code, {})`로 참여 가능하지만 현재 이름/프로필 정보가 응답에 포함되지 않는다. 게스트 화면 표시명은 세션 응답 또는 auth store에서 확정해야 한다.
4. `in_progress` 중 뒤늦게 참여하는 사용자를 허용할지 정해야 한다. 1.0은 코드 검증 후 참여가 가능했지만, 명상 클래스는 중도 입장 정책이 필요하다.
5. Web Bluetooth는 사용자 gesture 없이 자동 연결할 수 없다. waiting에서 시작 감지 후 자동으로 밴드 연결을 시도하는 UI는 브라우저 정책에 막힐 수 있으므로 consent 단계에서 미리 연결해야 한다.
6. EEG 미동의/미착용 사용자는 BrainChart를 0으로 채우면 안 된다. `null` 상태로 표현해 리포트 계산에서 제외해야 한다.
7. `linkband_mode='required'` 클래스에서는 미지원 브라우저 사용자를 `details` 이후 차단하거나 “다른 기기 사용” 안내를 제공해야 한다.
8. 전화번호 리포트 신청은 개인정보 수집 목적/보관 기간/동의가 필요하다. 기존 리포트 API는 인증 사용자 중심이다(`backend/app/api/v1/reports.py:20`).

## 생략 항목 판단

### 생략한다

1. 성별 입력
   - 이유: 2.0은 회원가입/온보딩을 이미 갖고 있고, Brian 요구가 “회원 가입하면서 했던 일 반복 입력 제거”다.
   - 게스트 익명 참여에서도 명상 수업 진입 목적에는 필수값이 아니다.

2. 실명 입력
   - 로그인 사용자는 계정 이름 사용.
   - 비로그인 게스트는 표시 이름만 받는다. 현재 `/join`도 이 구조다(`frontend/src/pages/class-join-page.tsx:197`).

3. 생년월일 입력
   - 세션 입장 필수 조건에서 제외한다.
   - 리포트/임상 분석에 필요하면 사후 프로필 보완 또는 상담사 관리 화면에서 처리한다.

4. 자리번호 필수 입력
   - 웹 2.0 기본 흐름에서는 생략한다.
   - 이유: 모바일/태블릿의 물리 좌석-밴드 박스 매칭을 그대로 강제하면 원격/개인 기기 웹 UX와 맞지 않는다.
   - 단, 그룹 오프라인 명상 수업에서 운영자가 장비를 배정하는 경우를 위해 nullable `seatNumber`는 모델/API에 남긴다.

5. 자리번호/이름 롱프레스 수정 모달
   - 웹에서는 롱프레스 대신 참가자 행 메뉴 또는 상세 패널로 대체한다.
   - SDD-021 MVP 범위에서는 구현 필수에서 제외하고 Phase 2로 둔다.

### 유지한다

1. 세션코드 표시
   - 호스트 live 화면과 게스트 waiting 화면에 모두 크게 표시한다.
   - 2.0에는 이미 `access_code`가 있고, 생성/상세/카드에서 사용 중이다(`frontend/src/lib/api/session.ts:33`).

2. 클래스 시작 조건
   - 참가자 1명 이상일 때만 활성화한다.
   - 서버에서도 같은 조건을 강제한다.

3. 대기 -> 명상 -> 완료 상태 전이
   - 세션 상태 `ready|scheduled -> in_progress -> completed`에 매핑한다.
   - 참가자별 상태는 별도 `sessionLogState: READY|STARTED|COMPLETED`로 둔다. 세션 전체 `paused`는 게스트 명상 화면에서 일시정지 오버레이로 처리한다.

4. LINK BAND 선택 사용 원칙
   - `none`: EEG UI 숨김 또는 비활성.
   - `optional`: EEG 미연결이어도 참여/시작/완료 가능.
   - `required`: 참여 전 동의와 연결 준비가 필요하며, 시작 조건에도 반영 가능.

5. 리포트 신청
   - 로그인 내담자: 기존 `Report` 흐름과 연결.
   - 익명 게스트: 기존 `Report.user_id` 필수 구조와 맞지 않으므로 바로 생성하지 말고 `report-request`로 신청만 저장한다.

## 최종 권고안

1. 호스트 화면은 신규 화면을 만들지 말고 `SessionLivePage`를 재구성한다.
   - 기존 녹음/마커/LiveKit은 2.0 고유 기능이므로 유지한다.
   - 1.0 `SessionScreen` 요소는 같은 화면 상단/중앙에 추가한다.
   - 별도 신규 라우트는 운영자가 어디에서 시작/종료해야 하는지 혼선을 만든다.

2. 게스트 화면은 `/join` 라우트는 유지하되 내부 컴포넌트를 분리한다.
   - 공개 진입 URL은 단순해야 하므로 `/join`을 유지한다.
   - 내부 구현은 `GuestWaitingPanel`, `GuestMeditationPanel`, `GuestCompletePanel`로 분리해 1.0 화면 단계를 재현한다.

3. `seatNumber`는 기본 생략, nullable 지원으로 결정한다.
   - 게스트에게 필수 입력시키지 않는다.
   - 운영자 장비 배정/오프라인 그룹 수업을 위해 API와 테이블 선택 컬럼에는 남긴다.

4. `access_code`는 세션코드로 확정한다.
   - 명칭만 UI에서 “클래스 코드”로 통일한다.
   - 호스트 live 화면에 “수강생에게 클래스 코드({access_code})를 알려주세요”를 추가한다.

5. `클래스 시작`은 active participant 1명 이상일 때만 허용한다.
   - 프론트 disable + 서버 검증을 모두 구현한다.
   - 현재 백엔드 전이는 참가자 수 조건이 없어 반드시 수정 대상이다(`backend/app/services/session_service.py:310`).

6. 1.0 `SessionLog`를 2.0에서는 `SessionParticipant + live metric` 조합으로 재현한다.
   - 영속 식별/참여 상태: `SessionParticipant`.
   - 실시간 metric: Redis/Socket payload.
   - 종료 후 분석: `EEGRecord` 또는 별도 participant-based EEG summary.

7. EEG raw 250Hz를 일반 REST로 매 샘플 저장하지 않는다.
   - 클라이언트/브릿지에서 window aggregation 후 전송한다.
   - 호스트 테이블은 1초 단위 최신값이면 충분하다.

8. 익명 게스트 보안 토큰을 추가한다.
   - 현재 join 응답의 `participant_id`만으로는 공개 API 보호가 약하다.
   - `participant_token`을 발급하고 state/telemetry/complete/report-request에 요구한다.

9. 리포트 신청은 SDD-021의 필수 UX로는 포함하되, 실제 `Report` 생성과 분리한다.
   - 로그인 사용자는 기존 리포트로 연결한다.
   - 게스트 전화번호는 별도 신청 테이블에 저장하고 상담사 승인/발송 단계에서 처리한다.

10. 구현 순서는 API 계약과 서버 검증을 먼저 둔다.
    - 먼저 `SessionLiveMetric` 스키마, live metrics API, start 조건 서버 검증을 만든다.
    - 그 다음 호스트 테이블/대시보드와 게스트 상태 전이를 붙인다.
    - 마지막으로 Web Bluetooth 실측/차트/리포트 신청을 연결한다.

11. 최소 테스트 게이트
    - Backend: 시작 조건(참가자 0명 거부, active 1명 허용, waitlisted 제외), 코드 참여, 게스트 state, telemetry 권한, 종료 broadcast/상태.
    - Frontend unit: `SessionLivePage` 시작 버튼 disable, 코드 배너, metric table fallback, `/join` waiting -> meditation 전환.
    - E2E: 호스트가 코드 공유, 게스트가 이름만 입력해 참여, 호스트가 시작, 게스트가 명상 화면으로 전환, 호스트 테이블에 참가자 표시, 종료 후 complete 표시.
