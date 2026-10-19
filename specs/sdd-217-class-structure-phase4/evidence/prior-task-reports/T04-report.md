# T04 구현 보고 — 체크인·현재접속 스냅샷 복원

- 승인 범위: SDD-217 T04 / R2·R6 DEV-02 / NV-04~08, api-contract §7·8. 지정 워크트리 `mindbreeze_2.0-sdd217`만 수정했다. T00~03 기존 변경과 T01 셀프뷰 변경을 보존했다.
- 스키마·마이그레이션 변경 없음. T05 이상 도메인 구현·하위 에이전트·커밋·푸시·배포 없음. sibling 변경·테스트는 한국어 이유와 require_escalated로 실행했다.
- TDD 및 verification-before-completion 적용. 전체 BE 반복 실행 대신 허용된 관련 PG/SQLite/FE 회귀만 실행했다.

## 변경 파일 16개

1. `backend/app/services/class_participation_service.py` 신규: 공통 User→Class→ClassMember ID순→Session ID순→Participant ID순 잠금, before 영속 근거의 최소 DTO, 현재 호스트/본인 권한, DB lease join/heartbeat/leave, 여러 탭, TTL 만료, 별도 참여 버전 및 DB 기반 전체 만료 정리.
2. `backend/app/api/v1/class_membership.py`: `GET /classes/{class_id}/sessions/{session_id}/participation`. access 또는 기존 X-Entry-Credential 본인 조회. 단순 observer/org_admin 운영 권한만으로 전체 조회 불가.
3. `backend/app/services/record_service.py`: 체크인 저장 전 같은 잠금 순서. before 저장 때 checkin_state/checkin_at 및 participation_version을 같은 커밋으로 기록하고 커밋 후 알림. after는 before 완료 근거로 쓰지 않는다.
4. `backend/app/services/session_service.py`: 기존 participant_changed 목록을 보존하면서 최소 체크인·출석·접속 필드를 병합. 본문·버전·시각을 같은 회차 잠금에서 모두 캡처한 후 커밋·발행. 기존 version=state_version 의미 유지.
5. `backend/app/ws/session_live_namespace.py`: 기존 namespace/join/joined/leave 이벤트 유지. 서버 인증 문맥으로만 lease 생성·갱신·삭제. 30초 heartbeat, 90초 TTL 및 최대30초 간격 DB 만료 루프. join 실패 때 이미 등록된 민감 룸 회수. lease 퇴장 DB 실패는 로그로 남기고 기존 접근 회수는 계속하며 TTL 재정리에 맡긴다.
6. `backend/tests/pg/test_sdd217_participation.py` 신규: 실제 PG/HTTP/loopback WebSocket 검증 9개(파라미터 포함).
7. `frontend/src/lib/api/participation.ts` 신규: PII 없는 참여 DTO와 스냅샷 API.
8. `frontend/src/hooks/useParticipationSnapshot.ts` 신규: 초기·재접속 REST 복원, snapshot 대기 중 delta 버퍼링, <=저장버전 무시, gap 재조회, TTL 재조회·실패 unknown·30초 재시도, 회수 후 늦은 응답/이벤트 차단.
9. `frontend/src/hooks/useSessionLiveSocket.ts`: joined 확정 뒤 30초마다 ID 없는 participation_heartbeat. access_revoked 뒤 snapshot/신호 폐기, 늦은 joined·재접속 join 차단, 타이머 정리.
10. `frontend/src/lib/api/session.ts`: SessionLiveMetric에 별도 참여 상태의 optional 필드 연결.
11. `frontend/src/lib/class/host-player-case.ts`: 표시용 checkinState/presenceState/enteredAt 필드 가산.
12. `frontend/src/components/class/player/host/host-live-model.ts`: 서버 참여 상태를 화면 모델로 전달. 대기실 checkin 원문을 완료 판정 근거로 쓰지 않는다.
13. `frontend/src/components/class/player/host/HostParticipantGrid.tsx`: 체크인 완료/미작성/미확인, 참여 중/미입장/미접속/접속 미확인 구분. 밴드 지표가 남아도 서버 미접속을 우선 표시. 초기 조회 대기의 undefined는 미입장으로 추정하지 않는다.
14. `frontend/src/pages/sessions/ClassPlayerPage.tsx`: 실제 호스트 페이지에 참여 스냅샷 복원과 행 overlay, 권한 상실 안내·WS 비활성화 연결.
15. `frontend/tests/sdd217-participation.test.tsx` 신규: DOM 복원·버전·실패·표시 7개.
16. `frontend/tests/sdd217-presence-socket.test.tsx` 신규: 실제 훅의 heartbeat 주기 및 회수 뒤 재접속/신호 차단 2개.

## RED → GREEN

- PG 최초 **4 failed**: 참여 스냅샷 서비스 부재3, REST before 저장 뒤 참가행 상태 부재1 → **4 passed**.
- 실제 HTTP/WS 추가 **1 failed,1 passed**: 실제 joined 스냅샷 참여 버전 부재 → T04 **6 passed**. 실제 Socket.IO namespace/uvicorn/WebSocket transport/독립 migrated PG로 검증했다.
- FE 빈 인터페이스 단계 **5 failed** → DOM **5 passed**. 최초 모듈 부재로 no tests가 난 실행은 기능 RED와 분리했다. `resolve is not a function` 2건은 API 호출 자체가 없는 빈 훅 단계에서 생긴 실패이며, 실제 렌더 상태 assertion 실패 및 API 호출횟수0도 함께 확인했다.
- 기존 WS 훅 회귀는 새 테스트를 먼저 구현 결과에서 확인한 후, 시작 때 clean이었던 해당 훅에 한해 T04 변경을 일시 제거하여 **2 failed**를 재현하고 finally로 원본 구현을 복구했다. 이후 **2 passed**. 다른 작업자의 dirty 파일을 reset하지 않았다. 이 둘은 최초 구현 전 RED가 아니라 변경 제거 방식의 회귀 RED이다.
- PG 관련 회귀 **30 passed,1 failed**: 기존 T03 룸 대역은 새 lease 정리의 별도 DB에서 해당 회차를 찾을 수 없어404. lease 정리 실패가 룸 회수를 막지 않도록 예외 로그+TTL 정리 경로로 보완 → **31 passed**. 실제 실패를 숨기는 무음 처리 아님.
- 최종 자격검증 실패 주입 실제 WS **1 failed,1 passed**: join_denied 뒤 all/self 룸이 남음 → 민감 룸·서버 문맥 정리 후 **2 passed**.
- 기존 guest 자격으로 본인 스냅샷 HTTP **1 failed(401)** → optional access/entry credential 연결 후 **PASS(200)**, 무자격401 유지.
- 만료 후 네트워크 복구 재시도 누락·밴드값 잔류시 연결됨 오표시 **2 failed,5 passed** → **7 passed**.
- 커밋 해제 직후 버전 증가 주입 **1 failed(8 != 7)** → 이벤트 전체를 잠금 안에서 캡처 후 커밋·발행하여 **PASS**. 이 테스트는 실제 PG에 대한 결정적 변경 주입이며 두 독립 연결의 실제 경쟁으로 과장하지 않는다.
- 초기 스냅샷 대기 상태의 미입장 오표시 **1 failed,6 passed** → explicit entered_at=null만 미입장으로 처리 후 **7 passed**, 관련 FE 전체95 유지.

## 최종 실행 명령·출력

Python은 주작업트리의 기존 venv를 실행만 했다. 실제 서비스 env·비밀값 사용 없음. DB는 비밀번호 없는 로컬 합성 DB이며 scratch_db는 별도 빈 DB를 head057까지 migrate한 뒤 해당 DB만 정리했다. 공유 PG 시작/정리는 root 소유로 유지했다.

```bash
cd '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd217/backend'
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest --confcutdir=tests/pg \
 tests/pg/test_sdd217_participation.py tests/pg/test_sdd217_attendance.py -q --tb=short
# 34 passed, 7 warnings in 8.76s

DATABASE_URL=sqlite:// \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest tests/test_sdd024_session_live_ws.py tests/test_sdd209_b5a_entry.py \
 tests/test_sdd209_i2_entry_times.py -q --tb=short
# 33 passed, 6 warnings in 5.25s

cd '../frontend'
npx vitest run tests/sdd217-participation.test.tsx tests/sdd217-presence-socket.test.tsx \
 tests/sdd217-self-view.test.tsx tests/class-player-page-live.test.tsx \
 tests/session-live-signal-connection.test.ts tests/class-player-member-container.test.tsx
# 6 files, 95 passed, 3.27s (최종 explicit-null 수정 후)
npx tsc -p tsconfig.app.json --noEmit
# exit 0
```

`npx tsc --noEmit`의 solution-only 빈 root config 실행은 실제 app 타입검사 증거로 쓰지 않았다. 위 app config 직접 검사가 유효 증거다. PG/SQLite warning은 기존 passlib crypt/argon2 및 uvicorn/websockets·HTTP422 deprecation이다. `git diff --check` 및 변경 Python6파일 AST PASS.

도구 오류도 별도 기록한다. 첫 파일작성은 sibling/backend cwd에서 `backend/tests/pg/...`로 이중 경로를 지정하여 shell no such file or directory로 쓰기 자체가 실패했다. 주작업트리·기존파일 쓰기 없음, 정리할 파일 없음. 테스트 경로도 no tests ran이었다. 뒤에 root cwd의 confcutdir를 backend 전용 경로로 지정한 실행1회 역시 no tests ran으로 분리하고 backend cwd에서 정상 RED를 확인했다. Python 기본 호출의 UTF-8 해석 실패1회는 실행 전 SyntaxError로 쓰기 없었으며 `/usr/bin/python3` UTF-8 명시 후 정상 실행했다.

## Verify별 증거와 한계

- **NV-04 API/DOM PASS, 실제 브라우저 미측정**: `test_nv04_persisted_before_only_no_pii`, `test_nv04_rest_before_persists_state_and_increments`, DOM 복원. after만 있는 기존 기록은 unknown, 저장 before는 completed, note/감정 원문 노출 없음. 밴드 없이 체크인 완료 복원.
- **NV-05 실제 PG/WS PASS, 실제 브라우저 미측정**: `test_nv05_real_ws_join_heartbeat_leave_disconnect[False]`. 실제 WS join 뒤 snapshot에 connected·참여버전, DB lease1개. 타인/타회차 payload를 실어도 서버 문맥 본인 heartbeat만 갱신됨. 현재 버전 증가 확인.
- **NV-06 API/DOM PASS, 호스트 실브라우저 새로고침 미측정**: `test_nv06_http_snapshot_no_operational_privilege`, `test_nv06_snapshot_self_and_current_host_only`, guest HTTP 및 DOM 초기 REST 복원. 제거된 과거 호스트 권한 거부.
- **NV-07 DOM/DB PASS**: entered_at·출석은 socket lease가 생성되어도 조작하지 않는다. 초대만 된 expected/entered_at=null은 미입장, 근거가 없는 체크인은 확인 중. 아직 서버 스냅샷이 없으면 미입장으로 단정하지 않는다.
- **NV-08 PG/실제WS/DOM PASS, 실브라우저 미측정**: 여러 탭 하나만 leave해도 다른 lease가 있으면 connected. 마지막 disconnect의 lease 삭제를 실제 WS에서 검증. TTL90s는 테스트 시각을 제어하여 snapshot에서 만료/버전증가/체크인·출석 보존 검증. FE 역순·같은버전 무시/버퍼/gap/재연결/만료조회실패 unknown/복구재시도/회수 뒤 stale차단을 DOM으로 검증.

**NV-04~08 전체 수용 PASS를 주장하지 않는다.** 실제 API 연결 브라우저의 reload·늦은입장·퇴장·재접속 여정은 T11 소유다. 90초 실제 벽시계 대기 및 최대30초 주기 정리의 실행 지연은 실측하지 않았다. 주기 루프는 코드 연결, 만료 정합은 실제 DB와 제어 시각으로 검증했다. 여러 WS 워커의 presence 스냅샷 근거는 DB이지만, 기존 워커 로컬 room-map에 따른 분산 접근 회수·외부 LiveKit 실제 서버 검증 제약은 T03과 동일하게 남는다.

## 후속 인터페이스·T11 인계

- GET `/api/v1/classes/{class_id}/sessions/{sid}/participation`: `{session_id,participation_version,generated_at,presence_ttl_seconds:90,participants:[ParticipationRow]}`. 호스트 전체/본인 한 행. 원문 PII 없음.
- `/session-live` `joined.snapshot` 및 기존 호스트 `participant_changed`: `participation_version` + 최소 행 상태, generated_at/TTL 가산. 기존 `version`은 상태 전용이며 참여 버전과 비교하지 않는다.
- `participation_heartbeat` 요청 본문은 `{}`. 서버 sid의 인증된 문맥만 사용. FE30초/DB TTL90초, lease 하나라도 유효하면 connected.
- `lock_context`, `build_snapshot`는 호출자 회차 잠금 내부 수집용이다. `socket_update`/`snapshot`/`expire_due`는 커밋을 소유한다. `_participation_socket`과 기존 notify는 커밋 후 발행한다. 앞으로 같은 회차 참여 변경도 공통 잠금과 participation_version을 유지해야 한다.
- T11: 실제 API로 before 체크인→무밴드 입장→진행 중 늦은입장→호스트 reload→퇴장→두 탭→재접속을 각각 캡처. 초대만 된 행과 snapshot 대기 unknown 표시, 이전버전 replay·gap재조회, access_revoked 후 화면 및 재join 차단, 실제90초 TTL/30초 정리 지연을 확인한다.
- 독립 리뷰는 root 소유이며 본 구현자가 자신의 승인을 주장하지 않는다.

## 독립 리뷰 수정 round 1/5 — Important 4건

리뷰 기준 `.superpowers/sdd/plan/T04-fix1-base` 이후 변경은 아래7파일과 이 보고서뿐이다. BE·스키마 변경 없음. 기존 사용자 변경·T01 셀프뷰 보존. 추가 하위 에이전트·커밋·푸시·배포 없음.

### 실제 페이지의 stale roster 및 stale joined snapshot

- 원인: 별도 참여 훅이 v4 delta를 무시해도 기존 WS 콜백이 `metrics`를 A목록으로 통째 교체했다. 표시 overlay가 현재 metrics만 순회하여 최신 v5의 B가 사라졌다.
- `class-player-page-live.test.tsx`에서 실제 ClassPlayerPage를 렌더하고 참여 훅/transport 경계만 대역화했다. 최신 v5 A+B 이후 v4 A만 callback 전달 시 B가 사라져 RED. 이 테스트는 DOM/실제 페이지 상태 경로 증거이며 실제 브라우저 증거는 아니다.
- 페이지에서 participation_version을 session별 독립 ref로 비교해 <=최신은 참가자 갱신을 차단한다. 표시 roster는 version>=0인 참여 snapshot 행을 기준으로 구성하며, 아직 지표가 없는 새 행은 미측정 기본값만 사용한다. 기존 EEG 행은 ID로 병합한다.
- 같은 원인의 joined.snapshot도 실제 페이지에서 추가 RED(B current_efficiency가95→null)를 확인했다. snapshot의 참여 버전이 오래되면 참가자 배열을 교체하지 않고 상태 필드는 기존 상태 계약대로 처리한다.
- `socket.ts`의 ParticipantChangedEvent와 SessionLiveJoinSnapshot에 별도 participation_version 타입을 가산했다. state_version으로 참여 버전을 비교하지 않는다.

### heartbeat가 EEG 측정값을 지우는 문제

- 원인: 기존 참여 알림의 device_status/current_efficiency/avg_efficiency/last_eeg_at placeholder NULL이 페이지의 최신 측정값을 덮었다.
- 실제 페이지에 기존 정상 EEG 행을 로드한 뒤 참여버전1·NULL placeholder 알림을 전달했다. current_efficiency95→null로 RED.
- 참여버전이 있는 이벤트는 기존 지표행의 이름·소유 식별·손들기/발언 상태만 병합한다. EEG 값·시각은 해당 참여 알림으로 덮지 않는다. 출석·체크인·접속은 별도 참여 snapshot overlay가 소유하며 새 참가자 ID만 지표 기본행으로 추가한다. 버전 없는 구 서버 이벤트의 목록 교체는 호환 경로로 보존했다.
- GREEN에서 current_efficiency/last_eeg_at/device_status가 알림 전 값 그대로 유지된다.

### mixed-band 조회 대기·실패의 접속 오표시

- 원인: presenceState가 undefined이면 조건분기를 건너뛰어 band ON은 연결됨, band OFF는 밴드 없이 참여로 표시했다. 최초 테스트는 allOff 화면만 보았다.
- 실제 HostParticipantGrid의 allOff=false에서 band ON/밴드 미착용을 각각 렌더하는 테스트 추가. ON 초기 대기에 연결됨으로 RED.
- `presenceState !== 'connected'`이면 undefined도 서버 확인 전 상태로 처리한다. 같은 접속 라벨 규칙을 ON/OFF 가지에 적용했다. explicit entered_at=null일 때만 미입장으로 구분하는 규칙은 유지했다. 단절·초기대기·조회 실패에서 밴드 연결 자체를 현재 수업 참여 근거로 쓰지 않는다.

### access_revoked 이후 BLE 보조 훅의 재접속

- 원인: 페이지가 종료 안내를 early return해도 useBand 훅은 마운트돼 있었고 enabled=true를 유지했다. 보조 connect 리스너가 공유 소켓을 재join할 수 있었다.
- 실제 ClassPlayerPage 테스트에서 회수 뒤 band enabled가 여전히true여서 RED. 페이지는 회수 시 band enabled=false, sessionId='', participantId=null로 내려 보조 WS와 raw 업로드 문맥도 해제한다.
- 추가로 **실제 useBand를 마운트**하여 access_revoked 직후 React cleanup 전 connect를 전달했다. join 호출1→2로 RED. useBand 자체가 회수된 sessionId를 ref에 기억하고 connect를 즉시 차단한다. 연결 플래그를 내리고 리스너를 cleanup한다. 페이지 비활성화 뒤 connect도 새 join을 만들지 않는다.
- 실제 useBand 테스트는 BLE 하드웨어/raw 업로드 저장소/Socket transport 경계만 대역화했다. 실장치·실브라우저·외부 WS 증거로 해석하지 않는다.

### 변경 파일

1. `frontend/src/pages/sessions/ClassPlayerPage.tsx`
2. `frontend/src/lib/socket.ts`
3. `frontend/src/components/class/player/host/HostParticipantGrid.tsx`
4. `frontend/src/hooks/useBand.ts`
5. `frontend/tests/class-player-page-live.test.tsx`
6. `frontend/tests/sdd217-participation.test.tsx`
7. `frontend/tests/sdd217-band-revocation.test.tsx` 신규

### 실행 명령·결과

```bash
cd '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd217/frontend'
npx vitest run tests/class-player-page-live.test.tsx tests/sdd217-participation.test.tsx
# 정상 RED: 4 failed, 32 passed
# 최소 수정 후: 36 passed

npx vitest run tests/sdd217-band-revocation.test.tsx
# 정상 RED: 1 failed(join 호출 2 != 1)
# 수정 뒤 관련3파일: 37 passed

npx vitest run tests/class-player-page-live.test.tsx -t '오래된 joined'
# 정상 RED: 1 failed, 28 skipped (B EEG 소실)

npx vitest run tests/sdd217-participation.test.tsx tests/sdd217-presence-socket.test.tsx \
 tests/sdd217-band-revocation.test.tsx tests/sdd217-self-view.test.tsx \
 tests/class-player-page-live.test.tsx tests/session-live-signal-connection.test.ts \
 tests/class-player-member-container.test.tsx
# 7 files, 101 passed in 4.24s
npx tsc -p tsconfig.app.json --noEmit
# exit 0
```

`git diff --check` PASS. BE 코드 변경이 없어 BE 전체/관련 PG를 반복하지 않았다. 최초 테스트 편집 명령은 frontend cwd에서 frontend/tests로 이중 경로를 지정해 FileNotFoundError로 읽기부터 실패했으며 파일 쓰기 없음. 뒤에 기존 테스트만 실행돼32 passed였던 출력은 신규 RED로 계산하지 않았다. 경로 정정 후 위4 failed를 정상 재현했다. useBand 테스트 최초 mock 커서가 null을 반환하여 cursor warning이 있었으나 제품 실패는 join 재호출 assertion이었다. 이후 실제 커서 구조의 최소 대역으로 고쳐 경고 없이 GREEN을 확인했다.

실브라우저 NV 검증은 여전히 T11 인계 상태다. 이 수정으로 해당 브라우저 시나리오의 PASS를 추가 주장하지 않는다. 추가 코드 리뷰는 root 소유다.

## 독립 리뷰 수정 round 2/5 — 회차 전환의 이전 버전·응답 혼입

기존 Important4는 리뷰에서 ADDRESSED였으며 이번 수정은 신규 회차 전환 finding과 같은 경계만 다뤘다. 기준은 `.superpowers/sdd/plan/T04-fix2-base`. BE 변경·BE 재실행·커밋·푸시·배포·하위 에이전트 없음.

### 원인과 수정

- App 라우트가 같은 ClassPlayerPage 인스턴스를 재사용한다. A의 참여 version50이 훅 state에 남은 채 B 첫 render가 실행되면, 페이지가 B ref를 -1로 초기화한 직후 소유 회차 확인 없이 max(-1,50)을 적용했다. 훅의 effect reset이 끝나도 ref50은 내려가지 않아 B의 유효 snapshot1/delta2를 거부했다.
- 참여 훅 state에 `sessionId`/`classId` 소유권을 가산했다. 요청 회차/클래스와 저장 state 소유권이 다르면 effect를 기다리지 않고 **그 첫 render부터** 빈 미확인 상태(version -1)를 반환한다. 이전 effect의 비동기 작업은 기존 disposed 가드로 계속 차단한다.
- 페이지는 참여 state의 sessionId가 현재 라우트와 일치할 때만 버전/행/회수 상태를 소비한다. 소유권 불일치 state를 새 회차의 max 계산에 넣지 않는다.
- 현재 라우트와 일치하는 loadedSession만 표시·훅 활성화에 사용한다. B 로딩 중 A의 컨테이너·participant ID·band 문맥을 사용하지 않는다. 회차 변경 effect에서 EEG·체크인·발언·신호·히스토리 캐시 및 이전 오류를 초기화한다.
- 라우트 generation을 부여해 과거 회차의 session/metrics HTTP 성공·실패와 지연 WS snapshot/participant/state/device/EEG 콜백이 현재 회차 상태를 덮지 못하게 했다. 같은 회차로 돌아오는 경우에도 이전 generation 콜백은 무효다. 기존 상태/참여 버전 의미는 바꾸지 않았다.

### 실제 RED → GREEN 증거

- `class-player-page-live.test.tsx`의 **실제 createMemoryRouter.navigate와 같은 페이지 인스턴스**로 A→B 전환했다. 참여 훅은 effect reset 직전의 A50을 반환하는 경계 대역을 유지했다. B snapshot1의 이름이 반영되지 않아 **RED1**. 수정 후 B snapshot1과 participant2 모두 즉시 반영된다.
- 같은 라우트 재사용에서 B session HTTP를 보류했다. 로딩 중 A의 HostLiveContainer가 여전히 렌더돼 **RED1**. 수정 후 로딩 중 A 컨테이너가 없고, B 로드 뒤 늦은 A의 metrics HTTP·session HTTP·보관한 joined callback을 전달해도 B session/roster를 덮지 않는다.
- `sdd217-participation.test.tsx`에서 **실제 참여 훅**을 A50에서 B로 rerender하며 모든 render의 반환값을 수집했다. 첫 B render가 A50/행을 반환해 **RED1**. 수정 후 첫 render부터 B의 빈 version -1 상태만 반환한다.
- 두 페이지 회귀는 실제 페이지/라우터를 실행하고 API·참여 훅/WS 경계만 대역화했다. 훅 회귀는 실제 훅을 실행하고 API/transport만 대역화했다. 실제 브라우저 증거로 과장하지 않는다.

### 변경 파일

1. `frontend/src/hooks/useParticipationSnapshot.ts`
2. `frontend/src/pages/sessions/ClassPlayerPage.tsx`
3. `frontend/tests/class-player-page-live.test.tsx`
4. `frontend/tests/sdd217-participation.test.tsx`
5. 이 보고서

### 실행 명령·최종 결과

```bash
cd '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd217/frontend'
npx vitest run tests/class-player-page-live.test.tsx -t 'route reuse'
# RED: 2 failed,29 skipped -> GREEN: 2 passed,29 skipped
npx vitest run tests/sdd217-participation.test.tsx -t '첫 렌더'
# RED: 1 failed,8 skipped -> GREEN: 1 passed,8 skipped

npx vitest run tests/sdd217-participation.test.tsx tests/sdd217-presence-socket.test.tsx \
 tests/sdd217-band-revocation.test.tsx tests/sdd217-self-view.test.tsx \
 tests/class-player-page-live.test.tsx tests/session-live-signal-connection.test.ts \
 tests/class-player-member-container.test.tsx
# 7 files,104 passed in 3.88s
npx tsc -p tsconfig.app.json --noEmit
# exit 0
```

`git diff --check` PASS. BE 코드 변경이 없어 PG/전체 BE를 반복하지 않았다. NV 실제 브라우저·실장치·TTL 벽시계 측정은 기존과 같이 T11 인계 상태다. 독립 재리뷰는 root 소유다.
