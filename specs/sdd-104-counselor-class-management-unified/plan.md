# [SDD-104] — Implementation Plan

**Goal:** 상담사 입장 시 단일 "클래스 관리" 레이아웃에서 오픈/시작/종료를 연속 진행.

**Architecture:** `ClassPlayerPage`의 씬 분기에서 `ready/scheduled`(isSetup)도 `HostClassWorkspace`를 렌더하도록 확장하고, 미디어 체크는 `left` 패널로 흡수. 상태 전이(`openClass`/`startClass`/`finishSession`)는 기존 그대로 재사용.

## Files to Change
| Action | File | Description |
|--------|------|-------------|
| Edit | `frontend/src/pages/sessions/ClassPlayerPage.tsx` | 씬 분기 확장 + `left` 패널 조건부 렌더 + 세팅 씬 블록 제거 |

## Tasks

### Task 1: 관리 레이아웃을 ready부터 렌더
**Objective:** `HostClassWorkspace` 렌더 조건에 `isSetup` 추가.
**Files:** `ClassPlayerPage.tsx:1771`
**Estimate:** 2min
- `{isHost && (isLobby || isRunning) && ...}` → `{isHost && (isSetup || isLobby || isRunning) && ...}`

### Task 2: 미디어 체크를 left 패널로 흡수
**Objective:** `ready` 상태에서 `left`에 `SessionPreJoinPreview`(오픈 버튼 포함) 렌더, 그 외 상태는 기존 left 유지.
**Files:** `ClassPlayerPage.tsx:1823`(left prop)
**Estimate:** 10min
- `left={isSetup ? <SessionPreJoinPreview onStart={(p)=>void openClass(p)} starting={transitioning} canStart={!transitioning} startLabel="클래스 오픈" /> : <>기존 left</>}`

### Task 3: 세팅 씬 블록 제거
**Objective:** ① 세팅 씬(`isSetup && isHost` 블록) 제거.
**Files:** `ClassPlayerPage.tsx:1713-1727`
**Estimate:** 2min

### Task 4: 오픈 전 빈 그리드·코드 가림
**Objective:** `ready/scheduled` 상태의 참가자 그리드에 "아직 오픈 전" 안내, 코드에 "오픈 후 공개" 가림.
**Files:** `ClassPlayerPage.tsx`(HostClassWorkspace 내부 roster empty + hcp-code)
**Estimate:** 10min

## Testing Strategy
- `cd frontend && npm run build` — TS + Vite 빌드 0 error.
- `npx tsc -b --noEmit` — 타입 체크.
- 브라우저 실측: 상담사 입장(ready) → 오픈 → 시작 → 종료 흐름, 레이아웃 유지 확인.
