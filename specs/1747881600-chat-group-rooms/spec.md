# F13b: 채팅방 유형 선택 — 개별(1:1) / 그룹(다중)

## 미션

CreateRoomModal에 "개별 채팅방" / "그룹 채팅방" 탭을 추가하고,
그룹 채팅방은 여러 내담자를 선택하여 생성할 수 있게 한다.

## 백엔드 변경

### 1. ChatRoomParticipant 모델 (신규)
```python
# backend/app/models/chat.py 에 추가
class ChatRoomParticipant(Base):
    __tablename__ = "chat_room_participants"
    room_id: Mapped[uuid.UUID] = FK -> chat_rooms.id (PK)
    user_id: Mapped[uuid.UUID] = FK -> users.id (PK)
```

### 2. Schema 추가
- `RoomCreateRequest`에 `participant_ids: list[str] | None` 필드 추가 (그룹방용)

### 3. chat_service 변경
- `create_direct_room` → `create_room` 으로 일반화
  - room_type='direct' 이면 기존 로직
  - room_type='group' 이면 participant_ids 로 여러 참여자 등록
- `_ensure_member`: room_type='group' 시 ChatRoomParticipant 체크
- `list_my_rooms`: room_type='group' 인 방도 포함

### 4. Alembic 마이그레이션
- chat_room_participants 테이블 생성

## 프론트엔드 변경 (직접 구현)

### CreateRoomModal.tsx
- 상단에 탭: "개별 채팅방" | "그룹 채팅방"
- 개별 탭: 기존 단일 선택 UI
- 그룹 탭: 체크박스 다중 선택 + 방 이름 입력
- API 호출 시 room_type 파라미터 구분

### chat.ts
- CreateDirectRoomPayload → CreateRoomPayload
- participant_ids 추가

## 절대 금지
- any 타입 금지
- 기존 direct room 동작 변경 금지
- 함수 시그니처 변경 금지 (기존 함수)
- Store 직접 import 금지

## 검증
- backend: pytest -q --tb=short
- frontend: npm run build
