# SDD-075 구현 계획

**목표:** 기관 상세 모달에서 기관 정보 수정과 비활성화/재활성화를 제공한다.
**구조:** Organization의 운영 상태와 버전을 저장하고, 전용 org_management_service에서 행 잠금·버전 검사·감사 기록을 한 트랜잭션으로 수행한다. 기존 기관 운영 서비스는 공통 운영 상태 가드를 호출한다.
**기술:** FastAPI, SQLAlchemy, Alembic, React, TypeScript.
**명세:** `specs/075-org-edit-deactivate/spec.md`.

## 구현 순서

- [x] T1: `backend/tests/test_sdd075_org_management.py`에 PATCH의 null/누락, 길이, 인증 사유·시각, 권한, If-Match 실패 테스트를 작성하고 RED 확인. Organization 필드와 마이그레이션, 스키마, 서비스, 관리자 라우트를 구현한다.
- [x] T2: 비활성화 영향·진행/예정/paused 세션·활성 연결·개인 기관 차단, 확인값, 멱등성, 보존, 재활성화·목록 필터 테스트 후 구현한다. 현재 세션에 생성 당시 기관 정보가 없으므로 현재 소속 기준의 보수적 영향 후보로 표시하며 기존 기록 귀속 불명은 차단한다. 신규 세션은 기관 스냅샷을 저장한다.
- [x] T3: 기관 코드 검색·가입/승인·초대 발급/수락·새 세션 생성/재실행의 공통 기관 행 잠금과 상태 검사를 추가한다. 기존 계정 역할과 상태는 바꾸지 않는다.
- [x] T4: `frontend/src/lib/api/admin.ts` 타입과 If-Match API, 별도 편집/운영 상태 폼, `org-detail-modal.tsx` 닫기 보호와 갱신, `OrgManagementPage.tsx` 운영 상태 필터를 구현한다. 저장 실패 입력 유지, 충돌 시 다시 불러오기, 보존 동의와 코드 확인을 제공한다.
- [x] T5: 대상 테스트와 전체 `backend/venv/bin/pytest`, `frontend/npm run build`를 실행한다. 변경 diff를 검토하고 summary.md에 결과와 검증 경계를 기록한다.

## 공통 제약

기관·계정·세션·파일 삭제 금지. 코드/사업자번호 재사용 금지. 상담 본문·리포트·채팅 노출 금지. 상담사 역할 변경·소속 해제 UI 제외. 기존 작업과 spec 보존. 커밋·운영 DB 마이그레이션·배포는 수행하지 않는다.

실행 중 보완: 소속 이동 이력 부재 때문에 귀속 미확정 세션은 전체 시스템 범위로 검사한다. 구체적인 범위와 운영 제약은 summary.md에 기록했다.
