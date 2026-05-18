# Plan: F2 상담센터 등록·인증 구현 계획

- **Sprint**: 002-counseling-center
- **Spec 참조**: `specs/002-counseling-center/spec.md`
- **개발 순서**: BE 모델 → BE API → BE 테스트 → FE 페이지

---

## 1. 구현 전략

1. **User.org_id FK 추가**: 기존 User 모델에 nullable FK → Alembic 마이그레이션
2. **사업자번호 검증**: 체크섬 알고리즘 (국세청 표준) + 형식 검증 (XXX-XX-XXXXX)
3. **파일 업로드**: S3 대신 로컬 스토리지 먼저 (운영 전환 시 S3로), multipart/form-data
4. **AI 검증**: F3.5 파이프라인 placeholder — Organization.verified=false로 저장
5. **F2.3 프리랜서**: 별도 API 없음, CounselorProfile.affiliation_type만으로 구분

---

## 2. Phase 분할

### Phase A — BE 모델 + 마이그레이션
- A1: `backend/app/models/organization.py` — Organization 모델
- A2: `backend/app/models/org_join_request.py` — OrganizationJoinRequest 모델
- A3: `backend/app/models/user.py` — org_id FK 추가
- A4: `backend/app/models/__init__.py` — 신규 모델 export
- A5: Alembic 마이그레이션 + upgrade head

### Phase B — BE API
- B1: `backend/app/schemas/org.py` — Pydantic 스키마
- B2: `backend/app/services/org_service.py` — 비즈니스 로직 (사업자번호 검증, 가입 신청, 승인/거절)
- B3: `backend/app/api/v1/org.py` — 라우터 (검색, 등록, 조회, 가입, 승인, 상담사 관리)
- B4: `backend/app/api/v1/__init__.py` — org 라우터 등록

### Phase C — BE 테스트
- C1: `backend/tests/test_org.py` — pytest (등록/검색/가입/승인/거절/권한)

### Phase D — FE 페이지
- D1: `frontend/src/lib/api/org.ts` — API 클라이언트
- D2: `frontend/src/pages/OrgSearchPage.tsx` — 센터 검색·가입 신청
- D3: `frontend/src/pages/OrgRegisterPage.tsx` — 신규 센터 등록
- D4: `frontend/src/pages/OrgManagementPage.tsx` — 센터 관리 (OrgAdmin)

---

## 3. 변경 예상 규모
- BE: 신규 모델 2개, 신규 라우터 1개, 서비스 1개, 마이그레이션 1개 (~600줄)
- FE: 신규 페이지 3개, API 클라이언트 1개 (~800줄)
- 테스트: pytest 6개 (~200줄)

---

## 4. 의존성 / 리스크

| 항목 | 리스크 | 완화 |
|---|---|---|
| 파일 업로드 (S3) | 운영 환경 필요 | 로컬 스토리지로 먼저 구현 |
| 사업자번호 공공 API | F3.5 연동 전 | 체크섬 검증만 먼저 구현 |
| OrgAdmin 역할 전환 | 기존 role 컬럼만으로 구분 | role="org_admin" 추가 |
