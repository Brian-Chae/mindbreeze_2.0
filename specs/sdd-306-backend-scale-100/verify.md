# SDD-306 Verify (QA 체크리스트 — 구현 전 작성)

## 자동 시험 (`backend/tests/sdd306/`)
- [x] V1 `next_state_after_command`: 명령 ACK 가 `projection_pending`(일시 지연, committed)이면 연결 상태가 READY 로 유지된다.
- [x] V2 `next_state_after_command`: `live_unavailable`(Redis 불가)이면 DEGRADED 로 전환된다(기존 동작 유지).
- [x] V3 `heartbeat_needs_resync`: DEGRADED 연결에서 heartbeat 가 성공하면 True(→ `live:resync_required` 발송, 클라이언트가 snapshot 으로 READY 복귀). READY/RESYNCING/REVOKED/TERMINAL 은 False.
- [x] V4 회귀: READY 가 아닌 연결의 metric 은 여전히 `not_ready`(게이트 완화 없음). `capture.renew` 가 `projection_pending` 이어도 이후 metric 은 거절되지 않는다.
- [x] V5 `Settings`: `DB_POOL_SIZE`/`DB_MAX_OVERFLOW` 환경변수로 풀을 올릴 수 있고 코드 기본값은 20/20 그대로다.
- [x] V6 nginx 렌더: `upstream mb_socket`(8000) / `upstream mb_rest` 가 생성되고 `REST_PORTS` 미지정이면 mb_rest 도 8000 하나(= 현행 단일 프로세스와 동일).
- [x] V7 nginx 렌더: `REST_PORTS=8001,8002,8003,8004` 지정 시 mb_rest 에 4개 server, `least_conn`·`keepalive`가 있고 `/socket.io` 는 항상 mb_socket 이다.
- [x] V8 라우팅 허용목록: 허용목록의 모든 (메서드, 경로)가 실제 FastAPI 라우트에 존재하고, 해당 엔드포인트 소스에 소켓 방송 호출(`session_live_namespace`·`schedule_publish`·`_notify_`)이 없다.
- [x] V9 라우팅 허용목록 정규식: 허용 경로가 mb_rest 로, 상태 변경 경로(`/enter`, `/join`, `/transition`, `/api/v1/sessions` POST 등)와 `/socket.io/` 가 mb_socket 으로 간다.
- [x] V10 systemd 렌더: `mindbreeze-backend-rest@.service` 가 `--port %i`, `LimitNOFILE`, `--backlog`, `--timeout-keep-alive` 를 갖고 공백 PREFIX 에서도 ExecStart 가 하나의 인자로 렌더된다. 기존 `mindbreeze-backend.service` 도 `LimitNOFILE` 이 있고 포트 8000 유지.
- [x] V11 dev 흔적 검사 통과(운영 렌더에 dev 값 없음).

## 회귀
- [x] `tests/test_sdd210_deploy_templates.py` 전체 통과(기존 단언 포함).
- [x] `tests/sdd246/transport/test_wire_contract.py`, `test_ws_state_machine_pg.py`, `test_scope_race_pg.py`(PG 실제 실행 14건 통과), `tests/sdd260/test_resources.py`, `tests/test_auth_deps_nonblocking.py`.
- [x] `tests/test_sdd024_session_live_ws.py`, `test_sdd026_live_session_p0.py`.

## dev 수동·부하 (3단계, 감독 신호 후 — 미실시)
- [ ] 적용 전 `/etc/nginx` 와 서비스 파일을 `/home/ubuntu/backup-1105/` 로 백업, `nginx -t` 통과, `/health/ready` 200.
- [ ] 40 → 70 → 100명 각 200초(상담사 새로고침 폭주 포함), 5xx>1% / p95>2초 / CPU 포화 시 중단.
- [ ] 분석창 전량 저장, 청크 업로드 누락 0, 소켓 `not_ready` 비율, DB 연결 최대치, 프로세스별 CPU 분포, 생성기(맥미니) CPU·네트워크.
