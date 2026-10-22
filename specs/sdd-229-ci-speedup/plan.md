# SDD-229 Plan

## T1. E2E 를 Release Build 로 이동

- `deploy-dev.yml`: 마지막 `e2e-smoke` 잡 제거.
- `e2e-smoke.yml`: `workflow_call` 에 선택 입력 `ref` 추가(검사할 커밋의 e2e 스크립트 사용), 알림 문구를 "릴리스 전 E2E 실패"로. `workflow_dispatch` 유지.
- `release-build.yml`: `e2e` 잡(= `uses: ./.github/workflows/e2e-smoke.yml`, `secrets: inherit`) 추가, `build` 가 `needs: [e2e]`.
  - 대상은 **dev 서버**다(운영 DB 에 테스트 데이터를 만들지 않기 위해). 릴리스할 커밋이 dev 에 배포돼 있어야 의미가 있다 — 기본 ref 가 develop 이고 dev 는 develop 을 배포하므로 맞는다.
  - 호출되는 워크플로가 쓰는 권한은 contents:read 뿐이라 기존 permissions 와 충돌 없음.

## T2. 변경분 기반 CI 선택 (`ci-feature.yml`)

- 새 `changes` 잡: 바뀐 파일 목록 계산
  - PR: `git diff --name-only HEAD^1 HEAD`(체크아웃된 머지 커밋 기준 = 현재 base 대비 PR 변경분)
  - push: `git diff --name-only <before> <sha>` (before 가 0 이면 전체)
  - `scripts/test-changed --ci --files-from <목록>` 이 `frontend`·`backend_mode(none|related|full)`·`backend_tests`·`pg` 를 GITHUB_OUTPUT 으로 낸다.
- `frontend` 잡: `frontend == 'true'` 일 때만.
- `backend` 잡: PR 이고 `backend_mode != 'none'` 일 때만. full 이면 기존 명령, related 면 선택 파일만.
- `backend-pg-smoke`: `pg == 'true'` 일 때만(backend/app·alembic·tests/pg·requirements 변경).
- 브랜치 보호(필수 상태 점검)는 현재 미설정이라 skip 된 잡이 머지를 막지 않는다.

## T3. 선택 로직 (`scripts/test-changed` 확장)

- 전체 전환 조건: `.github/workflows/ci-feature.yml`·`scripts/test-changed` 변경, `backend/requirements.txt`, `backend/alembic*`, `backend/app/{core,models}/`, `backend/app/{config,main}.py`, `backend/app/api/deps.py`, `backend/app/api/v1/__init__.py`, `backend/app/*/__init__.py`, `backend/tests/**/conftest.py`, `backend/tests/fixtures/`.
- 관련 테스트 찾기:
  1. 바뀐 app 모듈에서 시작해 **역 import 폐쇄**(그 모듈을 import 하는 app 모듈을 반복 확장). 집계 모듈(`app.main`, `app.api.v1`)은 확장하지 않는다(모든 것이 걸리므로).
  2. 폐쇄 안 모듈을 import 하는 테스트 + 폐쇄 안 라우터(`app/api/v1/*.py`)의 URL 접두어(`/api/v1{prefix}`)를 쓰는 테스트.
  3. 바뀐 테스트 파일 자체, 바뀐 테스트 헬퍼(`tests/*helpers.py`)를 import 하는 테스트, 바뀐 루트 cron 스크립트를 import 하는 테스트.
  4. `tests/pg` 는 PG 잡 담당이라 제외, `test_sprint4_integration.py` 제외(기존 CI 와 동일).
- 백엔드 .py 가 바뀌었는데 관련 테스트 0개 → 전체. 선택 파일이 전체의 60% 이상 → 전체.
- 백엔드 비-.py(assets 등)만 바뀌면 → 전체(렌더 결과 영향).
- 로컬 모드(인자 없음)는 같은 선택을 쓰고 기존처럼 바로 실행.

## T4. dev 배포 패키지 설치 생략 (`deploy-dev.yml`)

- 서버 `backend/.requirements.sha256` 와 새 `requirements.txt` 해시가 같고 venv 가 있으면 `apt-get`·`pip install` 생략. 다르면 설치 후 해시 기록. weasyprint import 확인은 항상 수행(수 초).

## T5. 문서

- `.claude/rules/branch-management.md` §5 갱신.
