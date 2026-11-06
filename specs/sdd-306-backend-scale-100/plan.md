# SDD-306 Plan

## 1. 다중 프로세스 방식 결정 — (C) 소켓 1프로세스 + 읽기/저장 REST 다중 프로세스

| 후보 | 내용 | 판정 |
|---|---|---|
| A | 회차(session_id) 일관 해시 + 포트별 uvicorn N | 기각 — 소켓 핸드셰이크에 session_id 가 없다(`live:join` 이벤트로 뒤늦게 옴, connect 의 `auth` 는 token 만). nginx 가 해시 키로 못 쓴다. 쿼리 추가는 앱 재빌드 필요. |
| B | 전역 상태 Redis 이전 | 기각 — `_active_signals` 등 11개 dict + 채팅 3개 dict, 범위·위험 큼. |
| **C** | `/socket.io` 와 상태 변경 REST 는 8000(소켓 프로세스) 고정, **허용목록 REST 만** 8001~800N 으로 분산 | **채택** — 소켓 상태는 한 프로세스에만 있어 WS-01 제약을 그대로 만족. 부하의 대부분(REST)만 코어를 나눠 쓴다. 단일 프로세스(로컬·테스트·`REST_PORTS` 미지정)는 현행 그대로. |

### 코드로 확인한 프로세스 전역 상태 의존 (전수조사)
- `grep session_live_namespace|_active_signals|clear_session_state app` 결과, 소켓 모듈을 쓰는 REST/서비스 경로는 전부 **쓰기(상태 변경)** 경로다: `api/v1/session.py:140,1290`(schedule_publish), `session_service.py`(`_notify_session_state/_participant_changed/_speaking_changed/_device_status/_promoted`), `class_participation_service.py:405`(대기실 알림), `class_effect_service.py:154`, `class_guest_service/record_service/class_attendance_service`(→`_notify_participant_changed`).
- `chat_namespace._sid_users/_user_sids/_sid_viewing`: `api/v1/account.py:164`(계정 삭제 시 소켓 끊기), `auth.py`·`org.py`·`admin.py`(프로필 변경 → `broadcast_profile_updated`). 모두 쓰기 경로.
- **허용목록(분산 대상) 엔드포인트는 위 어느 것도 호출하지 않음**을 시험(V8)이 소스 수준에서 고정한다.
- 모듈 전역 캐시: `upload_status_service/_overview`(1~2초 TTL, 프로세스별 따로 → 허용 오차 내), `ingest_signal_log._last_warn`(로그 throttle), `core/ingest_metrics`(관리자 통계 — **프로세스별로 쪼개짐**, 분산 후 관리자 수치는 REST 프로세스 합이 아님. 후속 과제로 기록), `api/deps._archive_slots`(프로세스별 슬롯 32 → 프로세스당이므로 분산하면 총량이 늘어 오히려 완화). rate limit 은 Redis 기반(로그인 잠금) → 공유됨.
- `outbox_worker.poll_and_deliver_ws`: 모든 프로세스 lifespan 에서 돌지만 `FOR UPDATE SKIP LOCKED` 로 중복 방지(CEL-OUTBOX-03), emit 은 AsyncRedisManager 가 중계 → 안전.

### 라우팅 허용목록 (nginx `map "$request_method $uri"` → `mb_rest`, 그 외 전부 `mb_socket`)
| 메서드 | 경로 | 비고 |
|---|---|---|
| GET | `/api/v1/sessions/{uuid}` | get_session (p95 5.1초) |
| POST | `/api/v1/sessions/{uuid}/features/batch` | 분석창 저장 |
| POST | `/api/v1/sessions/{uuid}/biosignal-raw/(presign\|ack)` | 청크 업로드 |
| POST | `/api/v1/sessions/{uuid}/biosignal-artifacts/(presign\|ack)` | 산출물 업로드 |
| GET | `/api/v1/sessions/{uuid}/biosignal-raw/summary` | 읽기 |
| GET | `/api/v1/classes/{uuid}` , `/classes/{uuid}/members` | 상담사 새로고침 |
| POST | `/api/v1/auth/(login\|refresh)` | bcrypt CPU 부하 |

`enter`·`join`·세션 전이·명령 REST 폴백(`/live/command`)·채팅·계정·`/socket.io/` 는 모두 소켓 프로세스(8000). 배포 초기에 `REST_PORTS` 미지정이면 `mb_rest` = 8000 하나라 동작이 변하지 않는다.

## 2. 소켓 `metric` `not_ready` 52% — 원인 판정: **서버 결함**(도구 문제 아님)
- 거절 위치: `session_live_namespace.py::_ingest` — `conn.state != "READY"` 이면 `not_ready`.
- 경로: 시험 중 `capture.renew` 35건이 `projection_pending` (outbox drain 지연, **committed=True 인 일시 지연**) → `live_command` 가 `outcome.degraded` 를 보고 `conn.state = "DEGRADED"` 로 전환. 그런데 **DEGRADED → READY 로 돌아오는 서버 경로가 없다**(heartbeat 루프는 `degraded_notified` 플래그만 내리고 상태는 유지). 클라이언트 앱은 `live:degraded` 를 받아야 resync 하는데 명령 경로의 DEGRADED 는 그 이벤트가 안 나간다 → 연결이 영구 `not_ready`. 8,000건 중 4,135건(52%)이 이후 거절된 숫자와 맞는다.
- 수정(서버): ① `projection_pending`(일시 지연)은 DEGRADED 로 만들지 않는다 — Redis 불가(`live_unavailable`)만 DEGRADED. ② DEGRADED 연결에서 heartbeat 가 성공하면 상태를 직접 바꾸지 않고 `live:resync_required` 를 보내 클라이언트가 snapshot 으로 READY 복귀하게 한다(놓친 이벤트 방지). 순수 함수 `state_after_command`/`heartbeat_needs_resync` 로 분리해 시험.
- `session.start` `invalid_state`: 시험 도구가 이미 `in_progress` 인 회차(이전 run 이 시작해 둔)에 다시 `session.start` 를 보내 `TRANSITIONS["start"]` (`ready/scheduled/open` 에서만)가 400 → `invalid_state`. **서버 정상, 도구 문제**. 시뮬레이터가 `in_progress` 면 start 를 건너뛰도록 수정(`backend/scripts/loadtest/` 는 이 브랜치에 추적되지 않은 파일이라 이번 SDD 에서는 보고서에 수정 방법만 기록하고, 3단계 직전 도구 정비 시 반영).
- `capture.renew` `projection_pending` 35건: 서버 처리량 부족(단일 프로세스 포화)의 증상. ①로 연결 상태는 안 깨지고, 분산으로 해소 기대. 100명 재시험에서 비율 재확인.

## 3. DB 풀 계산
- RDS `db.m7g.xlarge` max_connections 1702. 안전 상한 50% = 851.
- 현재 프로세스당 20+20 = 40(`db_pool_size=20`, `db_max_overflow=20`; 주: brief 의 10+10 은 SDD-260 이전 값).
- 100명 구성: 소켓 1 + REST 4 = 5개 uvicorn × 40 = 200, Celery 5종 자식 8 × 40 = 320(이론 최대, 평상시 한 자릿수), cron 잡 timer 동시 소수. **이론 최대 ≈ 540 < 851**. 평상시 사용 연결은 40명 시험 기준 38 → 100명이면 분산 후 ≈ 100 내외로 예상.
- 결정: **코드 기본값 20+20 유지**(프로세스를 늘리는 것이 풀 확대보다 안전; 운영 영향 없음). 환경변수 `DB_POOL_SIZE`/`DB_MAX_OVERFLOW`(pydantic 자동)로 프로세스별 조정 가능함을 시험(V5)으로 고정. 풀 확대는 3단계 계측(연결 최대치)에서 부족이 보일 때만.

## 4. nginx · uvicorn · systemd 한도 (100명 기준)
- 부하 산식: 40명 최대 63 req/s → 100명 ≈ 160 req/s, 상담사 새로고침 폭주 순간 300+/s.
- nginx: `worker_connections 768` — 동시 소켓 100 + 클라이언트 REST + 업스트림 연결(연결당 2개)로 768 은 부족 가능성 → **4096**, `worker_rlimit_nofile 65535`. 업스트림 `keepalive 64`(REST) + `proxy_http_version 1.1`, `Connection ""`(REST 쪽은 keepalive 용). 소켓 쪽은 기존 Upgrade 헤더 유지.
- uvicorn: `--backlog 2048`, `--timeout-keep-alive 30`, `--limit-concurrency` 는 걸지 않음(걸면 503 으로 5xx 가 늘어남 — 합격 기준 5xx 0 에 반함. 대신 DB 풀·archive 슬롯이 이미 429 로 조절).
- systemd: `LimitNOFILE=65535` (현재 1024), REST 인스턴스는 템플릿 유닛 `mindbreeze-backend-rest@.service` (`%i`=포트).
- `worker_connections`/`worker_rlimit_nofile` 은 nginx.conf 메인 컨텍스트라 사이트 템플릿 밖 → `deploy/dev/scale-100-apply.sh` 가 백업 후 적용·롤백한다(3단계에서만 실행).

## 5. 변경 파일
| 파일 | 변경 |
|---|---|
| `backend/app/ws/session_live_namespace.py` | `state_after_command`/`heartbeat_needs_resync` 추가, `live_command`·`_hb_loop` 에서 사용 |
| `deploy/templates/nginx/mindbreeze.conf.tpl` | `upstream mb_socket/mb_rest`, 허용목록 `map`, API 서버 `proxy_pass http://$mb_backend` |
| `deploy/templates/systemd/mindbreeze-backend-rest@.service.tpl` | REST 전용 인스턴스 유닛(신규) |
| `deploy/templates/systemd/mindbreeze-backend.service.tpl` | `LimitNOFILE`, `--backlog`, `--timeout-keep-alive` |
| `deploy/render.py` | `REST_PORTS` → `REST_UPSTREAM_SERVERS` 파생, 신규 유닛 등록 |
| `deploy/dev/scale-100-apply.sh` | dev 적용·롤백 스크립트(백업 `/home/ubuntu/backup-1105/`) — 3단계 전용 |
| `backend/tests/sdd306/` | 신규 시험 |

## 6. 롤백
- 코드: 커밋 revert. 서버(3단계): `scale-100-apply.sh rollback` → `/home/ubuntu/backup-1105/` 의 nginx.conf·사이트 설정·서비스 파일 복원, `systemctl disable --now 'mindbreeze-backend-rest@*'`, `nginx -t && systemctl reload nginx`.
