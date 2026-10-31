# SDD-260 — 40명 클래스 실시간 지표 저장 병목 해소 · Verify (Stage ③, 구현 전 QA 체크리스트)

> **이 문서는 구현 전(2026-10-31)에 작성한 게이트다. 구현 후 사후 수정을 금지한다.** 시나리오를 바꿔야 하면 사유를 `summary.md` 에 적고 여기엔 손대지 않는다.
> 실행자는 구현자와 다른 사람(QA)이어야 한다. 결과는 `specs/sdd-260-live-ingest-bottleneck/test-results/` 에 날짜별로 기록한다.
> 근거: `plan.md`(Phase·게이트), `plan-astra.md` §6, `plan-fable.md` §5.3~5.4. 개인정보·토큰·원시 payload 는 결과에 기록하지 않는다.
> **실밴드 시험(§D)은 대표 결정으로 구현 후 수행한다.** 시나리오는 지금 확정하고, 실행은 후보 빌드가 나온 뒤(11/3 이후)다.
> Phase 매핑: §A V-S1~S9·S13~S15 = G1/G2, V-S10~S12·S18~S19 = G4, V-S16~S17 = G3. §B V-C1~C6·C8·C10 = G2, V-C7·C9·C11·C12 = G3. §C = G1(V-L1~L6)·G4(V-L2 60분)·G5(2워커). §E = 모든 배포.

판정 규칙: 각 시나리오는 **입력 → 기대 결과 → 측정 방법** 으로 쓴다. 한 항목이라도 미달이면 해당 트랙 불합격. "count 일치"만으로 합격 금지(identity·hash 대조 필수).

---

## A. 서버 단위·통합 (V-S) — 실제 PostgreSQL, 1단계·2단계 공통

| ID | 시나리오 | 입력 | 기대 결과 | 측정 |
|---|---|---|---|---|
| V-S1 | 멱등·중복 | 같은 (participant, stream, sequence) 동일 hash 20회 동시 전송 | 물리 행 1, 나머지 `duplicate durable:true` | pytest 동시성(스레드 20) + DB count |
| V-S2 | hash 충돌 | 같은 identity 다른 hash 동시 2건 | 첫 저장 보존, 둘째 `feature_hash_conflict`, accepted 로 바뀌지 않음 | 응답 코드 + DB 행 hash |
| V-S3 | fencing | 구 generation 창 전송(새 owner 가 takeover 후) | `stale_owner_generation` 거절, outbox 최신값 역전 0 | 응답 + outbox `entity_version` 단조 증가 확인 |
| V-S4 | **NOWAIT 후 마지막 창 투영** | A 의 마지막 창이 epoch 락 충돌로 건너뜀(명령으로 락 점유해 유도), 이후 A 의 수신 없음 | ≤1초 안에 dirty 재투영으로 outbox `metrics.updated` 에 마지막 창이 나타남 | outbox 최신 행 `sequence` == 마지막 창, 소켓 호스트 수신 |
| V-S5 | **DEGRADED 복귀** | heartbeat 중 Redis 일시 정지 15초(LiveNotReady 유도) → 복구 | 연속 3회 실패 후 `live:degraded`, 복구 뒤 heartbeat 성공 1회에 `READY`, 이후 `live:metric` accepted. `RESYNCING`·`REVOKED` 은 변하지 않음 | 서버 로그 상태 전이 + 클라 metric ACK |
| V-S6 | NOWAIT 플래그 off | `LIVE_V2_PROJECT_NOWAIT=false` | 현행 대기 경로와 동일 동작(회귀 없음) | 기존 live 테스트 전부 통과 |
| V-S7 | 투영 실패 ≠ 저장 실패 | 투영 트랜잭션에 오류 주입 | ACK 는 `accepted durable:true`, feature 행 존재, dirty 로 재투영 | DB + 로그 "투영 실패" 1건 |
| V-S8 | heartbeat 세션당 1회 | 40연결 1세션 | `publish_session_sync` 호출 ≤1회/`V2_HEARTBEAT_S`/세션 | 카운터 로그 |
| V-S9 | publish 틱 | 틱 300ms, 40명 1Hz | 호스트 수신 지연 P95 < 1,500ms, 틱 0 이면 즉시 publish 로 복귀 | 시험 클라 호스트 수신 타임스탬프 |
| V-S10 | 락 순서·역진입 금지(2단계) | ingest 와 drain 동시 | ingest 가 epoch 를 잡지 않음(pg_locks), 데드락 0 | pg_locks 관찰 + 로그 |
| V-S11 | feature+투영 원자성(2단계) | feature INSERT 후 pending UPSERT 직전 crash 주입 | 둘 다 없거나 둘 다 있음. ACK 전 crash 면 ACK 없음 → 클라 재전송 → duplicate | DB 상태 + 재전송 결과 |
| V-S12 | drain crash(2단계) | outbox 커밋 직후·pending 삭제 전 crash | 재시작 후 pending 또는 outbox 중 하나 이상 남음, 중복 revision 0 | revision 연속성 스크립트 |
| V-S13 | 영상·음성·상태 공존 | metric 40명 중 LiveKit 토큰·녹음 start/stop·device·renew·session.end | 각 P95 ≤1s(토큰/start/stop ≤2s), renew 타임아웃 0, epoch 락 Traceback 0 | 시험 클라 지연표 |
| V-S14 | 스레드풀·DB 풀 | 32스레드·20/20 | DB 활성 < 30, QueuePool 오류 0, presence P95 < 500ms | `pg_stat_activity` + 로그 |
| V-S16 | feature archive→DB 재생(P3-B1) | 6분 오프라인으로 live 큐 300 초과 폐기 후 feature artifact 업로드 | 폐기 창이 `eeg_feature_windows` 에 `source='archive_replay'` 로 채워짐, outbox 에는 기록 0(live 미반영), 기존 행과 충돌 시 첫 저장 보존 | DB 행 수 == 생산 창 수, outbox 증가 0 |
| V-S17 | 24h 이후 검역 접수(P3-B2) | deadline 지난 청크 presign/ack | 플래그 on: `time_review` 로 저장·S3 객체 존재·live 미반영·감사 행 1. 승인 시 `uploaded`. 플래그 off: 현행 409 | DB + 감사 로그 |
| V-S18 | 적응형 백프레셔(P4-5) | executor 대기열 임계 초과 주입 | `_ingest` 가 `overloaded retry_after_ms 2,000~5,000` 반환, 클라 재전송으로 유실 0, 임계 아래로 내려오면 정상 | 응답 코드 분포 + 최종 DB 600/600 |
| V-S19 | NOWAIT·pending 배타 | 두 플래그 동시 on | 기동 시 설정 오류로 거부 또는 pending 우선·NOWAIT 무시가 로그에 명시 | 기동 로그 |
| V-S15 | 수신 요약 API | 본인 participant / 타인 participant / 호스트 | 본인·호스트만 200, 타인 403. `missing_ranges`·`receipt_hash` 가 DB 와 일치. 슬롯 429 발생 0 | pytest + 독립 hash 재계산 |

## B. 클라이언트·네이티브 (V-C)

| ID | 시나리오 | 입력 | 기대 결과 | 측정 |
|---|---|---|---|---|
| V-C1 | crash 경계(journal) | 패킷 append 중 프로세스 kill | 재시작 후 마지막 정상 CRC 레코드까지 복구, 찢긴 tail 은 gap 기록, 중간 손상은 격리 보존 | 파일 CRC 스캔 + gap 이벤트 |
| V-C2 | 봉인 경계 | temp→rename 직전/직후 kill | orphan 봉인본 재등록, 중복 alias 0 | 큐 인덱스 vs 파일 목록 |
| V-C3 | ACK 유실 | PUT 200 후 ack 응답 드롭 | 재시도 → 같은 identity·hash 재ack → 200 재발급, 서버 행 1 | 서버 DB + 로컬 receipt |
| V-C4 | 지터·동시성 | 40기기 동시 close | 첫 presign 0~60s 분산, 기기당 동시 PUT ≤2, 서버 초당 presign ≤10 | 서버 access 로그 히스토그램 |
| V-C5 | **전체 scope 이어올림** | 세션 A·B 각각 측정 중 강제 종료(업로드 미완) → 앱 재실행, 클래스 화면 안 들어감 | Android: WorkManager 가 A·B 모두 drain. iOS: `drainPendingArchives` 가 A·B 모두 drain. 둘 다 `close_state=complete` 수렴 | 서버 manifest + 로컬 pending 0 |
| V-C6 | **계정 전환·scope 격리** | 계정 A 측정 미완 → 로그아웃 → 계정 B 로그인 | A scope 전송 0, 보존됨. A 재로그인 시 재개. B 의 요청에 A 데이터 혼입 0 | 서버 participant 별 청크 + 로컬 파일 |
| V-C7 | 24h 초과 접수(범위 판정) | close deadline 24h 지난 pending 청크 ack | 서버 409 `pending_time_review`(현행 유지, 후속 범위). 클라는 격리·표시, 삭제 안 함 | 응답 + 로컬 상태 |
| V-C8 | 종료 비차단 UI | close 직후 | 화면 이탈 가능, "업로드 중 N건(MB)" → "완료"/"확인 필요" 전이 | 스크린샷 + 네이티브 counts 이벤트 |
| V-C9 | 복귀 재개 | 포그라운드 복귀 | `capture.renew` 1회(만료 lease 도 갱신, F9), MetricOutbox flush, archive drain, 특징창 저장 재개 | 서버 명령 로그 + feature 행 증가 |
| V-C10 | 429 처리 | 서버 `Retry-After` 2~6 랜덤 | 하한 준수 + full jitter, dead_letter 0 | 클라 로그 |
| V-C12 | 로컬 보관 정책 표시(P3-N3) | 다른 계정 scope·7일 지난 미완료 존재 | 설정 화면에 "전송 못 한 측정 데이터 N건(MB)" 표시, 자동 삭제 0 | 화면 + 파일 존재 |
| V-C11 | 리포트 비대기 | 업로드 미완 상태 | 리포트 생성 가능, 데이터센터 `pending_upload` 표시 | 화면 |

## C. dev 부하 재시험 (V-L) — 묶음 전송·1Hz 생산 시계 ACK 분리

| ID | 조건 | 합격 기준 |
|---|---|---|
| V-L1 | 착용 30(호스트 포함 40연결), 600초 | ≥30창/s, 계획 ≤660초 종료, `not_ready` 0, epoch Traceback 0, 특징창 30×600/600, 중복 0, metric ACK P95 < 1,000ms, presence P95 < 500ms, renew 타임아웃 0 |
| V-L2 | 착용 40(41연결), 600초 | ≥40창/s **또는** 거절 0·유실 0, 나머지 V-L1 과 동일(40×600/600) |
| V-L3 | V-L2 + 영상·음성·상태 동시 부하 | V-S13 기준 동시 충족 |
| V-L4 | 원시 | 청크 100% `uploaded`, chunk_index 갭 0, identity 중복 0, 429 는 재시도로 전량 확정, **S3 HEAD size·sha256 무작위 ≥20건 일치**(D-1 선행), decoder 재생 1건 |
| V-L5 | 호스트 | 수신 지연 P95 < 1,500ms, 누락 0 |
| V-L6 | 자원 | 프로세스 CPU < 90%, DB 활성 < 30, RSS 지속 증가 없음, 스레드풀 대기 P95 < 100ms(계측 추가) |
| V-L7 | 60분 소크(착용 ≥5 실밴드 + 합성 보충) | backlog 기울기 ≤0, 위 기준 유지 |
| V-L9 | G4: 착용 40 60분(pending 투영 on) | ≥40창/s 지속, 락 보유 P95<50ms·최대 200ms, 요청당 커밋 1회, pending age P95<2s |
| V-L10 | G5: `--workers 2` | V-L3 전부 + 워커 1개 재시작 중 ACK 유실분 재전송으로 유실 0, 호스트 집계·대기실·오디오 동기 워커 간 불일치 0 |
| V-L8 | P4 조기 착수 판정(11/2 09:00) | V-L2 에서 `not_ready`>0 / Traceback>0 / 600 미달자 / ACK P95>1,000ms 중 하나면 T2-P 진입 |

독립 검증: 서버 DB 집계 스크립트(창 수·identity 중복·연속 구간·hash)와 클라 manifest 대조. 시험 데이터 삭제는 목록 제시 후 승인.

## D. 실밴드·앱 시험 (V-B) — **구현 후 수행**(대표 결정). iOS·Android 후보 빌드 각 1대 이상, dev

| ID | 시나리오 | 기대 결과 |
|---|---|---|
| V-B1 | 60분 연속 측정 | 특징창 3,600±허용, 원시 청크 연속, gap 0, 60분 파일 크기 기록(용량 추정 갱신) |
| V-B2 | 측정 중 화면 잠금 3분 → 복귀 | 네이티브 측정 지속(특징창 결측 0) 또는 gap 1건만, 소켓 READY, 저장 재개 |
| V-B3 | 앱 백그라운드 3분 → 복귀 | V-B2 와 동일 |
| V-B4 | BLE OFF 1분 → ON | 자동 재연결(캐시 기기), gap 1건·시각·이유 기록, 가짜 보간 0 |
| V-B5 | 비행기 모드 6분 → 해제 | live 큐 300 초과 폐기분은 gap/진단으로 기록, archive 는 전량 업로드, 복귀 후 live 정상화. G3 전: 폐기 창이 DB 에 없음을 **명시**. G3 후: P3-B1 재생으로 DB 600/600 |
| V-B6 | 강제 종료 → 다른 화면으로 재실행 | V-C5 와 동일: 이어올림 자동, 클래스 화면 미진입 |
| V-B7 | 24h 넘긴 미완료 archive | V-C7: 409 격리·표시·보존 |
| V-B8 | 저용량(여유 < 100MB) | 수집 중단 명시·이전 파일 보존, 삭제 0 |
| V-B9 | 세션 종료 직후 앱 종료 → 10분 뒤 재실행 | 잔여 전송 완료, `close_state=complete` |
| V-B10 | 다른 계정 로그인 | V-C6 |

각 시도마다 앱 버전·측정 backend(native/web)·소켓 READY·BLE 패킷 수·journal durable seq·feature ACK·서버 count·호스트 렌더를 같은 시간축으로 기록한다.

## E. 배포·롤백 (V-D)

| ID | 확인 |
|---|---|
| V-D1 | 플래그 5종 각각 off 로 현행 경로 복귀(재기동 1회), 기존 live 테스트 전부 통과 |
| V-D2 | `python3 scripts/check-alembic-heads.py` 헤드 1개(2단계 진입 시) |
| V-D3 | S3 HEAD 403 원인 기록(키 값 미출력), ack 검증 성공 확인 |
| V-D4 | 후보 빌드 버전(Android vc, iOS build) 기록, 11/4 현장 기기 설치 확인 목록 |
| V-D5 | prod 릴리즈 전 롤백 리허설: 직전 릴리즈 재설치 + env 복원 |
| V-D6 | **구앱 호환**: vc31/iOS31 앱이 새 서버에 붙어 join·metric·presign/ack·close 가 기존대로 동작(additive 확인) |
| V-D7 | P4 롤백 절차: writer off → pending 0 확인 → 플래그 off. pending 잔존 상태에서 off 하지 않음을 절차서로 확인 |

## F. 체크리스트 (QA 서명)

- [ ] A V-S1~S19 (Phase 미도달 항목은 N/A 와 Phase 표기)
- [ ] B V-C1~C12
- [ ] C V-L1~L10
- [ ] D V-B1~B10 (iOS / Android 각각, 구현 후)
- [ ] E V-D1~D7
- [ ] 실패 항목과 미실시 항목을 summary.md 에 분리 보고(focused 성공과 전체 suite 실패 분리)
