# SDD-260 — 40명 클래스 실시간 지표 저장 병목 해소 · Verify (Stage ③, 구현 전 QA 체크리스트 · 10/31 3차판)

> **이 문서는 구현 전(2026-10-31)에 작성한 게이트다. 구현 후 사후 수정을 금지한다.** 같은 날 대표 지시 3회(완결성 우선 → 저장 단일 목표 → **호환 제약 폐기·REST 정본 저장 프로토콜**)로 구현 전 3회 개정했다. 기존 시나리오 ID 는 유지하고 의미만 새 프로토콜(`plan.md` §1)에 맞춰 다시 썼다. 시나리오를 바꿔야 하면 사유를 `summary.md` 에 적고 여기엔 손대지 않는다.
> 실행자는 구현자와 다른 사람(QA)이어야 한다. 결과는 `specs/sdd-260-live-ingest-bottleneck/test-results/` 에 날짜별로 기록한다. 개인정보·토큰·원시 payload 는 기록하지 않는다.
> **실밴드 시험(§D)은 구현 후(11/3) 수행한다**(대표 결정). 시나리오는 지금 확정.

## 등급과 합격선

| 등급 | 뜻 | 11/3 go/no-go |
|---|---|---|
| **[A]** | 저장 100%(feature→DB, 원시→S3, 3단계 대조, 이어올림, 소켓·Redis 무관) + 저장을 막는 자원(DB 풀·스레드풀·슬롯) | **한 항목이라도 미달이면 no-go** |
| **[후속]** | 리포트·자기 화면·코치 모니터링·지연·투영·다중 워커·archive 재생 | 판정에 쓰지 않음. 측정·기록만 |

**합격선(하나)**: 착용 40명·10분 — feature 참여자별 **600/600**·중복 0·REST `rejected` 0 (V-L2) · 원시 **100% `uploaded`**·갭 0·**S3 size/sha256 전수 일치** (V-L4) · 40기기 혼합 종료 후 20분 안에 feature·원시 서버 == 로컬, summary 빈 배열 (V-A10) · 소켓 차단·Redis 60초 정지 중 저장 지속 (V-A11, V-L11).

Phase 매핑: G1(서버) = V-A1~A4·A8·A9, V-S1·S2·S14·S15·S17, V-L1·L2 저장 열, V-L4. G2(앱) = V-A10~A13, V-C1~C6·C8~C10. go/no-go = §D V-B1~B10 + V-L7. §E 모든 배포. §G·§H·V-S4~S13·S16·S18·S19·V-L3·L5·L9·L10·V-A5~A7 = 후속.

판정 규칙: **입력 → 기대 결과 → 측정 방법**. "count 일치"만으로 합격 금지(identity·hash 대조 필수). [A] 는 REST `rejected` **0**(설계상 거절인 동의 철회는 시나리오에 넣지 않는다).

---

## A-2. 저장 경로 (V-A) — [A], 서버 S1~S3 · 앱 N1~N2 · 웹 W1

| ID | 등급 | 시나리오 | 입력 | 기대 결과 | 측정 |
|---|---|---|---|---|---|
| **V-A1** | A | **소켓 없이 저장** | 기기(또는 시뮬레이터)가 소켓 join 없이 REST `POST /features/batch` 로 60창 | 60창 `accepted durable:true`, `eeg_feature_windows` 60행, `ingest_path='rest'`, `device_timestamp_ms` non-null | 응답 + DB |
| **V-A2** | A | **소켓은 저장하지 않는다** | READY 상태에서 `live:metric` 60창만 보내고 REST 는 안 보냄 | ACK `projected`, **DB 행 0**, outbox(`metrics.updated`) 갱신 1. 그 뒤 REST 로 같은 60창 → `accepted` 60 | DB count + outbox |
| **V-A3** | A | 저장 판정 4종 | REST 로 ① 타 participant 창 ② 타인 소유 stream 창 ③ 동의 철회 후 창 ④ 같은 키 다른 hash | ① `participant_mismatch` ② `stream_not_owned` ③ `consent_withdrawn` ④ `hash_conflict`(첫 저장 보존). **그 외 거절 코드 없음**(lease·offline_bound·24h·straddle 없음) | 응답 + DB |
| **V-A4** | A | **지각 저장** | 세션 `ended_at` 48시간 뒤 REST 로 창 전송 | `accepted`, `late=true`, 리포트 구간 필터(`device_timestamp_ms`) 안에 들어감 | DB + `compute_class_stats` 창 수 |
| V-A5 | 후속 | feature archive 재생 리허설(A6) | 10/31 시연 세션 artifact 소급 | (후속) | — |
| V-A6 | 후속 | 재생 vs REST 중복 | — | (후속) | — |
| V-A7 | 후속 | 재생의 동의 준수 | — | (후속) | — |
| **V-A8** | A | **summary API(S2)** | 600창 중 100~159·400~419 삭제 후 본인/타인/호스트 조회 | 본인·호스트 200, 타인 403. `count=520`, `missing_ranges=[[100,159],[400,419]]`, `contiguous_through=99`, stream 별 분리, 600창 조회 < 200ms | pytest + DB |
| **V-A9** | A | **배치 한도·성능·멱등** | ① 300창 1회 ② 301창 ③ 같은 300창 20회 동시 | ① 200 < 2s ② 422 ③ 물리 행 300, 나머지 `duplicate` | 응답 시간 + DB |
| **V-A10** | A | **3단계 대조 종단(40기기 혼합)** | 합성 40기기 10분 측정: 10기기 네트워크 3분 단절, 10기기 종료 직후 kill→2분 뒤 재실행(클래스 화면 미진입), 10기기 종료 시 Wi-Fi 끊고 5분 뒤 복귀, 10기기 정상. 전원 동시 종료 | 20분 안에 **40명 feature 600/600·중복 0, 원시 100% `uploaded`·S3 전수 일치**, summary 전원 `missing_ranges=[]`, 로컬 outbox·archive pending 0, 첫 배치/presign 0~60s 분산 | QA 스크립트: 서버 DB·S3 집계 vs 기기별 로컬 수량 표 |
| **V-A11** | A | **소켓 차단 중 저장 지속** | 측정 중 서버 소켓 포트만 차단 5분(REST 는 열림) | REST 로 창이 계속 저장(5초 주기), 결측 0. 복귀 후 소켓 방송 재개, DB 중복 0 | DB 창 증가 추이 |
| **V-A12** | A | 거절 격리 정책(N1) | REST 응답에 `consent_withdrawn` 1건, `5xx` 1건, 네트워크 타임아웃 1건 주입 | `consent_withdrawn` 만 격리(재전송 0), 5xx·타임아웃은 full jitter 재시도 후 `accepted`. 소켓 ACK 로 acked 처리되는 창 **0** | 클라 outbox 상태 + 서버 로그 |
| **V-A13** | A | 웹 outbox 영속(W1) | 웹 참가자 6분 오프라인(360창) → 탭 새로고침 → 복귀 | 폐기 0, IndexedDB 전량 복원·REST 전송 → 600/600 | IndexedDB 건수 + DB |

## A. 서버 단위·통합 (V-S) — 실제 PostgreSQL

| ID | 등급 | 시나리오 | 입력 | 기대 결과 | 측정 |
|---|---|---|---|---|---|
| V-S1 | A | 멱등·중복(REST) | 같은 (participant, stream, sequence) 동일 hash 20회 동시 | 물리 행 1, 나머지 `duplicate` | pytest 동시성 + DB |
| V-S2 | A | hash 충돌(REST) | 같은 identity 다른 hash 동시 2건 | 첫 저장 보존, 둘째 `hash_conflict` | 응답 + DB |
| V-S3 | A | 소유권 | 타인 소유 stream 으로 창 전송 | `stream_not_owned`, 행 0 | 응답 + DB |
| V-S4 | 후속 | NOWAIT 후 마지막 창 투영 | — | (후속 C1) | — |
| V-S5 | 후속 | DEGRADED 복귀 | — | (후속 A2) | — |
| V-S6 | 후속 | NOWAIT 플래그 off | — | (후속) | — |
| V-S7 | A | **투영 실패 ≠ 저장** | 소켓 투영 트랜잭션에 오류 주입하며 REST 저장 진행 | REST `accepted` 전부, DB 행 전부. 투영 오류 로그만 | DB + 로그 |
| V-S8 | 후속 | heartbeat 세션당 1회 | — | (후속) | — |
| V-S9~S12 | 후속 | publish 틱·pending 투영 | — | (후속 C1·C2) | — |
| V-S13 | 후속 | 영상·음성·상태 공존 | — | 기록만 | — |
| V-S14 | A | DB 풀·스레드풀 | REST 40기기 5초 배치 + 소켓 40 방송 | DB 활성 < 30, QueuePool 오류 0, anyio 토큰 고갈 0, REST 처리 P95 < 500ms | `pg_stat_activity` + 계측 |
| V-S15 | A | 원시 summary API | 본인/타인/호스트 | 본인·호스트 200, 타인 403. `missing_ranges`·`receipt_hash` DB 일치, 슬롯 429 0 | pytest + hash 재계산 |
| V-S16 | 후속 | feature archive→DB 재생 | — | (후속 A6) | — |
| **V-S17** | A | **24h 뒤 원시 업로드도 저장(S4)** | close 24h 지난 청크 presign/ack, feature artifact presign | 200, `uploaded`, S3 객체 존재. 409·`pending_time_review` 응답 **0** | 응답 + DB |
| V-S18 | 후속 | 적응형 백프레셔 | — | (후속) | — |
| V-S19 | 후속 | 플래그 배타 | — | (후속) | — |

## B. 클라이언트·네이티브 (V-C)

| ID | 등급 | 시나리오 | 입력 | 기대 결과 | 측정 |
|---|---|---|---|---|---|
| V-C1 | A | crash 경계(journal) | 패킷 append 중 kill | 마지막 정상 CRC 까지 복구, tail gap 기록 | CRC 스캔 + gap |
| V-C2 | A | 봉인 경계 | temp→rename 직전/직후 kill | orphan 재등록, 중복 alias 0 | 큐 vs 파일 |
| V-C3 | A | ACK 유실(원시·feature) | PUT 200 후 ack 드롭 / REST 200 응답 드롭 | 재시도 → `duplicate`/재ack 200, 서버 행 1 | 서버 DB + 로컬 |
| V-C4 | A | 지터·동시성 | 40기기 동시 close | 첫 presign/배치 0~60s 분산, 기기당 PUT ≤2, 초당 presign ≤10 | access 로그 |
| V-C5 | A | **전체 scope 이어올림** | 세션 A·B 측정 중 강제 종료 → 재실행(클래스 화면 미진입) | A·B 모두 feature·원시 drain, summary 빈 배열, `close_state=complete` | manifest + summary + 로컬 pending 0 |
| V-C6 | A | 계정 전환·scope 격리 | A 미완 → 로그아웃 → B 로그인 | A 전송 0·보존, B 혼입 0, A 재로그인 시 재개 | 서버 participant 별 + 로컬 |
| V-C7 | A | 24h 초과(클라) | deadline 지난 pending | 그냥 업로드되어 `uploaded`(S4). 격리 0 | 응답 + 로컬 |
| V-C8 | A | 종료 비차단 UI | close 직후 | 화면 이탈 가능, "업로드 중 feature N창 · 원시 M건" → "완료" | 스크린샷 + counts |
| V-C9 | A | 복귀 재개 | 포그라운드 복귀 | FeatureUploader 즉시 1회·archive drain·(소켓 있으면 renew)·측정 계속, 결측 0 | 서버 창 증가 + 로그 |
| V-C10 | A | 429 처리(원시) | `Retry-After` 2~6 | 하한 준수 + full jitter, dead_letter 0 | 클라 로그 |
| V-C11 | 후속 | 리포트 비대기 표시 | — | (후속 R3) | — |
| V-C12 | 후속 | 로컬 보관 정책 표시 | — | (후속) | — |

## C. dev 부하 재시험 (V-L) — REST 배치 모드(5초·≤60창) + 소켓 방송

| ID | 등급 | 조건 | 합격 기준 |
|---|---|---|---|
| V-L1 | A | 착용 30, 600초 | REST `rejected` 0, 30×600/600, 중복 0, 원시 100%, backlog 기울기 ≤0. (지연은 기록만) |
| **V-L2** | **A** | **착용 40, 600초** | REST `rejected` 0 · **40×600/600** · 중복 0 · 원시 100% · backlog 기울기 ≤0 |
| V-L3 | 후속 | + 영상·음성·상태 | 기록만 |
| **V-L4** | **A** | 원시 | 청크 100% `uploaded`, chunk_index 갭 0, identity 중복 0, 429 전량 재시도 확정, **S3 HEAD size·sha256 전수 100%**, decoder 재생 1건 |
| V-L5 | 후속 | 호스트 수신 지연 | 기록만 |
| V-L6 | A | 자원 | 프로세스 CPU < 90%, DB 활성 < 30, RSS 증가 없음, anyio 토큰 고갈 0 |
| **V-L7** | A | 60분 소크(실밴드 ≥5 + 합성 35) | backlog ≤0, 종료 후 전원 summary 빈 배열, 원시 100% |
| V-L8 | — | 11/2 09:00 판정 | V-L2 미달이면 BE 는 저장 원인(DB 풀·스레드·쿼리)만 잡는다 |
| V-L9 | 후속 | pending 투영 60분 | (후속) |
| V-L10 | 후속 | `--workers 2` | (후속) |
| **V-L11** | **A** | **Redis 60초 정지 주입** | V-L2 중 5분 시점 Redis 정지 → REST 저장 지속(`accepted`), 종료 시 40×600/600. 소켓 방송은 멈춰도 됨 |
| **V-L12** | A | `--mixed-close` | = V-A10 를 부하 스크립트로 실행한 결과 |

독립 검증: 서버 DB 집계 스크립트(창 수·identity 중복·연속 구간·hash·REST 거절 코드)와 기기 로컬 수량 대조. 시험 데이터 삭제는 목록 제시 후 승인.

## D. 실밴드·앱 시험 (V-B) — **구현 후(11/3)**, iOS·Android 후보 빌드 각 ≥2대, dev

| ID | 등급 | 시나리오 | 기대 결과 |
|---|---|---|---|
| V-B1 | A | 60분 연속 측정 | feature 3,600±허용 DB 저장, 원시 연속, gap 0, 60분 용량 기록 |
| V-B2 | A | 화면 잠금 3분 → 복귀 | 측정 지속(결측 0) 또는 gap 1건, REST 저장 끊김 없음 |
| V-B3 | A | 백그라운드 3분 → 복귀 | V-B2 동일 |
| V-B4 | A | BLE OFF 1분 → ON | 자동 재연결, gap 1건·시각·이유, 가짜 보간 0 |
| V-B5 | A | 비행기 모드 6분 → 해제 | outbox 적체 360창 → 해제 후 REST 로 전량 저장 → 600/600, 원시 전량 |
| V-B6 | A | 강제 종료 → 다른 화면으로 재실행 | V-C5: 이어올림 자동, 클래스 화면 미진입 |
| V-B7 | A | 24h 넘긴 미완료 | 그냥 업로드·저장(S4) |
| V-B8 | A | 저용량(여유 < 100MB) | 수집 중단 명시·이전 파일 보존, 삭제 0 |
| V-B9 | A | 종료 직후 앱 종료 → 10분 뒤 재실행 | 잔여 전송 완료, summary 빈 배열, `close_state=complete` |
| V-B10 | A | 다른 계정 로그인 | V-C6 |
| V-B11 | 후속 | 리포트 종단 | 기록만 |

각 시도마다 앱 버전·소켓 상태·BLE 패킷 수·journal seq·REST ACK 수·서버 count 를 같은 시간축으로 기록한다.

## E. 배포·롤백 (V-D)

| ID | 등급 | 확인 |
|---|---|---|
| V-D1 | A | 롤백 = 직전 릴리즈 재배포 + 마이그레이션 downgrade 1단계. 리허설 1회 |
| V-D2 | A | `python3 scripts/check-alembic-heads.py` 헤드 1개 |
| V-D3 | A | S3 HEAD 403 원인 기록(키 값 미출력), ack 검증 성공 |
| V-D4 | A | 후보 빌드 버전(Android vc, iOS build) 기록, 사이트 APK·TestFlight 교체 확인, 11/4 설치 안내 QR |
| V-D5 | A | prod 릴리즈 전 롤백 리허설 |
| V-D6 | — | (삭제) 구앱 호환 — 설치자 0명 |
| V-D7 | 후속 | P5 롤백 절차 |
| V-D8 | 후속 | 재생 소급 절차 |
| **V-D9** | A | 구 v1 `POST /{session_id}/features` 제거 확인(404) 및 프런트 참조 0건 |

## G. 리포트 (V-R) — 후속, plan §9 R1~R3

| ID | 등급 | 시나리오 | 비고 |
|---|---|---|---|
| V-R1~R5 | 후속 | 결측 판정·"데이터 확인 중"·재생성·트리거 | 이전 판 시나리오 유지(summary.md 에서 후속 SDD 로 이관) |

## H. 회원 자기 화면 (V-M) — 후속, plan §9 M1~M2

| ID | 등급 | 시나리오 | 비고 |
|---|---|---|---|
| V-M1~M4 | 후속 | 로컬 우선·끊김 중 유지·서버 폴백·remoteEfficiency | 이전 판 시나리오 유지 |

## F. 체크리스트 (QA 서명)

- [ ] A-2 V-A1~A4·A8~A13 ([A])
- [ ] A V-S1~S3·S7·S14·S15·S17 ([A]); 나머지 후속 N/A 표기
- [ ] B V-C1~C10 ([A])
- [ ] C V-L1·L2·L4·L6·L7·L11·L12 ([A]); L3·L5 기록
- [ ] D V-B1~B10 (iOS / Android 각각, 구현 후)
- [ ] E V-D1~D5·D9
- [ ] 11/3 go/no-go 표: feature 600/600 (V-L2) / 원시 100%·S3 전수 (V-L4) / 혼합 종료 복구 (V-A10) / 소켓·Redis 무관 (V-A11·L11) — 각각 근거와 결과
- [ ] 실패·미실시 항목을 summary.md 에 분리 보고
