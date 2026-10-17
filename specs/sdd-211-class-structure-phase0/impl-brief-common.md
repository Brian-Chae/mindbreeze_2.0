# SDD-211 구현 워커 공통 브리프 (Stage ④ Implement)

정본: 이 폴더의 `spec.md`, `plan.md`(§2 TD1~TD9, §3 Task, §4 소유권·직렬 의존, §5 변경 동작, §13 확정 기록), `verify.md`(합격 기준 — **구현 후 완화 금지**), `investigation/*`. 원본 저장소 ROOT=`/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0` (이 폴더는 각 worktree 에도 있음). 프로젝트 규칙: `AGENTS.md`·`CLAUDE.md`, 한글 주석/커밋, `any` 금지, 불변성, kebab-case 파일.

## 공통 규칙
- 자기 **worktree·브랜치에서만** 작업(아래 개별 지시). 다른 worktree·원본 working tree(`mindbreeze_2.0`, 미커밋 파일 다수 — 건드리지 말 것) 수정 금지. **푸시 금지**, 원격 브랜치 생성 금지. Task 단위 로컬 커밋: `feat(sdd-211): <Task ID> <요약>` / `test(sdd-211): …`.
- **테스트 먼저(RED→GREEN)**. 특성화·골든 테스트(A0·T0-FE·T0-BE·C3 등)는 만든 뒤 이후 커밋에서 **수정 금지**. 기존 테스트 개정은 plan §5.2 개정표에 있는 것만(임의 수정·삭제·skip 금지). 의도하지 않은 기존 테스트 실패가 나오면 고치지 말고 목록화해 보고.
- **DB**: dev/prod DB 접속·조회 금지(`.env*` 읽기 금지, 비밀 출력 금지). 로컬 테스트는 SQLite(`pytest`), PG 검증은 로컬 임시 PG(없으면 `postgres` 바이너리/도커 확인 후 임시 클러스터를 `$TMPDIR` 에 생성, 끝나면 정리). 스키마 변경·신규 마이그레이션 금지(P0 의 기존 리비전 멱등화만).
- 백엔드: `cd <worktree>/backend && source venv/bin/activate`(원본 `backend/venv` 가 있으면 `ROOT/backend/venv/bin/python` 사용 가능; 없으면 `python3 -m venv` 후 `pip install -r requirements.txt`). 프론트: worktree `frontend/node_modules` 는 원본 심볼릭(필요 시 `ln -s`). 타입체크는 `npx tsc -p tsconfig.app.json --noEmit`.
- 시간이 오래 걸리는 명령은 타임아웃 주의(백그라운드+로그 파일 후 폴링). 임시 서버·프로세스는 끝내기 전 정리.
- 완료 보고(숫자): 완료 Task·커밋 SHA 목록, 추가/수정 테스트 수, pytest/vitest/tsc/eslint 기준선 대비 결과(신규 실패 0 여부), 개정한 기존 테스트, 막힌 것·결정이 필요한 것(비즈니스만), 확인하지 못한 것. **측정/실행하지 않은 것을 했다고 쓰지 말 것.** 막히면 임의 우회 대신 보고하고 멈춰라.
