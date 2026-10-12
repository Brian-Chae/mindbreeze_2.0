# [SDD-125] — Summary

## 구현 결과
회원(내담자) 클래스 뷰를 확정 목업(`design/member-class-player/index.html`) 정본대로 **3열**로 재구성 완료.

| 항목 | 결과 |
|---|---|
| 3열 레이아웃 | 좌(460px)·중(flex)·우(420px) + 리사이즈 핸들(드래그, min/max clamp) |
| 좌측 SUB | 클래스정보(상담사·참여자·밴드착용·그룹집중) + 프로필(이름·성별나이·밴드) + 나의상태(6지표) + 피드백 |
| 중앙 MAIN | 상담사 라이브 + 함께한 시간 + 채팅(topbar→중앙 이동) |
| 우측 SUB | 디바이스 상태 + raw(EEG 2ch + PPG IR/RED overlap, **ACC 제거**, CHIP 6종) |
| 지표 다이얼 | 270도 아크(62px) + 숫자(13px)+단위 + 라벤더 틱 마커 + 캡션 "그룹 평균 N"+"추이 대기" + 범례 |
| 반응형 | ≤1024 단일 스택(영상→채팅→정보→프로필→지표→디바이스), 핸들 숨김 |

## Files Changed
- `GuestMeditationPanel.tsx` — 3열 재구성 + 리사이즈 드래그 + 클래스정보/프로필/채팅 위치.
- `MemberMetricDial.tsx` — 270도 아크 + min/max 스케일 + 라벤더 틱 + 캡션(절대 그룹 평균) + 범례.
- `MemberRawData.tsx` — ACC 제거 + CHIP + PPG IR/RED overlap(색 #ffa657/#ff5c7a).
- `MemberClassInfoCard.tsx` (신규), `MemberProfileCard.tsx` (신규).
- `member-class-player.css` — 3열 flex + 리사이즈 핸들 + 카드/칩/다이얼 스타일.
- `member-class-player.browser.cjs` — raw 2블록·틱/캡션 셀렉터·모바일 수직 스크롤 허용.

## Verification
- `npx tsc --noEmit` 0 errors / `npm run build` 0 errors.
- `member-class-player.browser.cjs` 5/5 통과(1280×720·390×844·강당형·짧은 화면 2종).
- vitest 277/282 통과 — 실패 5건은 `QuietSignalButtons`/`useSessionLiveSocket` 신호 로직(본 스펙 범위 밖, 사전 존재).
- QA 하네스(iPad 1194×834·데스크톱 1280×720·모바일 390×844) 스크린샷 비전 검수: 3열·아크 게이지·틱 마커·CHIP·IR/RED overlap·무오버플로 확인.

## 디버깅
- **모바일 인라인 폭이 미디어쿼리 덮어씀**: 좌/우 컬럼 `style={{width}}`가 `@media`의 `width:auto`를 무력화 → CSS 변수(`--col-metrics-w`/`--col-device-w`) 방식으로 전환.
- **`ClassChatPanel` 필수 prop**: `onCollapsedChange` 누락 → `chatCollapsed` 상태 추가.
- **wearerCount 표현식 오류**: 그룹 평균 payload의 `wearer_count`를 별도 state로 분리.

## Known Differences (허용)
- topbar: 목업은 브랜드+진행중 상태, 구현은 기능 버튼(종료·스피커·화면끄기) 유지.
- 중앙 채팅: `chat_enabled`(상담사 토글) + 채팅방 개설 시에만 표시(게이트 유지).

## QA 루프
1회 검수 → 지표 이름 상단 이동 + 미니바 배경 추가. 이후 iPad/데스크톱/모바일 재검수 통과(목업 유사도 확보).
