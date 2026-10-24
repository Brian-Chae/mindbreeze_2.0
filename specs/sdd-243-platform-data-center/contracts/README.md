# SDD-243 데이터 센터 API 계약 (B01 동결, FE mock 기준)

- 정본 코드: `backend/app/schemas/data_center.py`, `backend/app/schemas/data_export.py`(하단 SDD-243 절), `backend/app/services/data_center_policy.py`.
- mock 응답: `fixtures/*.json` (합성값. `generate-fixtures.py` 로 재생성, `backend/tests/test_sdd243_policy.py::test_contract_fixtures_validate` 가 모델과의 드리프트를 막는다).
- 이후 Task(B02~B07)는 이 형태를 **additive 로만** 확장한다. 필드 삭제·의미 변경이 필요하면 이 문서를 먼저 고친다.

## 공통 규칙

| 항목 | 규칙 |
|---|---|
| prefix | `/api/v1/data-center` (일괄 반출 작업은 `/exports`, 기존 단건 SDD-071 API 는 그대로) |
| 인증 | 로그인 JWT. 서버가 매 호출 DB 로 role/active/membership 재검증. `platform_admin` 또는 `org_admin` 만 |
| 기관 선택 | GET·POST 모두 쿼리 `?org_id=<uuid>`(반출 요청 본문의 `scope_org_id` 는 쿼리와 같아야 하며 다르면 409 `org_scope_mismatch`). org_admin 이 기관 2개 이상이면 필수(없으면 400 `org_selection_required`), 1개면 생략 가능. 플랫폼은 선택(좁힘) |
| 범위 밖 | 타기관·개인상담소·상담 세션·귀속 불명·소속해제·없는 ID 는 **모두 동일한 404** `{"detail":{"code":"not_found",...}}` (존재 유출 금지) |
| 오류 형식 | `{"detail": {"code": "...", "message": "..."}}` — 400 `org_selection_required`, 403 `data_center_disabled`/`role_forbidden`/`actor_forbidden`/`no_admin_org`/`platform_only`/`research_forbidden`/`identity_forbidden`, 404 `not_found`, 413 `too_many_sessions`, 422 `reason_invalid`, 409 `preview_expired`/`request_hash_mismatch`, 429 `active_job_exists`(+`export_id`) |
| 캐시 | 모든 응답 `Cache-Control: no-store`. URL·개인정보·파형을 localStorage/분석 로그에 저장 금지 |
| 목록 | `limit`(기본 25, 최대 100, 초과 422) + `cursor`(안정 정렬 `(time,id)`, 필터 해시·as_of 바인딩). 필터가 바뀐 cursor 는 400 `cursor_mismatch` |
| 날짜 필터 | `date_from`/`date_to` = KST 달력일. 시작일 00:00 포함 ~ 종료일 다음날 00:00 미포함으로 서버가 UTC 변환 |
| 0 vs 미집계 | `Count{value, partial, unavailable_reason}`. `value=null`은 미집계, `0` 은 확인된 0 |
| 시각 | UTC ISO-8601. 상대시각 `*_us` 는 측정 시작 기준 int64 µs **10진 문자열** |
| 비활성 | `data_center_enabled=false`(기본)면 `/contexts`만 `capabilities.enabled=false` 로 응답, 나머지는 403 `data_center_disabled` |

## 엔드포인트 (spec §6 번호 · 구현 Task)

| # | 메서드 경로 | 응답 | 플랫폼 | 기관 | Task |
|---|---|---|---|---|---|
| 31 | GET `/contexts` | `DataCenterContext` | ✅ | ✅ | B02 |
| 1 | GET `/summary` | `SummaryResponse` | ✅ | ✅(자기 기관) | B02 |
| 2 | GET `/inventory` | `InventoryResponse` | ✅ | ✅ | B02 |
| 3 | GET `/subjects` | `DataCenterPage[SubjectListItem]` | ✅ | ✅ | B02 |
| 4 | GET `/subjects/{subject_type}/{subject_id}/holdings` | `SubjectHoldings` | ✅ | ✅ | B02 |
| 5 | POST `/subjects/{subject_type}/{subject_id}/contact-reveal` | `ContactRevealResponse`(no-store) | ✅ | ✅ | B02 |
| 6 | GET `/measurements` | `DataCenterPage[MeasurementListItem]` | ✅ | ✅ | B02 |
| 7 | GET `/measurements/{session_id}/{participant_id}` | `MeasurementDetail` | ✅ | ✅ | B02 |
| 26 | GET `/classes` | `DataCenterPage[ClassListItem]` | ✅ | ✅ | B02 |
| 27 | GET `/classes/{class_id}/sessions` | `ClassSessionsResponse` | ✅ | ✅ | B02 |
| 28 | GET `/sessions/{session_id}/participants` | `SessionParticipantsResponse` | ✅ | ✅ | B02 |
| 29 | GET `/members/{member_id}/sessions` | `SubjectSessionsResponse` | ✅ | ✅ | B02 |
| 30 | GET `/facilitators/{facilitator_id}/sessions` (`date_from`·`date_to` 필수) | `SubjectSessionsResponse` | ✅ | ✅ | B02 |
| 8 | GET `/consents` | `DataCenterPage[ConsentItem]` | ✅ | ✅(수집 동의만) | B03 |
| 9~10 | GET `/research-batches[/{id}]` | `ResearchBatchItem/Detail` | ✅ | ❌ 403 | B03 |
| 11~12 | GET `/retention-runs[/{id}]` | `RetentionRunItem/Detail` | ✅ | ❌ 403 | B03 |
| 13 | GET `/retention-candidates` | `DataCenterPage[RetentionCandidate]` | ✅ | ❌ 403 | B03 |
| 14 | GET `/account-deletions` | `DataCenterPage[AccountDeletionItem]` | ✅ | ❌ 403 | B03 |
| 15 | GET `/baselines` | `DataCenterPage[BaselineItem]` | ✅ | ❌ 403 | B03 |
| 16 | GET `/measurements/{s}/{p}/waveform?signal_type&from_us&to_us&max_points` | `WaveformResponse` | ✅ | ✅ | B04 |
| 17 | GET `/measurements/{s}/{p}/features?cursor&limit&from_us&to_us` | `FeaturePage` | ✅ | ✅ | B04 |
| 18 | GET `/measurements/{s}/{p}/spectrum?from_us&to_us` | `SpectrumResponse` | ✅ | ✅ | B04 |
| 32 | GET `/measurements/{s}/{p}/indices` | `IndicesPage` | ✅ | ✅ | B04 |
| 19 | POST `/exports/preview` | `ExportPreview` | ✅ | ✅(연구 ❌) | B05 |
| 20 | POST `/exports` (헤더 `Idempotency-Key`, 202) | `DataCenterExportStatus` | ✅ | ✅ | B05 |
| 21 | GET `/exports` | `DataCenterExportPage`(본인 작업만) | ✅ | ✅ | B05 |
| 22 | GET `/exports/{job_id}` | `DataCenterExportStatus`(URL 없음) | ✅ | ✅ | B05 |
| 23 | POST `/exports/{job_id}/download-url` | `PartDownload` | ✅ | ✅ | B07(미구현) |
| 24 | GET `/download-audits` | `DataCenterPage[DownloadAuditItem]` | 전역 | 본인+현재 기관 | B07(미구현) |
| 25 | POST `/export-reauth` | `ExportProof` | ✅ | ✅ | B07(미구현) |

## 구현 메모 (B02)

- `subjects`: `kind=user|guest`(생략 시 계정 → 비회원 순), `role`, `status`, `q`(이름·이메일·비회원 이름만; 연락처·생일 검색 없음). 비회원은 canonical 만(병합 원본 제외), 보유 건수는 병합 원본 합산.
- `members/{id}/sessions?subject_type=user|guest`, `facilitators/{id}/sessions` 는 `date_from`·`date_to` 필수(상담사). 회차는 시작시각 오름차순, `batches` 는 서버 설정 `member_facilitator_max_sessions`(기본 50) 기준 묶음 안내.
- `group_by` 는 예약 필드(현재 서버 정렬에 영향 없음, FE 가 불러온 페이지 안에서 그룹).
- `measurement` 의 PPG/ACC 는 SDD-244 인수 전이라 `not_collected(storage_not_connected)`, `manifest_state=not_connected`. EEG raw 없이 feature 만 있으면 `availability=unknown(raw_absent_features_only)`.
- 기관 참여자 표에서 `display_name` 은 `capabilities.can_export_identified` 가 true 일 때만 값, 연구 동의는 `not_visible`.

## 구현 메모 (B04 측정 시계열)

- 파형: `signal_type`(필수) `from_us`/`to_us`(상대 µs, `[from,to)`) `max_points`(기본 2000, 10~4000, 초과 422). 해당 구간 청크만 서버가 순차로 읽는다.
  - `method=raw`: 구간 원천 샘플 ≤ max_points. `method=minmax_envelope`: 시간 버킷 `max_points//2`개, 채널별 `min[]`·`max[]`(값 수 합 ≤ max_points), 데이터 없는 버킷은 `null`(보간 없음). `returned_count` = 포인트(버킷) 수, `source_sample_count` = 구간 안 원천 샘플 수.
  - `segments[]` 는 stream/segment 별 연속 구간(`point_start..point_end`)이므로 FE 는 segment 사이를 선으로 잇지 않는다. `gaps[]` = manifest gap + 서버가 감지한 샘플 인덱스 불연속(`sample_index_gap`). overlap 은 중복제거 없이 segment 분리 + `null_reasons.overlap`.
  - `availability != available` 이면 `method=none`, `t_us=[]`, `channels=[]`(0 값 파일/파형을 만들지 않음). 사유 예: `manifest_not_connected`(244 T06 미연결), `legacy_time_origin_unknown`, `old_app`/`unsupported_client`, `band_not_used`, `no_data_in_range`.
  - manifest 가 `pending_upload` 면 409 `manifest_pending`(준비 중). 명시적 `partial` 은 열람 허용(제외 범위는 `gaps`/`availability` 로 표시).
- feature: `limit` 최대 1000(1Hz 시계열이라 일반 목록 상한과 별개), `from_us`/`to_us` 는 첫 feature 윈도우 기준 상대 시각. `detail_emit=not_connected`(상세 emit JSONL 은 244 artifact 연결 후), `time_origin=first_feature_window`. 값은 원 float, 산출 불가는 `null`.
- indices: 당시 표시 snapshot 만 통과. 저장 이전/미수집은 6지표 모두 `value=null,status=display_history_missing,source=none`, `view=unavailable`. 서버는 feature 로 재구성하지 않으며 `reconstructed`/`report_aggregate` 를 당시 시계열에 섞지 않는다. HRV 는 `hrv_sdnn_ms`(SDNN) 고정.
- spectrum: `from_us`·`to_us` 필수. 2~30초, 연속(gap 없음)·시간축 확인 구간만 계산(`dc-welch-v1`: Hann·Welch 2초·50% overlap·창별 평균 제거·one-sided, 단위 `uV2/Hz`). 불가 시 `computable=false` + `reason`(`range_too_short`/`range_too_long`/`gap_in_range`/`time_axis_unknown`/`insufficient_coverage`/`manifest_not_connected`/`signal_*`).

## 구현 메모 (B05 preview·작업)

- 흐름: `POST /exports/preview` → (토큰 `preview_token`, 서버 원장에 대상·revision·정책 고정, TTL `limits.preview_ttl_seconds`) → `POST /exports`(헤더 `Idempotency-Key` **필수**, 본문 `{preview_token, reason, reauth_proof}`) → 202 `DataCenterExportStatus`(queued) → `GET /exports/{id}` 폴링.
- preview 규칙: 회차 시작시각+ID 오름차순. 회원·상담사 단위 50회차 초과는 413 `too_many_sessions`(`total/max/batches`) — `range.batch_index`(1=1~50, 2=51~100…) 또는 `range.session_ids`(≤50) 또는 기간으로 줄인다. 클래스 전체·회차 안 참여자는 수 제한 없음. 상담사 단위는 `range.date_from/date_to` 필수(422 `period_required`), 0건은 422 `no_sessions`. 미종료 회차는 `exclusions[reason=not_completed]`.
- 제외 사유(`exclusions`, `exclusion_counts` 는 전체 건수, 상세 목록은 500건까지): `consent_missing`, `band_not_used`, `not_collected`, `unsupported_client`, `expired`(raw 90일 경과), `manifest_not_connected`(244 T06 미연결), … 대상이 하나도 없으면 `eligible=false`, `preview_token=''`.
- manifest: `pending_upload` 는 409 `manifest_pending`, `partial` 은 409 `manifest_partial`(제외 범위 확인 후 `allow_partial=true` 로 재요청). `targets[].manifest_revision` 은 preview 시점 revision 으로 고정되며 후발 revision 은 자동 포함되지 않는다.
- create 재검사(전체 차단): preview 토큰은 본인·역할·기관 일치 필수(아니면 404), 만료 409 `preview_expired`, 재사용 409 `preview_consumed`, 정책 변경 409 `policy_changed`, 대상 권한·동의 변경 409 `scope_changed`, 소속 해제 등은 resolve 단계 403/404. 같은 `Idempotency-Key`+같은 preview 는 같은 작업 반환, 다른 요청이면 409 `request_hash_mismatch`, 활성 작업 한도 초과는 429 `active_job_exists`(+`export_id`).
- 재인증: `reauth_proof` 가 없거나 검증기가 연결되기 전이면 403 `reauth_required`/`reauth_unavailable`(fail closed). 검증 구현은 B07.
- 상태: `queued → preparing → ready|ready_with_warnings|failed|expired`. ZIP 생성기(B06) 연결 전에는 worker 가 `failed(package_builder_unavailable)` 로 닫는다. `parts[]` 에 object key·URL·ZIP hash 는 없다. 단건 SDD-071 API 는 일괄 작업을 보지 못한다(404).
- 목록/조회는 본인 작업 + 현재 선택한 기관 범위만(다른 기관을 선택하면 같은 관리자의 작업도 404). 플랫폼은 기관 관리자의 작업을 열 수 없다.

## 구현 메모 (B06 패키지) — 244 T12 연결 지점

- ZIP: `mbdc_{job-alias}_{identity}_part{N}.zip`, 모든 part 루트에 `README_ko.md`·`data_dictionary.json`·`manifest.json`(part 목록·파일별 bytes/sha256/rows/범위/이어짐·제외 사유·source revision). 참여자 폴더 `class-C01/session-001_date-withheld/participant-P01/`(식별 운영만 날짜). ZIP 엔트리 시각은 고정(생성 시각 비노출). 큰 파일은 `*.cont-0002.*` 로 행/레코드/row group 경계 분할, 헤더 반복.
- 어댑터 경계(통합 시 감독이 실제 T12 `iter_export_artifacts` 에 연결): `data_center_export.set_raw_artifact_source(source)` — `source.artifacts(scope, target, policy, signals) -> Iterator[RowArtifact|BinArtifact|MissingArtifact|TextArtifact]` (정의: `services/export_package.py`). 미연결이면 raw 신호는 `manifest_not_connected` 로 제외되고 features/indices/meta 만 담긴다. `source.indices_artifact(db, target, scope, policy)` 가 있으면 indices.csv 를 대체한다.
- 정책은 호출자가 `PackagePolicy` 로 전달한다(`lossless_allowed`: 플랫폼+운영+식별일 때만 원본 bin, `exact_time_allowed`: 식별 운영, `forbidden_strings`: 원 UUID 등 — 어느 텍스트/parquet 조각에 나오면 `pseudonym_leak` 로 실패). 어댑터의 필터는 서버 인가를 대신하지 않는다.
- 독립 검증기: `scripts/verify-sdd243-package.py --artifacts <dir> --expected <json>` (stdlib 전용, 제품 코드 import 없음).
- 실제 1GB 경계: `SDD243_REAL_1GB=1 pytest tests/test_sdd243_package.py -k real_one_gb` (기본 skip).

## 인가 요점 (FE 가 믿으면 안 되는 것)

- `capabilities` 는 표시용. 모든 호출을 서버가 다시 거절한다. 탭 숨김은 보안이 아니다.
- 기관 관리자 범위 = active org_admin 소속 기관 **하나** ∩ 귀속 확인된 명상(meditation, 비템플릿) 회차 ∩ (클래스가 있으면 클래스도 같은 기관에 귀속 확인). 개인상담소·상담 세션·타기관·귀속 불명은 제외.
- 연구 목적(`purpose=research`)은 플랫폼 전용 + 가명만. 기관/식별+연구는 403.
- 기관 식별 포함은 서버 설정 `org_identified_operations_enabled`(잠정, `limits.provisional=true`)가 false 면 403.
- 일괄 반출 요청의 `include` 는 5종(`eeg_raw,ppg_raw,acc_raw,features,indices`)뿐이며 report 는 거절된다.
