# Spec: F4 내담자 관리

- **Sprint ID**: 004-client-management
- **작성일**: 2026-05-19
- **대상**: F4.1 ~ F4.3 (P0)
- **제외**: F4.4(태그), F4.5(저널) — P1, 추후
- **현재 코드 상태**:
  - ClientCounselorLink, ClientProfile, User 모델 존재
  - 내담자 관리 API 전무

---

## F4.1 내담자 목록

### 액터
Counselor

### API
- `GET /api/v1/clients?q=&sort=name|recent&page=&size=`
- 응답: `{ clients: [{ id, name, email, concerns, last_session_at, tags }], total, page }`
- `q`: 이름·이메일 검색
- 상담사 본인의 내담자만 조회 (ClientCounselorLink 필터)

---

## F4.2 내담자 프로필

### API
- `GET /api/v1/clients/{id}` → 기본정보 + ClientProfile + 세션요약 + 메모
- `PUT /api/v1/clients/{id}/memo` → `{ memo }` — 상담사 비공개 메모

---

## F4.3 내담자 초대

### 플로우
1. 상담사가 이메일 입력 → `POST /clients/invite` → 초대 링크 생성
2. `GET /invite/{token}` → 상담사 정보 + 가입 안내
3. 내담자 가입 시 상담사 코드 자동 매칭

### API
- `POST /api/v1/clients/invite` — `{ email }` → `{ invite_token, invite_url }`
- `GET /api/v1/invite/{token}` — `{ counselor_name, counselor_code, organization }`

### 모델
```python
class ClientInvite:
    id: UUID
    counselor_id: UUID FK
    email: str
    token: str unique
    status: pending/accepted/expired
    created_at: datetime
```

---

## 수락 기준 (QA)
- [ ] 상담사 본인 내담자만 목록 조회
- [ ] 이름·이메일 검색 가능
- [ ] 내담자 프로필 + 상담사 메모 조회/수정
- [ ] 초대 토큰 생성 + 가입 시 자동 매칭
