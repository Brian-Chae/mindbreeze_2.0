# SDD-306 Summary (Stage ④~⑤ 완료, 3단계 dev 적용·부하 재시험은 감독 신호 대기)

## 결과
- 설계 (C): 소켓·상태 변경 REST 는 8000 한 프로세스, 허용목록 REST 7종만 `REST_PORTS` 인스턴스로 분산. 근거·전역 상태 의존 전수조사·DB 풀 계산·한도값은 `plan.md`.
- `not_ready` 52% 원인: **서버 결함**. `capture.renew` 의 `projection_pending`(committed 일시 지연)이 연결을 DEGRADED 로 만들고 서버엔 복귀 경로가 없었음. 수정: 일시 지연은 READY 유지(`state_after_command`), DEGRADED 연결은 heartbeat 성공 시 `live:resync_required` 발송(`heartbeat_needs_resync`). 게이트(READY 만 통과)는 완화하지 않음.
- `session.start invalid_state` 1건: **시험 도구 문제**(이미 in_progress 인 회차에 start 재전송, `TRANSITIONS["start"]` 는 ready/scheduled/open 만). 서버 정상. 도구(`sim_load_40.py`)는 이 브랜치 미추적 파일이라 3단계 전 별도 정비.
- DB 풀: 코드 기본값 20+20 유지, 환경변수 `DB_POOL_SIZE`/`DB_MAX_OVERFLOW` 로 상향 가능(시험 고정). 5프로세스 이론 최대 ≈540 < RDS 851(50%).

## 시험
- 신규 `tests/sdd306/` 22건(21 통과·1 skip). 회귀 167 통과 + PG 상태머신 14 통과.

## 미확인 / 후속
- nginx 설정 문법(`nginx -t`)은 로컬에 nginx 가 없어 미실행 → 3단계 서버에서 확인.
- dev 서버의 현재 nginx 사이트 설정은 템플릿 렌더물이 아니므로(prod 템플릿 기준) `scale-100-apply.sh` 는 유닛·한도만 적용하고 사이트 설정의 `mb_socket/mb_rest/map` 반영은 3단계에서 서버 파일을 보고 수동 병합해야 함.
- `core/ingest_metrics` 관리자 통계가 프로세스별로 쪼개짐(분산 후 REST 프로세스 수치는 합산 아님).
- `/health/ready` 는 8000 만 확인(REST 인스턴스별 헬스는 3단계 계측).
