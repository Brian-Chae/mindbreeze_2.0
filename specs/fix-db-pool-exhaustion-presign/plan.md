# [MB261029][FIX] dev 서버 DB 연결 고갈·복귀 연결 끊김 오표시 — 원인분석·계획

## 사고 재구성 (dev, 2026-10-29 UTC, journalctl·nginx access.log 읽기 전용)
- 07:51:5x: 회차 5a802015 참가자(iOS 빌드 25)가 백그라운드 복귀 직후 `biosignal-raw/presign` 을 **0.5초 안에 10건 이상 동시 연속** 호출(같은 IP 223.38.86.24, 로그상 200). artifacts/presign 4건 포함.
- 07:52:26: `[OUTBOX-WS] poll loop error: QueuePool limit of size 10 overflow 10 reached` 최초 발생 → 이후 모든 요청 TimeoutError.
- 07:52 nginx: raw/presign 48건·raw/ack 9건·artifacts/ack 4건이 499(클라가 포기) — 백엔드는 응답 못 함. /health 도 타임아웃.
- 07:54 감독이 재시작해 복구.

## 원인 (확정 ✔ / 추정 △)
1. ✔ `biosignal_service.ack_raw` / `biosignal_artifact_service.ack` 가 **DB 트랜잭션(커넥션)을 쥔 채 `storage_service.verify_object_sha256` (S3 HEAD, 저장소 체크섬 없으면 GET 전체 스트리밍)** 을 청크마다 직렬로 호출한다 (`biosignal_service.py:350`, `biosignal_artifact_service.py:353`). boto3 클라이언트(`storage_service._s3_client`)는 timeout/retry 설정이 없어 기본 connect 60s·read 60s·재시도 5회 → 느린 S3 한 건이 커넥션을 수 분 점유.
2. ✔ presign 도 `generate_presigned_put_checksummed` 가 **호출마다 boto3 client 를 새로 만든다**(`storage_service.py:210`). 인스턴스 역할 자격 조회(IMDS 네트워크 호출)가 DB 세션 보유 중 일어난다. 청크마다 반복(요청당 최대 N회).
3. ✔ 엔드포인트는 모두 `def`(스레드풀 40) 이고 풀은 10+10=20. 한 참가자의 복귀 직후 동시 요청 수십 건이 스레드 40개를 채우면서 풀 20개를 동시에 점유 → 다른 모든 요청(로그인 포함)이 `pool_timeout 30s` 대기. **단일 참가자 독점 제한이 없다.**
4. ✔ `main.py:_outbox_ws_poll_loop` → `outbox_worker.poll_and_deliver_ws` 는 `async def` 인데 안에서 **동기 `SessionLocal()`·`.all()`·`commit()` 을 이벤트 루프 스레드에서 직접 실행**한다. 풀이 가득하면 루프 자체가 30초씩(2초 주기로) 멈춰 `/health`(async)·Socket.IO·모든 async 핸들러가 함께 정지 → "서버 멈춤" 증상의 직접 원인. (최초 오류가 이 루프에서 찍힌 이유.)
5. ✔ iOS `ArchiveUploader.pump()` 는 `queue.counts.uploading >= maxConcurrent(2)` 로 동시성을 제한하나, `uploading` 은 **PUT task 가 붙은(attach) 뒤에만** 증가한다. presign 요청 중(상태 pending)은 세지 않아, 복귀 시 `pump()` 가 연속 호출(큐 변화·네트워크 복귀·ack 성공마다 `pump()`)될 때마다 같은 pending 항목에 대해 `begin()` 이 **중복 presign** 을 쏜다 → 로그의 0.5초 10건. 항목이 실패하면 백오프(1s→60s 지수)는 있으나, 중복 요청 자체는 막지 못한다.
6. △ Android `ArchiveUploader.drain()` 은 단일 스레드 순차(항목당 presign→PUT→ack)라 동시 폭주 없음 — 대조 결과 영향 없음.
7. ✔ pool_pre_ping=True·recycle 1800 은 이미 설정됨. `get_db` 는 finally close 로 누수 없음. session-live WS 핸들러·상주 루프의 커넥션 누수는 코드상 발견 못 함(OUTBOX 루프는 finally close).

## '연결 끊김' 오표시 (앱 복귀)
- 회원 클래스 화면의 상단 `연결 끊김`·"연결이 끊겼어요 / 다시 연결" 카드는 **밴드 상태가 아니라** `deriveNetUi` (Socket.IO 끊김 ∨ 브라우저 offline ∨ LiveKit 재연결) 결과 `net==='down'` 이다 (`MemberClassContainer.tsx:662~676`). 밴드는 네이티브가 소유해 연결 유지.
- 백그라운드 동안 소켓이 끊기고, 복귀 시 서버가 멈춰 있어 소켓 재연결이 안 되므로 15초 후 `down`. 문구가 "인터넷 연결을 확인" 이라 원인(서버)·밴드 상태와 맞지 않고, 복귀 시 즉시 재연결을 시도하지도 않았다(사용자가 '다시 연결'을 눌러야 재연결).

## 수정
### 서버 (backend)
| 파일 | 변경 |
|---|---|
| `services/storage_service.py` | ① S3 클라이언트 timeout·재시도 제한(connect 3s·read 10s·retries 2) ② presign 전용 클라이언트를 설정 지문 기준 캐시(호출마다 생성 제거) |
| `services/biosignal_service.py` | ack: S3 검증 전에 필요한 값만 꺼내고 `db.commit()` 으로 커넥션 반환 → 검증 → 새 트랜잭션에서 행 재조회·반영 |
| `services/biosignal_artifact_service.py` | 동일 |
| `api/deps.py` | `archive_upload_slot` 의존성 — 프로세스 전역 `BoundedSemaphore(archive_max_concurrent=6)`; 획득 실패 시 1.5s 대기 후 **429 + Retry-After** (iOS 분류기가 429 를 백오프로 처리). get_db 보다 먼저 평가되도록 첫 인자로 배치 |
| `api/v1/session.py` | raw/artifacts presign·ack 4개 엔드포인트에 slot 적용 |
| `services/outbox_worker.py` | DB 접근(`claim`·`commit`·`close`)을 스레드풀로 이동(`expire_on_commit=False`) — 풀이 막혀도 이벤트 루프 유지 |
| `core/database.py`·`config.py` | Postgres 연결 옵션 `lock_timeout`(10s)·`statement_timeout`(120s) 설정화(0=해제) |

### 앱
| 파일 | 변경 |
|---|---|
| iOS `ArchiveUploader.swift` | presign 진행 중 alias 집합(`inFlight`)으로 중복 presign 차단, 동시 상한에 presign 단계 포함 |
| Android | 변경 없음(순차) |
| 웹 `MemberClassContainer`·`member-player-case.ts`·`MemberFullView.tsx` | ① 앱 복귀(visibilitychange/pageshow) 시 소켓·LiveKit 즉시 재연결 + 끊김 타이머 리셋 ② 브라우저는 online 인데 서버/소켓만 끊기면 "서버 재연결 중"·카드 문구 "서버에 다시 연결하는 중 · 밴드는 계속 연결돼 있어요"로 구분 |

## 범위 밖
- 풀 크기 상향(RDS max_connections 미확정 — 근본 해결 아님), Celery 경로.
- 운영: 동일 코드이므로 **동일 위험 존재**(인스턴스 역할 자격·S3 지연·동시 참가자 ↑ 시 더 큼). 본 수정이 운영에도 같은 방식으로 적용됨.
