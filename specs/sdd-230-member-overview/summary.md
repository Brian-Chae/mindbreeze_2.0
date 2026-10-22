# SDD-230 — Summary (Stage ⑥)

## 구현 범위 (1단계: 목록+활동, 접속 제외)
- 마이그레이션 없음(alembic 헤드 1개 유지: e036a0000060).
- 백엔드: `client_overview_service.py`(신규), `client_service/schemas/api` 확장.
  - `GET /clients` 확장: `class_id`, `active_within_days` 서버 필터 + 성별·만나이(KST)·마스킹 연락처·소속 클래스·최근 활동/최근 상담(`last_session_at` None 고정 버그 수정)·`class_options`.
  - `GET /clients/{id}`: phone/birth_date 항상 null, `phone_masked`·`age` 추가.
  - 신규 `POST /clients/{id}/contact-reveal`(호출마다 active 연결 재검사, 원문 없는 감사 로그), `GET /clients/{id}/activity`(cursor), `GET /clients/{id}/reports`(리포트 + 회차 내부 변화 서사).
- 프론트: `ClientListPage`(표 기본·카드 전환, 서버 검색/클래스/활동기간 필터, 클래스 그룹핑, URL 쿼리 복원), `ClientProfilePage`(전체 페이지: 요약 헤더·타임라인·리포트·변화 서사·AI 패널 조건부·비공개 메모), `lib/clients/overview.ts`, `lib/api/clients.ts`.

## 결정/함정
- 접근 가능 세션 = 내가 호스트 ∪ 내가 만든/활성 강사인 클래스 ∪ 내 상담관계. 그 세션의 **해당 회원 참여자 행**만 조회.
- 활동 = 출석(결석·예정 제외) / 체크인 completed / 유효 측정(file_count>0 또는 duration>0) / AI 안부(AI 공개 시만). 리포트 생성·예정은 제외.
- 소속 클래스는 내가 접근 가능한 클래스만 노출(연결만으로 전체 클래스 노출 금지).
- 열람 감사는 영속 테이블이 마이그레이션을 요구해 **logger(`audit.client_contact_reveal`)만** 남김 → 후속 결정 필요.
- 변화 서사는 `compute_change` 재사용, delta 수치는 지표 변화량(점수 아님) 표시. 종합점수·평균·순위 없음.
- 이메일은 기본 목록/상세에 계속 노출(식별용). spec 의 이메일 마스킹은 미적용 → 결정 필요.

## 테스트
- pytest: `test_sdd230_member_overview.py` 14 + 인접 회귀 포함 72 통과(원본 저장소 venv).
- vitest: `sdd230-member-overview.test.tsx` 9 + 관련 파일 포함 173 통과. `npx tsc -p tsconfig.app.json --noEmit` 오류 0.
- 전체 vitest 전량은 550초 내 미완료(직렬 실행) → 관련 파일만 실행.
- Chrome headless 12장(표/카드/그룹/상세 × 1440/1194/390, API mock·가상 데이터): 페이지 가로 넘침 0, JS 오류 0, 접속·점수 문구 0. 표 내부 스크롤은 390만 발생(의도). 증빙: `screens/`.

## 1-2단계 — 기관관리자 범위 (2026-10-22, 마이그레이션 없음)
- **'기관 전체 회원' 정의**: 내가 관리하는 일반 기관(`UserOrgMembership` role=org_admin·active, 기관 활성, `kind != individual`, 다중 기관 전부; `User.org_id` 미사용) 안에서 ① 귀속 확정(`organization_attribution_known`) 기관 클래스(draft·archived 제외)의 active 멤버 ② 기관 귀속 active 상담관계(placeholder 제외)의 회원(role=client). 개인상담소·귀속 불명·링크만 있는 회원은 제외. 상담사는 기존 범위 불변.
- API: `GET /clients`(관리자 모집단 = 본인 연결 ∪ 기관 회원, `counselor_id` 필터, `counselors`·`counselor_options`), 상세/activity/reports/contact-reveal은 `require_client_access`(본인 연결 → 기관 회원 → 403) 공통. 관리자 전용 세션은 기관 명상 클래스 세션만, 회원용 리포트만, AI 안부·상담 세션 제외.
- 비공개 메모는 상담사 개인 메모라 관리자 비연결 회원에선 `memo=null`·`memo_editable=false`, 저장 API 403. FE는 메모 영역 숨김.
- FE: 목록에 관리자 전용 '담당 상담사' 열(표·카드)·필터(URL `counselor`). 라우트·사이드바(org_admin `/clients`)는 기존 그대로 확인.
- 테스트: pytest 신규 10(A1~A9) + 회귀 포함 117 통과, vitest 신규 4 + 기존 개요 9 통과, tsc 오류 0. 프론트 전체 실행 시 기존 실패 11건(org-management-browser 등 6파일)은 변경 전 동일 — 이번 범위 무관.
