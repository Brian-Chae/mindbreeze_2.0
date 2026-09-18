# SDD-082 — Verify (Stage ③, 구현 전 작성)

> QA List = Spec. 아래 시나리오가 곧 테스트 케이스이자 수락 기준.

## BE — 상태 관리 (T1)

| # | 시나리오 | 기대 결과 |
|---|---|---|
| TS1 | org_admin이 소속 active 상담사 suspend (사유 포함) | 200, User.status=suspended, VerificationAudit(action=org_counselor_suspend, reason) 기록, 대상자 인앱 알림 생성 |
| TS2 | 사유 없이/공백 사유로 suspend | 422 |
| TS3 | 정지된 상담사 로그인 시도 | 403 (기존 suspended 차단 로직) |
| TS4 | unsuspend (사유 포함) | 200, status=active, 감사 기록, 재로그인 가능 |
| TS5 | org_admin 계정(자기 자신 포함) suspend 시도 | 403 |
| TS6 | 미소속(membership 없음) 상담사 suspend | 404 |
| TS7 | counselor 토큰으로 suspend 호출 | 403 |
| TS8 | pending(초대 미수락) 상담사 suspend | 409 — 비밀번호 미설정 계정의 우회 활성화 차단 |
| TS9 | 이미 suspended 계정 재-suspend / active 계정 unsuspend | 409 |

## BE — 최근 이력 (T2)

| # | 시나리오 | 기대 결과 |
|---|---|---|
| TS10 | 세션 보유 상담사 activity 조회 | 200, sessions[]에 상태/일시/참여자 수, reports[]에 제목/상태/일시 (각 최근 10건) |
| TS11 | counselor 토큰으로 activity 호출 | 403 |
| TS12 | 미소속 상담사 activity 조회 | 404 |

## BE — 목록 확장 (T3)

| # | 시나리오 | 기대 결과 |
|---|---|---|
| TS13 | suspend 후 목록 조회 | 해당 행 status="suspended" (membership active여도) |
| TS14 | 목록 응답 | counselor_code, has_personal_office 필드 포함, 기존 필드/기존 테스트 불변 |

## FE (T4~T5) — 빌드 + 수동 시나리오

| # | 시나리오 | 기대 결과 |
|---|---|---|
| TS15 | org_admin 로그인 → 사이드바 | "상담사" 메뉴 노출, /org/counselors 이동 |
| TS16 | 목록 검색(이름/이메일/코드) + 필터(역할/상태) | 즉시 필터링, 상태 배지 활성/대기/정지 표기 |
| TS17 | 행 "정보 수정" | SDD-077 CounselorInfoEditor 열림 (org_admin 행은 비활성) |
| TS18 | 행 "비활성화" → 사유 입력 → 확인 | API 호출 후 배지 "정지"로 갱신. 사유 미입력 시 제출 불가 |
| TS19 | 정지 행 "활성화" → 사유 입력 | 배지 "활성" 복귀 |
| TS20 | 행 "이력" | 상세 패널: 프로필 + 세션/리포트 탭 |
| TS21 | `npm run build` | 0 error |

## 게이트

- [ ] `cd backend && venv/bin/pytest` 전체 통과 (기존 테스트 포함)
- [ ] `cd frontend && npm run build` 0 error
- [ ] 데이터 삭제 없음 — 상태 변경만 (자산 원칙)
