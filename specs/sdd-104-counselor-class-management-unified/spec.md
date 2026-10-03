# [SDD-104] 상담사 클래스 관리 통합 — "오픈 페이지 ↔ 대기 화면" 단일화

## Goal
상담사가 클래스 생성 → 입장하면 별도 "오픈 페이지"(미디어 프리뷰)를 거치지 않고 곧바로 **단일 "클래스 관리" 페이지**로 진입해, 같은 레이아웃 안에서 오픈/시작/종료를 연속 진행하도록 개편한다.

## Context
- 기획 문서: `docs/클래스-관리-통합-기획.md` (Brian 승인, 2026-10-03).
- 현재 `ClassPlayerPage`는 상태에 따라 화면을 전면 교체한다. `ready/scheduled` → ① 세팅 씬(`SessionPreJoinPreview` 미디어 프리뷰 + [클래스 오픈]), `open` → ② 대기실 씬(`HostClassWorkspace` + [시작하기]). 두 씬의 레이아웃이 완전히 달라 [클래스 오픈] 순간 화면이 "미디어 프리뷰"에서 "참가자 관리"로 뒤바뀌어 별개 페이지처럼 느껴진다.
- Brian 지적: "오픈 페이지와 대기 화면이 두 개로 나뉘어 있음 → 관리 페이지에서 오픈/시작/종료를 진행하는 게 자연스럽다."

## Scope
### ✅ In-scope
- `ClassPlayerPage.tsx`: `ready/scheduled` 상태에서도 `HostClassWorkspace`(관리 레이아웃)를 렌더.
- 미디어 체크(`SessionPreJoinPreview`)를 관리 레이아웃의 좌측 호스트 미디어 영역(`left`)으로 흡수 — 별도 풀스크린 씬 제거.
- 오픈/시작/종료를 한 화면에서 연속 진행(오픈 전 빈 그리드·코드 가림 안내).
- 상태 머신·회원 측 흐름·리포트 파이프라인은 **변경 없음**.

### ❌ Out-of-scope
- 백엔드 상태 전이·그룹 단독 시작(SDD-101)·리포트 파이프라인 변경.
- 회원 측(대기실→명상 immersive) 흐름 변경.
- `SessionPreJoinPreview` 컴포넌트 삭제(상담사 플레이어에서만 미사용, 보존).

## Acceptance Criteria
- [ ] 상담사 입장 시(ready/scheduled) `HostClassWorkspace` 관리 레이아웃이 즉시 렌더된다(세팅 씬 전면 교체 없음).
- [ ] 좌측 패널에서 카메라/마이크 확인 → [클래스 오픈] → 동일 레이아웃에서 참가자 그리드·코드가 활성화된다.
- [ ] 오픈 → [시작하기] → [종료]가 한 화면에서 연속 진행된다.
- [ ] 오픈 전 빈 그리드는 "아직 오픈 전" 안내를, 코드는 "오픈 후 공개" 가림을 표시한다.
- [ ] `npm run build` 0 errors.

## Dependencies
- 없음(FE 단일). 기존 `HostClassWorkspace`·`SessionPreJoinPreview`·`openClass`/`startClass`/`finishSession` 재사용.

## Risks
- 미디어 권한 요청 시점이 입장 직후로 앞당겨짐 → 마이크만 자동·카메라 OFF 기본(기존 정책)이라 영향 제한적.
- `SessionPreJoinPreview`를 좁은 `left` 패널에 넣으면 레이아웃 밀림 → `lg:flex-row` 반응형이 세로 스택으로 전환되어 대응.
