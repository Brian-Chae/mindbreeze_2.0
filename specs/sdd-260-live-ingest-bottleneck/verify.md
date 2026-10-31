# SDD-260 — 40명 클래스 실시간 지표 저장 병목 해소 · Verify (Stage ③, 구현 전 QA 체크리스트 · 10/31 우선순위 재정렬판)

> **이 문서는 구현 전(2026-10-31)에 작성한 게이트다. 구현 후 사후 수정을 금지한다.** 10/31 대표 지시(오프라인 클래스 · 저장 완결성 최우선)에 따라 구현 착수 전에 1회 개정했다: 기존 시나리오 ID 는 유지, **등급 열([A]/[B]/[C]) 추가**, 신규 §A-2 V-A*(저장 연결 독립), §G V-R*(리포트), §H V-M*(회원 자기 화면) 추가. 시나리오를 바꿔야 하면 사유를 `summary.md` 에 적고 여기엔 손대지 않는다.
> 2차 개정(같은 날): 대표 추가 지시로 합격선을 "저장 완결성" 하나로 통일, [B]/[C] 를 [후속] 으로 통합, V-A8~A13(REST 배치·summary·3단계 대조·웹 영속) 추가. 구현 전 개정이다.
> 실행자는 구현자와 다른 사람(QA)이어야 한다. 결과는 `specs/sdd-260-live-ingest-bottleneck/test-results/` 에 날짜별로 기록한다.
> 근거: `plan.md`(Phase·게이트), `plan-astra.md` §6, `plan-fable.md` §5.3~5.4. 개인정보·토큰·원시 payload 는 결과에 기록하지 않는다.
> **실밴드 시험(§D)은 대표 결정으로 구현 후 수행한다.** 시나리오는 지금 확정하고, 실행은 후보 빌드가 나온 뒤(11/3)다.

## 등급과 합격 규칙 (대표 추가 지시 10/31: 합격선은 "저장 완결성" 하나)

| 등급 | 뜻 | 11/3 go/no-go |
|---|---|---|
| **[A]** | 저장 완결성(feature→DB, 원시→S3/DB, 3단계 대조, 이어올림, 연결 상태 독립) + 저장을 막는 요인(락·heartbeat·DEGRADED·스레드풀·슬롯) | **한 항목이라도 미달이면 no-go** |
| **[후속]** | 리포트·자기 화면·코치 모니터링·지연·투영 구조·다중 워커 — 저장 완결성에 영향 없음 | 판정에 쓰지 않음. 측정·기록만. 이전 판의 [B]/[C] 는 모두 여기 |

**합격선(하나)**: 착용 40명(밴드 연결)·10분 기준 — feature 참여자별 **600/600**·중복 0·`not_ready`·거절 0 (V-L2 저장 열) · 원시 **100% `uploaded`**·갭 0·**S3 size/sha256 전수 대조 100%** (V-L4) · 종료 후 재접속 복구 — 40기기 동시 종료+네트워크 불안+강제종료 혼합에서 feature·원시 서버 수량 == 로컬 수량 (V-A10) · Redis 60초 정지 중 저장 지속 (V-L11). 실시간 지연 합격선은 **제거**.

Phase 매핑: G1 = V-A1~A4·A8·A9 + V-L1·L2 저장 열 + V-L4 + V-S5~S8·S14·S15. G2 = V-S16·S17·V-A5~A7. G3 = V-A10~A13 + V-C1~C6·C8~C10. go/no-go = §D V-B1~B11 + 60분 소크 V-L7. §E 는 모든 배포. §G·§H·V-S9~S13·S18·S19·V-L3·L5·L9·L10 은 후속.

판정 규칙: 각 시나리오는 **입력 → 기대 결과 → 측정 방법** 으로 쓴다. "count 일치"만으로 합격 금지(identity·hash 대조 필수). [A] 는 `not_ready`·거절 **0** 이 필수다(설계상 거절인 동의 철회·cutoff 이후 창은 시나리오에 넣지 않는다).

---

## A-2. 저장 연결 독립 (V-A) — 신규, [A], P1·P2

| ID | 등급 | 시나리오 | 입력 | 기대 결과 | 측정 |
|---|---|---|---|---|---|
| **V-A1** | A | **DEGRADED 중 저장** | 참가자 READY → Redis 일시 정지로 heartbeat 실패 → `live:degraded` 수신 → 그 상태에서 `live:metric` 10창 전송 | 10창 전부 `accepted durable:true`, `eeg_feature_windows` 10행, `not_ready` 0. 투영·방송은 실패/지연해도 ACK 에 영향 없음 | 클라 ACK + DB count + 로그 "투영 실패/건너뜀" 허용 |
| **V-A2** | A | **RESYNCING 중 저장** | join 후 snapshot 미수락(`pending_snapshot` 있음) 상태에서 metric 전송 | 저장 `accepted durable:true`. 명령(`live:command`)은 현행대로 `not_ready` 유지 | ACK + DB |
| **V-A3** | A | 저장 판정은 변하지 않음 | DEGRADED 상태에서 ① 구 generation 창 ② 동의 철회 후 창 ③ cutoff 이후 창 전송 | 각각 `stale_owner_generation`·`consent_withdrawn`·`window_after_cutoff` 거절. DEGRADED 라서 더 받아주거나 덜 받아주지 않는다 | 응답 코드 + DB 행 0 |
| **V-A4** | A | **join 전만 `not_ready`** | CONNECTING(join 미완) 에서 metric 전송 / REVOKED 후 전송 | CONNECTING: `not_ready retry:true`. REVOKED/TERMINAL: `not_ready` 또는 `forbidden`, 저장 0 | 응답 + DB |
| **V-A5** | A | **feature archive 재생 리허설(실데이터)** | 10/31 시연 세션(특징창 3분치만 저장된 세션)의 `uploaded` feature artifact 에 `scripts/replay_feature_artifacts.py --session` 실행 | `eeg_feature_windows` 행 수가 artifact `row_count` 합계 − 기존 중복 만큼 증가, `device_timestamp_ms` 전부 non-null, `source='archive_replay'`, outbox 증가 0, 격리(`unresolved_stream`) 건수 보고. 재실행 시 증가 0(멱등) | DB count 전후, artifact replay_status, 리포트 구간 필터 안에 드는지(`started_at~ended_at`) |
| **V-A6** | A | 재생 vs live 중복·충돌 | 같은 창이 live 로 저장된 뒤 archive 재생 | 중복은 건너뜀(행 1), hash 다르면 첫 저장 보존 + `feature_hash_conflict` 기록 | DB + 재생 로그 |
| **V-A7** | A | 재생의 동의·cutoff 준수 | 동의 철회된 참가자의 artifact / cutoff 이후 창만 든 artifact 재생 | 삽입 0, `replay_status='rejected:consent_withdrawn'`·`window_after_cutoff` | DB + 상태 |
| **V-A8** | A | **feature summary API(F-S2)** | 참가자 600창 중 100~159·400~419 를 DB 에서 지운 상태로 본인/타인/호스트 조회 | 본인·호스트 200, 타인 403. `count=520`, `missing_ranges=[[100,159],[400,419]]`, `contiguous_through=99`. stream·generation 별 분리 | pytest + DB 대조 |
| **V-A9** | A | **REST 배치 접수(F-S1)** | 소켓 없이 JWT / `X-Entry-Credential` 로 ≤300창 envelope 전송(①정상 ②이미 live 로 저장된 창 ③구 generation·같은 participant ④동의 철회 후 창 ⑤cutoff 이후 창 ⑥lease 만료 뒤 창) | ① `accepted durable:true`·DB 행 ② `duplicate` ③ `accepted`(historical, 소유 participant 일치) ④ `consent_withdrawn` 거절 ⑤ `window_after_cutoff` 거절 ⑥ **accepted**(historical 은 lease·offline_bound 미적용). live 투영·outbox 증가 0. 301창은 422 | 응답 + DB + outbox |
| **V-A10** | A | **3단계 대조 종단(40기기 혼합)** | 합성 40기기 10분 측정 중: 10기기 네트워크 3분 단절, 10기기 세션 종료 직후 강제종료 → 2분 뒤 재실행(클래스 화면 미진입), 10기기 종료 시 Wi-Fi 끊고 5분 뒤 복귀, 10기기 정상. 전원 동시 종료 | 20분 안에 **40명 전원 feature 600/600·중복 0, 원시 100% `uploaded`·S3 전수 대조 일치**, summary `missing_ranges=[]`, 로컬 outbox·archive pending 0. 첫 presign/배치 0~60s 분산 | QA 스크립트: 서버 DB·S3 집계 vs 기기별 로컬 수량 표 |
| **V-A11** | A | 소켓 없이 outbox drain(F-N2) | 측정 중 소켓만 끊고(서버 소켓 포트 차단) BLE 측정 지속 5분 | N초 후 REST 배치로 창이 계속 저장(`accepted`), 복귀 후 live:metric 로 전환해도 duplicate 만 발생·유실 0 | DB 창 증가 추이 + 거절 0 |
| **V-A12** | A | 격리 정책(F-N3) | lease 만료 뒤 창을 live 로 보내 `pending_time_review` 거절 수신 | 격리가 아니라 historical 재시도 큐 → F-S1 로 재전송 → `accepted`. `consent_withdrawn`·`feature_hash_conflict` 는 최종 격리 | 클라 outbox 상태 + DB |
| **V-A13** | A | 웹 outbox 영속(F-W1) | 웹 참가자 6분 오프라인(360창 적체) → 탭 새로고침 → 복귀 | 300 초과 폐기 0, IndexedDB 에서 전량 복원·전송 → 600/600 | IndexedDB 건수 + DB |

## A. 서버 단위·통합 (V-S) — 실제 PostgreSQL

| ID | 등급 | 시나리오 | 입력 | 기대 결과 | 측정 |
|---|---|---|---|---|---|
| V-S1 | A | 멱등·중복 | 같은 (participant, stream, sequence) 동일 hash 20회 동시 전송 | 물리 행 1, 나머지 `duplicate durable:true` | pytest 동시성(스레드 20) + DB count |
| V-S2 | A | hash 충돌 | 같은 identity 다른 hash 동시 2건 | 첫 저장 보존, 둘째 `feature_hash_conflict` | 응답 코드 + DB 행 hash |
| V-S3 | A | fencing | 구 generation 창 전송(takeover 후) | `stale_owner_generation` 거절, outbox 역전 0 | 응답 + outbox `entity_version` 단조 |
| V-S4 | 후속 | NOWAIT 후 마지막 창 투영 | 마지막 창이 epoch 락 충돌로 건너뜀, 이후 수신 없음 | ≤1초(C1 후) 또는 다음 heartbeat 드레인(C1 전) 안에 dirty 재투영 | outbox 최신 `sequence` == 마지막 창 |
| V-S5 | A | **DEGRADED 복귀** | heartbeat 중 Redis 15초 정지 → 복구 | 연속 3회 실패 후 `live:degraded`, 복구 뒤 성공 1회에 `READY`, `recovered:true`. RESYNCING·REVOKED 불변. **복귀 전에도 metric 은 저장됨(V-A1)** | 서버 로그 상태 전이 + 클라 ACK |
| V-S6 | A | NOWAIT 플래그 off | `LIVE_V2_PROJECT_NOWAIT=false` | 현행 대기 경로와 동일(회귀 없음) | 기존 live 테스트 전부 통과 |
| V-S7 | A | **투영 실패 ≠ 저장 실패** | 투영 트랜잭션에 오류 주입 | ACK `accepted durable:true`, feature 행 존재 | DB + 로그 1건 |
| V-S8 | A | heartbeat 세션당 1회 | 40연결 1세션 | `publish_session_sync` ≤1회/`V2_HEARTBEAT_S`/세션(스레드풀 보호) | 카운터 로그 |
| V-S9 | 후속 | publish 틱 | 틱 300ms, 40명 1Hz | 호스트 수신 지연 P95 < 1,500ms | 시험 클라 타임스탬프 |
| V-S10 | 후속 | 락 순서·역진입 금지(pending) | ingest 와 drain 동시 | ingest 가 epoch 를 잡지 않음, 데드락 0 | pg_locks + 로그 |
| V-S11 | 후속 | feature+투영 원자성(pending) | pending UPSERT 직전 crash | 둘 다 없거나 둘 다 있음; ACK 전 crash 면 재전송→duplicate | DB + 재전송 |
| V-S12 | 후속 | drain crash(pending) | outbox 커밋 직후 crash | pending/outbox 중 하나 이상 남음, 중복 revision 0 | revision 스크립트 |
| V-S13 | 후속 | 영상·음성·상태 공존 | metric 40명 + LiveKit 토큰·녹음·device·renew·session.end | 각 P95 ≤1s(토큰/start/stop ≤2s), renew 타임아웃 0, **저장 거절 0** | 지연표 + 거절 카운터 |
| V-S14 | A | 스레드풀·DB 풀 | 32스레드·20/20 | DB 활성 < 30, QueuePool 오류 0, 스레드풀 대기 P95 < 100ms | `pg_stat_activity` + 계측 |
| V-S15 | A | 수신 요약 API | 본인/타인/호스트 | 본인·호스트 200, 타인 403. `missing_ranges`·`receipt_hash` DB 일치, 슬롯 429 0 | pytest + 독립 hash 재계산 |
| **V-S16** | **A** | **feature archive→DB 재생(A6)** | 6분 오프라인(웹: live 큐 300 초과 폐기 / 네이티브: lease 만료로 `pending_time_review` 거절) 후 feature artifact 업로드 | 거절·폐기 창이 `eeg_feature_windows` 에 `source='archive_replay'` 로 채워져 **DB 600/600**, outbox 0, 충돌 시 첫 저장 보존, `device_timestamp_ms` non-null | DB 행 수 == 생산 창 수, outbox 증가 0 |
| V-S17 | A | 24h 이후 검역 접수(A7) | deadline 지난 청크/artifact presign·ack | 플래그 on: `time_review` 저장·S3 객체 존재·live 미반영·감사 1. 승인 시 `uploaded` → 재생 실행. 플래그 off: 현행 409 | DB + 감사 로그 |
| V-S18 | 후속 | 적응형 백프레셔(C3) | executor 대기열 임계 초과 주입 | `overloaded retry_after_ms` 반환, 재전송으로 **유실 0, 최종 600/600** | 응답 분포 + DB |
| V-S19 | 후속 | NOWAIT·pending 배타 | 두 플래그 동시 on | 기동 거부 또는 pending 우선 로그 명시 | 기동 로그 |

## B. 클라이언트·네이티브 (V-C)

| ID | 등급 | 시나리오 | 입력 | 기대 결과 | 측정 |
|---|---|---|---|---|---|
| V-C1 | A | crash 경계(journal) | 패킷 append 중 kill | 마지막 정상 CRC 까지 복구, tail gap 기록 | 파일 CRC 스캔 + gap |
| V-C2 | A | 봉인 경계 | temp→rename 직전/직후 kill | orphan 재등록, 중복 alias 0 | 큐 인덱스 vs 파일 |
| V-C3 | A | ACK 유실 | PUT 200 후 ack 드롭 | 재ack → 200, 서버 행 1 | 서버 DB + receipt |
| V-C4 | A | 지터·동시성 | 40기기 동시 close | 첫 presign 0~60s 분산, 기기당 PUT ≤2, 초당 presign ≤10 | access 로그 |
| V-C5 | A | **전체 scope 이어올림** | 세션 A·B 측정 중 강제 종료 → 재실행(클래스 화면 미진입) | A·B 모두 drain, `close_state=complete` | manifest + 로컬 pending 0 |
| V-C6 | A | 계정 전환·scope 격리 | A 미완 → 로그아웃 → B 로그인 | A 전송 0·보존, B 혼입 0 | 서버 participant 별 청크 + 로컬 |
| V-C7 | A | 24h 초과 접수(클라) | deadline 지난 pending ack | 서버 A7 on: `time_review` 접수. off: 409 격리·표시·삭제 안 함 | 응답 + 로컬 |
| V-C8 | A | 종료 비차단 UI | close 직후 | 화면 이탈 가능, "업로드 중 N건" → "완료"/"확인 필요" | 스크린샷 + counts |
| V-C9 | A | **복귀 재개** | 포그라운드 복귀 | `capture.renew` 1회, **`MetricOutbox.flush()` 로 미ACK 창 전량 재전송**, archive drain, 저장 재개 | 서버 명령 로그 + feature 행 증가 |
| V-C10 | A | 429 처리 | `Retry-After` 2~6 | 하한 준수 + full jitter, dead_letter 0 | 클라 로그 |
| V-C11 | 후속 | 리포트 비대기 표시 | 업로드 미완 | 리포트 생성 가능, `pending_upload`/"데이터 확인 중" 표시(R3-FE 전은 API 필드로 확인) | API + 화면 |
| V-C12 | A | 로컬 보관 정책 표시 | 다른 계정 scope·7일 미완료 | "전송 못 한 측정 데이터 N건" 표시, 자동 삭제 0 | 화면 + 파일 |

## C. dev 부하 재시험 (V-L) — 묶음 전송·1Hz 생산 시계 ACK 분리

| ID | 등급 | 조건 | 합격 기준 |
|---|---|---|---|
| V-L1 | A(저장 열)/후속(지연 열) | 착용 30(40연결), 600초 | **저장 열(필수)**: `not_ready` 0, 거절 0, epoch Traceback 0, 특징창 30×600/600, 중복 0, ≥30창/s. **지연 열(후속, 기록만)**: metric ACK P95, presence P95. renew 타임아웃 0 은 [A] |
| V-L2 | A/후속 | 착용 40(41연결), 600초 | 저장 열: `not_ready` 0 · 거절 0 · 40×600/600 · 중복 0 · ≥40창/s(backlog 기울기 ≤0). 지연 열 기록만 |
| V-L3 | 후속 | V-L2 + 영상·음성·상태 동시 | V-S13. 저장 열은 [A] 유지 |
| V-L4 | A | 원시 | 청크 100% `uploaded`, chunk_index 갭 0, identity 중복 0, 429 전량 재시도 확정, **S3 HEAD size·sha256 전수 대조 100%**, decoder 재생 1건 |
| V-L5 | 후속 | 호스트 | 수신 지연 P95 < 1,500ms, 누락 0 |
| V-L6 | A | 자원 | 프로세스 CPU < 90%, DB 활성 < 30, RSS 증가 없음, 스레드풀 대기 P95 < 100ms |
| V-L7 | A | 60분 소크(착용 ≥5 실밴드 + 합성) | backlog 기울기 ≤0, 저장 열 유지 |
| V-L8 | — | 11/2 09:00 판정 | V-L2 **저장 열** 미달이면 BE 는 저장 원인(스레드풀·락·DB·REST 배치)을 먼저 잡는다. 지연 열은 판정에 쓰지 않는다 |
| V-L9 | 후속 | G5: 착용 40 60분(pending 투영) | ≥40창/s, 락 보유 P95<50ms, 요청당 커밋 1회, pending age P95<2s |
| V-L10 | 후속 | G6: `--workers 2` | V-L3 전부 + 워커 재시작 중 유실 0, 워커 간 불일치 0 |
| **V-L11** | **A** | **40명 DEGRADED 주입** | V-L2 진행 중 5분 시점에 Redis 60초 정지 | 정지 중에도 metric `accepted durable:true`, 종료 시 40×600/600, `not_ready` 0. 호스트 화면은 정지 중 멈춰도 됨(C) |

독립 검증: 서버 DB 집계 스크립트(창 수·identity 중복·연속 구간·hash·**거절 코드별 카운트**)와 클라 manifest 대조. 시험 데이터 삭제는 목록 제시 후 승인.

## D. 실밴드·앱 시험 (V-B) — **구현 후 수행**(대표 결정). iOS·Android 후보 빌드 각 1대 이상, dev

| ID | 등급 | 시나리오 | 기대 결과 |
|---|---|---|---|
| V-B1 | A | 60분 연속 측정 | 특징창 3,600±허용, 원시 청크 연속, gap 0, 60분 파일 크기 기록 |
| V-B2 | A | 화면 잠금 3분 → 복귀 | 네이티브 측정 지속(결측 0) 또는 gap 1건, 저장 재개(renew→flush→drain) |
| V-B3 | A | 백그라운드 3분 → 복귀 | V-B2 와 동일 |
| V-B4 | A | BLE OFF 1분 → ON | 자동 재연결, gap 1건·시각·이유 기록, 가짜 보간 0 |
| V-B5 | A | 비행기 모드 6분 → 해제 | 네이티브: outbox 전량 flush(live 또는 REST), lease 만료분은 historical 재시도(F-N3)로 **F-S1 수락 → DB 600/600**; F-S1 전 구앱은 A6 재생으로 600/600. 웹: F-W1 영속분 전송 → 600/600 |
| V-B6 | A | 강제 종료 → 다른 화면으로 재실행 | V-C5: 이어올림 자동 |
| V-B7 | A | 24h 넘긴 미완료 archive | V-C7 |
| V-B8 | A | 저용량(여유 < 100MB) | 수집 중단 명시·이전 파일 보존, 삭제 0 |
| V-B9 | A | 종료 직후 앱 종료 → 10분 뒤 재실행 | 잔여 전송 완료, `close_state=complete` |
| V-B10 | A | 다른 계정 로그인 | V-C6 |
| V-B11 | 후속 | **실밴드 리포트 종단** | 착용 1명 10분 세션 종료 → 리포트 생성 → 해당 회원 리포트에 창 ≈600 반영, 결측 표기 없음. 서사·변화량만, 종합점수 없음 |

각 시도마다 앱 버전·측정 backend·소켓 상태·BLE 패킷 수·journal seq·feature ACK·서버 count·**자기 화면 지표 출처(local/server)** 를 같은 시간축으로 기록한다.

## E. 배포·롤백 (V-D)

| ID | 등급 | 확인 |
|---|---|---|
| V-D1 | A | 플래그 각각 off 로 현행 경로 복귀(재기동 1회), 기존 live 테스트 전부 통과. `LIVE_V2_INGEST_STORE_FIRST=false` 면 현행 `not_ready` 동작, `LIVE_V2_REST_FEATURE_BATCH=false` 면 404 |
| V-D2 | A | `python3 scripts/check-alembic-heads.py` 헤드 1개(P2 replay 상태·P5 pending 마이그레이션 진입 시) |
| V-D3 | A | S3 HEAD 403 원인 기록(키 값 미출력), ack 검증 성공 |
| V-D4 | A | 후보 빌드 버전 기록, 11/4 현장 기기 설치 목록 |
| V-D5 | A | prod 릴리즈 전 롤백 리허설 |
| V-D6 | A(선호) | **구앱 호환(선호)**: vc31/iOS31 앱이 새 서버에서 join·metric·presign/ack·close 기존대로. A1 로 구앱의 `not_ready` 재시도 루프가 사라지고 저장됨, A6 로 구앱 artifact 가 DB 로 재생됨 |
| V-D7 | 후속 | P5 롤백 절차: writer off → pending 0 → 플래그 off |
| **V-D8** | A | **재생 소급 절차**: `scripts/replay_feature_artifacts.py --session --dry-run` 이 삽입 예정 행 수·격리 건수를 보여주고, 실제 실행은 승인 후. 운영 DB 에는 DEPLOY 창구만 |

## G. 리포트 보장 (V-R) — 후속(저장 완결성에 영향 없음), plan §9 R1~R3

| ID | 등급 | 시나리오 | 입력 | 기대 결과 | 측정 |
|---|---|---|---|---|---|
| **V-R1** | 후속 | **결측 판정·"데이터 확인 중"** | 착용 3명 10분 시험 세션: 1명 정상(600창), 1명 중간 6분 오프라인(DB 240창, artifact `pending`), 1명 밴드 미착용. 세션 종료 → 리포트 생성 | 리포트 content 에 참여자별 `data_state`: 정상 `complete`(coverage ≥0.9), 오프라인 `verifying`("데이터 확인 중", coverage 0.4, missing_ranges 1구간), 미착용 `no_data`. 클래스 평균은 complete 참여자만. 종합점수 필드 없음 | content JSON + 화면(상담사 리포트) |
| **V-R2** | 후속 | 결측 표기의 입력은 DB 만 | V-R1 의 오프라인 참가자 artifact 가 끝내 안 올라옴(10분 경과) | `verifying` → `partial` 로 전환, 결측 구간 그대로 표기. 0 으로 채우지 않음 | content 재조회 |
| **V-R3** | 후속 | **재생 후 재생성** | V-R1 오프라인 참가자의 artifact 업로드 → A6 재생 완료 | 60초 안에 승인 전 리포트가 재생성되어 `data_state=complete`, 창 600. 이미 `completed`(승인) 리포트는 내용 불변 + "새 데이터 360창" 플래그만 | 리포트 `updated_at`·content + 승인 리포트 불변 확인 |
| **V-R4** | 후속 | 지각 live 저장 후 재생성 | 세션 종료 후 A11 복귀 flush 로 창이 들어옴 | V-R3 와 같은 트리거(디바운스 60초, 세션당 동시 1) | 로그 + content |
| **V-R5** | 후속 | 리포트 트리거 존재(회귀) | 녹음 없는 명상 클래스 세션 `/end` | `generate_reports_for_session` 체인 적재, 상담사+회원 리포트 생성(F18) | Celery 로그 + reports 행 |

## H. 회원 자기 화면 (V-M) — 후속(저장 완결성에 영향 없음), plan §9 M1~M2

| ID | 등급 | 시나리오 | 입력 | 기대 결과 | 측정 |
|---|---|---|---|---|---|
| **V-M1** | 후속 | **로컬 우선** | 밴드 연결 상태에서 서버 투영을 30초 멈춤 | 자기 화면 6지표가 계속 1Hz 로 갱신(로컬 값). M1 구현 전이면 기록만 | 화면 녹화 + 지표 출처 로그(local/server) |
| **V-M2** | 후속 | 소켓 끊김·DEGRADED 중 표시 | 측정 중 Wi-Fi 끊음 60초 → 복귀 | 끊김 중 지표 유지·"연결 끊김" 배너만, 복귀 후 링버퍼(`series`)가 끊김 없이 이어짐, 서버 값으로 과거로 되돌아가지 않음 | 화면 + series 길이 |
| **V-M3** | 후속 | 로컬 없을 때 서버 폴백 | 웹 참가자, 밴드 미연결(또는 lead-off) | 서버 LiveState 값 표시(기존 동작), 10초 stale 이면 null | 화면 |
| **V-M4** | 후속 | `remoteEfficiency` 경로 | v1 경로(v2 off) 밴드 끊김 | 이완도만 서버 직전 값 대체(현행), 나머지 null — 회귀 없음 | 화면 |

## F. 체크리스트 (QA 서명)

- [ ] A-2 V-A1~A13 ([A], G1·G2·G3)
- [ ] A V-S1~S19 (Phase 미도달 항목은 N/A 와 Phase 표기)
- [ ] B V-C1~C12
- [ ] C V-L1~L11 (저장 열/지연 열 분리 기록)
- [ ] D V-B1~B11 (iOS / Android 각각, 구현 후)
- [ ] E V-D1~D8
- [ ] G V-R1~R5 (후속, 기록만)
- [ ] H V-M1~M4 (후속, 기록만)
- [ ] 11/3 go/no-go 표: **저장 완결성 하나** — feature 600/600·중복 0 (V-L2) / 원시 100%·S3 전수 (V-L4) / 종료 후 재접속 복구 (V-A10) / DEGRADED 중 저장 (V-L11) — 각각 근거와 결과
- [ ] 실패 항목과 미실시 항목을 summary.md 에 분리 보고(focused 성공과 전체 suite 실패 분리)
