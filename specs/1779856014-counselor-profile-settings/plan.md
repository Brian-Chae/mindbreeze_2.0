# 상담사 프로필 설정 — Implementation Plan

> **SDD:** 1779856014-counselor-profile-settings
> **Spec:** `spec.md`
> **For Hermes:** Use subagent-driven-development. Dispatch each task to Claude Code Worker (`claude` CLI).

## Architecture

```
SettingsPage (frontend)
├── AccountSection (계정정보: name, email, phone, profile_image, bio)
│   └── Edit mode → 입력 폼 → Save → ConfirmDialog → API call
├── ProfileSection (프로필정보: affiliation, specialties, years, qualifications, careers)
│   └── Edit mode → 입력 폼 → Save → ConfirmDialog → API call
└── API Client
    ├── PATCH /counselors/me/profile  (계정 + 프로필 통합 업데이트)
    └── GET /counselors/me/profile    (계정 + 프로필 통합 조회) ← 기존 /users/me 확장

Backend
├── 신규 모델: Qualification, Career
├── 신규 스키마: CounselorProfileUpdate, CounselorProfileResponse
├── 신규 엔드포인트: PATCH /counselors/me/profile, GET /counselors/me/profile
└── Alembic 마이그레이션: qualifications, careers 테이블 생성
```

## 작업 디렉토리 (절대 경로 — Subagent에 필수 전달)

```
Frontend: /Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/frontend
Backend:  /Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend
```

---

## Task 1: 신규 DB 모델 + Alembic 마이그레이션 (백엔드)

**Objective:** Qualification, Career 모델 생성 및 DB 마이그레이션

**Files:**
- Create: `backend/app/models/qualification.py`
- Create: `backend/app/models/career.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/models/user.py` (User에 relationship 추가)
- Auto: Alembic 마이그레이션 파일

**Step 1:** Qualification 모델 생성

```python
# backend/app/models/qualification.py
import uuid
from datetime import datetime, date
from sqlalchemy import String, DateTime, Date, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

class Qualification(Base):
    __tablename__ = "qualifications"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    issuer: Mapped[str | None] = mapped_column(String(200))
    issued_at: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    user = relationship("User", back_populates="qualifications")
```

**Step 2:** Career 모델 생성

```python
# backend/app/models/career.py
import uuid
from datetime import datetime, date
from sqlalchemy import String, DateTime, Date, Boolean, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

class Career(Base):
    __tablename__ = "careers"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    organization: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[str | None] = mapped_column(String(200))
    started_at: Mapped[date | None] = mapped_column(Date)
    ended_at: Mapped[date | None] = mapped_column(Date)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    user = relationship("User", back_populates="careers")
```

**Step 3:** models/__init__.py 업데이트

```python
# 기존 import에 추가
from app.models.qualification import Qualification
from app.models.career import Career
```

**Step 4:** User 모델에 relationships 추가

```python
# user.py의 User 클래스에 추가
qualifications = relationship("Qualification", back_populates="user", cascade="all, delete-orphan")
careers = relationship("Career", back_populates="user", cascade="all, delete-orphan")
```

**Step 5:** Alembic 마이그레이션 생성 및 적용
```bash
cd backend && alembic revision --autogenerate -m "add qualifications and careers"
cd backend && alembic upgrade head
```

**Verify:** `psql`로 qualifications, careers 테이블 존재 확인

---

## Task 2: 백엔드 API — GET /counselors/me/profile + PATCH /counselors/me/profile

**Objective:** 상담사 프로필 조회/수정 API 엔드포인트 구현

**Files:**
- Modify: `backend/app/api/v1/auth.py` (기존 `/users/me` 확장 또는 새 라우터)
- Create/Modify: `backend/app/schemas/auth.py` (프로필 스키마 추가)

**Step 1:** Pydantic 스키마 추가

```python
# schemas/auth.py에 추가
from pydantic import BaseModel
from datetime import date
from typing import Optional

class QualificationItem(BaseModel):
    id: Optional[str] = None   # 기존 항목 식별용
    name: str
    issuer: Optional[str] = None
    issued_at: Optional[str] = None  # ISO date string

class CareerItem(BaseModel):
    id: Optional[str] = None
    organization: str
    role: Optional[str] = None
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    is_current: bool = False

class CounselorProfileUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    profile_image: Optional[str] = None
    bio: Optional[str] = None
    affiliation_type: Optional[str] = None
    years_of_experience: Optional[int] = None
    specialties: Optional[list[str]] = None
    qualifications: Optional[list[QualificationItem]] = None
    careers: Optional[list[CareerItem]] = None

class CounselorProfileResponse(BaseModel):
    id: str
    email: str
    name: str
    role: str
    phone: Optional[str] = None
    profile_image: Optional[str] = None
    bio: Optional[str] = None
    counselor_code: Optional[str] = None
    affiliation_type: Optional[str] = None
    years_of_experience: Optional[int] = None
    specialties: list[str] = []
    qualifications: list[dict] = []
    careers: list[dict] = []
```

**Step 2:** GET /counselors/me/profile 엔드포인트

```python
# auth.py에 추가
@router.get("/counselors/me/profile", response_model=CounselorProfileResponse)
async def get_counselor_profile(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    profile = current_user.counselor_profile
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "name": current_user.name,
        "role": current_user.role,
        "phone": current_user.phone,
        "profile_image": current_user.profile_image or (profile.profile_image_url if profile else None),
        "bio": current_user.bio or (profile.bio if profile else None),
        "counselor_code": profile.counselor_code if profile else None,
        "affiliation_type": profile.affiliation_type if profile else None,
        "years_of_experience": profile.years_of_experience if profile else None,
        "specialties": profile.specialties if profile else [],
        "qualifications": [{"id": str(q.id), "name": q.name, "issuer": q.issuer, "issued_at": str(q.issued_at)} for q in (current_user.qualifications or [])],
        "careers": [{"id": str(c.id), "organization": c.organization, "role": c.role, "started_at": str(c.started_at), "ended_at": str(c.ended_at), "is_current": c.is_current} for c in (current_user.careers or [])],
    }
```

**Step 3:** PATCH /counselors/me/profile 엔드포인트

```python
@router.patch("/counselors/me/profile", response_model=CounselorProfileResponse)
async def update_counselor_profile(
    req: CounselorProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # User 필드 업데이트
    if req.name is not None:
        current_user.name = req.name
    if req.phone is not None:
        current_user.phone = req.phone
    if req.profile_image is not None:
        current_user.profile_image = req.profile_image
    if req.bio is not None:
        current_user.bio = req.bio

    # CounselorProfile 생성/업데이트
    from app.models.counselor_profile import CounselorProfile as CPModel
    profile = db.query(CPModel).filter(CPModel.user_id == current_user.id).first()
    if profile is None:
        profile = CPModel(user_id=current_user.id, counselor_code=..., specialties=[])
        db.add(profile)

    if req.affiliation_type is not None:
        profile.affiliation_type = req.affiliation_type
    if req.years_of_experience is not None:
        profile.years_of_experience = req.years_of_experience
    if req.specialties is not None:
        profile.specialties = req.specialties

    # Qualifications: delete all + re-insert
    if req.qualifications is not None:
        db.query(Qualification).filter(Qualification.user_id == current_user.id).delete()
        for q in req.qualifications:
            db.add(Qualification(
                user_id=current_user.id,
                name=q.name,
                issuer=q.issuer,
                issued_at=date.fromisoformat(q.issued_at) if q.issued_at else None,
            ))

    # Careers: delete all + re-insert
    if req.careers is not None:
        db.query(Career).filter(Career.user_id == current_user.id).delete()
        for c in req.careers:
            db.add(Career(
                user_id=current_user.id,
                organization=c.organization,
                role=c.role,
                started_at=date.fromisoformat(c.started_at) if c.started_at else None,
                ended_at=date.fromisoformat(c.ended_at) if c.ended_at else None,
                is_current=c.is_current,
            ))

    db.commit()
    db.refresh(current_user)

    return await get_counselor_profile(current_user, db)
```

**Step 4:** Verify — `curl`로 GET/PATCH 테스트

---

## Task 3: 프론트엔드 — API 클라이언트 + 타입 정의

**Objective:** 프론트엔드에서 상담사 프로필 API 호출 함수 및 타입 정의

**Files:**
- Modify: `frontend/src/lib/api/client.ts` (또는 auth.ts — API 클라이언트 확인 필요)
- Modify: `frontend/src/stores/authStore.ts` (User 타입 확장)

**Step 1:** API 클라이언트 확인 및 함수 추가

```typescript
// lib/api/client.ts 또는 적절한 파일에 추가
export interface CounselorProfile {
  id: string;
  email: string;
  name: string;
  role: string;
  phone?: string;
  profile_image?: string;
  bio?: string;
  counselor_code?: string;
  affiliation_type?: string;
  years_of_experience?: number;
  specialties: string[];
  qualifications: { id: string; name: string; issuer?: string; issued_at?: string }[];
  careers: { id: string; organization: string; role?: string; started_at?: string; ended_at?: string; is_current: boolean }[];
}

export async function getCounselorProfile(): Promise<CounselorProfile> {
  const res = await Sr('/counselors/me/profile');
  return await res.json();
}

export async function updateCounselorProfile(data: Partial<CounselorProfile>): Promise<CounselorProfile> {
  const res = await Sr('/counselors/me/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return await res.json();
}
```

**Step 2:** authStore User 타입 확장 (profile 정보 포함)

---

## Task 4: 프론트엔드 — SettingsPage 확장 (계정정보 + 프로필정보 + 수정 모드 + ConfirmDialog)

**Objective:** SettingsPage에 프로필 섹션 추가, 수정 기능, ConfirmDialog 구현

**Files:**
- Modify: `frontend/src/pages/SettingsPage.tsx`
- Create: `frontend/src/components/settings/AccountSection.tsx`
- Create: `frontend/src/components/settings/ProfileSection.tsx`
- Create: `frontend/src/components/settings/ConfirmDialog.tsx`

**핵심 UX 플로우:**
1. 페이지 로드 시 `getCounselorProfile()` 호출 → 데이터 표시
2. "수정" 버튼 클릭 → 각 섹션이 edit 모드로 전환 (input/textarea로 변경)
3. "취소" → 원래 값으로 복원
4. "저장" → ConfirmDialog 표시 → 확인 → API 호출 → 성공 토스트

**AccountSection 구조:**
- 보기 모드: label + value (현재 SettingsPage와 유사)
- 수정 모드: name(input), phone(input), profile_image(input), bio(textarea)
- 이메일은 읽기 전용으로 표시

**ProfileSection 구조:**
- 보기 모드: affiliation_type, specialties(tag list), years_of_experience, qualifications(list), careers(list)
- 수정 모드: affiliation_type(input), specialties(comma-separated input → array), years_of_experience(number input)
- qualifications: 동적 리스트 (추가/삭제 버튼, 각 항목: name+issuer+issued_at)
- careers: 동적 리스트 (추가/삭제 버튼, 각 항목: organization+role+started_at+ended_at+is_current)

**ConfirmDialog:**
```tsx
function ConfirmDialog({ open, onConfirm, onCancel, message }: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  message: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-6 max-w-sm mx-4">
        <p className="text-[#1F1F1F] mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 text-[#6F6F6F] ...">취소</button>
          <button onClick={onConfirm} className="px-4 py-2 bg-[#5F0080] text-white rounded-lg ...">확인</button>
        </div>
      </div>
    </div>
  );
}
```

**Verify:** `npm run build` 통과, 타입 오류 없음

---

## Task 5: 통합 검증 + 배포

**Objective:** 전체 기능 동작 확인 및 EC2 배포

- 백엔드: rsync → Docker rebuild → restart
- 프론트엔드: `npm run build` → rsync dist → 컨테이너 재시작
- `curl`로 API 엔드포인트 검증
