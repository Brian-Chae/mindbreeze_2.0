# SDD-243 데이터 센터 API 계약 (B01 동결, FE mock 기준)

- 정본 코드: `backend/app/schemas/data_center.py`, `backend/app/schemas/data_export.py`(하단 SDD-243 절), `backend/app/services/data_center_policy.py`.
- mock 응답: `fixtures/*.json` (합성값. `generate-fixtures.py` 로 재생성, `backend/tests/test_sdd243_policy.py::test_contract_fixtures_validate` 가 모델과의 드리프트를 막는다).
- 이후 Task(B02~B07)는 이 형태를 **additive 로만** 확장한다. 필드 삭제·의미 변경이 필요하면 이 문서를 먼저 고친다.

## 공통 규칙

| 항목 | 규칙 |
|---|---|
| prefix | `/api/v1/data-center` (일괄 반출 작업은 `/exports`, 기존 단건 SDD-071 API 는 그대로) |
| 인증 | 로그인 JWT. 서버가 매 호출 DB 로 role/active/membership 재검증. `platform_admin` 또는 `org_admin` 만 |
| 기관 선택 | GET 은 `?org_id=<uuid>`, POST 는 body `scope_org_id`. org_admin 이 기관 2개 이상이면 필수(없으면 400 `org_selection_required`), 1개면 생략 가능. 플랫폼은 선택(좁힘) |
| 범위 밖 | 타기관·개인상담소·상담 세션·귀속 불명·소속해제·없는 ID 는 **모두 동일한 404** `{"detail":{"code":"not_found",...}}` (존재 유출 금지) |
| 오류 형식 | `{"detail": {"code": "...", "message": "..."}}` — 400 `org_selection_required`, 403 `data_center_disabled`/`role_forbidden`/`actor_forbidden`/`no_admin_org`/`platform_only`/`research_forbidden`/`identity_forbidden`, 404 `not_found`, 413 `too_many_sessions`, 422 `reason_invalid`, 409 `preview_expired`/`request_hash_mismatch`, 429 `active_job_exists`(+`export_id`) |
| 캐시 | 모든 응답 `Cache-Control: no-store`. URL·개인정보·파형을 localStorage/분석 로그에 저장 금지 |
| 목록 | `limit`(기본 25, 최대 100) + `cursor`(안정 정렬 `(time,id)`, 필터 해시·as_of 바인딩). 필터가 바뀐 cursor 는 400 `cursor_mismatch` |
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

## 인가 요점 (FE 가 믿으면 안 되는 것)

- `capabilities` 는 표시용. 모든 호출을 서버가 다시 거절한다. 탭 숨김은 보안이 아니다.
- 기관 관리자 범위 = active org_admin 소속 기관 **하나** ∩ 귀속 확인된 명상(meditation, 비템플릿) 회차 ∩ (클래스가 있으면 클래스도 같은 기관에 귀속 확인). 개인상담소·상담 세션·타기관·귀속 불명은 제외.
- 연구 목적(`purpose=research`)은 플랫폼 전용 + 가명만. 기관/식별+연구는 403.
- 기관 식별 포함은 서버 설정 `org_identified_operations_enabled`(잠정, `limits.provisional=true`)가 false 면 403.
- 일괄 반출 요청의 `include` 는 5종(`eeg_raw,ppg_raw,acc_raw,features,indices`)뿐이며 report 는 거절된다.
