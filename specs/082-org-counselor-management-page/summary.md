# SDD-082 — Summary (Stage ⑥)

> 기관 관리자 상담사 관리 페이지 — BE 상태 관리·이력 API + FE 전용 페이지 구현 완료.

## 구현 결과

### T1. BE — 상담사 활성화/비활성화 (org_admin 전용)
- `POST /org/{org_id}/counselors/{user_id}/suspend` / `POST .../unsuspend`
- `org_service.set_counselor_suspension()` 신설 — admin_service(플랫폼 전용)와 분리
  - 사유 필수(pydantic `CounselorStatusChangeRequest`, 공백 422)
  - 대상은 소속(membership) counselor 만 — 자기 자신·org_admin 403, 미소속 404
  - **pending 계정 정지 금지(409)** — 정지→해제 경로로 비밀번호 미설정 계정이 active 가 되는 우회 차단
  - 중복 전이 409 (이미 정지 / 정지 아님)
  - `VerificationAudit(action=org_counselor_suspend|org_counselor_unsuspend)` + 대상자 인앱 알림을 같은 트랜잭션으로 저장
  - 계정 상태만 변경 (데이터 삭제 없음), 정지 시 기존 suspended 로직으로 로그인 차단

### T2. BE — 최근 이력
- `GET /org/{org_id}/counselors/{user_id}/activity`
- 주최 세션(host_id 기준, 기존 org_dashboard 와 동일 기준) 최근 10건 + 해당 세션 리포트 최근 10건
- 메타데이터만 노출 (상태/일시/참여자 수/제목) — 상담 내용·리포트 본문 미노출

### T3. BE — 목록 응답 확장 (`_counselor_to_response`)
- 계정 `suspended` 는 membership 상태보다 우선 표기
- `counselor_code`(코드 검색용), `has_personal_office`(kind=individual 소속 여부, 1쿼리) 추가 — additive, 기존 테스트 불변

### T4~T5. FE
- `ORG_ADMIN_NAV_ITEMS` 에 "상담사" 메뉴(users 아이콘) 추가 → `/org/counselors` (RoleGuard org_admin)
- `pages/org/OrgCounselorsPage.tsx` 신설:
  - 검색(이름/이메일/코드) + 필터(역할/상태) + 상태 배지(활성/대기/정지) + 개인 상담소 배지
  - 행 액션: 정보 수정(SDD-077 `CounselorInfoEditor` 재사용, org_admin 행 비활성) / 이력 / 활성화·비활성화(사유 필수 다이얼로그)
  - 상세 패널: 프로필 요약 + 최근 이력 세션/리포트 탭
- `lib/api/org.ts`: `suspendCounselor` / `unsuspendCounselor` / `getCounselorActivity` + 타입 확장

## 디버깅 기록
- 테스트에서 연속 상담사 초대 시 429(초대 쿨다운) → SDD-079 패턴(`_clear_cooldown`)으로 해결
- eslint `react-hooks/set-state-in-effect` — 상세 패널의 effect 내 동기 setState 를 `key={selected.id}` 재마운트 방식으로 대체

## 테스트 결과
- `backend/tests/test_sdd082_org_counselor_management.py` 11개 (verify.md TS1~TS14 커버)
- `cd backend && venv/bin/pytest` — **656 passed, 12 skipped** (기존 테스트 회귀 없음)
- `cd frontend && npm run build` — **0 error** (tsc -b + vite; chunk 크기 경고는 기존과 동일)
- eslint 신규/수정 파일 0 error

## 변경 파일
- backend: `app/schemas/org.py`, `app/services/org_service.py`, `app/api/v1/org.py`, `tests/test_sdd082_org_counselor_management.py`(신규)
- frontend: `src/lib/api/org.ts`, `src/components/layout/SidebarNav.tsx`, `src/App.tsx`, `src/pages/org/OrgCounselorsPage.tsx`(신규)

## 남은 항목
- FE 수동 시나리오(TS15~TS20)는 실제 브라우저 확인 필요 (Stage ⑦ Review 시)
- 다중 소속 상담사 정지는 계정 단위(User.status)라 다른 기관/개인 상담소 로그인도 함께 차단됨 — 스펙 명시 동작이나 운영 정책상 재검토 여지
