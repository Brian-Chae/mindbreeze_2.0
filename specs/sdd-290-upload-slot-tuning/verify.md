# SDD-290 Verify (QA 체크리스트)

## 자동 시험 (`backend/tests/sdd290/test_upload_slot.py`)
- [x] V1 기본값 32 / 1.0, 세마포어가 새 값으로 생성
- [x] V2 32개까지 통과·33번째 429(`archive_busy`, Retry-After 2~6), 반환 후 누수 없음
- [x] V3 대기시간 내 슬롯이 풀리면 429 없이 통과
- [x] V4 대기시간 초과 시 429
- [x] V5 자원 정합: 2×슬롯 ≤ anyio 64, 슬롯 < DB 풀 40, 대기 ≤ 2초

## 회귀
- [x] `tests/sdd260/test_resources.py`(기본값 갱신), `tests/test_fix_db_pool_exhaustion_presign.py`, `tests/sdd260` 전체
- [x] `tests/test_sdd244_ingest.py`, `test_sdd244_artifacts.py`, `test_sdd243_244_runtime.py`, `tests/sdd246` — 기존 실패 4건(`sdd246/ingest/test_live_ingest_pg.py`)은 변경 전에도 동일하게 실패(기준선)

## dev 수동·부하 (배포 후, 미실시)
- [ ] 40명 시나리오 429 비율 감소
- [ ] DB 연결 피크 ≤ 28
- [ ] presign p95 < 1s, ack p95 < 3s, anyio 사용 피크 < 64
- [ ] 시험 중 로그인·/health 정상
