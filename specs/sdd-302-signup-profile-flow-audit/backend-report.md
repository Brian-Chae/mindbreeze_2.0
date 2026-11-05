# SDD-302 — 백엔드 구현 결과

## 변경
- 본인 UserResponse에 `client_required_fields`, `profile_prompt_dismissed`, `gender`, `birth_date`, `phone` 추가. 필수 판정은 client 역할의 실제 이름·성별·생일이며 공급자/기존 완료 플래그와 독립이다. 전화번호는 선택이다.
- `GET /api/v1/auth/users/me`는 최신 UserResponse 반환. 생일은 과거 상세정보 수정 호환을 위해 ClientProfile 값 우선, 없으면 User 값으로 보완한다. 신규/PATCH는 두 값을 함께 저장한다.
- 이메일(레거시 포함)·Google·Apple 신규는 성별 누락 시 422 `detail.code=GENDER_REQUIRED`. 소셜 기존 로그인에는 가입 입력을 요구하지 않는다. Apple 오류는 nonce 소비 전에 반환되어 같은 nonce로 성별 보완 재시도가 가능하다.
- Google 신규 확인 이름은 요청의 trim된 name 우선, 없으면 공급자 이름 사용. 기존 계정 재로그인은 입력 이름으로 덮어쓰지 않는다.
- `POST /onboarding/client/complete`: client 역할 확인, 필수 누락 400 `{code:CLIENT_REQUIRED_FIELDS, message, required_fields}`. 충족 시 기존 step1~4·전화번호 없이 완료 가능. 코치 완료 계약은 유지한다.
- `POST /onboarding/client/profile-dismiss`: client 전용, UserResponse 반환. `OnboardingProgress.steps.profile_prompt_dismissed=true`만 저장하고 다른 진행키/완료 상태 보존, 반복 요청 안전. DB migration 없음.

## 검증
- 신규 핵심 RED: 27 failed / 1 passed → 구현 후 28 passed.
- Google 신규 확인 이름 RED: 1 failed → 구현 후 관련 회귀 통과.
- 과거 상세프로필 생일 우선 RED: 1 failed → 구현 후 통과.
- 관련 13파일 회귀: **165 passed**, 60.23초. 인증·가입·코치/회원 온보딩·초대·역할·연령/동의·Apple nonce/연결 포함.
- 생일 호환 최종 수정 후 신규+Apple 재검증: **51 passed**, 25.14초.
- `git diff --check` 통과. crypt/argon2 및 기존 HTTP 422 상수 DeprecationWarning 존재.
- 전체 `pytest -q --tb=short --maxfail=10` 실행 결과와 후속 실패 분류는 아래 최종 검증 절에 기록한다. 전체 재실행 통과로 보고하지 않는다.

## 테스트 입력 호환
기존 공통 fixture의 생일 기본값 보정에 성별을 추가했다. `X-Test-Strict-Signup: 1`은 모든 가입 기본값 보정을 끄며 신규 실패 테스트는 이를 사용한다. 기존 프로필 없는 출발 상태 복원은 생일과 성별 둘 다 자동 주입했을 때에만 수행한다. 기존 연령·동의·nonce 테스트 단언은 유지하고 정상 payload에 성별을 추가했다.

## 한계
합성 HTTP API + SQLite/fakeredis 검증이다. 실 OAuth·네이티브 앱·운영 DB·메일 발송은 수행하지 않았다. PR/배포는 감독 담당이다.

## 독립 리뷰 보완
- 선택 전화번호 PATCH는 미전달이면 보존, 명시 `""`/공백/`null`이면 삭제(None). 값은 양끝 공백을 제거한다. RED 3개 → GREEN.
- 공용 `get_progress`에서 기존 User 부모행을 `SELECT FOR UPDATE`로 잠가 단계·완료·보류 쓰기를 사용자별 직렬화한다. 진행행이 아직 없어도 최초 INSERT가 경합하지 않는다. 잠금 획득 후 `populate_existing`으로 오래 열린 세션의 JSON 캐시를 갱신한다.
- 로컬 전용 임시 PostgreSQL + Alembic 하네스로 실제 2스레드 race 검증: 최초 보류 동시요청은 중복 키 예외, 기존 단계/보류 동시저장은 키 소실로 **RED 2 failed** 재현 → 수정 후 **2 passed**. 기존 step1/새 step3/보류키/current_step/완료=true 보존을 확인했다.
- 전화번호·동시성 변경 후 신규/PG/회원·코치 온보딩/초대/가입/Apple 회귀 **86 passed**, 48.63초. PG 검증은 SQLite 대체가 아닌 실제 로컬 PostgreSQL이며 외부 DB에 접속하지 않았다.

## 전체 검증 환경과 CI 보완
- 로컬 ingest 4건은 `jsonschema` 미설치로 실패했다. 기준선 `13bff196`의 backend를 임시 디렉터리에 격리하여 같은 파일 재실행: 동일 **4 failed / 17 passed**(20.03초), 모두 `ModuleNotFoundError: jsonschema`.
- `requirements.txt`에는 이미 `jsonschema==4.26.0`가 있으며 CI도 requirements를 설치한다. 공유 venv를 수정하지 않고 `/tmp/sdd302-test-deps`에 설치 후 현재 코드 ingest 재실행: **21 passed**(9.74초). 제품 의존성 파일 변경 없음.
- PR PostgreSQL smoke의 보강 HTTP 3건 실패 원인은 합성 NOW=2026-11-02와 실제 2026-11-05의 불일치였다. 대상 회차 NOW+2일(11/4)을 HTTP 실시간 검사가 과거 회차로 거부했다. 가입/성별 변경과 무관하며 해당 테스트·서비스는 기준선과 동일했다.
- 기준선 `13bff196` 격리 실제PG에서도 동일 HTTP 3건 **3 failed / 39 deselected**(17.72초). 제품 로직은 보존하고 `test_sdd217_makeup.py` fixture에서 보강 서비스 시각만 합성 NOW로 고정했다.
- 수정 후 해당 파일 전체 실제 PostgreSQL 검증 **42 passed**(29.03초). 권한·멱등성·동시성·회차상태 검증 단언을 유지했다.


## 최종 전체 실행과 실패 해소
- 전체 실행: **10 failed / 5148 passed / 545 skipped**, 1795.76초. `--maxfail=10`에 도달해 끝부분 일부가 미실행되었으며, 실행 중 수정 전 모듈/fixture를 이미 로드한 프로세스였다. 전체 최종 재실행 GREEN으로 주장하지 않는다.
- 실패 10건 분류:
  1. `tests/sdd246/ingest/test_live_ingest_pg.py`: `test_capture_start_ACK에_stream_owner_generation_lease_participant가_계약대로_들어간다`, `test_stream_수명_event_payload는_DeviceEntity_스키마와_일치한다`, `test_밴드_보고_payload도_DeviceEntity이고_이후_stream_event가_밴드_필드를_보존한다`, `test_metric_소켓은_저장하지_않고_최신값_metrics_event만_만들고_REST가_feature를_저장한다` — 모두 `jsonschema` 누락. 기준선에서도 동일, 임시 의존성 적용 후 해당 파일 21 passed.
  2. `tests/test_sdd244_contracts.py::test_frozen_schema_matches_dto_and_golden`의 `raw-v2-RawHeader`, `manifest-v1-ManifestRevision`, `feature-v1-FeatureRecord`, `indices-v1-DisplaySnapshot` — 동일 `jsonschema` 누락. 임시 의존성 적용 후 최종 회귀 통과.
  3. `tests/test_sdd220_apple_auth.py::test_ts11_nonce_누락_불일치_재사용` — 전체 실행이 수정 전 정상 payload(성별 없음)를 로드한 상태. 초기 구현 커밋에서 성별을 넣어 nonce 단언은 유지했으며 최종 Apple 회귀 통과.
  4. `tests/test_upload_status_overview.py::test_V_O09_상세_API_요약과_교차_일치` — 목록 서비스 시각만 합성 NOW로 고정하고 상세 서비스 시각은 실제 현재인 fixture 결함. 같은 pending 청크가 10초/하루 경과로 다르게 분류됐다. 기준선 `13bff196` 격리 실행에서도 **1 failed / 29 passed**. 제품 로직 변경 없이 상세 서비스 시각·캐시를 목록 fixture와 함께 고정했다.
- 마지막 시각 fixture 수정 후 상세/목록 업로드 현황 + SDD244 계약 + Apple 전체: **160 passed**, 56.80초.
- 중단 지점 다음 정렬 파일(`test_upload_status_overview_pg`, `test_upload_status_pg`, `test_video_record`, `test_web_push`, `test_ws_chat_multitab`, `test_ws_null_data_guard`) 별도 실행: **38 passed / 9 skipped**, 27.46초. PG opt-in 파일 9개는 이 명령에서는 skip이며 실제 PG 검증을 대체하지 않는다.
- 전체 실행에서 발견한 실패 10건은 각 영향 범위 재검증으로 모두 해소했다. 최종 CI 전체 결과는 감독이 별도로 확인한다.
