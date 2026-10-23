# [MB261023][FIX] 백엔드 로그인 확인 비차단 · DB 연결 수 명시

- 브랜치: `fix/backend-auth-nonblocking` (origin/develop `c90ea4cb` 기준)
- 근거 보고서: `~/.hermes/share/reviews/uvicorn-workers-review.md` 적용 순서 1번(A-1, A-3)
- 범위: 순서 1번만. 나머지 `async def` 라우트 전환(순서 2)·workers 분리(순서 3)는 하지 않음.

## 1. 원인 (측정으로 확인)

1. `get_current_user`·`get_current_user_optional`이 `async def`인데 안에서 동기 `db.query()`를 호출 → 인증 단계가 **이벤트 루프 위에서 직렬 실행**.
2. 더 심각한 것: 루프 위에서 DB 풀 커넥션을 기다리면 **교착**한다. 풀(5+10=15)이 요청이 쥔 커넥션으로 가득 차면, 인증 쿼리가 루프를 붙잡은 채 `pool_timeout`(30초)까지 대기한다. 커넥션을 쥔 요청들은 응답을 보내려면 같은 루프가 필요하므로 서로 풀리지 않는다. 수정 전 코드에서 홈 화면 3개(36건)를 동시에 보내면 재현됨(`QueuePool limit of size 5 overflow 10 reached, connection timed out, timeout 30.00` 로그).

## 2. 변경

| 파일 | 내용 |
|---|---|
| `backend/app/api/deps.py` | `get_current_user`·`get_current_user_optional`을 `def`로 전환 → FastAPI가 스레드풀에서 실행. `get_current_user_optional` 내부의 `await` 제거. `require_roles`의 `_guard`는 DB를 쓰지 않는 순수 연산이라 `async` 유지. async로 되돌리지 말라는 주석 추가 |
| `backend/app/config.py` | `db_pool_size=10`, `db_max_overflow=10`, `db_pool_timeout=30`, `db_pool_pre_ping=True`, `db_pool_recycle=1800` (환경변수로 덮어쓰기 가능) |
| `backend/app/core/database.py` | `build_engine_kwargs()` 추가 — 위 설정을 `create_engine`에 반영. SQLite URL이면 풀 인자를 붙이지 않음(테스트 환경 오류 방지) |
| `backend/tests/test_auth_deps_nonblocking.py` | 신규 6건 |
| `fix-notes/backend-auth-nonblocking/bench/` | 측정 도구(시드·지연 프록시·벤치)와 원자료(`results/*.txt`) |

### 호출부 전수 확인
- `get_current_user(`·`get_current_user_optional(`를 **직접 호출**하는 곳은 `deps.py` 내부(optional → get_current_user) 1곳뿐 → `await` 제거로 해결.
- 나머지는 모두 `Depends(...)` 경유(라우터 약 25개 파일, `require_roles` 포함). FastAPI가 `def` 의존성을 스레드풀에서 자동 실행하므로 라우트 쪽 수정 불필요. `async def` 라우트가 이 의존성을 쓰는 경우도 동일(의존성만 스레드풀로 감).
- Socket.IO 네임스페이스(`session_live`·`chat`·`record`)는 `get_current_user`를 쓰지 않고 자체 검증(`asyncio.to_thread`)을 한다 → 영향 없음. `main.py`·`tests/`에도 직접 호출·`dependency_overrides` 없음.

### 세션(스레드 안전성) 근거
- `get_db`는 동기 제너레이터 의존성 → FastAPI가 setup/teardown을 스레드풀에서 실행한다(`contextmanager_in_threadpool`). 요청당 `SessionLocal()` 1개를 만들고, 같은 요청 안의 모든 `Depends(get_db)`는 FastAPI 의존성 캐시로 **같은 세션**을 공유한다.
- 인증 → 라우트 → 정리(close)가 **순차**로만 실행되며 동시에 두 스레드가 같은 세션을 쓰는 경로가 없다(라우트가 인증보다 먼저 실행되지 않음). SQLAlchemy `Session`은 스레드에 묶이지 않고 순차 사용이면 안전하며, psycopg2 커넥션도 스레드 간 순차 사용이 허용된다. 세션이 다른 스레드로 넘어가는 것 자체는 기존 동기 `def` 라우트(291개)가 이미 하던 방식이다.
- 반환값이 ORM 객체가 아닌 `dict`라 인증 후 세션 밖으로 지연 로딩이 새지 않는다.

## 3. DB 풀 기본값(10 + 10)과 근거
- 프로세스마다 풀이 따로 생긴다(웹 1 + Celery 자식 프로세스 각각 `database.py` import). RDS `max_connections`를 확인할 수 없어 **보수적으로 프로세스당 최대 20**.
- 웹: 요청 대부분이 짧고, 스레드풀(40) 중 DB를 동시에 쥐는 수는 훨씬 적다. 6화면 72건 동시 부하에서 PG 쪽 동시 연결 최대 **17**(샘플링 기준).
- Celery 자식: email 2 + exports 1 + main 1 + report 2 + stt 2 = **8개**, 태스크당 대개 1~2개 연결. cron 스크립트(oneshot)는 각 1~2개.
- 합계: 평상시 웹 ~10~17 + Celery ~8~16 + cron 몇 개 ≈ **25~40**. 이론 상한 = 웹 20 + 자식 8×20 = 180(실제로는 도달하지 않음).
- 기존은 5+10=15(웹 상한)였다. 상한을 올렸지만 Celery 자식이 거의 안 쓰는 한도라 평상시 총량은 거의 같다.
- **미확인 항목**: RDS `max_connections`(db.t4g.micro ≈ 112, small ≈ 225 수준). OPS 창구에서 `SHOW max_connections;` 확인 필요. 부족하면 환경변수 `DB_POOL_SIZE`·`DB_MAX_OVERFLOW`로 조정(코드 수정 불필요).
- `pool_pre_ping`: RDS 재기동·유휴 끊김 후 죽은 커넥션 사용 방지(요청당 `SELECT 1` 왕복 1회 추가 — 측정치에 이미 포함). `pool_recycle=1800`: 30분마다 연결 갱신.

## 4. 측정

환경: 로컬 PostgreSQL 16, uvicorn **단일 프로세스**(`app.main:asgi_app`, 서버와 같은 방식), Redis 로컬, 상담사 토큰으로 인증 GET 12개를 `asyncio.gather`로 동시 호출. 한 "화면" = 12건(대시보드·알림 3·채팅방·클래스·세션·리포트·프로필·클라이언트·온보딩·상담관계). 5회 반복(워밍업 1회 별도), DB는 비어 있어 라우트 자체 작업은 가벼움 → **인증/풀 경로 차이가 그대로 드러남**.
RTT 시뮬레이션: PG 앞에 지연 TCP 프록시(`bench/delay_proxy.py`, 양방향 1ms → **왕복 약 2ms**, RDS 1~3ms 가정)를 두고 서버가 프록시를 거쳐 접속.
원자료: `bench/results/before.txt`, `after.txt`, `after-stress.txt`. 재현: `bench/` 상단 주석 참고(시드→프록시→uvicorn→`bench.py`).

평균(5회 평균, ms):

| 시나리오 | 구분 | 전체 완료 | 개별 p50 | 개별 최대 | 실패 |
|---|---|---|---|---|---|
| 1화면 12건, DB 직결 | 수정 전 | 116.4 | 93.0 | 112.3 | 0 |
| | 수정 후 | **48.2** | 40.1 | 45.3 | 0 |
| 1화면 12건, RTT 2ms | 수정 전 | 257.7 | 220.6 | 254.1 | 0 |
| | 수정 후 | **81.2** | 57.8 | 76.5 | 0 |
| 3화면 36건, DB 직결 | 수정 전 | **24,287** (5회 중 3회 30~45초 정지) | 24,217 | 24,273 | 180건 중 63 |
| | 수정 후 | **148.8** | 81.9 | 141.3 | 0 |
| 3화면 36건, RTT 2ms | 수정 전 | **27,310** (5회 중 3회 45초 정지) | 27,213 | 27,299 | 180건 중 95 |
| | 수정 후 | **383.2** | 229.3 | 362.7 | 0 |
| 6화면 72건, RTT 2ms | 수정 후 | 655.6 | 363.5 | 628.5 | 0 |

- 수정 전 3화면 정지가 없던 회차만 보면 직결 234~269ms, RTT 570~660ms → 수정 후(149 / 383)가 정지 없는 경우에도 약 1.5~1.7배 빠름.
- 1화면: 직결 2.4배, RTT 2ms에서 3.2배 단축. RDS처럼 왕복 지연이 있을수록 인증 직렬화 비용이 커서 효과가 큼.
- 6화면 72건(수정 전은 3화면에서 이미 정지하므로 측정 안 함)도 실패 0. 첫 회 226ms, 이후 ~700~800ms는 단일 프로세스 GIL/CPU 한계.
- 수치는 로컬 맥 기준이며 dev(t4g.medium 2코어)와 절대값이 다르다. 상대 비교용. 같은 도구로 dev에서 재측정하려면 OPS/DEPLOY 창구가 필요(이 작업에서는 서버 접속 금지).

## 5. 테스트

| 구분 | 결과 |
|---|---|
| 신규 `tests/test_auth_deps_nonblocking.py` | 6 passed (인증 의존성이 코루틴이 아님 / 스레드풀 실행 확인 / 풀 설정이 settings 반영 / 기본값 보수적 / SQLite에서 풀 인자 미부착 / 실제 엔진 풀 크기). `get_current_user`를 `async`로 되돌리면 2건이 실패하는 것 확인(변이 검증) |
| 백엔드 전체 pytest (`--ignore=tests/pg`, `-n 4`) | 수정 전(기준 `c90ea4cb`) **3434 passed, 12 skipped** → 수정 후 **3440 passed, 12 skipped**(+신규 6). 실패 0, 기존 실패 없음 |
| PG 테스트 `tests/pg` (로컬 PG16, alembic head 적용 DB, `PG_SMOKE=1`) | **464 passed** |
| 인증·권한 관련(`test_auth_*`, `test_session_authz`, `test_sdd211_*`, `test_sdd072/073` 등) | 전체 pytest에 포함되어 통과 |

## 6. 남은 리스크 · 제안 (이번 범위 밖)
1. **`async def` 라우트의 동기 DB 호출(약 69개)** 은 여전히 루프를 막는다(`auth.py`·`org.py`·`admin.py` 등). 풀이 가득 찼을 때 같은 교착이 이 경로에서 이론상 재현될 수 있다(풀 20개로 확률은 크게 낮아짐). 보고서 순서 2로 `def` 전환 권장.
2. `get_db`가 응답 **후** 세션을 닫기 때문에 커넥션을 요청 종료까지 쥔다. 풀 소진 시 대기 요청이 누적될 수 있음 → 읽기 전용 GET은 인증 직후 커넥션을 반납하는 구조는 별도 검토 대상.
3. `_outbox_ws_poll_loop`(2초 주기)의 동기 DB 쿼리가 루프에서 실행됨(보고서 A-4) — 미수정.
4. RDS `max_connections` 미확인(OPS 확인 필요). 풀 합계가 한도를 넘으면 `DB_POOL_SIZE`로 낮출 것.
5. `pool_pre_ping`으로 요청당 `SELECT 1` 왕복이 추가된다(RTT 2ms에서도 위 수치에 포함, 이득이 더 큼).
6. 배포는 develop 반영 시 백엔드 재시작(2~3분) 동반 — "테스트 중"이 아닐 때만(taskbox §2-1). 라이브 클래스(Socket.IO) 코드는 변경하지 않았고 전체 WS 관련 테스트가 통과하나, 실제 호스트 1 + 참가자 3 브라우저 회귀 확인은 배포 후 DEPLOY 창구에서 권장.
