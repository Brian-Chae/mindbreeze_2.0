## P0 시나리오 충족 판정

검증일: 2026-09-08. 대상: 현재 로컬 작업 트리, HEAD `40f4c93e86fc57ab111f1913628e82f27153c5be`. 기준 문서는 같은 디렉터리의 `spec.md`, `plan.md`, `verify.md`와 `specs/025-live-session-parity-analysis/02-codex-integration-review.md`다. 아래 코드 경로는 저장소 루트 기준이며 행 번호는 검증 시점 기준이다.

**판정: 라이브 운영 보류.** 현재 코드에는 SDD-026의 안전망이 반영되지 않은 경로가 남아 있다. “구현 후 완료본”이라는 전제를 확인할 수 없으므로 현재 작업 트리 자체를 판정했다. `verify.md`의 19개 항목 중 **충족 2, 부분 충족 1, 미충족 15, 미검증 1**이다. 회귀 항목의 통과가 권한·복구·정합 계약 충족을 의미하지 않는다.

검증 방법은 코드 대조, 기존 백엔드 전체 테스트, 프론트 타입 검사·빌드, 기존 FakeSio와 품질 함수의 직접 호출이다. 실제 Socket.IO 네트워크, PostgreSQL 동시성, 브라우저 새로고침·오프라인 및 실기기 BLE 시나리오는 실행하지 않았다. 코드·테스트 파일은 수정하지 않았다.

**동시 작업 주의:** 마무리 확인(2026-09-08 00:33 KST)에서 다른 작업에 의한 `frontend/src/lib/session-live/feature-queue.ts`, `signal-status.ts` 추가와 `socket.ts`의 신호 타입 import 변경을 확인했다. 그 시점에도 `useBand.ts`의 offset 0 초기화·재연결 버퍼 삭제는 남아 있었다. 아래 판정·행 번호·테스트 결과는 앞서 읽고 실행한 검증본에 대한 기록이며, 이후 변경 전체를 검증한 결과가 아니다. 최종 통합본은 별도로 고정해 재검증해야 한다.

### 1. 권한 — 5개 미충족

1. **잘못된 토큰 connect 거부: 미충족.** 토큰 디코딩 예외를 무시하고 `return True`로 연결한다. 직접 호출에서도 `invalid_token_connect=True`를 확인했다. 근거: `backend/app/ws/session_live_namespace.py:38-54`.
2. **다른 참여자의 세션 join 거부/본인만 수신: 미충족.** `session_id`의 존재 여부, 호스트 소유권, 참여 credential 검증 없이 room에 넣는다. FakeSio에서 존재하지 않는 `nonexistent-session`에도 입장했다. 근거: `backend/app/ws/session_live_namespace.py:60-68`.
3. **타인 participant_id 업로드 403: 미충족.** 명시 ID가 있으면 현재 사용자의 ID와 비교하지 않는다. 세션에 속한 참여자 행만 있으면 통과한다. WS와 REST가 이 함수를 공유하므로 양쪽 모두 영향받는다. 근거: `backend/app/services/session_service.py:846-879,966-973`, `backend/app/ws/session_live_namespace.py:135-137`.
4. **게스트 간 EEG 비노출: 미충족.** 가입자는 모두 `session:{id}`에 들어가며 EEG도 같은 room 전체로 발행된다. UI에서 본인 데이터만 고르는 것은 서버 노출을 차단하지 못한다. 근거: `backend/app/ws/session_live_namespace.py:65-68,142-154`, `frontend/src/components/class/GuestMeditationPanel.tsx:51-64`.
5. **동의 미완료/대기열 업로드 차단: 미충족.** 업로드 신원 해석·저장 경로에 `consent_eeg`와 `is_waitlisted` 검증이 없다. 호스트 REST 목록에서 대기열을 제외하는 것은 업로드 차단과 다르다. 근거: `backend/app/services/session_service.py:644-646,846-949`.

### 2. 유실 없는 이어하기 — 1개 부분 충족, 3개 미충족

1. **단절 중 데이터 보존·재전송: 미충족.** 큐는 메모리 `useRef`뿐이며 연결 시 잔여 큐를 빈 배열로 바꾼다. WS 연결 중에는 REST flush도 중단한다. 근거: `frontend/src/hooks/useBand.ts:163-165,188-207,419-426`.
2. **ACK 유실 재전송 시 중복 저장 없음: 부분 충족.** UNIQUE와 기존 인덱스 skip은 있으나 저장 ACK 및 ACK 유실 재시도 계약이 없다. 같은 인덱스의 다른 payload도 중복으로 취급한다. 기존 테스트는 인덱스 중복 방지만 확인한다. 근거: `backend/app/models/eeg_feature.py:22-25`, `backend/app/services/session_service.py:895-943`, `frontend/src/lib/socket.ts:123-129`, `backend/tests/test_sdd024_session_live_ws.py:298-339`.
3. **새로고침 후 offset 연속성: 미충족.** 훅 생성마다 offset은 0이며 영속 cursor를 읽는 경로가 없다. 같은 참여자 ID를 복원하더라도 이미 저장된 인덱스와 충돌하면 새 값이 skip된다. 근거: `frontend/src/hooks/useBand.ts:165,215-218`, `backend/app/services/session_service.py:895-916`.
4. **pause/resume 시간축·데이터 보존: 미충족.** 같은 훅이 유지되면 카운터 자체는 유지되므로 모든 pause가 곧 충돌하는 것은 아니다. 그러나 재마운트 복구 계약이 없고, 명상 중 폴링은 완료·취소만 처리하며 패널에 paused 상태를 전달하지 않는다. 일시 정지 시 수집을 제어하거나 중단 구간을 시간축에 반영하는 근거가 없다. 근거: `frontend/src/pages/class-join-page.tsx:161-197,279-286`, `frontend/src/components/class/GuestMeditationPanel.tsx:44-49`, `frontend/src/hooks/useBand.ts:165,217`.

### 3. 신호·기기 정합 — 4개 미충족

1. **SQI 0.5/null의 WS·REST 표시 일치: 미충족.** 0.5는 프론트에서 50→`ok`, 서버에서 `degraded`→`lead_off`다. null은 서버에서 `valid`→`ok`, 프론트에서는 unknown·기존 상태 유지·신규 행 ok 등으로 갈린다. 근거: `frontend/src/hooks/useBand.ts:122-129`, `frontend/src/pages/sessions/SessionLivePage.tsx:38-43,57-88`, `backend/app/services/session_service.py:786-805`. 서버 함수 직접 호출로 두 입력의 결과를 확인했다.
2. **unknown의 valid 승격 방지: 미충족.** `_quality_from_signal(None)`은 명시적으로 `valid`를 반환한다. 실제 밴드 콜백도 SQI 부재를 최종 0으로 치환해 미확인과 낮은 품질을 혼동한다. 근거: `backend/app/services/session_service.py:791-792`, `frontend/src/hooks/useBand.ts:335-345`.
3. **LeadOff와 SQI 분리 표시: 미충족.** SQI 임계값에서 접촉 상태를 직접 추론한다. 검토한 전송·수신 계약에는 실제 접촉 상태를 별도 축으로 처리하는 경로가 없다. 근거: `frontend/src/hooks/useBand.ts:122-129,224-229`, `backend/app/services/session_service.py:800-805`.
4. **배터리 전달·last_eeg_at 기반 BLE 단절 구분: 미충족.** 프론트가 전송한 배터리·상태는 namespace 저장/발행 인자에서 빠진다. REST 배터리는 항상 null이다. 마지막 수신 시각은 반환하지만 경과시간에 따른 상태 전환이 없고 저장 후 `band_connected=True`만 설정한다. 근거: `backend/app/ws/session_live_namespace.py:90-114`, `backend/app/services/session_service.py:667-700,833-842,945-949`, `frontend/src/hooks/useBand.ts:381-385`.

### 4. 상태 계약 — 3개 미충족

1. **join snapshot: 미충족.** `joined`에는 `session_id`만 있으며 status/version/참여자/집계가 없다. 근거: `backend/app/ws/session_live_namespace.py:68`. 직접 호출 결과도 `{'session_id': 'nonexistent-session'}`뿐이다.
2. **상태·참여자·기기 이벤트: 미충족.** namespace에는 join/leave/feature만 있고 상태 전이는 DB commit 후 해당 상태 이벤트 없이 반환한다. `backend/app`, 프론트 hooks 및 socket 모듈에서 세 이벤트 이름을 검색해 구현을 찾지 못했다. 근거: `backend/app/ws/session_live_namespace.py:35-116`, `backend/app/services/session_service.py:312-346`.
3. **snapshot 전 폴백 유지: 미충족.** connect 즉시 `isConnected=true`; 호스트는 이 값만으로 반복 metrics 폴링을 중단한다. 전환 시 REST 조회 1회는 있지만 snapshot 수신·version 확인을 보장하지 않는다. 근거: `frontend/src/hooks/useSessionLiveSocket.ts:59-63`, `frontend/src/pages/sessions/SessionLivePage.tsx:228-237`.

### 5. 회귀 — 2개 충족, 1개 미검증

1. **백엔드 pytest: 충족(실행 대상 기준).** `backend/`에서 `./venv/bin/python -m pytest -q` 실행: **255 passed, 1 skipped, 11 warnings, 32.45s, exit 0**. 건너뛴 테스트는 JWT fixture가 필요한 client portal 통합 테스트다(`backend/tests/test_sdd_c01.py:109`). 따라서 “모든 시나리오 실행·통과”로 확대 해석하면 안 된다. 경고에는 deprecated API 및 `broadcast_notification` coroutine 미대기 경고가 포함된다.
2. **프론트 tsc/build: 충족.** `frontend/`에서 `npm run build` 실행: `tsc -b && vite build`, 타입 오류 없이 **exit 0**, 771 modules, Vite build 3.55s. CSS token import 해석 실패 경고와 500 kB 초과 chunk 경고가 남았다. 타입·번들 생성 통과는 시각적 정상 동작을 보장하지 않는다.
3. **기존 호스트/게스트 라이브 플로우: 미검증.** 기존 SDD-024 테스트는 FakeSio 핸들러·SQLite 저장 경로를 검증하며 실제 브라우저·네트워크·밴드 조합의 E2E가 아니다. 특히 기존 테스트가 공용 room 발행과 변경 payload의 `saved=0`을 정상으로 기대한다(`backend/tests/test_sdd024_session_live_ws.py:177-209,319-339`). 테스트 통과만으로 강화된 권한·복구 계약을 승인할 수 없다.

## 잔여 결함

### R1. P0 — 신원 없는 구독에서 대리 업로드까지 이어지는 권한 결함

세션 ID를 아는 접속자는 공용 room의 EEG를 수신할 수 있고, 이벤트에 포함된 참여자 ID로 업로드할 수 있다. 잘못된 토큰도 이를 막지 않는다. 즉 ID의 비추측성은 보호 수단이 될 수 없다. 명시 participant_id의 소유 검증, 호스트의 세션 권한, 게스트 credential의 session/participant 바인딩을 WS와 REST 모두에서 적용해야 한다. 근거: `backend/app/ws/session_live_namespace.py:38-68,94-114,142-154`, `backend/app/services/session_service.py:858-879`.

### R2. P0 — 비동의·대기열·종료 상태에서의 수집 차단 부재

참여자 행 존재만 확인하므로 EEG 비동의·대기열뿐 아니라 종료·취소 후에도 새 인덱스 저장을 차단하는 상태 검증이 없다. `_store_feature`와 REST ingestion은 세션 존재만 검사한다. 지연 재전송을 위해 종료 후 모든 업로드를 일괄 거부하는 것도 해결책은 아니다. 종료 전 수집분을 증명·허용할 범위와 종료 후 새 수집분 거부 조건을 함께 정해야 한다. 근거: `backend/app/ws/session_live_namespace.py:131-137`, `backend/app/services/session_service.py:846-949,966-973`.

### R3. P0 — 저장 확인 없는 전송과 재접속·종료 유실

`emitSessionLiveFeature`의 true는 emit 호출 완료일 뿐 저장 성공이 아니다. 서버 저장 예외는 로그 후 반환하며 큐 복구에 필요한 명시 ACK/NACK가 없다. 재연결 시 잔여 버퍼를 삭제하고 unmount도 drain 없이 정리한다. `disconnect`의 flush는 WS 연결 중 no-op이며 실제 stream cleanup보다 먼저 실행된다. 영속 미확정 큐, commit 후 payload 식별 ACK, 재시도 및 수집 중단 후 drain을 하나의 계약으로 묶어야 한다. 근거: `frontend/src/lib/socket.ts:123-129`, `backend/app/ws/session_live_namespace.py:98-105`, `frontend/src/hooks/useBand.ts:188-235,282-305,419-426,480-494`.

### R4. P0 — 중복 키가 데이터 충돌을 숨기고 WS 화면에는 미저장 값 발행

같은 인덱스의 다른 payload를 보내면 DB는 기존 값을 유지하지만 `_store_feature`는 새 입력을 반환하고 `saved=0`이어도 그대로 broadcast한다. REST와 WS의 값이 달라질 수 있다. 기존 테스트도 REST에서 0.5를 저장한 인덱스에 WS로 0.9를 보내고 skip만 검사한다. ACK는 같은 식별자·같은 payload의 재전송과 다른 payload의 충돌을 구분해야 하며, 최신 화면은 실제 확정된 데이터만 반영해야 한다. 근거: `backend/app/services/session_service.py:908-910`, `backend/app/ws/session_live_namespace.py:107-114,135-137`, `backend/tests/test_sdd024_session_live_ws.py:319-339`.

### R5. P0 — 현재값·평균·기기 상태를 신뢰할 수 없음

평균은 null만 제외해 degraded/invalid 구간도 포함하고, 최신값도 품질과 무관하게 반환한다. WS 행 갱신은 평균을 갱신하지 않으며 null 현재값은 이전 숫자로 유지한다. REST의 last_eeg_at은 수집 시각이 아닌 최신 인덱스 행의 DB 생성 시각이다. 지연 업로드를 방금 측정한 값으로 오인할 수 있고 서버·브라우저 표시 시각도 다르다. 근거: `backend/app/services/session_service.py:833-842`, `backend/app/models/eeg_feature.py:45-46,70`, `frontend/src/pages/sessions/SessionLivePage.tsx:60-94`. 품질별 집계 포함 정책, null로 현재값을 지우는 규칙, 수집 시각/서버 수신 시각, staleness와 배터리·접촉 상태의 공통 계약이 필요하다.

### R6. P0 — REST fallback 저장이 연결된 호스트에게 전파되지 않음

송신자 WS만 끊겨 REST로 저장해도 ingestion은 저장 수만 반환하고 이벤트를 발행하지 않는다. 호스트 WS가 연결되어 있으면 metrics 반복 조회가 꺼져 최신값·평균·참여자 갱신을 놓칠 수 있다. 상태 snapshot 및 version gap 복구도 없다. 근거: `backend/app/services/session_service.py:953-973`, `frontend/src/pages/sessions/SessionLivePage.tsx:228-237`, `frontend/src/hooks/useSessionLiveSocket.ts:59-63`. WS/REST 모두 commit 이후 동일한 확정 상태를 전달하고 재연결·이벤트 공백에서 snapshot으로 복구해야 한다.

## 최소 운영 게이트

아래 항목은 모두 필수다. 아직 확인되지 않은 게이트는 체크하지 않는다. 같은 최종 구현본에서 요청·응답, 수신 이벤트, DB 행 수·payload, UI 상태를 연결한 증거를 남겨야 한다.

- [ ] **G1 — 권한 음성 시나리오:** 잘못된/만료된 토큰, 다른 세션 호스트, credential 없는 게스트, 타인 participant_id, EEG 비동의, 대기열 참여자를 WS join/feature 및 REST feature에 각각 적용한다. 비인가 구독·저장·발행은 0건이어야 한다. 정상 credential 게스트와 정당한 호스트는 계속 동작해야 한다.
- [ ] **G2 — 실제 수신 격리:** 별도 브라우저 컨텍스트의 호스트 1명·게스트 A/B를 연결한다. A의 EEG는 허용된 호스트와 A에게만 전달되고 B의 네트워크 수신에는 나타나지 않아야 한다. 다른 세션도 동일하게 격리한다.
- [ ] **G3 — 영속 큐·ACK·멱등:** 단절 중 30개 feature 생성, 페이지 새로고침, 재접속, commit 직후 ACK 유실을 순서대로 재현한다. 최종 고유 저장 30개, payload 일치, 확정 후 큐 0개를 확인한다. 동일 키·상이 payload는 명시 충돌이어야 한다. PostgreSQL에서 WS/REST 동시 재전송도 확인한다. IndexedDB 저장 실패는 조용한 전송 성공으로 표시하지 않는다.
- [ ] **G4 — pause/resume·종료:** 동일 참여자에서 재마운트/새로고침을 포함한 pause/resume을 실행해 인덱스 충돌 및 신규 데이터 소실 0건을 확인한다. 중단 구간과 재개 시각을 보존한다. 종료 전 미확정 큐는 승인된 지연 업로드 정책으로 drain하고 종료·취소 후 신규 수집은 차단한다. 단절 중 종료된 클라이언트도 재접속 시 종료 상태로 복구한다.
- [ ] **G5 — 품질·기기·평균:** SQI null/0.39/0.4/0.5/0.7, 실제 LeadOff, BLE 해제, 전송만 중단, 밴드 미사용을 각각 입력한다. WS·REST 현재값/평균/품질/배터리가 같고 unknown은 valid가 되지 않아야 한다. 저품질 집계 정책과 staleness 임계시간을 먼저 확정하고 경계값까지 검증한다. 미수신·접촉불량 때 과거 점수가 현재값으로 남지 않아야 한다.
- [ ] **G6 — snapshot·이벤트·폴백:** snapshot의 status/version/started_at/허용 참여자/집계를 확인한다. 세 이벤트는 commit 후 발생하고 중복·역순·version gap에서 되돌림 없이 복구해야 한다. snapshot 지연·join 거부·연결만 성공한 경우 폴백을 유지한다. EEG 없는 신규 참여자와 REST-only 업로드도 호스트에 반영되어야 한다.
- [ ] **G7 — 최종 회귀 및 운영 경로:** 최종 변경본에서 백엔드 전체 pytest, P0 음성/복구 테스트, 프론트 tsc/build를 다시 통과시킨다. 현재 skip의 처리 근거를 남기고 CSS token import 경고의 화면 영향을 확인한다. 지원 브라우저+실기기에서 호스트/게스트 시작→일시정지→재개→종료 및 미착용 흐름을 수행하고, Safari/Firefox 안내도 확인한다. 배포가 다중 worker라면 서로 다른 worker에 연결된 호스트·게스트에서도 동일 격리·전파·복구 결과를 확인한다.

## 최종 권고안

**SDD-026 통합 승인 및 라이브 운영은 보류한다.** SDD-025의 P0 4종은 현재 검토본에서 해소되지 않았다. 기존 pytest와 build 통과는 확인했으나 보안·유실·정합 수락 기준을 충족하지 못한다.

우선 서버 권한·참여 credential·게스트 격리를 확정하고, payload 식별 ACK와 영속 큐·offset 복구를 양단에서 맞춰야 한다. 이어서 WS/REST 공통 품질·집계 및 snapshot/version 계약을 완성한 최종 구현본으로 G1~G7을 검증한다. 구현이 다른 작업 트리나 진행 중인 변경에 있다면 그 코드가 통합된 이후 재검증해야 하며, 이번 문서는 그 변경의 완료 증거가 아니다.

이 문서는 통합 검증 결과이며 구현 전 `verify.md`를 사후 작성하거나 체크 완료로 바꾸지 않았다. 현재 디렉터리에서 `summary.md`도 확인되지 않았으므로 SDD 완료 판정은 하지 않는다.
