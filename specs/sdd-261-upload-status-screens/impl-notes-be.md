# SDD-261 BE-1 구현 노트

## spec §7 첫 확인 항목 (BE 관련)
- 항목 3(실DB 시작 sequence 분포·legacy NULL 비율): **미확인** — 운영/dev DB 접근 금지 지시. 집계는 시작값을 가정하지 않고 이웃 간 빈 칸만 센다(1-based/0-based 무관).
- 항목 4(워커 수·proxy 타임아웃): **미확인**. 1초 TTL 캐시는 프로세스별이므로 워커 W개면 초당 최대 W회 계산.
- 항목 5(REPEATABLE READ 와 get_db 충돌): PG 에서 권한 확인 후 `db.rollback()` → `db.connection(isolation_level=REPEATABLE READ, postgresql_readonly=True)` 로 전환, 끝에 rollback. 임시 PG 16 으로 실행해 통과(tests/test_upload_status_pg.py). 외부에서 트랜잭션을 이미 잡은 세션이면 `InvalidRequestError` 시 기본 격리로 폴백.

## 계획과 달라진 점 / 판단
1. **권한 판정**: spec 은 `class_role()` 재사용을 암시하나 platform_admin 을 모르고 N회 쿼리라, 권한을 **1 쿼리**(exists 서브쿼리)로 직접 구현. 기준은 `class_access_service.active_membership`(활성 사용자·활성 membership·활성 기관)과 동일.
2. **403/404 구분**: 매트릭스대로 “같은 기관 활성 membership 이나 host 아님 → 403”, “기관 멤버십 없음 → 404”. 보조코치·lead 도 host 가 아니면 403. 비활성(suspended 등) 사용자는 get_current_user 단계에서 차단(401/403).
3. **응답 필드 추가**: `is_guest`, `summary`(status별 건수), `poll_interval_sec`, `etag`(본문). 교차 오리진에서 `ETag`/`X-Poll-Interval` 이 JS 에 안 보이는 경우 대비. `backend/app/main.py` 의 CORS `expose_headers` 는 BE-1 소유 밖이라 수정하지 않음 → **감독 확인 필요**(동일 오리진 `/api` 프록시면 불필요).
4. **SQL 횟수**: 본문 경로 = 권한 1 + revision 1 + 참여자 1 + feature 1 + raw 1 = 5회(PG 실측 5). 304 = 2회(실측 2). HTTP 경로는 `get_current_user` 의 사용자 조회 1회가 추가된다.
5. **revision**: spec 의 “참여자 상태 해시” 대신 참여자 수·band_connected·report_included·대기·동의 집계값을 지문에 포함. 이름 변경만으로는 ETag 가 바뀌지 않음(다음 데이터 변화 때 반영) — 계약에 명시. 60초 경과 pending 수(stale)를 포함해 시간 경과만으로 status 가 바뀌는 경우에도 ETag 가 바뀐다.
6. **raw `registered`** 는 `object_key` presign 만 된 pending 포함. `last_received_at` 은 uploaded 행만.
7. **raw 내부 결측**은 (signal_type, stream_id, segment_id) 중 SQL 은 (participant, signal, stream, segment) partition 의 lag 로 계산. 등록 행 전체(상태 무관) 기준 chunk_index 빈 칸 — chunk_index 는 0-based(현행 FeatureUploader 와 무관).
8. 수집 경로·기존 summary API 무변경. 마이그레이션 없음.

## 성능 (합성 PG 16, 40명 × feature 약 3,600행 + raw 3신호, 로컬 맥)
- 200 경로 p50 ≈ 0.49s, p95 ≈ 0.55~0.62s (목표 < 1s). 304 경로 p95 ≈ 0.10s (목표 < 0.15s). 캐시 미사용 측정.
- EXPLAIN: feature 집계는 `ix_eeg_feature_windows_session_id` Bitmap Index Scan(대형 테이블 seq scan 없음). 40명×1h 총 약 12만 행 기준. 실서버 규모에서는 QA 가 재측정 필요.

## 남은 위험
- 프로세스별 캐시: 워커 수만큼 계산이 나뉜다.
- `window_function lag` 집계는 회차 전체 행을 읽는다. 40명×1h(≈14만 행)에서는 0.5s 이나, 회차가 4배 커지면 선형 증가.
- 응답 시각(`as_of`)은 초 단위 절사. 캐시 적중 중엔 같은 값.
