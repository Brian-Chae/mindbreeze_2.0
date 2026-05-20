# F11 — 어드민 검토 큐

## 현재 상태
- `Credential` 모델: status(pending/skipped/approved/rejected/needs_review), ai_verdict(JSONB) 존재
- `VerificationAudit` 모델: admin_id, action, reason, extra 존재
- `Organization` 모델: verified(bool)만 있음 — 개별 문서 관리 불가
- `User.role` = `platform_admin` 존재
- 어드민 전용 API / 프론트엔드 **전무**

## 구현 범위

### 백엔드

#### 1. OrgDocument 모델 신설 (`app/models/org_document.py`)
- id(UUID), org_id(FK→organizations), type(문서유형: biz_registration/corporate_registry/tax_cert/4대보험 등), s3_key, file_name, status(pending/approved/rejected/needs_review), ai_verdict(JSONB), created_at
- relationship: org → Organization, audits → VerificationAudit

#### 2. VerificationAudit 확장
- `target_type` 컬럼 추가: "credential" / "org_document"
- `target_id` 컬럼 추가: credential_id 또는 org_document_id (UUID)
- 기존 `credential_id`는 deprecated but 유지 (마이그레이션)

#### 3. Admin API (`app/api/v1/admin.py`) — platform_admin 전용
- `GET /admin/reviews` — 검토 큐 목록
  - credential(status=needs_review/pending) + org_document(status=needs_review/pending) 통합
  - 정렬: 위험도(ai_verdict.risk_score DESC), 접수시각(ASC)
  - 필터: document_type, risk_level
  - 페이지네이션
- `GET /admin/reviews/credentials/{id}` — Credential 검토 상세
  - AI 추출 필드, 공공 API 응답, 위변조 신호, 권장 판정 포함
- `GET /admin/reviews/org-documents/{id}` — OrgDocument 검토 상세
- `POST /admin/reviews/{target_type}/{id}/action` — 검토 처리
  - action: approve / reject / request_more
  - reason: string (LLM 사유 초안 편집 가능)
  - → VerificationAudit 기록 (actor=admin)
  - → Credential/OrgDocument 상태 업데이트
- `POST /admin/reviews/batch` — 일괄 처리 (승인/반려, 최대 50건)
- `GET /admin/users` — 사용자 목록 (role 필터, 검색, 페이지네이션)
- `POST /admin/users/{id}/suspend` — 사용자 정지 (사유 필수, VerificationAudit 기록)
- `POST /admin/users/{id}/unsuspend` — 사용자 정지 해제

#### 4. Admin 서비스 (`app/services/admin_service.py`)
- `get_review_queue(filters, page, size)` — 통합 검토 큐
- `get_credential_review_detail(id)` — Credential 상세
- `get_org_document_review_detail(id)` — OrgDocument 상세
- `process_review(target_type, target_id, action, reason, admin_id)` — 검토 처리
- `batch_process_review(items, admin_id)` — 일괄 처리
- `list_users(filters, page, size)` — 사용자 목록
- `suspend_user(user_id, reason, admin_id)` — 정지
- `unsuspend_user(user_id, admin_id)` — 해제

#### 5. Alembic 마이그레이션
- org_documents 테이블 생성
- verification_audits에 target_type, target_id 컬럼 추가

#### 6. pytest: 10+ 테스트
- 검토 큐 목록 (Credential + OrgDocument 통합)
- 검토 상세 (Credential, OrgDocument 각각)
- 검토 처리 (승인/반려/추가자료요청) + VerificationAudit 기록 확인
- 일괄 처리
- 사용자 정지/해제
- platform_admin 권한 가드 (counselor 접근 시 403)

### 프론트엔드

#### 1. API 클라이언트 (`lib/api/admin.ts`)
- listReviews, getCredentialReview, getOrgDocumentReview, processReview, batchProcessReview
- listUsers, suspendUser, unsuspendUser

#### 2. AdminReviewListPage (`pages/admin/AdminReviewListPage.tsx`)
- AppShell 래퍼
- Credential + OrgDocument 통합 카드 목록
- 카드: 유형 배지(Credential/OrgDocument), 제출자명, 위험도 점수, 접수일시, 상태 뱃지
- 필터: 문서유형, 위험도 (상단 필터 바)
- 페이지네이션

#### 3. AdminReviewDetailPage (`pages/admin/AdminReviewDetailPage.tsx`)
- AppShell 래퍼
- 좌측: 원본 증빙 뷰어 (이미지 확대, 워터마크)
- 우측: AI 검증 결과 카드 (추출 필드, 공공 API 매칭, 위변조 신호, 권장 판정)
- 하단: 액션 버튼 (승인/반려/추가자료요청) + 사유 입력 (textarea, LLM 초안 생성 버튼)
- 히스토리: VerificationAudit 타임라인

#### 4. UserManagementPage (`pages/admin/UserManagementPage.tsx`)
- AppShell 래퍼
- 사용자 목록 테이블 (이름, 이메일, 역할, 상태, 가입일)
- 검색 + 역할 필터
- 정지/해제 액션 (모달 confirm + 사유 입력)

#### 5. App.tsx 라우트 추가
- `/admin/reviews` → AdminReviewListPage
- `/admin/reviews/credential/:id` → AdminReviewDetailPage
- `/admin/reviews/org-document/:id` → AdminReviewDetailPage
- `/admin/users` → UserManagementPage

#### 6. AppShell 사이드바
- platform_admin 전용 "어드민" 메뉴 섹션 추가 (검토 큐, 사용자 관리)

### 디자인
- UI Kit 보라색(#5F0080) 기반
- 카드 목록은 기존 ReportListPage 패턴 재사용
- 상세 페이지는 좌우 분할 레이아웃 (원본 뷰어 + AI 분석)
- 위험도 뱃지: high(빨강)/medium(노랑)/low(초록)

## 주의
- 모든 admin API는 `platform_admin` role 가드 필수 (Depends)
- VerificationAudit은 모든 액션에 기록 (actor=admin_id, payload={reason, ai_verdict_snapshot})
- OrgDocument는 Organization과 N:1 관계 (1개 센터당 여러 문서)
- credential_id 기존 컬럼은 마이그레이션에서 nullable=True로 유지
- `cd frontend && npm run build` + `cd backend && pytest` 검증
