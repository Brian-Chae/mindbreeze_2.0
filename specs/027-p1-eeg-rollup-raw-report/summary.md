# SDD-027 — Summary (P1 백엔드 구현 결과)

> 범위: 백엔드 P1 (T1 60초 롤업 · T2 raw manifest/EEGRecord 확장 · T3 presigned/ack · T4 리포트 상태머신 · T5 pytest).
> FE(T6/T7)·통합(T8)은 별도 트랙.

## 구현 결과

### T1. 60초 롤업 집계
- `app/services/eeg_rollup_service.py` — EEGFeatureWindow(1초) 온디맨드 파생(`window_index // 60`).
- 버킷마다 `sample_count`·`valid_count`(quality=="valid")·`coverage`(=valid/60, ≤1.0)·시간 범위(start_sec/end_sec)·`metrics` 제공.
- **null 보존**: 지표 평균은 비-null 샘플만 대상. 전 구간 null 지표는 None(0 치환 금지).
- **전체 평균 = 유효 샘플 수 가중**: `overall.metrics` 는 전 구간 비-null 샘플의 전역 평균(희소 버킷 과대가중 방지) — 버킷 단순 평균 아님.
- `algorithm_version` = 정규화 상수 버전(eeg_metrics).
- API: `GET /sessions/{id}/eeg-rollup?participant_id=&resolution=60` — host 전용.

### T2. EEGRawChunk 모델 + EEGRecord/Report 확장
- `EEGRawChunk`(신규): session_id/participant_id/user_id(nullable)/stream_id/chunk_index/시간범위/sample_rate/channel_count/unit/schema_version/checksum/size_bytes/object_key/upload_status. 유니크 `(session, participant, stream, chunk_index)`.
- `EEGRecord` 확장: `participant_id`·`play_group_id`·`file_count` 추가, `user_id` **nullable**(게스트 raw).
- `Report` 확장: `status`(상태머신)·`data_credibility`·`participant_id` 추가, `user_id` **nullable**(게스트 리포트).
- Alembic `b3d9e1f04277`(down_revision `a1c2e3f40261`) — 표준 PG, 기존 reports 는 `completed` 백필. 단일 head 확인.

### T3. presigned PUT + ack
- `app/services/storage_service.py` — boto3 presigned PUT. 자격증명 미설정 시 https 스텁 URL 폴백(테스트 hermetic).
- `app/services/eeg_raw_service.py` — presign(멱등 manifest 생성·동일 object_key 재사용) + ack(status=uploaded, `EEGRecord.file_count` 재계산).
- 소유 검증은 **SDD-026 `resolve_upload_participant` 재사용** — 게스트는 participant_id, 회원은 JWT. 타인 chunk ack 는 404.
- API: `POST /sessions/{id}/eeg-raw/presign`, `POST /sessions/{id}/eeg-raw/ack`.

### T4. 리포트 상태머신
- `pending_analysis → pending_review(승인 게이트) → completed / error`.
- `generate_report_inline`: 분석 성공 → `pending_review` + `data_credibility` 파생(EEG 게이트 status: valid→high / degraded→medium / invalid·insufficient→low / not_measured→None). 실패 → `error`.
- `approve_report`: `pending_review→completed`(멱등, completed 재승인 시 알림 미재발송). `pending_analysis`/`error` 는 승인 불가(400).
- 게스트 리포트: `user_id` None, `participant_id` 로 소유. 게스트는 알림 대상 제외.

### T5. pytest
- `tests/test_sdd027_rollup_raw_report.py` 17개 — 롤업(버킷/가중평균/null보존/필터/권한), raw(presign/멱등/ack/게스트 nullable user_id/회원 JWT/비참가자 403/타인 ack 차단), 리포트(pending_review/승인/게이트 차단/신뢰도 high/게스트 client report).

## 테스트 결과
```
tests/test_sdd027_rollup_raw_report.py → 17 passed
전체: 293 passed, 1 skipped (사전 skip), 23.6s
```

## 디버깅 노트
- ack `file_count` 가 0 으로 집계되는 문제 → conftest `autoflush=False` 로 인해 count 쿼리가 미-flush 된 `upload_status` 변경을 못 봄. `ack_upload` 에 `db.flush()` 추가로 해결.
- presign IntegrityError 처리에서 `db.rollback()`(전체 롤백) 제거 — `begin_nested()` 컨텍스트 매니저가 SAVEPOINT 만 롤백(SDD-026 `persist_feature_windows` 패턴과 정합).

## 금지 준수
- null→0 치환 없음(롤업 평균·data_credibility·checksum/size 모두 null 보존).
- TimescaleDB 미사용(표준 PG hypertable 아님, 온디맨드 파생).
- 기존 테스트 회귀 없음(276→293 passed).
