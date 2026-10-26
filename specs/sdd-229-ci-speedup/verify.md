# SDD-229 Verify — 구현 전 QA 게이트 (구현 전 작성)

| ID | 시나리오 | 기대값 | 도구 |
|---|---|---|---|
| V01 | 워크플로 문법 | `actionlint` 오류 0 (수정한 4개 파일) | actionlint |
| V02 | 프론트만 변경 | `frontend=true, backend_mode=none, pg=false` | 선택 스크립트 단위 테스트 |
| V03 | 문서만 변경 | 전부 false/none | 단위 테스트 |
| V04 | 서비스 1개 변경 (`app/services/dashboard_service.py`) | `related`, 그 서비스를 직접 import 하는 테스트 + `/api/v1/dashboard` 를 부르는 테스트 포함, 무관한 테스트(예: devices) 미포함 | 단위 테스트 + 실제 저장소 |
| V05 | 라우터 1개 변경 (`app/api/v1/devices.py`) | `related`, `/api/v1/devices` 테스트 포함 | 단위 테스트 |
| V06 | 공통 영역 변경 (`app/core/security.py`, `app/models/*.py`, `requirements.txt`, `tests/conftest.py`, alembic) | `full` | 단위 테스트 |
| V07 | CI 파일·선택 스크립트 변경 | `frontend=true, full, pg=true` | 단위 테스트 |
| V08 | 관련 테스트 0개인 app 변경 | `full` | 단위 테스트 |
| V09 | 선택된 테스트 실제 실행 | V04 선택 목록으로 로컬 pytest 통과 | pytest |
| V10 | Deploy Dev 구조 | 잡이 frontend·deploy 둘뿐, e2e 없음 | YAML 파싱 |
| V11 | Release Build 구조 | `e2e` 잡이 e2e-smoke.yml 호출, `build.needs` 에 e2e | YAML 파싱 |
| V12 | 패키지 설치 생략 | 해시 같으면 생략, 다르거나 venv 없으면 설치 + 해시 기록 (셸 로직 bash 로 재현) | bash |
| V13 | 실제 PR CI | 이 PR(워크플로 변경)은 전체 실행 = 회귀 확인. 머지 후 Deploy Dev 에 e2e 없음·시간 단축 확인 | GitHub Actions |
