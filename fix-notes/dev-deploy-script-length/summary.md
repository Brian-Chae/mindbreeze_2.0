# dev 배포 워크플로 길이 한도 초과 복구

- 기준: `953a1437` (PR #79 머지), 브랜치 `fix/dev-deploy-script-length`.
- 결과: SSH action의 반복 크론 등록 17개를 `deploy/dev/register-crons.sh`로 이동했다. 배포 번들에 포함하고, 번들 해제·서비스 재시작·nginx 보장 이후 기존 등록 위치에서 bash로 호출한다.
- 다른 SSH 배포 본문은 이동/호출 부분 외 바이트 동일하다. 로그 파일 생성·DEBUG=false·롤백·운영 배포 경로를 유지했다.

## 길이

YAML 파싱 후 `with.script` 값 기준:

- 문자 수: **18,139 → 10,086자**.
- UTF-8: **21,057 → 12,255바이트** (8,802바이트 감소).
- UTF-16: 18,139 → 10,086단위.
- 사용자 제공 장애 추정치 약 21,027과 달리 기준 커밋을 직접 파싱한 UTF-8 측정값은 21,057이다. 모든 측정 방식에서 수정 후 15,000 미만이다.
- 새 회귀 테스트는 문자 수와 UTF-8 모두 18,000 초과 시 실패한다. 수정 전 RED: 문자 수 18,139로 실패, 수정 후 GREEN.

## 크론 동일성 증거

재현: `/tmp/mb237-venv/bin/python fix-notes/dev-deploy-script-length/verify-crons.py`

- 실제 crontab 대신 Bash 함수와 임시 HOME의 파일만 사용한다. 크론에 포함된 명령은 문자열로 등록만 하므로 서버 경로·환경 파일·DB·메일에 접근하지 않는다.
- 기준 커밋의 등록 명령 17개와 새 스크립트의 등록 명령은 순서·글자까지 동일하다.
- 빈 상태 및 기존 작업·중복 등록·DEBUG=true가 있는 상태에서 양쪽을 각각 반복 실행했다. 각 회차 결과가 바이트 및 줄 집합으로 동일하다.
- 기존 상태에서는 첫 실행부터 17개 작업과 DEBUG=false가 동일하고, 두 번째 실행 결과도 동일하다. 무관한 기존 작업을 보존한다.
- 시간·명령·로그 경로·flock·--dev-env·`retention_sweep_cron.py --dry-run`을 그대로 유지했다.
- 기존 작업 보존 시 결과 SHA256: `369f8d547d1a53d22e293ca3bb49b73a4e7f24668fe989e27daae4e37c144968`.
- 빈 상태 안정화 결과 SHA256: `512e9e0c5c7ea161c32c724835ee387e54ee396a765cfc651c7c10bc9bca3f7a`.
- 기존 특성: 완전히 빈 crontab에서는 `set -e`와 `grep -v` 종료 코드 때문에 첫 회차는 크론 등록을 생략하고 DEBUG=false만 남는다. 다음 회차에는 17개가 등록되어 안정화된다. 기준/수정에서 동일하며 이번 범위에서 동작을 변경하지 않았다.

## 검증

- YAML 파싱: 통과.
- `bash -n deploy/dev/register-crons.sh`: 통과.
- `actionlint .github/workflows/deploy-dev.yml`: 통과.
- `git diff --check`: 통과.
- 관련 backend 테스트: **115 passed**, 기존 의존성/문자열 관련 DeprecationWarning 4건.
  - test_dev_deploy_script_length.py
  - test_sdd216_release.py (새 등록 경로·번들 포함·해제 이후 호출 검증)
  - test_sdd212_dev_workflow.py / test_sdd212_worker_units.py
  - test_sdd210_deploy_templates.py / test_sdd210_ci_gates.py
  - test_mb2_high_severity_fixes_3.py
- #79의 실제 변경은 deploy-dev.yml뿐이며 추가/갱신한 backend 테스트는 없었다.
- backend 전체 테스트와 실제 GitHub 배포는 실행하지 않았다. 서버 접속·DB·실제 환경 파일 조회·실제 crontab 변경·머지·develop 푸시·workflow 수동 실행은 하지 않았다.

## 독립 리뷰

- 읽기 전용 별도 검증자가 diff·크론 문자열·길이·격리 테스트·Bash 구문을 재검증했다. 새 회귀 없음.
