# 상담사 프로필 설정 — Spec

> **SDD:** 1779856014-counselor-profile-settings
> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task via Claude Code Workers.

## 목표

상담사(counselor) 설정 페이지에서 계정정보 외에 **프로필 정보도 열람·수정** 가능하게 확장한다. 수정 시 재확인(confirm dialog) 절차를 포함한다.

## 대상

- **사용자 역할**: `counselor` (상담사)
- **진입 경로**: 하단 탭 > 설정(⚙️) > SettingsPage

## In-Scope

### 계정정보 (User 테이블 기반)
| 필드 | 타입 | 수정 가능 | 비고 |
|------|------|-----------|------|
| 이름 | `string` | ✅ | `User.name` |
| 이메일 | `string` | ❌ (읽기 전용) | `User.email` — 변경 시 인증 필요, 추후 별도 기능 |
| 전화번호 | `string` | ✅ | `User.phone` |
| 프로필 사진 | `image url` | ✅ | `User.profile_image` (또는 `CounselorProfile.profile_image_url`) |
| 소개글 | `text` | ✅ | `User.bio` |

### 프로필 정보 (CounselorProfile + 신규 모델 기반)
| 필드 | 타입 | 수정 가능 | 비고 |
|------|------|-----------|------|
| 소속 센터 | `string` | ✅ | `CounselorProfile.affiliation_type` |
| 전문분야 | `string[]` | ✅ | `CounselorProfile.specialties` |
| 경력연수 | `int` | ✅ | `CounselorProfile.years_of_experience` |
| 자격정보 | `Qualification[]` | ✅ | **신규 모델** — 자격명, 발급기관, 취득일 |
| 이력정보 | `Career[]` | ✅ | **신규 모델** — 근무지, 기간, 역할 |

### UX 요구사항
- **섹션 분리**: 계정정보 / 프로필 정보 두 섹션으로 구분
- **수정 버튼**: 각 섹션마다 "수정" 버튼 → 클릭 시 edit 모드 전환
- **재확인 절차**: 저장 버튼 클릭 시 confirm dialog ("변경사항을 저장하시겠습니까?")
- **저장 완료**: 성공 토스트/메시지

## Out-of-Scope

- 내담자(client) 프로필 수정
- 관리자(org_admin/platform_admin) 프로필 수정
- 비밀번호 변경
- 이메일 변경 (인증 플로우 필요)
- 프로필 사진 파일 업로드 (URL 입력만 — 업로드는 추후)

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| Frontend | React 18 + TypeScript, Tailwind CSS, Zustand |
| Backend | FastAPI (Python), SQLAlchemy + Alembic |
| Database | PostgreSQL |

## 현재 코드베이스

- **설정 페이지**: `frontend/src/pages/SettingsPage.tsx` — 현재 계정정보 + 알림설정만 있음
- **User 모델**: `backend/app/models/user.py` — name, email, phone, profile_image, bio
- **CounselorProfile 모델**: `backend/app/models/counselor_profile.py` — specialties, affiliation_type, years_of_experience, profile_image_url, bio
- **기존 API**: `PATCH /users/me` — 현재 name, phone, gender, birth_date만 업데이트 (client_profile 위주)
- **Auth store**: `frontend/src/stores/authStore.ts` — User 타입, login/logout

## 신규 모델

### Qualification (자격정보)
```python
class Qualification(Base):
    __tablename__ = "qualifications"
    id: UUID (PK)
    user_id: UUID (FK → users.id)
    name: str           # 자격명 (예: "임상심리사 1급")
    issuer: str | None  # 발급기관 (예: "한국산업인력공단")
    issued_at: date | None  # 취득일
    created_at: datetime
```

### Career (이력정보)
```python
class Career(Base):
    __tablename__ = "careers"
    id: UUID (PK)
    user_id: UUID (FK → users.id)
    organization: str   # 근무지
    role: str | None    # 역할/직책
    started_at: date | None
    ended_at: date | None
    is_current: bool (default=False)
    created_at: datetime
```

## QA 리스트

- [ ] 상담사 계정으로 설정 페이지 접근 시 프로필 섹션 표시
- [ ] 계정정보 섹션에 이름/이메일/전화번호/프로필사진/소개글 표시
- [ ] 프로필정보 섹션에 소속센터/전문분야/경력연수/자격정보/이력정보 표시
- [ ] "수정" 버튼 클릭 시 입력 폼으로 전환
- [ ] "취소" 버튼으로 수정 모드 해제 (원래 값 복원)
- [ ] "저장" 버튼 클릭 시 확인 다이얼로그 표시
- [ ] 확인 후 저장 → API 호출 → 성공 시 토스트 표시
- [ ] 자격정보/이력정보 추가/삭제 가능
- [ ] 저장 실패 시 에러 메시지 표시
- [ ] 빌드 통과 (`npm run build`)
- [ ] 타입 체크 통과
