# [SDD-015] — Summary

## What Was Built

MIND BREEZE 2.0을 "클래스 코드로 바로 접속"하는 라이트 모델로 간소화.
기관·상담사·내담자 3계층 + 즉석 클래스(일정 없이 시작).

### 역할·가입 모델 (4계층)
- **system_admin**(platform_admin): 기관 등록 → 6자리 기관 코드(org_code) 발급
- **org_admin**: 소속 상담사·클래스 전체 + 기관 통계
- **counselor**: 기관 코드 입력 필수 가입
- **client/guest**: 가입 또는 게스트(이름만)로 클래스 코드 참여

### 백엔드 (Claude)
| 항목 | 내용 |
|------|------|
| 모델 | Organization.org_code, Session.access_code/started_at/ended_at, scheduled_at nullable, SessionParticipant.user_id nullable + guest_name |
| 마이그레이션 | 881a08fbe584 (sdd_015) |
| API | POST /admin/orgs(기관등록), POST /auth/register/counselor(org_code 필수), GET/POST /sessions/by-code/{code}(조회/참여), POST /sessions/{id}/start|end, GET /dashboard/counselor, GET /dashboard/org |
| 게스트 | user_id NULL + guest_name (get_current_user_optional 의존성 신설) |
| 테스트 | 106 → 129 passed (+23 신규) |

### 프론트 (Codex + Cursor)
| 담당 | 내용 |
|------|------|
| Codex | 상담사 기관코드 가입, 클래스 코드 참여(class-join-page), 즉석 클래스 생성/코드 복사, ready→start→end, 게스트 대기 화면 |
| Cursor | 상담사 대시보드(DashboardPage), 기관 대시보드(OrgDashboardPage) |
| Codex(통합) | OrgDashboard/AdminOrg 라우트, RoleRouter 역할분기, 기관 등록 UI, 메뉴 간소화(채팅·자격증명·검토큐·사용자관리 숨김) |

## Test Results

- 백엔드: **129 passed, 1 skipped** (기존 106 + 신규 23)
- 프론트: `npx tsc --noEmit` 0 error, `npm run build` 성공 (742 modules)

## 간소화 (숨김 — 코드/DB 삭제 없음)

채팅, 자격증명, 어드민 검토큐, 사용자관리, LiveKit 영상통화, 캘린더 고도화, 셀프트레이닝 → 메뉴/라우트 숨김.

## 3-Way 에이전트 오케스트레이션 (Orca)

| 에이전트 | 역할 | 소요 |
|----------|------|------|
| Claude Code | 백엔드 (모델·마이그레이션·API·테스트) | 11m35s |
| Codex | 프론트 핵심 + 통합 (Superpowers subagent-driven) | 52m + 12m |
| Cursor | 대시보드 UI (상담사/기관) | headless agent |

## Notes for Reviewer

- 게스트 참여자는 user_id 없이 guest_name으로 저장. AI 기록/리포트는 보기만 가능(편집은 host 전용).
- 기존 AI 기록(SDD-013)·리포트(SDD-014)·LINK BAND 로직은 삭제/수정 없음.
- 일정(scheduled_at) 없는 즉석 클래스는 status="ready"로 생성, "시작" 시 in_progress.
