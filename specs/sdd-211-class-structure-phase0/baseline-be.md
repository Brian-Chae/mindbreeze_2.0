# SDD-211 백엔드 기준선 (G0, BE-1)

- 측정 시점: 2026-10-18, worktree `mindbreeze_2.0-sdd211-be1` (브랜치 `sdd/211-be1`, 기준 커밋 `d43e53cc`)
- 명령: `cd backend && python -m pytest -q --tb=line -p no:cacheprovider --ignore=tests/test_sprint4_integration.py --deselect=tests/test_sdd070_pdf_metrics.py::test_real_pdf_metric_pages` (CI 와 동일 제외 항목, 원본 저장소의 venv Python 3.11.14 사용, `CI=true`)
- 결과: **1985 passed, 11 skipped, 1 deselected, 0 failed** (205.32초)
- 실패 파일: 없음
- 스킵 11건: 기존 `skip` 마킹(이 Task 에서 변경 없음). 목록은 측정하지 않음.
- 측정 중 신규 SDD-211 테스트 파일은 아직 없었다(기준선 실행 시작 후 작성). 이후 "신규 실패 0"은 이 수치 대비.
- 작업 트리 타인 미커밋 변경: 원본 `mindbreeze_2.0` 의 `designs/class-structure-redesign/` untracked 파일은 이 worktree 에 없으며 건드리지 않았다.
