# 계약 확장 — SessionLiveMetric에 성별·나이·사전 설문 추가

백엔드(FastAPI) + 프론트 계약을 확장한다. 구현 후 백엔드/프론트 빌드·테스트 통과까지.

## 백엔드
### 1. `backend/app/schemas/session.py` — SessionLiveMetric 필드 추가
```python
gender: str | None = None
birth_date: date | None = None
concerns: list[str] = []
```
(date 는 `from datetime import date` 확인)

### 2. `backend/app/services/session_service.py` — get_live_metrics 채움
- 회원 user_ids 에 대해 `ClientProfile` batch 조회 (`from app.models.client_profile import ClientProfile`, names 조회 패턴 재사용)
- 각 참가자 metrics.append 에 추가:
  - `gender`: `p.gender`(SessionParticipant) 우선, 없으면 회원 `client_profile.gender`
  - `birth_date`: `p.birth_date` 우선, 없으면 회원 `client_profile.birth_date`
  - `concerns`: 회원이면 `client_profile.concerns`(list), 게스트는 `[]`
- `birth_date` 는 `date` → ISO 문자열(`str`)로 직렬화 (Pydantic date 필드가 자동 직렬화하므로 `date` 객체 그대로 넣어도 됨)

## 프론트
### 3. `frontend/src/lib/api/session.ts` — SessionLiveMetric 필드 추가
```typescript
gender?: string | null;
birth_date?: string | null;
concerns?: string[];
```

### 4. `frontend/src/pages/sessions/ClassPlayerPage.tsx` — placeholder 연결
- 성별: `male`/`female`/`other` → `남`/`여`/`기타` 매핑 (없으면 생략)
- 나이: `birth_date` → 오늘 기준 만 나이 계산 (예: "여 · 25세")
- 사전 설문: `concerns` 배열 → "사전 설문" 섹션에 표시 (없으면 생략)
- `frontend/tests/host-class-workspace.test.tsx` 도 갱신

## 검증
- `cd backend && pytest` 통과 (관련 테스트)
- `cd frontend && npm run build` 종료코드 0
- 기존 placeholder "—" → 실제 데이터 연결 확인

## 주의
- 데이터 프라이버시: 게스트는 성별·나이만(참여 시 입력), 회원은 프로필 기반. concerns 는 회원 전용.
- `any` 금지, 명시적 타입
