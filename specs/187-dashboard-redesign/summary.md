# [SDD-187] — Summary

## What Was Built
| File | Description |
|------|-------------|
| `frontend/src/pages/client/ClientHomePage.tsx` | 회원 홈 행동 중심 재설계 — 다음 세션 히어로 → 초대 → 내 리포트(client만) → 이번 주 일정 → 요약 타일 → 담당 상담사 → 대화/알림 |
| `frontend/src/pages/DashboardPage.tsx` | 상담사 대시보드 재설계 — 지금 할 일(진행중 입장+검토대기) → 오늘·다가오는 일정 → 요약 타일 → 내 클래스(그룹핑) → 대화/알림 → 코드 접이식 |

## Test Results
- ✅ TS1 회원 히어로: `in_progress/open/ready` 최우선 → `pickUpcomingClass` 폴백, 카운트다운·참여코드·입장 CTA 구현
- ✅ TS2 리포트 필터: `type=client`만 표시 (상담사용 노출 버그 제거)
- ✅ TS3 초대 수락: `handleConfirmInvite` + `sessionInvites` refetch 로직 보존
- ✅ TS4 상담사 액션큐: 진행중/오픈 클래스 입장 + 검토대기 배너
- ✅ TS5 반응형: Tailwind 4단 브레이크포인트(모바일 단일스택 → lg 2컬럼), `max-w-[560px]` 중간 크기 제한
- ✅ TS6 코드 접이식: 접힘/펼침 토글 + 복사
- ✅ `npx tsc -b --noEmit` 0 errors
- ✅ `npm run build` 0 errors (8.33s)
- ✅ Tailwind 클래스 생성 확인 (`#5F0080`/`#6E1A8C`/`#01f0c8`/`#4B0066` 등 전부 dist CSS에 존재)

## Debugging Journey
- **"승인 대기" 판단 제약**: 대시보드 API `ClassSummary.record_status`는 AI 기록 파이프라인 상태(merging→completed/failed)이고, 리포트 승인 상태(`pending_review`)는 별개 필드라 대시보드 응답만으로 정확히 계산 불가. MVP에서는 `completed && has_record && report_count>0`를 "검토 대기"로 근사 표시하고, 상세 승인은 `/reports` 목록에서 처리.
- **미사용 변수 LSP 진단 2건**: `CARD_CLS`(미사용)·HeroCard의 `useNavigate`(미사용) 제거.

## Notes for Reviewer
- 실화면 스크린샷 검증은 dev 서버 로그인 필요 — dev 계정(`counselor@test.com`/`client@test.com`)으로 확인 요망.
- "연속 출석" 타일은 EEG/출석 데이터 미존재로 "완료 세션" 타일로 대체함 (향후 출석 데이터 연동 시 복원).
- 목업의 크림 배경(`#F7F4F0`)은 AppShell/ClientShell이 흰색 배경을 제공하므로 유지하지 않음 — 배경 전환은 별도 스코프.
- commit/push는 보류 (사용자 게이트). 원하시면 진행하겠습니다.
