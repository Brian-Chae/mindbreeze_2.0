# 브랜치·SDD 번호 규칙

> 2026-10-18 도입. Claude Code / Codex / Hermes / Paseo 워커 모두 준수한다.
> 근거: 여러 워크스페이스가 develop에 직접 커밋하면서 공유 파일(`specs/.sdd-counter`, DB 마이그레이션 등)에서 충돌이 반복됨.

## 1. 브랜치

```
main (운영 릴리스 전용)
  └── develop (통합 브랜치 — push 시 dev 자동 배포)
        ├── sdd/<NNN>-<슬러그>        ← SDD 기능 단위 (기본)
        ├── sdd/<NNN>-integrate       ← 한 SDD를 트랙으로 나눠 병렬 구현할 때 통합용
        ├── fix/<슬러그>              ← 핫픽스
        └── chore/<슬러그>            ← 설정·의존성·정리
```

- **기능·SDD 작업은 전용 브랜치 + 전용 워크트리(Paseo 워크스페이스)에서 하고, 끝나면 PR로 develop에 합류한다.**
- **빠른 수정은 develop에 직접 푸시해도 된다**: 오타·문구, 설정값, 긴급 핫픽스처럼 파일 몇 개에서 한 번에 끝나는 변경. 푸시 직전에 `git pull --rebase origin develop`.
- 임의 이름 브랜치(`Brian-Chae/*`, `worktree-*` 등) 금지. 워크스페이스를 만들 때 브랜치를 위 이름 규칙으로 정한다.
- 모든 작업 브랜치는 최신 `origin/develop`에서 분기한다. 하루 이상 걸리는 작업은 매일 한 번 `git fetch && git rebase origin/develop`.
- 병렬 트랙: `sdd/<NNN>-be`, `sdd/<NNN>-fe` 처럼 나눠 구현하고 `sdd/<NNN>-integrate`에서 합쳐 **PR 1개**로 올린다. 트랙별 담당 파일은 plan에 표로 고정한다.

## 2. SDD 번호와 제목

- 번호는 **`scripts/sdd new "한글 제목" <영문-슬러그> --worktree`** 로만 발급한다.
  `specs/.sdd-counter` 수정, `ls specs | tail` 로 번호 직접 계산은 **금지**(폐기됨, git 추적 해제).
  - origin/develop의 specs, 원격 `sdd/*` 브랜치, 원격 예약을 모두 보고 다음 번호를 정하고 **원격에 먼저 선점**하므로, 여러 워크스페이스가 동시에 실행해도 번호가 겹치지 않는다.
- 제목은 **한글로, 비전문가도 이해하는 한 줄**로 쓴다(예: `클래스·세션 구조 1단계`). 같은 제목을 아래에 일관되게 쓴다.
  - spec.md 첫 줄: `# SDD-NNN — 한글 제목`
  - PR 제목: `[SDD-NNN] 한글 제목`
  - Paseo 워크스페이스 제목: `SDD-NNN 한글 제목`
- 폴더·브랜치 이름은 영문 슬러그(macOS 한글 정규화와 CI 호환 때문): `sdd/NNN-슬러그`, `specs/sdd-NNN-슬러그/`.
- 전체 현황: `scripts/sdd list` (번호 · 상태 · 한글 제목).
- 커밋 메시지: `feat(sdd-NNN): 한글 설명` / `fix(sdd-NNN): …`
- DB 마이그레이션(alembic)은 **SDD당 담당 워커 1명**만 만든다. 병합 후 `python3 scripts/check-alembic-heads.py` 로 헤드가 1개인지 확인한다(2개 이상이면 머지 전 정리).

## 3. 충돌 줄이기

- 여러 트랙이 자주 만지는 파일: `backend/app/services/{agent_llm,agent_service,session_service,agent_checkin}.py`, `backend/app/config.py`, `backend/app/schemas/session.py`, `backend/app/api/v1/session.py`, DB 마이그레이션(`backend/alembic/versions/`). 같은 파일을 두 워커가 동시에 수정하지 않도록 plan의 **파일 담당 표**로 한 명에게만 준다. 겹치면 순차로 돌린다.
- 같은 워크트리에서 병렬 작업 금지(index lock·중간 상태 충돌). 워커마다 워크트리를 분리한다.
- 합치기 전에 `git fetch && git rebase origin/develop` 로 최신을 반영하고 테스트를 다시 돌린다.

## 4. 머지와 정리

- PR은 **Merge commit**(기존 방식 유지). 머지 후 원격·로컬 브랜치와 워크트리를 삭제한다.
- 끝난 워크트리는 바로 정리한다: `git worktree remove <경로>` → `git branch -d <브랜치>` → `git push origin --delete <브랜치>`.
- 미커밋 변경이 있는 워크트리는 정리하지 않는다(내용 확인 후 결정).

## 5. CI·테스트 실행 시점

- 작업 브랜치(`sdd/**`·`fix/**`·`feature/**`) push 에서는 CI 가 돌지 않는다. 작업 중에는 로컬에서 `scripts/test-changed` (변경 파일 관련 테스트만)를 쓴다.
- `develop` 대상 **PR 생성·갱신 시 전체 CI 1회**(backend 전체 pytest 포함)가 머지 게이트다. 새 push 가 오면 이전 실행은 취소된다.
- `develop` push(머지·빠른 수정)는 frontend 검증 + PG 마이그레이션 스모크만 돌고, 배포(Deploy Dev) 후 e2e-smoke 가 이어진다.
