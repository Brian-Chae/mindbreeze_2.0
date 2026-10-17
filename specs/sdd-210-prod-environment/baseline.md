# [SDD-210] T-0 기준선 (2026-10-17)

| 항목 | 값 |
|---|---|
| 작업 브랜치 / 기준 SHA | `sdd/210-prod-code` / `73cd3c0c` (develop) |
| `deploy-dev` 마지막 성공 SHA | `ce979ea18c37bf6a210ae2ef2b26a9128d0af2ca` (2026-10-17T13:24:54Z) |
| alembic heads | 1개 — `e036a0000051` |
| alembic/versions *.py 파일 수 | 84 (plan 의 85 와 1 차이 — 파일 수 기준 재집계값) |
| 백엔드 pytest | `--ignore=tests/test_sprint4_integration.py` → **1985 passed, 12 skipped** (189.9s) |
| 프론트 tsc | `tsc -p tsconfig.app.json --noEmit` 오류 0 |
| 프론트 build | 통과 (`✓ built`, 기존 INEFFECTIVE_DYNAMIC_IMPORT 경고만) |
| 프론트 eslint | 기존 3 errors (본 SDD 이전부터 존재, 증가 금지 기준선) |
| develop 동결 지점(릴리스 후보 SHA) | 컷오버 직전 Brian 승인 시 확정 — 현재 후보 `73cd3c0c` 잠정 |
