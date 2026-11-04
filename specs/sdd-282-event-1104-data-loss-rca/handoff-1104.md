# SDD-282 인계 — 11/4 행사 데이터 유실 원인 분석 (2026-11-04 17:15 KST 기준)

> 다음 워커는 이 문서와 spec.md만 읽고 이어간다. 모든 조회는 운영 DB **읽기 전용**(SSM, 인스턴스 `i-0487c67fb0db7dcba`, `/etc/mindbreeze/prod.env`, `/opt/mindbreeze/venv/bin/python`). 비밀값·개인정보 출력 금지(건수·접두사만).

## 0. 대상

- 회차 `1a74e4c9-a54e-4454-8505-22840922811c`, 10:12~11:27 KST(UTC 01:12~02:27), 정원 50, `participant_mode=group`, `linkband_mode=optional`.
- 참여 행 63개 = 회원 24(전원 1행씩) + 비회원 39행(고유 이름 16개). 대기열 행 12개(10:24~10:41 KST).
- 운영 release `20261103-105956-4553b53`. 앱: 사이트 APK vc46, TestFlight 39.

## 1. 확정된 사실 (쿼리·로그 근거)

| # | 사실 | 근거 |
|---|---|---|
| F1 | 분석 데이터가 끝까지 정상(3,980~4,511건, 66~75분)인 사람은 6명, 전원 회원·`band_connected=true`·뇌파 동의·대기열 아님·재입장 없음 | `eeg_feature_windows` 집계 |
| F2 | 정상 6명은 전원 푸시 등록이 `android/1.0.0`이고, `features/batch` 8,863건 전부 okhttp(Android 앱) UA | `device_tokens`, nginx UA |
| F3 | 비회원 데이터 있는 행은 3개(17~23건)+원시 2행뿐, 전부 10초~2분 후 중단. 비회원 39행은 이름 16개뿐 → 재입장마다 새 행 생성 정황(`guest_client_id` 비어 있음) | `session_participants` |
| F4 | 10:24:06에 정원 50 도달. 그 시점 비회원 27행 중 이름 15개, 12행은 같은 이름 중복. 이후 12행은 전부 대기열이고 11행이 기존 이름과 같음 | 입장 시각 분석 |
| F5 | 10:15~10:40 KST `eeg-raw/presign` 403 약 10,100건(Android 웹 7,759, iOS 웹 2,378). 코드상 403은 (a) 대기열 참가자 `session_service._assert_upload_eligible`, (b) 뇌파 수집 거부 `assert_eeg_upload_allowed` 두 가지 | nginx, 코드 |
| F6 | 분석 표(`eeg_feature_windows`)가 0건인데 기대량(`session_ingest_expected.feature`≈4,500)을 보고하고 원시 800~1,200 청크가 올라온 **회원 5명**: `de8312`, `6a2172`, `518675`, `ac1a78`(+`94234b`는 기대량 0). 이들의 리포트는 본문 343자·`eeg` 항목 26자의 사실상 빈 리포트 | `reports`, `session_ingest_expected` |
| F7 | 정상 5명 리포트는 본문 약 8만 자, 신뢰도 high. `b5eed5`(분석 3,980건)·`6ecab3`(998건)·`bc8a88`(141건)·`94234b`는 리포트 자체가 없음(`report_included=false`) | `reports`, `session_participants` |
| F8 | 리포트는 `eeg_feature_windows`만 읽는다 (`class_report_stats_service.py:354`) | 코드 |
| F9 | 5xx 0건. 10:15~10:25 입장 폭주 때 서버 장애·499 없음 → 서버가 느려서 튕긴 것이 아님 | nginx |
| F10 | 11:23:56~11:30:24 KST에 `ReplayUnavailable: log_truncated` 1,561회(`class_participation_service.py:893`→`session_live_state.py:226`). 수업 종료(11:27) 전후의 별개 문제. Redis는 정상(evict 0, 재시작 없음) | journald |
| F11 | 로그인 기록 `refresh_tokens.user_agent`는 전원 빈 값. 입장 시 플랫폼·앱 빌드 기록이 DB 어디에도 없음 → 사후 기기 대조 불가 | 스키마 조회 |

## 2. 가설 (코드로 검증 필요)

- **H1 (최우선)**: F6 회원 5명은 `features/batch`가 `rejected` 되었거나 아예 호출되지 않았다. `store_batch`(`live_ingest_service.py:225`)는 `stream_not_owned`(해당 `stream_id`가 `capture_stream.id`와 일치하지 않음)일 때 거절한다. **비교 결과**: 정상 참가자는 `eeg_feature_windows.play_group_id`가 `capture_stream.id`와 일치(`n_pg_in_cs == n_pg`). 반면 F6의 5명은 `biosignal_streams.stream_id`(웹 측 생성, 3개 공통 ID `3f484381`, `8318de5e`, `bbdfa6e0`)와 `capture_stream.id`가 서로 다름 → **stream_id 불일치로 거절되었을 가능성**. 정상 2명(`14b252`, `c364c0`)도 `biosignal_streams`는 같은 3개 ID지만 `capture_stream`이 generation 1→2로 재생성되며 일치했다. 즉 "capture_stream 재생성(generation 증가) 여부"가 갈림길일 수 있다.
- **H2**: 대기열/동의거부 403(F5)이 비회원 전멸의 주원인. 로그에 응답 본문이 없어 구분 불가 → 서버 로그에 `detail` 남기도록 하거나 `eeg_collection_consented` 값으로 교차 확인.
- **H3**: 밴드 미연결 회원 10명은 BLE 끊김 후 이탈(대표 추정). `live:device` 보고로만 `band_connected`가 켜지는 구조(`live_ingest_service.py:412`).
- **H4**: 푸시 등록 기준 iOS 7명이 전원 분석 0건 → iOS 경로 별도 결함 가능(F2의 okhttp 단서와 정합). `94234b`(iOS)만 원시 1,517 청크.

## 3. 모름 (다음 워커가 풀 것)

1. F6 회원 5명의 `features/batch` 요청이 실제로 갔는지·결과가 무엇인지 (`[ingest-batch]` 로그는 0줄 — 로그 레벨 때문에 기록되지 않음. nginx로는 요청 건수만 확인 가능).
2. 비회원 재입장 시 새 `session_participants` 행이 만들어지는 경로 (`guest_client_id`/entry credential 처리).
3. F5 403 중 대기열 vs 동의거부 비율.
4. F6의 분석 파일(`biosignal_artifacts`, kind=`feature`·`indices`)을 열어 **복구 가능한 행 수** (S3 객체 내용 확인 필요).
5. `b5eed5`의 `report_included=false` 원인 (`report_choice_events`로 확인).
6. F10의 `log_truncated`가 11:23에 시작·11:30에 종료된 이유 (rebuild/epoch 로그 없음).

## 4. 복구 후보 (운영 DB 쓰기 — 건별 승인 필요, 먼저 읽기 전용 검증)

- 대상 최우선: F6 회원 5명(분석 파일이 서버에 있음: `indices` 약 4,495~4,511행). 분석 표로 재적재 후 리포트 재생성.
- 차선: `b5eed5`(분석 3,980건 존재, 리포트만 없음) — 리포트 생성만 필요.
- 배포 전 RDS 스냅샷, 쓰기 전 영향 건수·롤백안 문서화.

## 5. 수정 후보 (SDD 분할 제안, 대표 우선순위 결정)

1. 비회원 재입장 동일인 식별 + 정원 계산에서 중복 행 제외 (정원 소진 방지)
2. `features/batch` 거절 시 클라이언트가 재시도·재등록하도록 계약 보강 및 거절 코드 서버 로그 상시 기록
3. 입장 시 플랫폼·앱 빌드·UA를 `session_participants` 또는 manifest에 기록
4. 실시간 방송 `log_truncated` 반복 차단(실패 시 snapshot 대체, heartbeat는 계속 송출)
5. 403 응답에 사유 코드(`WAITLISTED` / `EEG_CONSENT_REQUIRED`)를 클라이언트가 처리하고 재시도 폭주를 막기

## 6. 재사용 스크립트 위치

`~/.hermes/cache/scratch/ev1104a.sh` ~ `ev1104m.sh` (SSM base64 실행 패턴: `base64 < 스크립트 | aws ssm send-command ... echo $B | base64 -d | bash`). 24시간 후 정리될 수 있으니 필요 시 이 문서의 쿼리 의도를 보고 새로 작성.

## 7. 다음 작업 순서 (권장)

1. H1 검증: 코드(`live_ingest_service.store_batch`, `_load_stream`, 클라이언트 `metric-outbox.ts`·`feature-batch.ts`)를 읽고, F6 5명의 stream_id·generation 이력을 대조.
2. 분석 파일에서 복구 가능 행 수 산출 → 대표에게 복구 승인 요청.
3. plan.md → verify.md(구현 전 게이트) 작성 후 대표 승인.
