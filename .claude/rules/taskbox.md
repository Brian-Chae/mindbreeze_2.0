# MB TASK BOX 워크스페이스 규칙

> 2026-10-22 확정(Brian). Claude Code / Codex / Hermes / Paseo 워커 모두 준수한다.
> 기획 배경: `docs/MINDBREEZE_TASKBOX_워크스페이스_운영_기획.md` · 브랜치 규칙: `branch-management.md`

## 1. 워크스페이스 구성

| 종류 | 제목 | 체크아웃 | 수명 |
|---|---|---|---|
| 지휘 창구 | `[MB] TASK BOX` | 메인(develop) | 상시 |
| 배포 창구 | `[MB][DEPLOY] 배포·릴리즈` | 메인 | 상시 |
| 운영 창구 | `[MB][OPS] 운영·장애 대응` | 메인 | 상시 |
| 앱 창구 | `[MB][APP] 앱 출시` | 메인(빌드 산출물 때문) | 상시 |
| 기능 카드 | `SDD-NNN 한글 제목` | 워크트리 `sdd/NNN-슬러그` | 끝나면 보관 |
| 수정 카드 | `[MBYYMMDD][FIX] 세부 작업` | 워크트리 `fix/슬러그` | 끝나면 보관 |
| 점검 카드 | `[MBYYMMDD][QA] 세부 작업` | 메인(읽기만) 또는 워크트리 | 끝나면 보관 |

- 날짜는 **만든 날** 6자리, 생성 후 불변. 세부 작업 20자 안팎. 상태는 제목에 넣지 않는다.
- SDD 카드는 `scripts/sdd new "한글 제목" <슬러그> --worktree`로만 만든다.
- FIX/QA 카드 워크트리는 `create_workspace(isolation=worktree, mode=branch-off, baseBranch=develop, branchName=fix/<슬러그>)`.

## 2. 핵심 원칙

- **메인 체크아웃에서는 코드를 고치지 않는다.** 코드 변경은 카드(워크트리)에서만. 메인은 깨끗한 develop 유지(`git pull`만).
- 상시 창구는 진단·확인·배포만 한다. 코드 수정이 필요하면 TASK BOX에 FIX 카드 발행을 요청한다.
- 예외: 오타·문구·설정값 같은 빠른 수정은 `branch-management.md`의 develop 직접 푸시 규칙을 따른다(그래도 카드 하나를 열어 그 안에서 한다).

## 2-1. develop 반영(머지·푸시) 일원화

- develop에 합치기(PR 머지)와 develop 직접 푸시는 **DEPLOY 창구만** 한다. 카드·다른 창구는 PR 생성까지만.
- develop 반영 = dev 자동 배포 = 백엔드 재시작(2~3분)이라 진행 중인 클래스·상담 연결이 끊긴다.
- Brian이 "테스트 중"이라고 하면 DEPLOY는 develop 반영을 멈추고 대기 목록에 쌓는다. "테스트 끝"이면 쌓인 PR을 한 번에 머지해 배포를 1회로 묶는다.
- 여러 PR을 합칠 때는 연달아 머지하고 마지막 머지의 Deploy Dev·e2e-smoke 결과만 확인한다.

## 3. 창구별 역할

| 창구 | 한다 | 안 한다 |
|---|---|---|
| TASK BOX | 요청 해석, 카드 생성, 워커 배정, 장부 기록, 현황 보고, 머지 확인 요청, 끝난 카드 보관·정리 | 코드 수정, 배포 |
| DEPLOY | 머지 후 Deploy Dev·e2e-smoke 결과 확인, 실제 화면·API 동작 검증, prod 릴리즈(승인 후), 배포 이력 | 기능 구현 |
| OPS | EC2·RDS·Celery(email worker 포함)·로그·디스크·테스터 계정 점검, DB 조작(승인 후) | 코드 수정 |
| APP | Capacitor 빌드, TestFlight·Play 제출, 서명·스토어 메타 | 웹 기능 구현 |
| 카드 | SDD 7단계 또는 원인분석→수정→테스트, PR 생성 | 머지·배포 |

## 4. 흐름

1. Brian → TASK BOX 요청.
2. TASK BOX: 유형 판정 → 카드 생성 + 작업 에이전트 생성 + 장부 한 줄. 운영·배포·앱 요청은 해당 상시 창구로 넘긴다.
3. 카드 완료 기준: PR 생성 + CI 통과 + (SDD는) summary 작성.
4. TASK BOX: "머지할까요?" → 승인 시 머지 → DEPLOY에 "SDD-NNN 머지, dev 검증" 인계.
5. DEPLOY: 배포 결과와 실제 동작 확인 → 장부 `dev반영`.
6. TASK BOX: 카드 보관, 워크트리·브랜치 정리(삭제는 승인 후) → 장부 `완료`.
7. prod 릴리즈는 DEPLOY에서 묶음으로, Brian 승인 후.

## 5. 장부

- 위치: knowledge `0 Personal/Tasks/YYYY-MM.md`의 `## MINDBREEZE` 절(전사 장부와 한곳).
- 열: 식별 | 제목 | 워크스페이스 ID | 브랜치/PR | 상태 | 비고
- 상태: 진행 · PR대기 · dev반영 · prod반영 · 외부대기 · 완료 · 보관
- SDD 상세 원본은 `specs/` + `scripts/sdd list`. 장부는 색인.

## 6. 현황 보고

`list_workspaces`(MB 프로젝트 `prj_5beaa6cf8cf2a244`) + `gh pr list --state open` + `scripts/sdd list`를 합쳐 표 하나로:

| 카드 | 유형 | 상태 | 다음 행동 | Brian 결정 필요 |
