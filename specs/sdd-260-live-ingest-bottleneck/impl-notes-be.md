# SDD-260 BE 트랙 구현 노트 (plan 과 달라진 점 · 사유 · 남은 위험)

## plan 과 달라진 점
| # | plan | 구현 | 사유(근거) |
|---|---|---|---|
| 1 | S1 응답 `[{sequence, status, code?, durable}]` | `{session_id, participant_id, results[{stream_id, sequence, status, durable, code?}], counts}` | stream 이 여러 개(재시작·pause)일 수 있어 키가 (stream_id, sequence). 앱 매칭 단순화. contract.md §1 |
| 2 | S1 인증 `resolve_upload_participant` | 동일 + `allow_completed=True` | 종료된 세션 사후 전송 필수(`session_service.py:3471`). 인증·소유 확정을 본문 검증보다 먼저 수행(미인증 401 이 422 에 가려지지 않게) |
| 3 | S1 301창 422 | 422 `{"code":"invalid_message","field":"windows"}` | `parse_feature_batch` (`schemas/session_live_ingest.py`). 소켓 상한(60)과 별개로 REST 는 300 |
| 4 | S1 `late = ended_at 이후` | `observed_at_ms > ended_at(ms)` | 기기 보고 시각 기준(서버 anchor 불필요). 시계 오차가 있어도 저장은 하고 표식만 |
| 5 | S3 ACK `projected\|ignored` | 동일. 단 ignored 사유 코드: session_mismatch·participant_mismatch·stream_not_found·stale_owner_generation·**not_live**(종료/만료 stream) | 소켓은 저장 판정을 안 하므로 거절이 아닌 "방송 제외" |
| 6 | S3 `_ingest` READY 가드 유지 | 유지(`session_live_namespace.py` 미수정) | 방송 전용이라 READY 에서만 의미. plan §8 BE 행(ACK 주석만)과 일치 |
| 7 | S4 `evaluate_ingest` 축소 | **함수는 그대로 두고 호출부만 제거**(`live_ingest_service`, `biosignal_service.archive_gate`) | `evaluate_ingest` 는 `tests/sdd246/commands/test_capture_cutoff_pg.py` 가 단위 검증 중이고 다른 호출자가 없어졌을 뿐 삭제 이득이 없다. 호출 0건 → 죽은 코드지만 후속 정리(요청 범위 밖) |
| 8 | S4 `CaptureStream.close_deadline_at` 컬럼 유지 | 유지. 단 `biosignal_orphan_sweep` 이 `close_deadline_at` 로 stream 을 닫음(`biosignal_orphan_sweep.py:87-98`) | 저장 거절과 무관(stream 닫기만). 건드리지 않음 |
| 9 | S5 anyio 토큰 64 | `lifespan` 에서 `total_tokens=64`, 기본 executor 32 | `config.py` 에 `default_executor_workers`·`anyio_thread_tokens` 설정화 |
| 10 | S5 DB 풀 20+20 | 기본값 변경(20+20). **프로세스별**이라 웹 1 + Celery 자식 8 이면 이론 상한 40+8×40 — `.env` 로 Celery 쪽을 낮춰야 RDS 79 이내 | 기존 주석(`config.py` 풀 설명) 참조. DEPLOY 가 `.env.dev` 에서 `DB_POOL_SIZE` 를 프로세스별로 조정 필요 |
| 11 | S7 `core/metrics.py`[추정] | 신규 `core/ingest_metrics.py` (프로세스 내 카운터) + `GET /api/v1/admin/ingest-metrics`(platform_admin) + 배치당 `[ingest-batch]` 로그 | 코드에 `core/metrics.py`·Prometheus 없음(grep 확인). 다중 워커가 되면 프로세스별 값이라 후속에서 이관 |
| 12 | (plan 외) 원시 summary | `GET /biosignal-raw/summary` 추가 | plan §4 S2 본문은 feature 만 적었으나 §5.1 N5·verify V-S15 가 원시 summary 를 요구. contract.md §3 |
| 13 | (plan 외) 응답 모델 | `FeatureBatchResponse/FeatureSummaryResponse/RawSummaryResponse` | OpenAPI 계약 테스트(`CS8`)가 response_model 미지정 라우트 증가를 막음. 골든은 가산 갱신 |

## 시험 쪽 변경(구 v1 `POST /sessions/{id}/features` 삭제 여파)
- 17개 파일이 구 엔드포인트로 feature 행을 심었음 → `tests/feature_seed.py::post_features`(저장 로직 직접 호출) 로 치환. 인증·소유권 검증은 실제 `/features/batch` 를 빈 `windows` 로 호출해 위임(401/403/404 그대로, 통과 시 422 → 시드 진행).
- `tests/test_rest_feature_live_fallback.py` 삭제: 구 REST 저장 시 소켓 방송(`notify_session_eeg`) 동작 시험. 새 설계는 REST 저장이 방송하지 않음(spec/plan: `_project_latest`·publish 호출 없음).
- `tests/sdd246/ingest`·`t12b`: "소켓이 저장한다" 단정 → "소켓=방송 전용, 저장=`store_batch`" 로 재작성(검증 의도는 유지).
- `tests/sdd246/archive`: 구 정책(409/403 cutoff·24h·offline 거절) 단정 7건 → 새 정책(V-S17: 수락, 동의 철회만 403).
- OpenAPI 골든(`tests/contract/golden/sessions_openapi.json`): v1 features 및 EEGFeatureBatch* 제거, 신규 3 라우트 추가. `sessions_shapes.json` 은 **손대지 않음**(S16 시나리오는 시드 헬퍼로 같은 모양 응답 유지).

## plan §10 정독 결과(BE 해당분)
- `core/metrics.py` 없음 → 신규 모듈(#11).
- 소켓 전역 sink 설치 경로(`install_default_ingest_sinks`)는 그대로 — `ingest_metrics` 반환 형태만 바뀜(`acks[].status` projected|ignored).
- WS 의 구 v1 경로 `session_live_namespace.py:751,1163`(`persist_feature_windows`, 레거시 `session:feature` 이벤트)는 **그대로 남아 DB 에 저장**한다. 앱(N1 이후)은 이 경로를 쓰지 않지만 서버에는 살아있다. 호환 폐기 방침이면 후속 삭제 대상(이 PR 범위 밖, 웹 트랙의 `useBand` 와 같이 정리해야 해서 보류).

## 남은 위험 · 확인하지 못한 것
1. **`summary` 의 한계**: 서버는 `min_index` 이전/`max_index` 이후 누락을 알 수 없다. 앱 완료 판정은 contract.md §2 규칙(로컬 최대 sequence 와 비교) 필수. 앱 트랙에 전달 필요.
2. **동시 다른 hash**: 경합으로 저장을 못 한 창은 승자 행의 hash 를 재조회해 같으면 `duplicate`, 다르면 `hash_conflict` 로 판정한다(`store_batch` 끝부분). 시험은 동시 2건 5회 반복 통과했으나 실제 경합이 매번 발생한다는 보장은 없다(순차 경로는 확정 검증).
3. **부하 미검증**: V-S14(40기기×5초 배치 + 소켓 40 방송 시 DB 활성 <30, P95 <500ms)와 V-L* 는 QA 부하 스크립트 몫이며 이 트랙에서 실행하지 않았다. 단일 테스트로 300창 1회 <2s, 동시 20회 300창 멱등은 확인.
4. **로컬 환경**: SQLite 기반 기존 스위트 + PG 임시 DB(`sdd246_t03_*`) 하네스로 실행. 운영/dev DB·서버 접근 없음. alembic upgrade 는 시험 하네스가 PG 에 적용(성공). downgrade 리허설(V-D1)은 **미실시**.
5. **Celery 프로세스별 풀**: #10 참조 — DEPLOY 가 `.env.dev` 값 확인 필요.
6. **`ingest_path='legacy'`**: 마이그레이션 이전 모든 행과 WS 레거시 경로 행이 `legacy`. 리포트는 구분하지 않음.
