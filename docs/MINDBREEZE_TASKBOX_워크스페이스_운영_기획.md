# MIND BREEZE TASK BOX 워크스페이스 운영 기획 (초안)

> 작성: 2026-10-22 · 상태: 초안(Brian 결정 대기)
> 참고: knowledge 칸반 규칙(`knowledge/3 Agents/default/운영/knowledge 워크스페이스 칸반 규칙.md`), 브랜치 규칙(`.claude/rules/branch-management.md`)

## 1. 배경·문제

- 현재 MB Paseo 워크스페이스 3개가 모두 **같은 메인 체크아웃(develop)** 을 공유함 → 미커밋 변경(`privacy-policy.ts`)이 어느 작업 것인지 불분명, 동시 수정 충돌 위험.
- 제목 체계 없음(영문 자동 제목·SDD·일반 작업 혼재) → 개발/운영/배포 구분 불가.
- 요청 접수 → 작업 → 배포 → 검증 흐름이 한 창에 섞여 진행 상황 추적이 어려움.
- knowledge는 `[ALL][AI] TASK BOX` + 카드 + 월별 장부로 정리됨 → 같은 방식을 MB에 적용.

## 2. 구조 개요

```
[MB] TASK BOX (지휘·접수)               ← 메인 체크아웃, 코드 수정 안 함
 ├─ 상시 창구 (메인 체크아웃, 장기 유지)
 │   ├─ [MB][DEPLOY] 배포·릴리즈        ← develop 머지 확인·dev/prod 배포·배포 후 검증
 │   ├─ [MB][OPS] 운영·장애 대응         ← EC2·RDS·Celery·로그·디스크·계정
 │   └─ [MB][APP] 앱 출시               ← iOS/Android 빌드·스토어 제출
 └─ 단위 카드 (워크트리, 끝나면 보관)
     ├─ SDD-NNN 한글 제목               ← 기능 개발 (sdd/NNN-슬러그)
     ├─ [MB261022][FIX] 세부 작업        ← 버그 수정 (fix/슬러그)
     └─ [MB261022][QA] 세부 작업         ← 점검·조사·리뷰 (코드 변경 없음 또는 소량)
```

## 3. 역할 분담

| 창구 | 하는 일 | 하지 않는 일 | 체크아웃 |
|---|---|---|---|
| TASK BOX | 요청 해석·카드 생성·워커 배정·현황 보고·장부 기록·완료 카드 정리 | 코드 수정, 배포 | 메인(develop) |
| DEPLOY | PR 머지 상태 확인, `develop` 반영→Deploy Dev 결과·e2e-smoke 확인, prod 릴리즈(승인 후), 배포 이력 기록 | 기능 구현 | 메인(develop, pull만) |
| OPS | 서버 상태·장애 진단, DB 조작(승인 후), 디스크·워커 프로세스 관리, 테스터 계정 관리 | 코드 수정(필요 시 FIX 카드 발행 요청) | 메인 |
| APP | Capacitor 빌드, TestFlight·Play 제출, 서명·스토어 메타 | 웹 기능 구현 | 메인 또는 전용 워크트리 |
| SDD 카드 | Spec→Plan→Verify→구현→테스트→Summary, PR 생성 | 머지·배포 | 전용 워크트리 |
| FIX 카드 | 원인분석→수정→테스트→PR(또는 빠른 수정 규칙 시 develop 직접) | 배포 | 전용 워크트리 |
| QA 카드 | 점검·조사·리뷰, 결과 문서 | 대규모 수정 | 메인 또는 워크트리 |

**핵심 원칙: 메인 체크아웃에서는 코드를 고치지 않는다.** 코드 변경은 반드시 카드(워크트리)에서. 메인은 항상 깨끗한 develop 상태 유지.

## 4. 흐름 (요청 → 완료)

1. Brian → TASK BOX에 요청.
2. TASK BOX: 유형 판정(SDD/FIX/QA/운영/배포/앱) → 
   - 단위 작업: 카드 생성(SDD는 `scripts/sdd new ... --worktree`, FIX/QA는 `create_workspace(worktree, branch-off develop)`) + 작업 에이전트 생성 + 장부 한 줄.
   - 운영·배포·앱: 해당 상시 창구로 지시 전달.
3. 카드 완료 기준 = PR 생성 + CI 통과 + summary 작성.
4. TASK BOX가 "머지할까요?" 확인 → 머지 → **DEPLOY 창구로 인계**("SDD-NNN 머지됨, dev 배포 검증").
5. DEPLOY: Deploy Dev·e2e-smoke 결과와 실제 화면/API 동작 확인 → 장부 상태 `dev 반영`.
6. TASK BOX: 카드 보관 + 워크트리·브랜치 정리(승인 후) → 장부 `완료`.
7. prod 릴리즈는 DEPLOY 창구에서 묶음 단위로, Brian 승인 후.

## 5. 장부

- 위치(안): knowledge `0 Personal/Tasks/YYYY-MM.md`에 **`## MINDBREEZE` 절** 추가 — 전사 TASK BOX와 한곳에서 조회.
- 열: 식별 | 제목 | 워크스페이스 ID | 브랜치/PR | 상태 | 비고
- 상태 값: 진행 · PR대기 · dev반영 · prod반영 · 외부대기 · 완료 · 보관
- SDD 상세 이력은 기존처럼 `specs/NNN/`과 `scripts/sdd list`가 원본. 장부는 색인 역할만.

## 6. "현황" 보고 형식

TASK BOX가 아래 3개를 합쳐 표 하나로 보고:
- `list_workspaces`(MB 프로젝트) — 열린 카드
- `gh pr list --state open` — 머지 대기
- `scripts/sdd list` — 최근 SDD 상태

| 카드 | 유형 | 상태 | 다음 행동 | Brian 결정 필요 |
|---|---|---|---|---|

## 7. 구현 작업 (승인 후)

| # | 작업 | 산출물 |
|---|---|---|
| 1 | 규칙 문서 작성 | `.claude/rules/taskbox.md`, AGENTS.md·CLAUDE.md에 한 줄 링크 |
| 2 | `paseo.json`에 제목 자동 생성 지침 추가 | `metadataGeneration.title.instructions` = 제목 규칙 |
| 3 | 상시 창구 4개 생성 | TASK BOX·DEPLOY·OPS·APP 워크스페이스 + 창구별 지시문 |
| 4 | 기존 워크스페이스 정리 | 아래 표대로 이름 변경·이관 |
| 5 | 장부 MINDBREEZE 절 추가 | 10월 진행분 기록 |
| 6 | 스킬 반영 | `knowledge-workspace-kanban`에 MB 절 추가(또는 `mindbreeze-development` 참조) |

### 기존 워크스페이스 정리안

| 현재 | 처리 |
|---|---|
| Plan Task Box workspace for Mindbreeze (`wks_2bc10cfa`) | → `[MB] TASK BOX`로 이름 변경(이 창을 지휘 창구로 사용) |
| 안드로이드 앱 출시 관련 작업 (`wks_27266d46`) | → `[MB][APP] 앱 출시`로 이름 변경 |
| SDD-219 클래스 출시 점검과 통합 검증 (`wks_696edacc`) | 완료 여부 확인 후 보관 또는 유지 |
| 메인 체크아웃 미커밋 `frontend/src/lib/privacy-policy.ts` | 어느 작업 것인지 확인 → 해당 카드로 옮겨 커밋 |

## 8. Brian 결정 사항

1. **카드 제목 체계**
   - A(기본값): SDD는 기존 `SDD-NNN 제목` 유지, 그 외만 `[MB날짜][유형] 작업` — 기존 브랜치 규칙과 충돌 없음
   - B: 전부 `[MB날짜][유형] ...`로 통일(SDD도 `[MB261022][DEV] SDD-227 ...`) — knowledge와 형식 일치, 제목이 길어짐
2. **상시 창구 구성**
   - A(기본값): DEPLOY·OPS·APP 3개
   - B: DEPLOY+OPS 하나로 합쳐 2개(배포와 운영 모두 서버 다루는 일이라 묶음)
3. **장부 위치**
   - A(기본값): knowledge 월별 장부에 MINDBREEZE 절 — 전사 한곳 조회
   - B: 저장소 `docs/taskbox/YYYY-MM.md` — 코드 워커가 바로 읽음, 대신 develop 커밋 발생
