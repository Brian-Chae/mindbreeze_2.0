# SDD-076 구현 계획

- 목표: 플랫폼 관리자 전용 역할 변경·소속 해제 API와 기관 상세 상담사 행 액션 구현.
- 기준: `spec.md`, `docs/org-management-crud-기획.md` §4.3, §5.4–5.5.
- 기존 기관 관리자 API는 변경하지 않으며 계정·프로필·세션·리포트를 삭제하지 않는다.
- 실행: 담당 워커가 순차 구현하며 커밋·배포·운영 DB 적용은 하지 않는다.

## T1 — API 계약과 도메인 보호
- `backend/tests/test_sdd076_org_counselor_management.py`: API 미구현 RED 확인.
- `backend/app/schemas/org.py`: 공백 제거한 필수 reason(1–2000자), role Literal(counselor/org_admin), 추가 필드 거부.
- `backend/app/services/org_management_service.py`: 기관 행 잠금 → 대상 사용자 최신 조회 및 잠금 → 소속/역할/보호 조건 검사 → 변경과 VerificationAudit 원자 커밋.
- 주 담당자 강등/해제, 개인 기관 소유자 변경/해제, 마지막 활성 관리자 강등/해제는 409. 타 기관 404, 잘못된 역할 422.
- `backend/app/api/v1/admin.py`: require_platform_admin PATCH(200)/DELETE(204) 경로.

## T2 — 데이터 보존·권한·동시성
- ready/scheduled/in_progress/paused 세션 또는 active 내담자 연결이 있으면 해제 409.
- 해제 시 org_id만 제거하고 org_admin은 counselor로 변경; 감사에 대상 사용자/기관, 전후 role/org_id, 사유 및 자동 시각 기록.
- 기관 잠금 공유 진입점과 인증 DB 재조회 확인; 잠금을 기다린 요청이 오래된 소속을 사용하는 경계 보완.
- 기존 세션 organization_id/organization_attribution_known와 계정/프로필 보존 테스트.
- PostgreSQL 동시성 실행 환경이 없으면 행 잠금 설계와 SQLite 검증의 차이를 summary에 명시.

## T3 — 화면
- `frontend/src/lib/api/admin.ts`: 역할 변경 및 사유 포함 DELETE 호출 추가.
- `frontend/src/lib/api/client.ts`: 기존 호출과 호환되게 DELETE body 옵션 허용.
- `frontend/src/components/admin/org-detail-modal.tsx`: 행 버튼, 보호 사유, 확인 폼 연결.
- 확인 폼은 대상 이름, 변경 역할(User.role 변경 안내), 계정/기록 보존 안내, 필수 사유, 취소/실행 버튼 제공.
- 처리 중 중복 요청·닫기 차단, 실패 입력 유지, 성공 시 상담사/상세/목록 새로고침.

## T4 — 검증·보고
- 신규 테스트 RED → 구현 → 신규 및 SDD-074/075 회귀 GREEN.
- `cd backend && venv/bin/pytest` 전체 실행.
- `cd frontend && npm run build` 실행, 가능 시 브라우저 상호작용 확인.
- `summary.md`에 결과와 미검증 경계 기록.
