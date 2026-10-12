## 1.0↔2.0 실시간 경로 정합 비교

검토일: 2026-09-07. `00-research-brief.md`를 출발점으로 현재 로컬 소스를 대조했다. 아래 경로에서 `1API/`는 형제 저장소 `../mind-breeze-api/`, `1APP/`는 `../mind-breeze-app/`, 그 외는 mindbreeze_2.0 루트 기준이다. `파일:행`은 이번 검토 시점의 근거다. 정적 코드 리뷰이며 실기기·서버 통합 실행 결과는 아니다. 제안한 이벤트·필드는 현행 구현과 구분해 표기한다.

**결론: 2.0은 EEG 전송을 WS 중심으로 개선했지만, 세션 제어·복구·모니터링까지 1.0과 정합하다고 볼 수 없다.** 특히 저장 확인 없는 전송, 재연결 시 버퍼 폐기, room 접근 검증 부재를 운영 전 P0로 해결해야 한다.

| 경로 | 1.0 실제 동작 | 2.0 실제 동작 | 정합 판정 |
|---|---|---|---|
| 접속·입장 | `/socket`, `joinRoom` → room 입장 + `join-room-user`; 지도사는 `joinRoomForOperator` | `/socket.io`, `/session-live`, `join` → `session:{id}` + 본인에게 `joined` | 전송 경로와 이벤트 계약이 다름. 2.0에는 참여자 변경 알림·입장 스냅샷이 없음 |
| 시작·종료 | OPERATOR의 `start`/`finish` → 참여자 로그 일괄 전이 → `start-meditation`/`finish-meditation`; 종료 후 room 전체 퇴장 | 호스트 REST 상태 전이 → DB commit. 해당 경로의 WS 상태 broadcast 없음 | EEG WS가 시작·종료 이벤트를 대체하지 않음 |
| 상태 모델 | 참여자별 READY→STARTED→COMPLETED, 시작 시각·playGroupId 복제 | Session의 ready/scheduled→in_progress↔paused→completed, cancelled. 참여자 로그 상태는 세션에서 파생 | 정규화는 개선. pause와 completed/cancelled를 UI에서도 구분해야 함 |
| EEG 데이터 | 참여자 효율·상태 PATCH → MongoDB → 지도사 주기 조회 | BLE→StreamProcessor→AnalysisMetricsService→useBand→1초 `feature`→EEGFeatureWindow→`eeg_feature`; 단절 시 5초 REST 배치 | 2.0 다중 feature 실시간화는 개선. WS와 REST의 전달·상태·평균 계약은 불일치 |
| 지도사 데이터 | 1초 폴링과 참석 이벤트 병행 | live-metrics는 WS 단절 시 4초, 세션 상세는 상시 5초 폴링 | 폴링 제거가 아니라 일부 축소. EEG 없는 신규 참여자의 metrics 행 갱신 공백 가능 |
| 참여자 화면 전이 | 소켓 이벤트 및 재접속 시 loadSessionLog | class-join-page에서 대기·명상 중 3초 상태 조회 | 2.0도 상태 전이에 폴링 의존 |
| 재접속 | AsyncStorage code→서버 로그 재조회; 단절 중 종료 보정 | Socket.IO 자동 재연결·room 재가입. sessionStorage 저장 함수는 있으나 같은 페이지에서 읽어 초기 상태 복구하는 경로 없음 | “전혀 없음”이 아니라 연결 복구만 부분 구현. 신원·상태·측정 연속성 복구 미완 |
| raw 보존 | raw를 로컬 JSON으로 저장→재시도 presigned URL→PUT→성공 시 로컬 삭제 | EEGRecord.s3_key 모델 존재. 현재 useBand 라이브 경로는 feature만 전송 | S3 개념 부재가 아니라 라이브 raw 보존 경로 미연결 |

근거: `1API/src/socket/socket.gateway.ts:23-127`, `1APP/src/api/SessionApi.ts:11-92`, `1APP/src/reducers/session/index.ts:21-50,135-154`, `1APP/src/screens/SessionScreen/index.tsx:132-145`, `backend/app/ws/session_live_namespace.py:38-114`, `backend/app/services/session_service.py:23-28,312-346,624-634`, `frontend/src/lib/socket.ts:75-129`, `frontend/src/hooks/useSessionLiveSocket.ts:59-76`, `frontend/src/pages/sessions/SessionLivePage.tsx:34-35,219-237`, `frontend/src/pages/class-join-page.tsx:62-89,95-196`.

### 브리프에서 수정해야 할 전제

- **DeviceStatus·LeadOff는 부분 구현됨.** `DeviceStatus`에 ok/lead_off/disconnected/unsupported/unknown이 있고 게스트 화면에 접촉 정상/불량 표시도 있다. 다만 하드웨어 접촉 상태를 전달하는 일관된 계약과 안내·분석 중단 UX가 부족하다. (`frontend/src/lib/api/session.ts:113`, `frontend/src/hooks/useBand.ts:122-129`, `frontend/src/components/class/GuestMeditationPanel.tsx:154-176`)
- **평균값은 이미 존재한다.** REST에서 relaxation_index 평균을 계산하지만 60초 버킷은 없다. WS 행 갱신은 평균을 갱신하지 않아 WS가 정상인 동안 초기 평균이 남는다. (`backend/app/services/session_service.py:808-842`, `frontend/src/pages/sessions/SessionLivePage.tsx:66-94,228-237`)
- **1.0의 60초 집계는 이름만으로 확정할 수 없다.** `efficiencies60` 배열과 chunk 입력 누적은 확인했지만 검토한 app/api 경로에서 60초 평균 산식·유효 샘플 처리·시간 경계 생성은 확인하지 못했다. 2.0 요구사항으로는 유효하나 “검증된 1.0 60초 집계”로 이식해서는 안 된다. (`1API/src/session/session-log.schema.ts:78-88`, `1API/src/session/session.service.ts:410-413`)
- **1.0 raw는 현재 useBand에서 직접 PUT하지 않는다.** 직접 S3 호출은 주석이며 로컬 파일 저장 후 `useFileController`가 재시도 API를 사용한다. 이 영속 대기열의 복구 가치를 참고해야 한다. (`1APP/src/hooks/useBand.ts:202-225`, `1APP/src/hooks/useFileController.ts:41-58`, `1APP/src/api/SessionApi.ts:39-52`)

## 누락 기능 우선순위 판정

P0는 라이브 운영 전 필요한 접근 제어·유실 방지·상태 정합, P1은 신뢰 가능한 장기 관찰·재분석을 위한 다음 구현, P2는 반복 운영·규모 확장이다. 밴드 미사용 참여자는 장애로 취급하지 않고 기본 상담·명상 흐름을 계속 제공한다.

| 항목 | 판정 | 최소 구현 세트 |
|---|---|---|
| playGroupId/이어하기 | **P0: 측정 식별·offset 복구**, **P2: 별도 반복 회차 모델** | 단일 실행은 기존 session_id와 최초 started_at 사용. 새로고침 후 마지막 확정 sequence 다음부터 전송. 같은 세션의 재접속을 새 회차로 만들지 않음. 반복 수업이 필요할 때만 SessionRun/run_id 도입 |
| 재연결 복구 | **P0** | 유효한 참여 증명으로 신원 복구→서버 상태·참여자 snapshot→미확정 feature 재전송→확정 cursor 갱신. 단절 중 종료/취소도 복원 |
| DeviceStatus | **P0** | BLE 연결·접촉·브라우저 지원·참여 의사·서버 수신 신선도를 별도 축으로 저장/전달. EEG 발생과 독립적인 device_status 이벤트, 배터리, heartbeat 및 timeout |
| LeadOff | **P0** | 실제 채널 접촉 정보와 SQI를 분리. 접촉 불량 안내, 불량 구간의 현재 점수 표시 중단, 품질 플래그·집계 제외, 정상 복귀 후 재개 |
| 효율 2해상도 | **P0: 현재/평균 정합**, **P1: 1초/60초 API** | WS/REST 동일 품질 정책과 평균. 60초 버킷은 서버에서 1초 원천으로 생성하며 valid_count·coverage·시간 범위 제공 |
| raw S3 | **P1**, raw 보존 약속이 있는 수집 배포에는 **출시 전 필수** | 동의한 참여자의 raw chunk 영속 큐→presigned PUT→checksum 확인→manifest 확정. guest participant_id 지원, 재전송·종료 drain·보관/삭제 정책 |

### P0를 결정하는 구체적 결함

**1. room 구독과 업로드 신원 검증이 불충분하다.** connect는 잘못된 토큰도 예외를 무시하고 연결을 허용하며 join은 session_id만 있으면 입장한다. EEG를 같은 room의 모든 게스트에게도 broadcast한다. 업로드는 명시 participant_id가 있으면 현재 사용자와의 소유 관계보다 우선하며, 참여자 행 존재만 확인한다. 따라서 세션/참여자 식별자를 아는 비인가 클라이언트의 구독·대리 업로드를 막는 코드가 이 경로에 없다. 1.0에는 JWT/role guard가 있지만 그것만으로 세션별 소유권 검증까지 안전하다고 단정할 수 없다.

최소안: 호스트 JWT 또는 서버 발급 참여 credential을 session/participant/role에 바인딩하고 join·feature·REST 모두 검증한다. 호스트는 허용된 참여자 metrics, 게스트는 자신의 EEG만 수신하도록 구독 범위를 나눈다. 대기열·EEG 비동의 참여자의 업로드도 차단한다. 근거: `backend/app/ws/session_live_namespace.py:38-68,94-114,151-154`, `backend/app/services/session_service.py:846-879`, `1API/src/socket/socket.gateway.ts:27,76-77,106-107`.

**2. 재접속 시 미전송 데이터가 실제로 버려질 수 있다.** useBand는 WS emit 성공을 저장 성공처럼 취급하고 버퍼에서 제외한다. `emitSessionLiveFeature`의 true는 단순 emit 완료다. 서버는 저장 실패를 로그만 남기고 반환한다. 단절 중 쌓인 REST 버퍼는 재연결 onConnect에서 무조건 빈 배열이 된다. 또한 훅 재생성 시 offset이 0부터 다시 시작해 기존 UNIQUE(session_id, participant_id, window_index)와 충돌하며 새 데이터가 중복으로 skip될 수 있다.

최소안: 모든 전송을 미확정 큐에 먼저 보관하고 서버 commit 이후 ACK 또는 이미 저장된 동일 항목 ACK를 받아 삭제한다. ACK는 stream/sequence와 payload 일치 여부를 식별해야 한다. 재연결에서는 삭제 대신 재전송하고 offset을 복구한다. 종료는 새 수집을 멈춘 뒤 기존 큐를 drain하되 종료 이전 수집분의 지연 업로드 허용 범위를 서버가 검증한다. `saved=0`일 때 입력 payload를 최신 데이터처럼 broadcast하지 말고 실제 저장값과 정합하게 처리한다. 근거: `frontend/src/hooks/useBand.ts:165,188-235,282-305,419-426`, `frontend/src/lib/socket.ts:123-129`, `backend/app/ws/session_live_namespace.py:98-114,135-137`, `backend/app/services/session_service.py:895-916`, `backend/app/models/eeg_feature.py:22-25`.

**3. 같은 신호가 WS와 REST에서 다르게 보인다.** SQI 0.5는 프런트에서 50으로 환산되어 ok이지만 서버에서는 degraded→lead_off다. null SQI는 서버에서 valid로 판정한다. 배터리와 device_status를 프런트가 보내도 namespace는 feature만 저장·반환한다. REST 배터리도 None이다. 연결 해제는 로컬 상태만 바꾸고 서버 band_connected는 저장 시 True로만 갱신된다.

최소안: SQI 저하는 signal quality로 표현하고 접촉불량으로 단정하지 않는다. unknown을 valid로 승격하지 않는다. 별도 상태 이벤트와 마지막 수신 시각으로 BLE 단절/전송 중단/미사용을 구분한다. 불량·미수신 구간은 마지막 점수를 현재 점수로 유지하지 않고 측정 불가와 마지막 측정 시각을 표시한다. 근거: `frontend/src/hooks/useBand.ts:122-129,224-229,381-385`, `frontend/src/pages/sessions/SessionLivePage.tsx:40-43,66-78`, `backend/app/ws/session_live_namespace.py:90-114`, `backend/app/services/session_service.py:695-699,786-805,945-947`.

**4. 제어 이벤트·snapshot 없이 metrics 폴링만 중단했다.** 시작·종료는 REST/폴링, EEG는 WS로 나뉜다. 새 참여자가 EEG를 보내지 않으면 WS metrics 갱신이 없고, WS feature에서는 참가자 이름을 알 수 없어 임시 이름 행을 만든다. 평균도 갱신되지 않는다.

최소안: 제안 이벤트 `session_state_changed`, `participant_changed`, `device_status_changed`와 join snapshot을 추가한다. snapshot에는 status/version, started_at/ended_at, 허용된 participant 목록·현재 상태·집계를 포함한다. commit 이후 이벤트를 발행하고 클라이언트는 version으로 중복·역순을 처리한다. snapshot 적용 전에는 연결 완료만으로 폴백을 끄지 않는다. 근거: `frontend/src/pages/sessions/SessionLivePage.tsx:82-94,195-237`, `frontend/src/hooks/useSessionLiveSocket.ts:59-63`, `backend/app/services/session_service.py:330-346`.

## 1.0 잘못된 설계 회피

### 폴링 의존: 일부 회피했지만 아직 미완료

1.0은 이벤트가 있어도 지표 조회를 매초 반복한다. 2.0은 지표를 push하고 단절 때만 live-metrics 폴링을 하는 방향은 옳다. 그러나 상태 폴링은 남아 있고, REST fallback ingestion은 WS 구독자에게 broadcast하지 않는다(`backend/app/services/session_service.py:953-973`). 송신자의 WS만 끊긴 경우 REST 저장은 성공해도 WS에 연결된 호스트에게 새 값이 안 보일 수 있다.

**권고:** 제어·참여자·기기·EEG 모두 공통 서버 상태를 원천으로 하고 REST/WS ingestion은 같은 commit 후 발행 경로를 사용한다. 폴링은 단절 및 상태 version gap 복구 수단으로 유지한다. P0는 재접속 snapshot과 유실 없는 큐, P1은 커밋 후 발행 실패까지 복구하는 outbox 및 낮은 빈도의 일관성 점검이다. Socket.IO transport의 polling fallback과 애플리케이션 데이터 조회 폴링은 별개다.

### 효율 단일지표: 데이터 모델은 개선, 라이브 표시·집계는 추가 정합 필요

1.0 라이브는 efficiency/avgEfficiency 중심이지만 별도 SessionReport까지 단일지표라고 일반화하면 안 된다. 2.0은 focus/relaxation/stress 및 추가 feature·band powers·quality를 독립 보존한다(`backend/app/models/eeg_feature.py:42-68`, `frontend/src/hooks/useBand.ts:95-118`). 다만 currentEfficiency는 relaxation_index 별칭이므로 1.0 효율과 수치적으로 동등하다고 볼 근거는 없다. 이름을 “이완 지표”로 명확히 하고 알고리즘·단위·버전을 함께 관리한다.

**권고:** 1초 원천을 기준으로 60초 집계와 세션 전체 집계를 생성한다. null/불량 구간을 0으로 치환하지 않고 지표별 valid_count와 coverage를 제공한다. 전체 평균은 버킷 평균의 단순 평균이 아니라 유효 샘플 수로 가중한다. 현재 REST 평균은 null만 제외하고 invalid 품질을 제외하지 않으므로 P0에서 품질 정책을 통일한다(`backend/app/services/session_service.py:834-836`). 채널 접촉불량을 “AI 분석중”이라고만 표시하는 1.0 표현도 그대로 복제하지 말고 원인과 착용 안내를 보여준다.

### MongoDB 비정규화: DB 종류보다 중복 저장·무한 배열이 문제

1.0은 참여자 SessionLog에 상태·startedAt·playGroupId를 복제하고 효율 배열을 계속 늘리며 PATCH 때 배열 결합과 평균 재계산을 한다. 일부 문서만 수정되거나 병렬 갱신할 때 실행 단위 정합 관리가 어렵다(`1API/src/socket/socket.gateway.ts:79-94`, `1API/src/session/session.service.ts:339-340`, `1API/src/session/session-log.schema.ts:78-147`). MongoDB 자체를 잘못된 설계로 규정할 근거는 없다.

2.0은 Session/SessionParticipant/EEGFeatureWindow로 분리하고 FK·UNIQUE로 관계와 중복을 통제했다. 다만 PostgreSQL 전환만으로 성능이 해결된 것은 아니다. 업로드마다 기존 window_index 전체를 읽고, live-metrics마다 원천 전체를 읽어 Python에서 평균을 낸다(`backend/app/services/session_service.py:817-836,895-904`).

**권고:** Session을 상태의 단일 원천으로 유지하고 원천 1초 feature·60초 파생 집계·raw manifest를 분리한다. P1에서 해당 batch key만 조회/upsert하고 최신값·집계 조회를 제한한다. P2에서 실제 세션 길이·동시 참가자 부하에 맞춰 인덱스·파티션·보관 기간을 검증한다. raw를 DB JSON 배열에 누적하지 않는다. 기존 EEGRecord는 user_id 필수이므로 게스트 raw를 연결할 때 participant 기반 소유 모델을 명시적으로 설계한다(`backend/app/models/record.py:44-54`).

## 최종 권고안(P0/P1/P2)

### P0 — 라이브 운영을 위한 최소 구현 묶음

1. **참여 권한 계약:** host/guest credential, room·upload 소유 검증, 본인 EEG 구독, 동의·대기열 검증.
2. **공통 상태 계약:** 서버 status/version 및 join snapshot, 시작·pause·resume·종료·취소·참여자 변경 이벤트. 기존 최초 started_at 보존. 완전한 복구 전까지 REST 폴백 유지.
3. **유실 없는 이어하기:** session_id를 실행 단위로 사용, 확정 sequence 복구, 영속 미확정 큐, 저장 ACK, 멱등 재전송, 종료 drain. 접속 자체를 저장 완료로 취급하지 않음.
4. **기기·품질 정합:** 별도 기기 이벤트와 timeout, 실제 LeadOff·SQI 분리, 배터리 전달, unknown/null 정책, 현재값·평균의 동일 계약. 밴드 미사용자는 정상 참여자로 유지.

이 네 묶음을 함께 통과시키는 것이 최소다. playGroupId 필드 하나만 추가하거나 자동 재연결 옵션만 켜는 것으로 대체할 수 없다. 무밴드 명상·상담과 EEG 실패를 분리하고, EEG 실패 때문에 시작·종료·기록 흐름을 막지 않는다.

**구현 후 검증 기준(이번 리뷰에서는 미실행):** 비인가 room/대리 업로드 거부, 정상 guest 본인 업로드, WS 단절 중 생성 후 재연결 데이터 보존, ACK 유실 재전송 중복 방지, 새로고침 offset 연속성, 단절 중 종료 복원, pause/resume 시간축 보존, WS 송신 실패/REST 성공의 호스트 반영, SQI 0.5/null의 WS·REST 동일 표시, 실제 LeadOff·BLE 단절·미사용 구분, EEG 없는 신규 참여자·평균 갱신, 게스트 간 EEG 비노출.

### P1 — 2해상도와 raw 보존의 최소 구현 묶음

- 1초/60초 조회 계약, 유효 수·coverage·알고리즘 버전, REST와 WS가 공유하는 현재/평균 집계. outbox와 최신값/집계 조회 최적화.
- 참여자 기반 raw chunk manifest: session_id, participant_id, stream_id, chunk_index, 시간 범위, sample_rate, 채널, 단위, schema_version, checksum, object_key, 업로드 상태. SDK raw→로컬 영속 큐→presigned PUT→확인 API로 완성한다.
- 종료 직전 chunk·브라우저 재시작·중복 PUT·중단 복구·보관 만료/삭제를 검증한다. 업로드 완료와 분석 완료는 별도 상태다. 기존 상담 기록 상태와 참여자별 EEG 분석 job 상태도 분리한다.

raw가 없는 과거 feature에서 원시 파형을 복원할 수 없다. 따라서 **재분석 가능한 데이터 수집을 약속하는 배포라면 raw P1을 출시 전 게이트로 당긴다.** feature 기반 라이브 확인만 제공하는 단계에서는 P0를 먼저 완료할 수 있다.

### P2 — 반복 실행과 규모 확장

- 같은 수업 정의를 여러 번 실행하는 요구가 확정되면 SessionRun(run_id)을 도입한다. 템플릿·세션·실행 회차를 구분하고 참여자/feature/raw/report를 실행에 연결한다. 재접속·pause/resume은 기존 run_id, 명시적 새 실행만 새 run_id를 사용한다. 현행 completed 세션을 바로 재시작하도록 상태 규칙을 느슨하게 바꾸지 않는다.
- 대규모 참여자 모니터링의 차등 갱신·가상화, raw 저장·분석 job 운영 대시보드, 장기 데이터 파티션/보관 최적화는 부하 측정 후 진행한다.

본 문서는 개선 우선순위 리뷰이며 구현 승인을 대신하지 않는다. 코드·테스트·마이그레이션을 수정하지 않았다. 후속 구현은 위 최소 세트를 spec/plan/사전 verify에 반영하고 프로젝트의 구현 전 승인 절차를 따른다.
