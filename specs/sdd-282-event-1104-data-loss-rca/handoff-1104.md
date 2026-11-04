# SDD-282 인계 — 11/4 행사 데이터 유실 원인 분석 (2026-11-04 갱신 2차)

> 다음 워커는 이 문서와 spec.md, plan.md, verify.md만 읽고 이어간다. 모든 조회는 운영 DB **읽기 전용**(SSM, 인스턴스 `i-0487c67fb0db7dcba`, `/etc/mindbreeze/prod.env`, `/opt/mindbreeze/venv/bin/python`). 비밀값·개인정보 출력 금지(건수·접두사만).
> 분류 기준: **확정** = 쿼리·코드 근거로 직접 확인 / **가설** = 정황은 맞지만 직접 증거 없음 / **모름** = 아직 확인 못함.

## 0. 대상

- 회차 `1a74e4c9-a54e-4454-8505-22840922811c`, 10:12~11:27 KST(UTC 01:12~02:27), 정원 50, `participant_mode=group`, `linkband_mode=optional`.
- 참여 행 63개 = 회원 24(전원 1행씩) + 비회원 39행(고유 이름 16개). 대기열 행 12개.
- 운영 release `20261103-105956-4553b53`. 앱: 사이트 APK vc46, TestFlight 39.

## 1. 확정

| # | 사실 | 근거 |
|---|---|---|
| F1 | 분석 데이터가 끝까지 정상(3,980~4,511건)인 사람은 6명, 전원 회원·`band_connected=true`·뇌파 동의·대기열 아님 | `eeg_feature_windows` 집계 |
| F2 | 정상 6명은 전원 푸시 등록이 `android/1.0.0`. `features/batch` 응답 200이 9,239건(499가 77건), 5xx 0건. UA는 okhttp(Android 앱) 8,862 / 웹(Android Chrome) 439 / iOS 앱 15 | nginx |
| F3 | **분석 0건 회원 4명**(`de8312`·`6a2172`·`518675`·`ac1a78`, 전원 Android 푸시): `capture_stream`은 각 1개(generation 1)가 있고 `capture.start` 1회 적용. 그런데 **`capture.renew`·`capture.reanchor`가 0건**(정상자는 renew 300~350건, reanchor 14~49건)이고 `live_outbox`의 device 이벤트는 2건(시작·세션 종료)뿐. 3명은 수업 종료 뒤 `capture.start`가 `session_ended`로 거절된 기록(1·1·6건)이 있음 | `live_command_ledger`, `live_outbox` |
| F4 | 위 4명의 stream 불일치 가설(H1 원안)은 **기각**. `biosignal_streams.stream_id`(3개 공통 ID)와 `capture_stream.id`가 다른 것은 정상자 `14b252`도 동일하고, 정상자의 `eeg_feature_windows.play_group_id`는 `capture_stream.id`(=서버 발급 stream)와 일치한다. 4명도 `capture_stream.id`는 정상 존재(소유자 일치)하므로 `store_batch`의 `stream_not_owned`가 걸릴 조건이 아니다 | DB 대조, `live_ingest_service.py:127,246` |
| F5 | 4명의 **분석 파일은 서버에 있고 열린다**: `biosignal_artifacts` kind=`feature`(signal=eeg) 209개 파일 업로드 완료·모두 S3 열림·행 수 일치. 행은 sequence 1..N 연속·중복 0·결측 0. 4명 합계 **12,540행**(de8312 2,820 / 6a2172 4,200 / 518675 2,580 / ac1a78 2,940). 주요 지표 유효값 비율 약 97~99%. 관측 시각은 시작(10:12 KST)부터 각각 10:59·11:22·10:55·11:01 KST까지(수업 종료 11:27 전) | S3 읽기, `ev…` 스크립트 q9~q11 |
| F6 | 같은 형식의 `feature` 파일은 **정상자 DB 행과 일치**한다: `14b252`의 파일 3,300창 전부가 (sequence, feature_hash)로 DB 행과 1:1 일치(DB는 4,511행, 파일은 앞부분 일부). 즉 파일 → `eeg_feature_windows` 재적재 방식이 기존 정상 경로와 같은 내용을 만든다 | q16 |
| F7 | `kind=indices`(표시값 이력)는 4명 중 3명에 있음: 518675 4,495행 / 6a2172 4,495행 / ac1a78 4,491행 (de8312는 없음). 이것은 화면에 보인 값(`focus·relaxation·emotional·bpm…`)이라 리포트가 읽는 분석 표(`eeg_feature_windows`)의 원천이 아니다 | S3 읽기, 코드 |
| F8 | 리포트 통계는 `eeg_feature_windows`만 읽는다(`class_report_stats_service.py:354` 이하, 회차 시작~종료 구간·`report_included` 참가자). 그래서 위 4명 리포트는 사실상 빈 리포트(본문 343자, 기존 확인) | 코드 |
| F9 | `b5eed5`·`bc8a88`의 `report_included=false` 원인: 두 명 모두 `report_choice_events`가 **0건**(리포트 선택 자체를 한 적 없음, 기본값 false 유지). `6ecab3`·`94234b`는 이벤트 2건(켰다가 스스로 끈 기록: 09:44 켬→09:53 끔, 10:16 켬→10:22 끔) | `report_choice_events` |
| F10 | `b5eed5`는 분석 3,980건이 DB에 이미 있어 **리포트 생성만** 하면 된다(단, 본인이 리포트 반영을 선택해야 함 — 선택 변경은 본인/권한 절차 필요) | 위 + 코드 |
| F11 | 비회원 재입장 시 새 행이 생기는 경로: `session_service.py:2229~2262`. 입장 자격(entry credential)이 없거나 만료·폐기면 **새 `SessionParticipant`를 만든다**(이름 일치로 인계하지 않는다는 주석 있음). 이때 `guest_client_id`를 채우는 코드는 **어디에도 없음**(읽는 곳은 `dashboard_service.py:117`뿐). 정원 계산 `_has_capacity`는 `is_waitlisted=false` 행 수만 센다(`session_service.py:1578`). 실측: 비대기·미제거 행 51개 > 정원 50, 비회원은 이름 16개에 행 39개(2회 이상 입장한 이름 10개) | 코드, DB |
| F12 | 비회원 39행 중 **24행(62%)은 구조적으로 업로드 불가**: 대기열 12행(`is_waitlisted=true`) + 비대기인데 뇌파 수집 거부 상태(`eeg_collection_consented=false`) 12행. 업로드 가능(비대기·동의) 15행뿐이고 그중 데이터가 있는 행이 5개. 비회원 뇌파 동의 기본값이 false인 것은 코드 설계(`session_service.py:2095`, "비회원은 미동의, true로 추정하지 않는다") | DB, 코드 |
| F13 | 403 두 원인 모두 서버 코드에 존재: 대기열 `_assert_upload_eligible`(`session_service.py:3448`), 뇌파 거부 `assert_eeg_upload_allowed`(`recording_consent_service.py:72`). F12로 비회원 24행이 이 두 조건에 해당 → 10,100건 403의 구성은 이 두 가지로 충분히 설명되나, 요청별 비율은 로그에 본문이 없어 산출 불가 | 코드, DB |
| F14 | `[ingest-batch]` 로그가 없는 이유: 앱 코드에 `logging.basicConfig/dictConfig`가 없고(`backend/app` 전체 검색) uvicorn은 `--log-level` 없이 기동(`ExecStart=…uvicorn app.main:asgi_app --host 127.0.0.1 --port 8000`)이라 `logger.info`(session.py:848)는 루트 로거 기본 WARNING에 걸려 출력되지 않는다. (※ 이전 "0줄" 확인은 `journalctl -u mindbreeze-backend`로 한 것이라 유닛명 오류 가능성이 있어 근거로 쓰지 않는다. 코드 근거만으로 판단) | 코드, systemd |
| F15 | 5xx 0건, 입장 폭주 구간에 서버 장애·499 이상 징후 없음. `eeg-raw/presign` 403 약 10,100건(10:15~10:40 KST) | nginx |
| F16 | 로그인 기록 `refresh_tokens.user_agent`는 전원 빈 값이고 입장 시 플랫폼·앱 빌드가 DB에 남지 않음 → 사후 기기 대조 불가. 푸시 등록(`device_tokens`)만 간접 단서 | 스키마 |
| F17 | 서비스 로그 `ReplayUnavailable: log_truncated` 1,561회(11:23:56~11:30:24). 코드상 발생 위치 `class_participation_service.py:893`(`seq - n_rows`로 되감기) → `session_live_state.py:226`(flag≠ok이면 log_truncated). 주석에 "재구축 직후 복원된 seq만 있고 stream 이력이 없을 때 log_truncated가 난다"가 이미 적혀 있음 | 코드, journald(이전 조회) |
| F18 | DB `eeg_feature_windows` 27,416행은 전부 `ingest_path='rest'`, 11명. 소켓 경로 저장은 없다(SDD-260 설계) | DB |

## 2. 가설

- **H1′ (4명 무저장의 가장 유력한 설명, 강한 정황)**: 4명은 `capture.start`가 서버에서는 적용됐지만, **응답(ACK)이 앱에 도달하지 못했거나 소켓이 곧바로 끊겨** 앱이 stream 신원을 못 받았다. 안드로이드 앱은 stream이 정해지기 전에 만든 창을 "귀속 전 창"으로 **보관만 하고 전송하지 않는다**(`MetricOutbox.pendingBatch`는 태그된 창만 반환, `FeatureUploader`는 그 후보만 전송). 이후 `capture.start`를 다시 보내다 수업 종료 뒤 `session_ended`로 거절된 기록(F3)이 이와 맞는다. 복구 스위퍼(`ScopeSweeper.drain`)도 `scope.json`에 stream이 없으면 "보낼 수 없어 진단만" 하고 끝낸다. 결과적으로 앱은 약 4,500창을 기기에 쥔 채(`ingest-expected` feature 4,516~4,833 보고와 일치) 서버에는 저장하지 못했다.
  - 같은 방향의 반증 없음. 단 `518675`는 거절 기록이 없어(재시도 없음) 설명이 완전하지 않다.
  - **확정하려면**: 해당 기기의 `outbox.log`/`scope.json`(기기에서만 확인 가능) 또는 앱 로그가 필요. 서버 로그만으로는 확정 불가.
- **H2′ (비회원 전멸의 주원인)**: F12·F13 합계로 비회원 62%가 구조적 거절. 나머지 15행(업로드 가능) 중 데이터가 있는 5행도 10초~2분 후 중단 — 중단 원인(앱 이탈/재입장으로 인한 새 행 발급 후 이전 행 방치)은 정황만 있음.
- **H3 (밴드 미연결 회원)**: 회원 24명 중 `band_connected=false` 15명(Android 5·iOS 6·푸시 없음 4), true 9명. `band_connected`는 `live:device` 보고로만 켜짐(`live_ingest_service.py:412`). 15명 중 8명은 `capture_stream`이 0개(측정 시작 자체를 안 함). BLE 끊김 후 이탈은 대표 추정이며 서버 데이터로는 구분 불가. 정상 6명이 전원 `band_connected=true`인 것은 확정(F1).
- **H4 (iOS 별도 결함)**: **약화됨**. iOS 푸시 7명 중 6명이 밴드 미연결, 4명은 `capture_stream` 0개 → "측정 시작 전 이탈"로 설명 가능. iOS 앱 UA의 `features/batch`는 15건 모두 200이며 11:25~11:28 KST에 몰림(1명, `bc8a88` 계열 141창). iOS 경로의 결함 증거는 없음. 단 `94234b`(iOS)는 원시 청크가 많은데 분석 0건 + feature 파일 중 `window_index`가 0/중복인 stream이 있어(`b29d11af`: 531행이 모두 index 0) 별도 확인 가치가 있음.
- **H5 (신규)**: `capture.renew` 부재는 4명이 "측정은 하지만 소켓 세션이 죽어 있던" 상태임을 뜻한다. 이 시점의 앱/네트워크 상태 원인(Wi-Fi 혼잡, 소켓 재연결 실패)은 모름.

## 3. 모름

1. 4명 기기에 남은 미전송 창의 실제 개수와 전송 가능 여부(기기 확인 필요). H1′ 확정에 필요.
2. 비회원 15행(업로드 가능) 중 데이터가 없는 10행의 사유(밴드 미착용인지 앱 문제인지).
3. F13의 403 요청별 비율(대기열 vs 동의 거부) — 본문 로그 없음. DB 행 기준 12:12 동수만 확인.
4. `log_truncated`가 11:23에 시작해 11:30에 끝난 이유. 코드 주석은 "재구축 직후"를 지목하나 그 시각의 재구축·epoch 변경 로그를 확인하지 못함.
5. 4명 중 `de8312`는 `indices` 파일이 없는 이유.
6. `94234b`의 feature 파일 `window_index` 중복 구조(원인 불명).

## 4. 복구 가능성 (읽기 전용 산출, 쓰기는 대표 승인 후 별도 단계)

| 대상 | 복구 원천 | 복구 가능 행 수 | 한계 |
|---|---|---|---|
| `de8312` | feature 파일 47개 | 2,820 | 기대량 4,833 대비 약 58%. 관측 종료 10:59 KST |
| `6a2172` | feature 파일 70개 | 4,200 | 기대량 4,520 대비 약 93% |
| `518675` | feature 파일 43개 | 2,580 | 기대량 4,517 대비 약 57%. 업로드 대기(pending) 60행 1개는 제외 |
| `ac1a78` | feature 파일 49개 | 2,940 | 기대량 4,516 대비 약 65% |
| **합계** | | **12,540** | 나머지(약 6,500행 추정)는 기기에만 있을 가능성 |
| `b5eed5` | 이미 DB에 3,980행 | 0(재적재 불필요) | 리포트만 생성하면 되나 `report_included=false`(본인 선택 없음) |
| `bc8a88`·`6ecab3`·`94234b` | — | 해당 없음 | 6ecab3·94234b는 본인이 리포트 반영을 껐고, bc8a88은 선택 안 함 |

- 재적재 방식: feature 파일 행(`sequence`, `metrics`, `observed_at_ms`, `feature_hash`, `sqi` …) → `live_ingest_service._feature_item` 변환 → `eeg_feature_windows`(멱등 키 play_group_id=해당 참가자 `capture_stream.id`, window_index=sequence, ingest_path 표식). F6으로 형식이 정상 경로와 같음을 확인.
- 리포트 재생성: `class_report_stats_service.compute_class_stats`는 DB 행만 읽으므로 재적재 후 기존 리포트 재생성 경로를 호출하면 된다. **호출 함수·승인(approved/delivery) 상태 처리는 아직 코드 확인 안 함** — plan.md에서 선행 조사 항목으로 둔다.
- 쓰기 전 필수: RDS 스냅샷, 영향 건수·롤백(삭제 대상 식별 가능한 표식) 문서화, 대표 건별 승인.

## 5. 수정 후보 (SDD 분할 제안 — 상세는 plan.md)

1. 앱: stream 귀속 전 창이 영구 보관되지 않도록 서버가 stream을 대신 알려주는 경로(예: `features/batch`가 stream 미지정 창을 참가자의 현재/최신 stream에 귀속) + ScopeSweeper 보강
2. 비회원 재입장 동일인 식별 + 정원 계산에서 중복 행 제외
3. 업로드 403 사유 코드 응답 + 클라이언트 처리, 비회원 뇌파 동의 기본값/안내 재검토
4. 서버 로깅 설정(INFO 로그 출력) + features/batch 거절 코드 집계 노출
5. 입장 시 플랫폼·앱 빌드 기록
6. `log_truncated` 반복 차단

## 6. 재사용 스크립트

- 새 조회는 `~/.hermes/cache/scratch/rca/ssmrun.py <스크립트.sh>` (SSM base64 실행 래퍼). 같은 디렉터리에 `q1~q20.sh` 조회 스크립트 보관(24시간 후 정리될 수 있음). 이전 `ev1104a~m.sh`도 있음.
- 조회 주의: `eeg_feature_windows.quality`는 문자열, `refresh_tokens` 시각 열은 `issued_at`, `session_participants`에 `status` 열 없음, `device_tokens` 열은 `platform`·`app_version`, S3 객체는 gzip일 수도 아닐 수도 있어 매직 바이트로 판별, macOS `sed -i` 금지.

## 7. 확인하지 못한 것

- 기기(스마트폰) 안의 미전송 창과 앱 로그 → H1′ 최종 확정 불가.
- `log_truncated`의 직접 원인(rebuild 시각 대조).
- 리포트 재생성 호출 경로와 승인·발송 상태 처리.
- 비회원 403 요청별 비율.
