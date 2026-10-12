# [SDD-104] — Summary

## What Was Built
| File | Description |
|------|-------------|
| `frontend/src/pages/sessions/ClassPlayerPage.tsx` | ① 세팅 씬(별도 미디어 프리뷰 화면) 제거. `ready/scheduled`부터 `HostClassWorkspace` 렌더(`isSetup \|\| isLobby \|\| isRunning`). `left` 패널을 `isSetup ? SessionPreJoinPreview(compact) : 기존`으로 조건부. 헤더 `headerControls`에 `isSetup` 브랜치 추가 — **[클래스 오픈]** 버튼. 참가자 빈 그리드 "아직 오픈 전" 안내 |
| `frontend/src/components/session/SessionPreJoinPreview.tsx` | `compact` prop(항상 세로 스택, 비디오 높이 축소, 전면/후면 전환·시작 버튼 숨김) + `onPrefsChange` prop(카메라/마이크 토글 상태를 부모로 보고) |
| `docs/클래스-관리-통합-기획.md` | 수정 기획안(Brian 승인) |
| `specs/sdd-104-counselor-class-management-unified/{spec,plan,verify,summary}.md` | SDD 4종 산출물 |

## Test Results (브라우저 실측 — dev API + 로컬 Vite)
- ✅ TS1: `ready`(준비) 상태에서 관리 레이아웃(`hcp-workspace`) 즉시 렌더. 좌측 미디어 체크 + 우측 참가자 그리드, 헤더 [🔓 클래스 오픈].
- ✅ TS2: [클래스 오픈] → `open`(오픈) 상태. **레이아웃 전면 교체 없이** 좌측이 "대기실 BGM + 클래스 코드"로, 헤더가 [✕ 클래스 닫기 + ▶ 시작하기]로 전환.
- ✅ TS3: [시작하기] → `in_progress`(진행중). 같은 관리 레이아웃에서 헤더가 [❚❚ 일시정지 + ■ 클래스 종료]로 전환.
- ✅ TS4: 참여자 1명(test 세션) 대상 정상 동작. 단독 시작 가드(SDD-101) 회귀 없음.
- ✅ TS5: 오픈 전 빈 그리드 "아직 클래스를 오픈하지 않았습니다" + 코드 가림 확인.
- ✅ `npm run build` 0 errors (7.4s).

## Debugging Journey
- **[클래스 오픈] 버튼 잘림**: `SessionPreJoinPreview` 전체를 좁은 `left` 패널(300px)에 넣자 콘텐츠가 길어져 버튼이 하단에서 잘림(브라우저 실측). → 기획안 §3.4대로 **[클래스 오픈]을 헤더 툴바로 이동**하고, 좌측은 `compact` 모드(세로 스택 + 비디오 160px + 전면/후면·시작 버튼 숨김)로 축소. 토글 상태는 `onPrefsChange`로 부모 `mediaPrefs`와 동기화.
- **`left={<>` → 삼항 조건 변경 시 닫는 태그 불일치**: `</>}` → `</>)}`로 보정(TS `')' expected` 해소).

## Notes for Reviewer
- **비변경**: 상태 머신(`ready→open→in_progress→completed`), 회원 측 흐름, 리포트 파이프라인, 이탈 가드. FE 단일 변경(BE·DB 없음).
- `SessionPreJoinPreview`의 `onStart` 경로(기존 시작 버튼)는 남겨두었으나, 상담사 플레이어에서는 헤더 [클래스 오픈]이 primary — 좌측은 미디어 체크 전용(시작 버튼 숨김).
- 헤더 [클래스 오픈]은 `openClass(mediaPrefs)` 직결. 마이크 OFF 시 amber 경고 배너(좌측)가 안내를 대체(SDD-085 확인 다이얼로그는 좌측 패널 미사용으로 생략 — 필요 시 후속 보강 가능).
- 검증은 로컬 Vite(5175) → dev API 프록시로 진행. dev 배포(push → GitHub Actions)는 미진행(승인 대기).
