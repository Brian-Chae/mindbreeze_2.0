# SDD-036 백엔드 구현 결과

2026-09-14 — Phase A 완료.

## 구현

- HARU 정본의 NormalizationBaseline/NormalizationModel, 11종 지표 스키마, 집계 서비스를 이식했다.
- `/api/v1/normalization`에 baseline 생성·목록·삭제, 모델 계산·목록·활성 조회·활성화를 등록했다. 정본 호환을 위해 baseline 활성화와 `/active` 조회도 유지했다.
- 모든 경로에서 기존 `require_platform_admin`을 재사용한다. baseline의 user_id는 인증된 관리자 UUID 문자열로 서버에서 설정한다.
- 정본의 AsyncSession을 mindbreeze 동기 Session으로 바꿨다. 인증 조회에서 이미 시작된 요청 트랜잭션을 재사용하고, 변경 성공 시 commit·예외 시 rollback한다.
- median + 1.4826·MAD, MIN_BASELINES=5, FAA 절댓값, breathingStability 무변환, 그 외 로그 변환 및 POSITIVE_ONLY/DIRECTION_DOWN을 유지한다. 유효 표본 부족·척도 0인 지표는 생략하여 클라이언트 fallback을 허용한다.
- NaN/Infinity 요청은 유한 수 검증과 BaselineValidationRoute를 통해 직렬화 가능한 422 오류로 반환한다. null은 그대로 보존한다.
- PostgreSQL advisory transaction lock과 부분 유일 인덱스를 유지하여 모델 버전 계산과 단일 활성 전환을 보호한다.

## 검증 결과

- 구현 전 신규 테스트: 12 failed — 경로/서비스 미구현을 확인했다.
- 신규 테스트 최종 개별 실행: **13 passed**.
- 최종 전체 실행 `cd backend && venv/bin/pytest -q`: **350 passed, 1 skipped, 12 warnings**, 30.42초, exit 0.
- `git diff --check`: 통과.
- `cd backend && venv/bin/alembic upgrade head`: **실제 설정된 PostgreSQL 연결에서 성공**, exit 0.
- 적용 후 DB 조회: alembic_version = `e036a0000002`; 두 테이블의 모든 컬럼 및 `is_active = true` 부분 유일 인덱스 확인.

마이그레이션 연결:

`8e30b17c920a → e036a0000001 → e036a0000002`

`upgrade head` 실행 시 기존 DB에 미적용된 선행 마이그레이션도 함께 적용됐다. 실행 로그의 첫 적용은 `30c1bfbc724f → e512db25533a`이며, 기존 병합 브랜치 및 SDD-015 이후 선행 리비전을 거쳐 새 리비전까지 적용했다. 신규 두 테이블만 개별 적용한 것은 아니다.

## 검증 범위와 인계

API 테스트는 SQLite 격리 DB와 실제 관리자 권한 의존성을 사용한다. 11종 저장, null/구버전 계약, 최소 baseline 수, 버전 증가, 활성 전환·재활성·404 보존, 삭제, 미인증 및 비관리자 차단, 비유한 숫자 422, 집계 변환을 확인했다. PostgreSQL 실동시 요청 경합과 브라우저 연동은 별도로 실행하지 않았다.

프론트 코드, 기존 specs/.sdd-counter 및 SDD-035 문서는 이 작업에서 수정하지 않았다. FE 통합 확인과 SDD 전체 summary/최종 리뷰는 코디네이터 단계에 남아 있다. 커밋·푸시는 하지 않았다.

## 변경 파일

- backend/app/models/normalization_baseline.py
- backend/app/models/normalization_model.py
- backend/app/models/__init__.py
- backend/app/schemas/normalization.py
- backend/app/schemas/normalization_model.py
- backend/app/services/normalization_distribution.py
- backend/app/api/v1/normalization.py
- backend/app/api/v1/__init__.py
- backend/alembic/versions/e036a0000001_sdd_036_normalization_baselines.py
- backend/alembic/versions/e036a0000002_sdd_036_normalization_models.py
- backend/tests/test_normalization.py
- specs/036-normalization-standard-model/be-impl-report.md
