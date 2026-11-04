# SDD-282 복구 실행 설계 — 12,540행 재적재 + 리포트 덮어쓰기 (재발송 없음)

- 작성: 2026-11-04 19:05 KST / 상태: **설계·드라이런까지. 운영 쓰기는 하지 않았다.**
- 근거: 코드 읽기 + 운영 DB·S3 **읽기 전용** 조회(READ ONLY 트랜잭션). 개인정보는 건수·접두사(6자)만.
- 드라이런: `scripts/sdd282-recovery-dryrun.py` (쓰기 금지 주석·`SET TRANSACTION READ ONLY` 포함), 실행 결과 원문 `dryrun-result.txt`.
- 분류: **확정**(코드·쿼리 근거) / **가설** / **모름**.

## 0. 한 줄 결론

1. **재발송 위험은 "호출 방법"에 달려 있다.** 리포트 생성 함수 `generate_report_inline`을 직접 호출하면 승인·알림·메일이 일어나지 않는다. 반면 API `generate_report`나 `generate_client_reports_for_session`은 호스트 자동 승인이 켜져 있어 **복구 후 호출하면 승인 + 푸시/알림 + 메일 발송까지 이어진다.** 쓰면 안 된다.
2. 4명의 client 리포트는 지금 **승인 전(`pending_review`)·발송 기록 없음** 상태다. 덮어써도 회원에게는 "리뷰 중"으로만 보인다. 승인(=메일 발송)은 별도 결정으로 남긴다.
3. 적재 대상은 인계 때 12,540행에서 **현재 13,920행으로 늘었다**(기기가 18시대까지 파일을 계속 올림). 4명 모두 DB에 기존 행 0, 중복 0, 충돌 0. 변환기는 정상자 3,300창과 30개 컬럼 값이 전부 일치.
4. 롤백은 가능하다. `ingest_path='recover'`(7자, 8자 제한 안, 기존 사용 0건)를 표식으로 쓰고, 대상 4명은 기존 행이 0이라 표식 행 삭제 = 완전 원상복구. 리포트는 **덮어쓰기 전 본문 백업이 없으면 되돌릴 수 없으므로** 백업이 실행 조건이다.

## 1. 리포트 재생성 경로와 부수 효과 (질문 1)

### 1-1. 호출 경로별 부수 효과 (확정, 코드 근거)

| 경로 | 승인 상태 | 알림·푸시 | 메일 | 비고 |
|---|---|---|---|---|
| **`tasks/report_task.generate_report_inline(report_id, db)`** (직접 호출) | 유지. 승인 전이면 `pending_review` 그대로, 승인됨이면 `completed` 유지 (`report_task.py:505,513,579`) | 없음. 단 **실패 시** 호스트에게 `report_generation_failed` 알림 1건(`:600~`) | 마지막에 `_maybe_enqueue_client_report_email` 로 **큐에는 넣지만**(`:459~`) 소비자 `deliver_report_email` 이 `status != completed` 면 발송 없이 상태 문자열만 반환(`report_email_service.py:202`) | **채택 경로.** 아래 3중 방어를 더한다 |
| `report_service.generate_report` (API `POST /reports/generate/{session}`) | 호스트 `auto_approve_report=True` + `pending_review` 면 `_approve_auto` 호출 (`report_service.py:470~482`) | `report_ready` 알림 + AI 비서 대화 시작 (`approve_report` `:1311~1355`) | 승인 직후 메일 예약 → `completed` 라 **실발송** | **금지.** 이 회차 호스트는 `auto_approve_report=True` (확정, 쿼리) |
| `generate_client_reports_for_session` (세션 종료 파이프라인) | 재생성은 `pending_analysis/error/partial`일 때만. 지금 4건은 `ready` 라 재생성 안 함. **그러나** `pending_review` + 자동승인이면 승인함 (`:558~569`). 지금은 측정자료 없음(`not_measured`)이라 `_skip_auto_approve_no_data` 로 건너뛰지만, **데이터를 넣고 나면 이 보호가 풀려 자동 승인·발송된다** | 위와 같음 | 위와 같음 | **복구 후 절대 호출 금지.** 이 회차 `pipeline_outbox`는 `published`·시도 0이라 재시도로 저절로 도는 일은 없음(확정) |
| `class_report_job` 의 `regenerate` 액션 (일괄 작업) | `generate_report_inline` 만 호출 → 승인 불변 | 없음 | 위 첫 행과 동일(큐에 넣되 미발송) | 대상 조건: client 리포트·권한. 쓸 수 있으나 감독 스크립트가 더 단순 |
| `approve_report` / `approve-and-send` / `approve-all` | `completed` 로 전이 | `report_ready` 알림 | **발송** | **복구 범위 밖.** 대표 별도 승인 후에만 |
| `resend_report_email` / `retry-delivery` | — | — | **재발송** | 금지(이번 건은 발송 이력이 없어 해당도 없음) |

### 1-2. 상담사 리포트(counselor) 덮어쓰기 — 별도 주의 (확정)
- 회차에 counselor 리포트 1건(`completed`, 본문 112,274자, `class_report` 블록 있음, 상담사 코멘트 없음). 승인된 리포트라 재생성해도 `completed` 유지, 메일은 client 전용이라 **발송 없음**.
- 재생성하면 `class_report` 통계가 4명 데이터를 포함해 **바뀐다**(24명 집계 → 승인된 본문이 달라짐). 이전 서사·상담사 수정본은 이월되지만(`_attach_class_report`), 본문은 덮어써진다 → 백업 필수.
- 생성 끝에 AI 서사 태스크를 예약할 수 있다(`_maybe_enqueue_class_narrative`, `is_ai_enabled` 일 때만). **이 서버의 `ai_features_enabled` 값은 확인하지 못했다(모름).** 방어 스크립트에서 이 예약도 막는다.
- 상담사 리포트도 덮어쓸지는 대표 확인 필요(지시문은 "리포트 덮어쓰기"). 기본 제안: client 4건 먼저, counselor 1건은 결과 확인 뒤.

### 1-3. 안전한 덮어쓰기 방법 (제안)
- 서버에서 **스크립트로 `generate_report_inline` 만** 리포트 5건(client 4 + counselor 1)에 호출한다. API·파이프라인 함수는 호출하지 않는다.
- **3중 방어(스크립트 내부, 호출 전 monkeypatch)**: `report_task._maybe_enqueue_client_report_email`, `_maybe_enqueue_class_narrative`, `_emit_report_progress` 를 no-op 으로 교체 → 큐에 메일·AI가 아예 들어가지 않는다(구성상 불가능하게).
- 실행 후 자동 검증: 4건 모두 `status=pending_review`, `sent_at/approved_at IS NULL`, `delivery_status IS NULL`, `report_email_sent_at IS NULL`, 호출 전후 `notification_outbox` 건수 동일. 하나라도 어긋나면 중단·복원.
- (선택) 실행 구간에 `mindbreeze-email-worker`를 멈추는 방법도 있으나 다른 메일 지연이 생겨 기본 제안에서 제외.

### 1-4. 4명 리포트 현재 상태 (확정, 운영 읽기)
- 4명 모두 동일: client 리포트 `pending_review` / 생성상태 `ready` / 본문 **343자**(빈 리포트) / 신뢰도 NULL / `sent_at`·`approved_at` 없음 / 승인경로·`delivery_status` NULL / 발송시도 0 / 읽음 false / PDF 없음.
- 참가자: `report_included=true`(override=true, `report_choice_events` 각 1건), 이메일 등록됨, **`report_email_sent_at` 없음**, 출석, 제거·대기열 아님, 회원.
- 회차 전체: client `completed` 9(발송 기록 있는 참가자 9명) / `pending_review` 22 / counselor `completed` 1. → 4명은 "이미 발송된 리포트를 다시 보내는" 경우가 **아니다.** 처음 보내는 것이므로 "재발송 금지"는 "승인·발송 자동 실행 금지"로 지키면 된다.

## 2. 적재 방식과 드라이런 (질문 3)

### 2-1. 변환 규칙 (확정)
- 원천: `biosignal_artifacts` kind=`feature`, signal=`eeg`, `upload_status='uploaded'` (객체는 gzip, 행은 JSONL).
- 파일 행에는 `stream_id`·버전값이 없고 `sequence, window_start_us, window_end_us, observed_at_ms, sqi, contact, metrics{25종}, feature_hash` 만 있다. 나머지는 **참가자의 `capture_stream`**(1개씩, generation 1)에서 채운다: `stream_id=capture_stream.id`, `algorithm_version`, `model_version`, `device_profile`.
- 변환은 운영 코드 그대로: `parse_metric_window` → `_feature_item`(`live_ingest_service.py:106`) → `eeg_feature_windows` 컬럼. quality 는 `eeg_window_invalid` → `invalid`, 아니면 `_quality_from_signal(sqi)`.
- 키: `UNIQUE(session_id, participant_id, play_group_id, window_index)` (`uq_eeg_feature_window`) — `play_group_id=capture_stream.id`, `window_index=sequence`. 중복 방지 = 이 제약 + 적재 시 `ON CONFLICT DO NOTHING`. 해시 충돌 = 같은 키에 다른 `feature_hash`가 이미 있으면 **덮어쓰지 않고 중단·보고**(운영 `store_batch`의 `hash_conflict` 와 같은 원칙).
- `device_timestamp_ms=observed_at_ms`(리포트 구간 필터가 이 값을 우선 사용: `report_task.py:221`), `late = observed_at_ms > 회차 종료`(전부 구간 안이라 false), `ingest_path='recover'`.
- **`_persist_feature_items`/`store_batch`를 쓰지 않는다**: 이 경로는 `participant.band_connected=True` 로 바꾸고 `device_status_changed` 방송을 내보낸다(`session_service.py:3601,3617`). 복구는 `eeg_feature_windows` 에 직접 INSERT 만 하고 다른 테이블은 건드리지 않는다.
- `created_at`: 기본값(적재 시각)이면 `eeg_query.feature_windows_chronological`(created_at 정렬)이 이 행들을 "회차 후 도착"으로 정렬한다. **관측 시각으로 명시 지정하는 안을 권장**(표식은 `ingest_path`가 대신함). 이 선택이 다른 화면에 미치는 영향은 전수 확인하지 못했다(가설).

### 2-2. 변환기 검증 (확정)
정상자 `14b252` 파일 3,300행을 위 방식(capture_stream 값 채움 + 운영 변환기)으로 변환해 DB 행과 비교: **(sequence, feature_hash) 일치 3,300/3,300, 비교 컬럼 30개 전부 동일 3,300/3,300, 불일치 0.** 변환기는 정상 경로와 같은 값을 만든다.

### 2-3. 드라이런 결과 (확정, 2026-11-04 19:0x KST, 쓰기 없음)

| 대상 | 파일(업로드완료) | 행 수 | 고유 seq | 파일내 중복 | hash 충돌 | DB 기존 행 | 삽입 예정 | 변환 통과 | 관측구간(KST) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| `de8312` | 49 | **2,940** | 2,940 (1~2940) | 0 | 0 | 0 | **2,940** | 2,940/2,940 | 10:12~11:01 |
| `6a2172` | 70 | **4,200** | 4,200 (1~4200) | 0 | 0 | 0 | **4,200** | 4,200/4,200 | 10:12~11:22 |
| `518675` | 43 | **2,580** | 2,580 (1~2580) | 0 | 0 | 0 | **2,580** | 2,580/2,580 | 10:12~10:55 |
| `ac1a78` | 70 | **4,200** | 4,200 (1~4200) | 0 | 0 | 0 | **4,200** | 4,200/4,200 | 10:12~11:22 |
| **합계** | 232 | **13,920** | | **0** | **0** | **0** | **13,920** | 13,920 | |

- (관측구간 UTC 원문은 `dryrun-result.txt`. de8312 01:12~02:01 UTC = 10:12~11:01 KST.)
- 대상 밖 영향 0: 키에 `participant_id` 가 들어 있고 대상 4명의 기존 행이 0이며, 적재는 이 테이블 INSERT 한 종류뿐. `eeg_feature_windows`를 참조하는 FK 0개, 트리거 0개 (확정).
- 전체 `eeg_feature_windows` 현재 34,334행(이 회차 27,416). 적재 후 이 회차 27,416 + 13,920 = **41,336**, 전체 48,254 (verify C3 의 39,956 기준은 이 갱신으로 대체).
- 모든 행이 회차 시작~종료 안(`밖 0`). quality 분포(valid / invalid / degraded / unknown): de8312 2,928/11/0/1, 6a2172 4,185/14/0/1, 518675 2,504/74/0/2, ac1a78 4,095/103/1/1. 지표 유효값 비율 약 97~99%.
- 예상 커버리지(가설, 회차 4,510초 기준): de8312 약 65%, 6a2172 약 93%, 518675 약 57%, ac1a78 약 93%. 커버리지 50% 미만이면 신뢰도 `very_low` 로 내려가는 규칙(`report_task.py:435`)에는 걸리지 않지만 `degraded` 판정이 나올 수 있다 — 리포트에 "부분 구간" 표기를 숨기지 않는 것은 별도 확인(verify C4).

### 2-4. 인계 숫자와 달라진 점 (확정, 중요)
- 인계 12,540 → 현재 13,920 (+1,380): `de8312` +120행(파일 2개), `ac1a78` +1,260행(파일 21개) — 둘 다 18시대 업로드. 이 회차 feature 파일의 최근 생성은 18:37 KST. `6a2172`·`518675`는 인계 때와 같음.
- 의미: **기기가 지금도 미전송 파일을 올리고 있다.** 실행 시점마다 숫자가 늘 수 있으므로 ① 적재 직전 드라이런을 다시 돌리고 ② 적재는 멱등(재실행 시 새로 올라온 seq 만 추가)으로 만들고 ③ **리포트 재생성은 마지막 적재 뒤에 한다.** 업로드가 언제 멈출지는 모름.
- 부수 사실(RCA 가치): `de8312`의 `capture_stream.clock_anchor_id` 가 NULL 이었다(변환 검증 중 확인; 나머지 3명은 값 확인 못 함). 앵커를 받지 못했다는 뜻으로 H1′(ACK 미수신)와 부합한다(가설). 그리고 앱의 아티팩트(파일) 업로드 경로는 늦게나마 데이터를 올렸다 — 귀속 전 창이 영구 유실이 아니라 "서버 DB 적재 경로를 못 탄 것"에 가깝다(가설, 하위 SDD 1번 설계 근거).

## 3. 롤백 (질문 4)

### 3-1. 적재 롤백 (확정 가능)
- 표식: `ingest_path='recover'` — 컬럼 길이 8자 안, 현재 `legacy`(1,719)/`rest`(32,615)만 있고 `recover` 0건. 앱 코드는 이 컬럼을 **쓰기만 하고 읽지 않는다**(`grep` 결과 쓰기 2곳뿐) → 새 값이 동작에 영향 주지 않음.
- 롤백 쿼리(승인 후 실행): `DELETE FROM eeg_feature_windows WHERE session_id = :S AND participant_id IN (:4명) AND ingest_path = 'recover';` 기대 삭제 건수 = 적재 건수. 4명은 적재 전 기존 행이 0이므로 이 삭제로 **적재 전 상태와 동일**.
- 적재 전 필수: RDS 스냅샷(ID 기록), 적재 건수·삭제 쿼리 사전 시험(로컬/트랜잭션 `ROLLBACK`). FK·트리거 없음 → 연쇄 영향 없음.
- 표식 보강(선택): 적재 한 번마다 `created_at` 대신 별도 배치 ID 를 남길 컬럼은 없다. 표식은 `ingest_path` 하나뿐이라, **같은 4명에 다른 경로 행이 새로 생기면 분리 불가**하다 → 적재~리포트 확인 구간에는 4명이 라이브 경로로 쓸 일이 없음(회차 종료됨)을 전제로 한다.

### 3-2. 리포트 롤백 (조건부)
- 덮어쓰기는 `content`를 통째로 교체한다. **원본 복원은 사전 백업이 있을 때만 가능**하다. 백업 대상 5건(client 4 + counselor 1)의 `content, status, generation_status, generation_error, generation_started_at, data_credibility, pdf_url, sent_at, approved_*` 를 JSON 파일로 서버 보호 경로에 저장(개인정보 포함 가능 → 저장소 커밋 금지, 접근 제한).
- 복원: 백업 JSON → `UPDATE reports SET ... WHERE id = :id` 5건. 실패 경로(`status=error` 스텁으로 교체)가 나면 이 백업으로 되돌린다.
- 되돌릴 수 없는 것: 이미 나간 메일·푸시(우리 방어로 0건이어야 함), WebSocket 진행 방송(방어로 차단).

## 4. 518675 업로드 대기 60행 (질문 5)

### 4-1. 사실 (확정)
- `biosignal_artifacts` 1건: `upload_status='pending'`, 행 60, seq 2581~2640, `verified_at` NULL, 실패사유 NULL, 생성 11:36:17 KST(회차 종료 후), `uncompressed_sha256` NULL.
- 그러나 S3 객체는 **존재**하고(13,552B), 크기가 기록과 일치하며, 저장 바이트의 SHA-256 이 기록된 `checksum` 과 일치. 압축을 풀면 실제 60행, seq 2581~2640 으로 기록과 동일, 60/60 변환 통과, 전부 회차 구간 안, 이미 올라온 seq(1~2580)와 겹침 없이 이어짐.
- 대조: 정상자 `14b252`의 pending 1건은 객체 자체가 없다(`NoSuchKey`). 즉 pending 이라고 같은 상태가 아니다.

### 4-2. 제외 사유와 처리 방안
- 제외 사유(인계 시점): 서버가 업로드를 확정(ACK, `uploaded`+`verified_at`)하지 않은 파일이라 "검증 안 된 데이터를 넣지 않는다"는 보수 원칙.
- 현재 근거로는 **포함해도 안전**(체크섬·행 수·연속성·변환 통과 확인). 처리안: 로더에 옵션(`--include-pending-518675`)을 두고 대표 승인 시 +60행(518675 합계 2,640). 포함해도 `biosignal_artifacts` 상태는 바꾸지 않는다(쓰기 최소화). 기본값은 제외.
- 압축해제본 해시를 검증하지 못한 점(`uncompressed_sha256` NULL)은 남는 불확실성이다.

## 5. 실행 순서 제안 (대표 승인 후, 각 단계 실패 시 중단·복원)

| # | 단계 | 쓰기 | 확인 |
|---|---|---|---|
| 0 | RDS 스냅샷 생성, ID 기록 | 인프라 | 스냅샷 `available` |
| 1 | 리포트 5건 본문 백업(JSON, 서버 보호 경로) | 파일 | 5건 저장, 건수·바이트 |
| 2 | 드라이런 재실행 (업로드 증가분 반영) | 없음 | 삽입 예정 = 그 시점 합계, 중복·충돌 0 |
| 3 | 적재: 4명 단일 트랜잭션(또는 참가자별), `ON CONFLICT DO NOTHING`, `ingest_path='recover'` | INSERT 만 | 참가자별 건수 = 드라이런, 재실행 시 0건 추가(멱등) |
| 4 | 사후 검증: 이 회차 행 수, 다른 참가자 행 수 불변 | 없음 | verify C1~C3 (기준 숫자는 §2-3 으로 갱신) |
| 5 | client 4건 `generate_report_inline` (3중 방어 포함) | `reports` 4행 | 본문 343자 아님, `pending_review` 유지, 발송·승인 필드 NULL, `notification_outbox` 건수 불변 (verify C4~C6) |
| 6 | counselor 1건 재생성 여부 결정 → 필요 시 같은 방식 | `reports` 1행 | `completed` 유지, `class_report` 변화 확인 |
| 7 | **승인·발송은 대표 별도 결정** (승인하면 푸시+메일 발송됨 — §1-1) | — | — |

## 6. 확인하지 못한 것
1. 기기의 미전송 파일이 **언제 끝나는지**(이 서버가 받을 총량의 최종 숫자). 인계 시점 대비 +1,380행 증가가 확인됐을 뿐.
2. 서버의 `ai_features_enabled` 값 → counselor 재생성 시 AI 서사 태스크가 실제 예약되는지. (방어 스크립트로 차단하므로 영향 없음)
3. `created_at` 을 관측 시각으로 명시할 때 다른 화면(라이브/롤업)에 미치는 영향의 전수 확인.
4. 예상 커버리지가 실제 `_coverage_ratio` 계산과 같은지(리포트 생성 후 확인 가능).
5. 이 회차 리포트를 회원이 이미 "리뷰 중"으로 본 이후 승인될 때 회원 앱의 표시(승인 전 마스킹 동작은 코드상 확인, 화면 확인은 못 함).
6. 로더 스크립트 자체는 아직 작성·시험하지 않았다(이 문서는 설계 + 읽기 전용 드라이런까지). 쓰기 스크립트는 대표 승인 후 로컬 DB 시험을 거쳐 작성한다.
