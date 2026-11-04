# SDD-290 분석 — 업로드 슬롯 구조 (코드 확정)

표기: **[확정]** 코드로 확인 / **[가설]** 코드만으로 단정 불가.

## 1. 슬롯이 세는 요청
- **[확정]** 슬롯은 프로세스 전역 `threading.BoundedSemaphore(settings.archive_max_concurrent)` 하나다(`backend/app/api/deps.py:103`). 의존성 `archive_upload_slot`(`deps.py:106-121`)은 `acquire(timeout=archive_slot_wait_sec)` 실패 시 429 `{"code":"archive_busy"}` + `Retry-After` 2~6초(무작위).
- **[확정]** 아래 4개 엔드포인트가 **같은 세마포어를 공유**한다(`backend/app/api/v1/session.py:1004,1020,1036,1052`): raw presign / raw ack / artifacts presign / artifacts ack. presign과 ack는 슬롯이 분리돼 있지 않다.
- **[확정]** 엔드포인트는 `def`(동기)라 anyio 스레드에서 실행된다. 의존성도 `def`이므로 `acquire` 대기 자체가 anyio 스레드 1개를 점유한다(대기 최대 `archive_slot_wait_sec`).
- **[확정]** `/biosignal-raw/summary` 등 조회는 슬롯 비적용.

## 2. 슬롯을 쥔 채 하는 일과 보유 시간
- **presign (raw·artifacts)**: DB 조회·행 생성 + `generate_presigned_put_checksummed`(로컬 서명, 네트워크 호출 없음) + `db.commit()` (`biosignal_service.py:196-302`). **[확정]** 짧다. DB 연결은 핸들러 전 구간 보유.
- **raw ack** (`biosignal_service.py:314-382`): DB 조회 → `db.commit()`으로 연결 반납 → **슬롯을 쥔 채** 청크마다 `storage_service.verify_object_sha256`를 **순차** 호출(`storage_service.py:251-286`: `head_object`; 저장소 체크섬이 없으면 `get_object` 전체 스트리밍 해시) → 행 재조회·commit. **[확정]** 보유 시간 ≈ 청크 수 × S3 왕복. S3 클라이언트 타임아웃 연결 3초·읽기 10초·재시도 2회(`storage_service.py:294`)라 최악은 청크당 수십 초. **[가설]** 평상시 HEAD 1회는 수십 ms 수준(운영 계측 없음).
- **artifacts ack** (`biosignal_artifact_service.py:329-395`): raw ack와 같은 HEAD 순차 검증 + indices/normalization은 `_index_content`에서 `download_bytes`(S3 GET 전체 읽기)와 색인 INSERT를 **슬롯과 DB 연결을 모두 쥔 채** 수행. **[확정]** 4종 중 가장 오래 쥔다.
- 결론 **[확정]**: 슬롯 보유 시간이 긴 쪽은 ack(S3 HEAD/GET)이며, 한도를 올리면 S3 대기 요청이 늘 뿐 DB 연결은 ack 중 HEAD 구간에서는 반납된다. 보유 시간을 줄이려면 슬롯 의존성을 ack 핸들러 내부의 S3 구간만 감싸도록 재구성해야 하는데, ack 4개 핸들러·서비스 구조 변경이라 행사 1주 전 **최소 변경 원칙에 어긋난다** → 한도 상향을 택한다. (재구성 후보는 plan.md "후속")

## 3. 슬롯 32 vs 스레드·DB 풀 (동시 점유 계산)
| 자원 | 한도 | 출처 |
|---|---|---|
| anyio 스레드 | 64 | `config.py:98`, `main.py:159` |
| 기본 executor | 32 | `config.py:97`, `main.py:157` (소켓 방송·`asyncio.to_thread`용, 동기 REST 핸들러는 anyio 사용 → **[가설]** 슬롯과 직접 경쟁하지 않음) |
| DB 풀 | 20+20=40, 대기 30초 | `config.py:80-83` |

- 최악 스레드: 슬롯 보유 32 + 슬롯 대기자(스레드 1개씩, 최대 1.0초) → 최대 64 = anyio 한도에 정확히 도달 가능. **[확정]** 포화 순간에는 로그인 등 다른 동기 엔드포인트가 스레드를 잠시 기다릴 수 있다(대기 1.0초로 제한돼 지속되지 않음). 이 때문에 대기 시간을 1.5초가 아닌 **1.0초**로 한다.
- 최악 DB 연결: 슬롯 32개가 모두 연결을 쥐는 경우(presign·artifacts ack) 32 < 40. 나머지 8개+로 다른 요청 처리. ack(raw)는 HEAD 구간 반납이라 실제는 이보다 낮다. **[가설]** 실사용 점유는 dev 40명 시험으로 확인(연결 사용률 70% = 28 이하가 합격선).
- 기존 한도 16이었을 때 최악 스레드 32, 연결 16 → 상향 후 두 배. 위 계산상 한도 안.

## 4. 운영 값 변경 경로
- **[확정]** `Settings`는 환경변수가 코드 기본값보다 우선(`config.py:9-31`, pydantic-settings). 운영 `/etc/mindbreeze/prod.env`는 SSM `/mindbreeze/prod/*`에서 `deploy/render_env.py`가 렌더하며, **매니페스트(`deploy/env-manifest.tsv`)에 없는 키는 렌더 실패**(`render_env.py:4,64`). `ARCHIVE_*` 키는 매니페스트에 없다(grep 0건) → SSM에 값을 넣어도 반영되지 않고, 매니페스트 수정 = 코드 변경이다.
- **[확정]** 따라서 prod.env 우회는 불가·부적절하고 **코드 기본값 변경**이 가장 단순하다(이번 구현). 롤백 = 이전 릴리스로 되돌리거나 값 되돌린 코드 재배포 + 재시작.
- 운영 `prod.env`에 덮어쓰기가 없다는 감독 확인(spec §1)을 그대로 신뢰한다(운영 접속 금지로 재확인 안 함).
