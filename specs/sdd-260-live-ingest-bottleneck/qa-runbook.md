# SDD-260 — QA 시험 절차서 (40명 저장 완결성)

- 스크립트: `backend/scripts/loadtest/loadtest_ingest_v3_40.py` (본 시험), `mock_ingest_server.py` + `test_loadtest_ingest_v3.py` (모의 서버 단위 검증)
- 계약: `contract.md` §1~3 (POST /features/batch · GET /features/summary · GET /biosignal-raw/summary). verify V-A10·V-A11·V-A12·V-A9·V-L2·V-L4·V-L12 대응.
- **이 문서는 절차서다. 실행은 감독이 dev 배포 후에 한다. 아래 서버에는 아직 실행한 적 없다.**

## 1. 합격선 (하나라도 어긋나면 불합격)

| 기준 | 값 | 판정 근거 |
|---|---|---|
| feature 완결 | 참여자별 서버 창 == 600 (summary 집합 == 로컬 장부) | `features/summary` |
| 중복 | DB 물리 행 중복 0 (`count - count(distinct (play_group_id, window_index))`) | DB 직접 조회 |
| REST 거절 | 0 (4종 거절 코드 모두) | batch 응답 `rejected` |
| 원시 | 청크 600/10×3=180개/인 100% `uploaded`, 영수증 해시 일치 | `biosignal-raw/summary` |
| S3 대조 | uploaded 청크 전수 HEAD size(+SHA-256) 일치 | boto3 HEAD |
| 복구 | 종료 후 20분 안에 서버 == 로컬 | 스크립트 데드라인 |

DB 또는 S3 자격이 없으면 해당 열은 `UNVERIFIED`, 전체 판정은 `CONDITIONAL` — **PASS 가 아니다**(검증 수단 없이 합격 처리하지 않는다).

## 2. 사전 준비

1. 의존성(로컬 임시 venv): `python3.11 -m venv ~/.hermes/cache/lt40s-venv && ~/.hermes/cache/lt40s-venv/bin/pip install httpx "python-socketio[asyncio_client]" aiohttp websockets boto3 psycopg2-binary`
2. 시험 클래스·회차를 dev 에 만들고(상담사 UI 또는 기존 loadtest-40 절차) `~/.hermes/share/loadtest-40s/state.json` 에 `{"class_id","session_id","code"}` 를 적는다. 상태 파일에는 **참가 자격(entry_credential)만** 저장되고 비밀번호는 저장되지 않는다.
3. 환경변수(전부 환경변수로만 — 인자·파일에 비밀을 남기지 않는다):
   - `LT40S_API` (기본 `https://dev-api.mindbreeze.looxidlabs.com`; 서버 직접 IP `35.75.58.187` 로 우회 시 Host/TLS 문제가 있으므로 도메인 권장)
   - `LT40S_COUNSELOR_PW` — 호스트 소켓(`session.start`)에 필요. 터미널에서 `read -s` 로 입력해 export.
   - `LT40S_DATABASE_URL` — **읽기 전용** DSN(서버 `backend/.env.dev` 에서 SELECT 전용으로). 로컬에서 RDS 에 직접 붙지 못하면 SSH 터널(`ssh -i ~/.ssh/mindbreeze/mindbreeze-dev-key.pem -L 5433:<RDS>:5432 ubuntu@18.183.86.88`) 사용.
   - `LT40S_S3_BUCKET` (기본 `mindbreeze-dev`), AWS 자격은 기본 체인(`AWS_PROFILE` 등).
4. 게스트 준비: `python loadtest_ingest_v3_40.py setup --members 40` → 이름 `LT40S-게스트-001..040`.

## 3. 실행 (시나리오 6종)

```
python loadtest_ingest_v3_40.py run --wearers 40 --seconds 600 --scenario <시나리오> [--s3-download]
```

| 시나리오 | 동작 | 검증하는 것 |
|---|---|---|
| `normal` | 40기기 10분, 5초 배치(≤60창), 10초 원시 청크, 소켓 방송 병행 | V-L2·V-L4 합격선 |
| `netdrop` | 기기별 임의 시점 60초 단절 + 60초 지연(3s, 50%) + 종료 직전 20초 30% 드롭 | 재시도·full jitter, 결측 0 |
| `sockblock` | 측정 30% 지점에서 소켓 차단(연결 끊고 재연결 시도만 집계). REST 는 계속 | V-A11: 소켓 없이도 저장 지속 |
| `mixed-close` | 10기기씩: 3분 단절 / 종료 직후 kill→2분 뒤 재실행(장부에서 이어올림) / 종료 시 Wi-Fi 5분 끊김 / 정상. 전원 동시 종료 | V-A10(=V-L12) |
| `dup-resend` | 정상 종료 후 이미 보낸 배치를 5중 동시 재전송 | V-A9 멱등: 물리 행 불변, 거절 0 |
| `rate429` | 일부 구간 429 주입(Retry-After 2) + 서버 실제 429(archive 슬롯)가 있으면 그대로 처리 | V-A12: Retry-After 하한 + full jitter 재시도 후 전량 저장 |

종료 코드: 0=PASS, 1=그 외. 결과: `~/.hermes/share/loadtest-40s/results/result-<시나리오>-<시각>.{json,md}`(`--out` 으로 변경).
리포트에는 참여자별 서버 창 수/DB창/DB중복/결측/REST 거절/원시 기대·서버/영수증 일치, 거절 코드 통계, 429 재시도 수, 종류별 지연 분포(p50/p95/p99/max), 첫 배치·첫 presign 분산(0~60s 확인), 주입 장애 횟수가 들어간다.

## 4. 해석 주의

- **원시 청크 장부**: 로컬 장부 alias 집합 − 서버 `aliases_uploaded` ≠ ∅ 이면 재큐잉·재업로드(최대 8라운드) 후 다시 대조한다. 그래도 남으면 불합격.
- **S3 403**: HEAD 가 403 이면 `s3.reasons` 에 `AccessDenied: ...` 등 오류 코드·메시지 80자를 집계한다. 전부 403 이면 S3 열은 `UNVERIFIED`(= P0-1 미해소, 실행 계정의 `s3:GetObject`/`ListBucket` 권한 확인). 부분 403 은 FAIL.
- HEAD 만으로 SHA-256 을 못 읽는 객체(체크섬 미저장)는 `sha_unverified` 로 분리한다. 확정하려면 `--s3-download`(전수 다운로드 후 SHA-256, 40명×180청크 ≈ 수백 MB).
- summary 의 `min_index` 이전·`max_index` 이후는 서버가 모른다(contract §2). 스크립트는 **로컬 장부 − 서버 집합** 으로 판정하므로 꼬리 유실도 잡는다.
- 소켓 `live:metric` ACK(`projected|ignored`)는 방송 확인용 통계일 뿐 저장 판정에 쓰지 않는다.
- 호스트 자격 없이 소켓 입장이 안 되면 stream 을 만들 수 없다(`capture.start` 는 소켓 명령). `LT40S_COUNSELOR_PW` 가 없으면 소켓 생략 경고만 나오고 기기가 임의 stream_id 를 쓰므로 서버가 `stream_not_owned` 로 거절한다 — 실서버 시험에는 반드시 설정할 것.

## 5. dev vs 운영 실행 주의

- **dev(`35.75.58.187`, ubuntu@18.183.86.88 EC2)**: 기본 대상. 시험 전 `admin/ingest-metrics` 와 `[ingest-batch]` 로그 확인 가능. 40기기 × 5초 배치 + 원시 presign 동시 접수로 DB 풀·archive 슬롯(16/0.5s) 부하가 실제로 걸린다.
- **운영**: 원칙적으로 실행하지 않는다. 불가피하면 (1) 별도 승인, (2) 격리된 시험 클래스/회차만, (3) 실사용자 시간대 회피, (4) 접두사 `LT40S-` 외 데이터는 건드리지 않는다, (5) DB 연결은 읽기 전용 DSN 만. 운영 시 스케일업 필수(메모리 노트).
- 시험은 합성 기기가 요청을 40개 동시에 보내므로 같은 IP 에서 WAF/rate limit 이 발동할 수 있다 → `http` 통계에 403/429 가 보이면 그대로 기록되고 429 는 재시도된다.
- 시험 중 서버 재배포·재시작 금지(결과 오염).

## 6. 시험 데이터 식별·정리

- 접두사 **`LT40S-`**: 게스트 이름 `LT40S-게스트-NNN`, 리포트 메일 `lt40s-NNN@example.com`(example.com — 실발송 없음). 클래스·회차 이름도 `LT40S-` 로 만든다.
- 정리(삭제는 건별 승인 후): 해당 세션의 `eeg_feature_windows`, `eeg_raw_chunks`(+S3 객체 key 목록은 DB 에서 먼저 덤프), `capture_streams`, `session_participants` 중 이름이 `LT40S-%` 인 참가자 행. 세션 자체를 삭제하면 FK CASCADE 로 대부분 정리된다. S3 는 `eeg_raw_chunks.object_key` 목록으로 삭제.
- 정리 전 조회 쿼리 예: `select count(*) from session_participants where display_name like 'LT40S-%';` (개인정보 출력 금지 — 건수만).

## 7. 모의 서버 단위 검증 (로컬, 서버 접속 없음)

```
cd backend/scripts/loadtest && ~/.hermes/cache/lt40s-venv/bin/python -m pytest test_loadtest_ingest_v3.py -q
```
40기기×600초를 120배속으로 6 시나리오 + 5xx 재시도 + 거절 격리(불합격 판정) + 서버 유실 후 summary 대조 재전송 + summary/영수증 해시 의미 검증. 이것은 **스크립트 로직 검증**이며 실서버 합격 증거가 아니다.
