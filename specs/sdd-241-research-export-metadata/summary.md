# SDD-241 — 연구용 비식별 사본 메타데이터 보강 결과

## 결과

Brian의 2026-10-24 확정 결정을 적용했다. 생년월만 유지하고, 새 고지에 명시 동의한 이후 회차의 절대시각·프로그램·진행자를 연구 번들에 추가했다. 구현 전 spec/plan/verify 커밋은 `2f2b4b14`이며 기준 spec은 `599e06aa`다. 최신 origin/develop `17ad1a43`을 merge한 뒤 시작했다.

## 파일별 추가 필드

`backend/app/services/research_export_service.py`의 ALLOWED·Arrow schema·행 생성:

- `sessions.parquet`: `started_at_utc`, `started_at_kst`, `ended_at_utc`, `ended_at_kst`, `session_time_source`, `session_time_reason`, `class_pseudo`, `seq`, `session_kind`, `schedule_mode`, `planned_session_count`, `default_duration_min`.
- `subjects.parquet`: `measurement_started_at_utc`, `measurement_started_at_kst`, `measurement_ended_at_utc`, `measurement_ended_at_kst`, `measurement_time_source`, `measurement_time_reason`. 기존 `gender`, `birth_year_month` 유지(일자 없음).
- 신규 `facilitators.parquet`: `session_pseudo`, `user_id`, `real_name`, `account_role`, `session_role`.
- `manifest.json`: schema `2.0`, 5개 Parquet의 컬럼·행수·바이트·sha256, 새 허용목록 해시, `consent_scope`, `time_provenance`, `facilitator_provenance`. content hash에 schema/목록/동의범위/세션·개인·진행자/프로그램/raw 메타 반영.

`backend/app/services/research_consent_service.py`: 명시적인 `r5-2` 재동의만 기존 true 선택의 버전·시각·이력을 갱신한다. 버전 미전달 기본 `r5-1`, 가입 boolean-only `Consent.version=1.0`은 그대로 유지하며 자동 확장하지 않는다.

`frontend/src/lib/privacy-policy.ts`: 방침 `2.1`(10/24), 공통 `RESEARCH_METADATA_NOTICE`, 진행자 실명·계정 ID·역할, UTC/한국시간 측정 시작·종료, 프로그램 정보, 참여자 PII 제외와 HMAC·결합 위험 설명.

공통 문구 반영: `ConsentCheckList.tsx`(가입), `LoginPage.tsx`(소셜), `NoticeStepView.tsx`(회차 요약·상세), `privacy-consents.tsx`(계정 설정), `guest-class-membership-page.tsx`(비회원), `member-operations.tsx`(클래스 설정). `member-prep.ts`의 명시 제출 연구 고지만 `r5-2`로 변경했다. 상담사 가입·서비스 약관은 이용 근거가 부족함을 조사하고 [진행자 고지 초안](facilitator-notice-draft.md)에 기록했다. 신규 동의 UI는 추가하지 않았다.

## 데이터 해석과 결측

- 세션 시각은 started_at/ended_at. 개인 시각은 실제 업로드 raw endpoint의 최솟값·최댓값이며 예약/입장/업로드 시각·feature 시각으로 대체하지 않는다.
- 유한값·2000~2100 epoch 범위·세션 구간·endpoint 순서·스트림별 chunk 시계 역행을 검증한다. 유효 구간의 외곽 시작/종료이며 중간 공백이 없는 연속 측정을 뜻하지 않는다.
- 근거 미확인/feature-only/끝점 누락/역전/세션 밖/시계 역행이면 null+사유. 운영 naive 시각을 UTC로 추정하지 않는다(SQLite 테스트에서만 timezone 복원).
- 진행자는 회차 host와 해당 회차 scope·추가/제거 기간이 겹치는 관계를 반영한다. 중도·종료 후 제거자도 시각 근거가 있으면 포함. 제거 시점 미상·회차 전 제거·모순된 구간은 제외한다. 이름·계정 역할·관계 역할은 현재 스냅샷이며 당시 실출석/프로필·덮어쓴 재등록 이력의 완전 복원을 보장하지 않는다.
- 구동의/동의시각 불명/동의 이전 시작 회차는 확장 컬럼 null, 진행자 행 없음. session/participant namespace를 확장 동의와 분리한다. acked/exported 자동 재반출 없음.
- 참여자 실명·연락처·원본 ID·생년월일의 일자·자유기입 제목/메모 반출 금지. 진행자 실명은 real_name 셀만 예외이며 참여자와 동명 충돌은 실패, 진행자 연락처 패턴도 실패한다.

## 검증

- RED: 신규 계약10건 실패 → 구현. 리뷰 수정2건 실패 → 구현. 고지 FE2건/BE재동의1건 및 요약 DOM1건 실패 → 구현.
- 백엔드 관련 4파일: **73 passed**(exporter50 + 동의23).
- 프론트 최종 관련 7파일: **96 passed**. `npx tsc -b` 통과.
- 독립 `verify-contract.py`: 5개 Parquet 재읽기, UTC/KST 날짜 경계·소수초 동일 순간, manifest 파일/허용목록 해시 재계산 통과.
- 변경 전 백엔드 전체: **3938 passed, 463 skipped, 1 failed**, 390.65초. 기존 SDD-218 대량 report job 접수 200ms 제한 테스트가 1574.4ms로 실패(쿼리18회); 본 변경 전부터 재현했다.
- 변경 후 백엔드 전체: **3971 passed, 463 skipped, 실패 0**, 374.06초. 변경 전 실패한 SDD-218 성능 테스트도 통과했다. 해당 서비스/테스트는 수정하지 않았으며, 시간 기반 테스트의 변동으로 기록한다.
- Task1 독립 리뷰 Important(복수 스트림 오판) 수정 후 재리뷰 해소. Task2 및 전체 브랜치 최종 독립 리뷰 Critical/Important 없음.

재실행(프로젝트 pytest 의존성 설치된 Python 사용):

```bash
cd backend
python ../specs/sdd-241-research-export-metadata/verify-contract.py
python ../specs/sdd-241-research-export-metadata/verify-contract.py --pytest -q
```

실제 PostgreSQL/S3/Spark 적재·장비 물리 시계·브라우저/기기는 미검증이다. pytest는 SQLite 인메모리와 저장소 더블을 사용하며 dotenv 로더를 차단했다. PG 테스트는 별도 인프라 없이 건너뛴 결과를 포함하므로 DB 증거가 아니다.

## 법적·운영 위험

**진행자 실명·실제 user id는 직접 식별정보다. 참여자 연구 동의가 진행자 본인의 동의를 대신하지 않는다. 진행자 본인의 별도 동의 또는 다른 적법한 이용·외부 제공 근거와 동의 증빙·철회·기존 사본 처리 체계는 아직 확인/구현되지 않았다.** 이번 구현 승인과 법적 이용 근거 확보는 구별하며, 실제 확장 연구 이용 전에 이를 해결해야 한다. 고지 초안은 동의 증빙이 아니다.

정확한 일시·프로그램·진행자와 성별·생년월의 결합은 재식별 위험을 높인다. 모든 연구 사본이 익명이라고 보장하지 않는다. 현재 이름/역할 및 누락 가능한 관계 이력, 장비 시계의 절대 정확도, schema2.0 수신자 소비·ack 호환은 실제 운영 검증이 남았다.

가입·계정 boolean-only 동의는 새 항목 고지 버전 증빙이 없어 확장되지 않는다. 클래스 설정에서 이미 true인 구동의를 같은 true로 저장하는 UX는 없으므로 해제 저장 후 재선택하거나 회차 고지에서 명시 동의해야 한다. 이번 범위에서는 기존 경로만 유지했다.

서버·실DB·환경파일·실데이터 삭제·메일·머지·develop push·배포는 수행하지 않았다. 작업 브랜치 push와 develop 대상 PR 생성 후 최종 리뷰를 요청한다.

## 최종 인계 상태

- 제품 구현 커밋: `9e7c0da1` (`feat(sdd-241): 연구 사본 측정·프로그램·진행자 메타데이터와 고지 보강`), 작업 브랜치 push 완료.
- PR: [#83 — 연구용 비식별 사본 메타데이터 보강](https://github.com/Brian-Chae/mindbreeze_2.0/pull/83), base `develop`, head `sdd/241-research-export-metadata`.
- 로컬 검증과 독립 리뷰를 마쳤다. Brian 최종 Review·CI 완료·실제 운영 검증은 별도이며, 머지·develop push·배포는 하지 않았다.
