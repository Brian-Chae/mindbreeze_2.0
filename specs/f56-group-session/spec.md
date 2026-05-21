# F5.6 그룹 세션 — Spec

## 미션
명상 수업 등 그룹 세션을 위한 다수 참여자 초대, 정원 관리, 대기열 기능 구현.

## 현재 상태
- ✅ 백엔드: `max_participants`, `SessionParticipant`, `participant_ids` 필드 존재
- ✅ API: `inviteParticipant(id, userId)` 단일 초대, `createSession({participant_ids})` 가능
- ✅ FE: SessionCreatePage에 max_participants 입력 필드 존재
- ❌ FE: 참여자 다중 선택 UI 없음
- ❌ FE: CSV 업로드 없음
- ❌ BE: 대기열(waitlist) 로직 없음
- ❌ FE: 세션 상세에 참여자 목록·대기열 표시 없음

## 구현 범위

### 1. 백엔드 — 대기열 로직 (SessionParticipant에 waitlist 필드 추가)

**SessionParticipant 모델 변경:**
```python
# backend/app/models/session.py
class SessionParticipant(Base):
    ...
    is_waitlisted: Mapped[bool] = mapped_column(Boolean, default=False)
    waitlist_position: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
```

**참여자 초대 로직 변경 (inviteParticipant):**
- `max_participants`보다 적으면 → 바로 참여자로 등록
- `max_participants` 도달 시 → 대기열로 등록 (is_waitlisted=true, waitlist_position=자동할당)
- 대기열에서 참여자 취소/이탈 시 → 대기열 1순위 자동 승격

**SessionDto 응답에 대기열 정보 포함:**
```typescript
export interface SessionDto {
  ...
  waitlist_count: number;  // 대기열 인원 수
  participants: SessionParticipant[]; // is_waitlisted 필드 추가
}
```

### 2. 프론트엔드 — SessionCreatePage 참여자 선택

**다중 선택 드롭다운:**
- 기존 `client/list` API로 내담자 목록 가져오기
- 체크박스 기반 다중 선택 (검색 가능)
- 선택 인원 수 / 최대 참여자 수 실시간 표시 (예: "3/5명")
- 최대 초과 선택 시 경고 + 마지막 선택 해제

**CSV 업로드:**
- "CSV로 추가" 버튼 → 파일 선택
- CSV 형식: `email,name` (헤더 포함)
- 업로드 후 이메일로 사용자 조회 → 존재하면 선택 목록에 추가, 없으면 "초대 대상 아님" 표시
- CSV 파싱은 FE에서 처리

**SessionCreatePage 변경사항:**
```
[세션 유형] [일시] [소요시간] [최대인원] ← 기존 유지
[참여자 선택] ← 신규: 다중 선택 + CSV 버튼
  └─ [내담자 검색___] [검색]
  └─ ☑ 홍길동  ☑ 김철수  ☐ 이영희  ...
  └─ 선택: 2/5명  [CSV로 추가]
[제목] [메모] ← 기존 유지
```

### 3. 프론트엔드 — SessionDetailPage 참여자·대기열

**참여자 섹션 (신규):**
```
참여자 (3/5명)
┌─────────────────────────────┐
│ 🟢 홍길동 (참여)             │
│ 🟢 김철수 (참여)             │
│ 🟢 이영희 (참여)             │
├─────────────────────────────┤
│ 대기열 (2명)                 │
│ 🟡 박지민 (1순위)            │
│ 🟡 최민수 (2순위)            │
├─────────────────────────────┤
│ [+ 참여자 초대] [CSV로 추가]  │
└─────────────────────────────┘
```

**참여자 초대 모달:**
- 기존 참여자 선택 UI 재사용
- `inviteParticipant` API 호출
- 대기열 자동 반영

### 4. 프론트엔드 — ALTER SESSION DETAIL FOR GROUP

세션 상세 페이지 하단에 참여자 섹션 추가:
- `session.participants`에서 `is_waitlisted=false` → 참여자 목록
- `session.participants`에서 `is_waitlisted=true` → 대기열 목록 (waitlist_position 순)
- 참여자 0명이면 "아직 참여자가 없습니다"

## 파일 목록

### 백엔드 수정
- `backend/app/models/session.py` — SessionParticipant에 is_waitlisted, waitlist_position 추가
- `backend/app/api/session.py` — inviteParticipant에 대기열 로직, SessionDto에 waitlist_count 포함
- `backend/app/schemas/session.py` — SessionParticipant schema에 is_waitlisted 포함
- `backend/alembic/versions/` — 마이그레이션 생성

### 프론트엔드 신규
- `frontend/src/components/session/ParticipantPicker.tsx` — 다중 선택 + CSV 업로드 컴포넌트

### 프론트엔드 수정
- `frontend/src/pages/sessions/SessionCreatePage.tsx` — ParticipantPicker 통합
- `frontend/src/pages/sessions/SessionDetailPage.tsx` — 참여자·대기열 섹션 추가
- `frontend/src/lib/api/session.ts` — SessionParticipant 타입에 is_waitlisted 추가

## 절대 금지
- any 타입 사용 금지
- Store 직접 import 금지 (useAuthStore 제외)
- 기존 세션 상태머신 로직 변경 금지
- 모바일 반응형 캘린더 코드 변경 금지

## 검증
- `cd backend && pytest -q` — 기존 테스트 통과
- `cd frontend && npm run build` — 빌드 성공
