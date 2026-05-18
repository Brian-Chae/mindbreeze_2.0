# Spec: F2 상담센터 등록·인증

- **Sprint ID**: 002-counseling-center
- **작성일**: 2026-05-19
- **대상 영역**: F2.1 ~ F2.4 (기능명세서 §131~175)
- **개발 단계**: MVP1 / **우선순위**: P0 (F2.4만 P1)
- **현재 코드 상태**:
  - `backend/app/models/user.py` — User.org_id 없음 (추가 필요)
  - `backend/app/models/counselor_profile.py` — affiliation_type 있음
  - Organization, OrganizationJoinRequest 모델 미존재
  - 상담센터 API 전무

---

## 공통 규칙

- 모든 API는 `/api/v1` 프리픽스, JWT `Authorization: Bearer <token>`
- 인증 필요: `get_current_user` 의존성
- 오류 메시지: 한국어 `{"detail": "..."}`
- DB: PostgreSQL, SQLAlchemy 동기 Session

---

## F2.1 기존 센터 검색 후 소속 가입

### 액터
Counselor (`role=counselor`)

### 메인 플로우
1. **센터 검색**: `GET /org/search?q=센터명&region=지역` → `{ organizations: [...] }`
2. **가입 신청**: `POST /org/{org_id}/join` → `OrganizationJoinRequest` 생성 (status=pending)
3. **OrgAdmin 알림**: 이메일 발송 (개발 단계 콘솔 로그)
4. **OrgAdmin 승인/거절**: `PUT /org/{org_id}/requests/{req_id}` → status=approved/rejected + reason

### 예외 처리
| 케이스 | 응답 |
|---|---|
| 이미 가입된 센터에 중복 신청 | 409 `이미 가입 신청한 센터입니다` |
| 이미 소속 센터 있음 | 409 `이미 소속된 센터가 있습니다` |
| 존재하지 않는 센터 | 404 |
| 승인 권한 없음 (OrgAdmin 아님) | 403 |

### API
- `GET /api/v1/org/search?q=&region=` → `{ organizations: [{ id, name, region, verified }] }`
- `POST /api/v1/org/{org_id}/join` → `{ request_id, status }`
- `GET /api/v1/org/requests` — 내 가입 신청 목록
- `PUT /api/v1/org/{org_id}/requests/{req_id}` — OrgAdmin 승인/거절 (body: `{ status, reason }`)

### 수락 기준 (QA)
- [ ] 중복 신청 시 409
- [ ] 승인 시 User.org_id 설정됨
- [ ] 거절 시 reason 포함, 다른 센터에 재신청 가능
- [ ] OrgAdmin만 승인/거절 가능 (403)

---

## F2.2 신규 센터 등록 (대표자)

### 액터
Counselor (센터 대표자)

### 메인 플로우
1. **센터 정보 입력**: 센터명·대표자명·사업자등록번호·주소·연락처
2. **사업자등록증 업로드**: `POST /org/register` — multipart/form-data (파일 + 메타)
3. **기본 검증**: 사업자등록번호 형식·체크섬
4. **저장**: Organization 생성 (verified=false), 신청자가 OrgAdmin으로 자동 승격
5. **AI 검증 예약**: F3.5 파이프라인 연결 (본 스프린트는 placeholder — verified=false 상태로 생성)
6. **승인 시**: Organization.verified=true, 신청자 org_id 설정

### 예외 처리
| 케이스 | 응답 |
|---|---|
| 사업자등록번호 형식 오류 | 422 `올바른 사업자등록번호 형식이 아닙니다` |
| 이미 등록된 사업자등록번호 | 409 `이미 등록된 사업자등록번호입니다` |

### API
- `POST /api/v1/org/register` — multipart: `{ name, ceo_name, biz_number, address, phone, file }` → `{ organization, org_admin_granted }`
- `GET /api/v1/org/{org_id}` — 센터 정보 조회

### 수락 기준 (QA)
- [ ] 사업자등록번호 체크섬 검증 통과
- [ ] 등록 성공 시 Organization.verified=false
- [ ] 등록자가 User.org_id + role=org_admin 자동 부여
- [ ] 중복 사업자등록번호 409

---

## F2.3 1인 / 프리랜서 운영

- 상담사가 센터 소속 없이 운영
- `User.org_id = null` 허용
- `CounselorProfile.affiliation_type = "프리랜서"` 설정
- 별도 API 불필요 — 가입 시 affiliation_type 선택

### 수락 기준 (QA)
- [ ] org_id=null인 상담사도 정상 로그인·서비스 이용 가능
- [ ] 프리랜서 상담사는 센터 검색·가입 API 접근 가능 (전환 허용)

---

## F2.4 센터 정보 수정 / 상담사 관리

### 액터
OrgAdmin

### API
- `PUT /api/v1/org/{org_id}` — 센터 정보 수정 (name, address, phone)
- `GET /api/v1/org/{org_id}/counselors` — 소속 상담사 목록
- `PUT /api/v1/org/{org_id}/counselors/{user_id}` — 상담사 권한 조정 (org_admin 승격·해제)
- `DELETE /api/v1/org/{org_id}/counselors/{user_id}` — 상담사 소속 해제

### 수락 기준 (QA)
- [ ] OrgAdmin만 수정 가능 (403)
- [ ] 소속 해제 시 User.org_id=null
- [ ] 최소 1명의 OrgAdmin 유지 (해제 시 422)

---

## 데이터 모델 변경

### User
- `org_id: UUID | None` FK → organizations.id 추가

### Organization (신규)
| 컬럼 | 타입 |
|---|---|
| id | UUID PK |
| name | String(200) |
| ceo_name | String(100) |
| biz_number | String(10) unique |
| address | String(300) |
| phone | String(20) |
| verified | Boolean (default false) |
| verified_at | DateTime nullable |
| created_at | DateTime |

### OrganizationJoinRequest (신규)
| 컬럼 | 타입 |
|---|---|
| id | UUID PK |
| user_id | UUID FK → users |
| org_id | UUID FK → organizations |
| status | String(20): pending/approved/rejected |
| reason | Text nullable |
| created_at | DateTime |

---

## 추적성 매트릭스

| F-ID | 핵심 변경 BE | 핵심 변경 FE |
|---|---|---|
| F2.1 | `org.py`·`organization.py`·`org_join_request.py` | 센터 검색·가입 신청 UI |
| F2.2 | `org.py`·사업자번호 검증·파일 업로드 | 센터 등록 폼 |
| F2.3 | 별도 API 없음 (데이터 모델만) | affiliation_type 선택 UI |
| F2.4 | `org.py`·소속 상담사 관리 | 센터 관리자 대시보드 |
