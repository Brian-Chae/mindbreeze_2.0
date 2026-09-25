# 채팅방 설정(이름·정보 변경) 기능 기획안

> 작성일: 2026-09-25 · 상태: 검토용 제안 · 범위: 기획 문서만 작성, 구현 없음
> 기준: `docs/chat-sort-settings/00-research-brief.md:10-49`와 현재 체크아웃의 코드.
> 아래 **현재 사실**과 **제안 정책**을 구분한다. 제안한 API·필드·권한은 아직 구현된 동작이 아니다. 경로는 저장소 루트 기준이며, 라인은 작성 시점 기준이다.

## 1. 배경 — 현재 상태와 해결할 문제

### 1.1 브리프의 현재 상태 확인

- 방 유형은 direct/session/group이다. `ChatRoom`은 `id`, nullable·unique `session_id`, `room_type`, nullable `host_id`, nullable `name`, `created_at`을 가진다. 이름 컬럼은 `String(120)`이다. 근거: `backend/app/models/chat.py:13-25`.
- 방 목록/생성/단건 조회, 메시지 조회·전송, 읽음 처리는 있지만 방 update/rename/PATCH/DELETE API는 없다. `PUT /rooms/{room_id}/read`는 이름 수정이 아닌 읽음 처리다. 배치 읽음 POST도 별도로 존재한다. 근거: `backend/app/api/v1/chat.py:23-114`.
- 방 목록은 세션 dict 순서 → direct → group 순으로 합쳐 반환하며 정렬 로직이 없다. 브리프의 약 349행 표기는 현재 코드에서 381행으로 이동했다. 근거: `backend/app/services/chat_service.py:381-440`.
- `_serialize_room()`은 `id`, `session_id`, `room_type`, `host_id`, `name`, `peer_name`, `peer_id`, `session_title`, `session_scheduled_at`, `participant_count`, `created_at`, `unread_count`를 반환한다. `last_message`와 `last_message_at`은 없다. 응답 스키마도 동일하다. 근거: `backend/app/services/chat_service.py:305-330`, `backend/app/schemas/chat.py:57-73`.
- 메시지 조회에만 `ChatMessage.created_at.desc()` 최신순 정렬이 있다. 방 목록 정렬과 구분한다. 근거: `backend/app/services/chat_service.py:452-465`.
- 상담사·내담자 목록에는 방 진입 버튼이 있지만 정렬 토글이나 설정 버튼은 없다. 근거: `frontend/src/pages/chat/ChatPage.tsx:100-156`, `frontend/src/pages/client/ClientChatPage.tsx:164-210`.
- 프론트 `ChatRoom` 타입에만 선택적 `last_message`가 선언돼 있다. 이를 현재 서버가 제공하는 데이터로 가정하지 않는다. 근거: `frontend/src/lib/api/chat.ts:24-41`.
- 생성 모달에는 direct/group 공통 이름 입력이 있다. 근거: `frontend/src/components/chat/CreateRoomModal.tsx:155-162`.
- 메시지 모델은 `type(text/image/file/system)`, `content`, `file_url`, `event_type`, `created_at`, `read_by(JSONB)`, `recipient_count` 등을 보유한다. 그룹 참여자는 별도 `ChatRoomParticipant(room_id, user_id, joined_at)`, 읽음은 `ChatMessageRead(message_id, user_id, read_at)`에도 저장한다. 근거: `backend/app/models/chat.py:30-72`.
- 세션에는 `type`, `status`, `host_id`, nullable `scheduled_at`, nullable `title` 등이 있다. 근거: `backend/app/models/session.py:24-47`.

### 1.2 이름 변경 전에 반드시 고려할 코드 제약

**direct의 `name`은 현재 표시 이름이 아니라 내담자 ID 저장소다.** 방 생성·재사용은 `host_id + name(client_id)`로 찾는다. 생성 API가 이름을 받아도 direct 분기에서는 `get_or_create_direct_room()`에 전달하지 않는다. 근거: `backend/app/services/chat_service.py:172-194`, `backend/app/services/chat_service.py:251-275`.

이 필드를 자유 텍스트로 덮어쓰면 상대방 식별, 내담자 목록 조회, 수신자 결정에 영향을 준다. 근거: `backend/app/services/chat_service.py:48-63`, `backend/app/services/chat_service.py:281-302`, `backend/app/services/chat_service.py:402-415`, `backend/app/services/chat_service.py:468-481`.

화면 제목도 방별로 다르다. direct는 `peer_name`, group은 `name`, session은 `session_title`을 사용한다. 근거: `frontend/src/pages/chat/ChatPage.tsx:21-33`, `frontend/src/pages/client/ClientChatPage.tsx:32-37`.

**기관 멤버십 기반 생성과 목록 노출 사이에는 현재 차이가 있다.** direct 생성은 연결 기록 또는 공유 기관으로 허용하지만, 내담자용 목록 조회는 `ClientCounselorLink`에서 얻은 상담사 ID가 있어야 해당 방을 포함한다. 따라서 공유 기관만으로 생성된 방이 내담자 목록에도 반드시 나타난다고 가정하지 않는다. 근거: `backend/app/services/chat_service.py:264-275`, `backend/app/services/chat_service.py:402-415`. 내담자 화면에도 상담사 연결 여부에 따른 진입 제한이 있다. 근거: `frontend/src/pages/client/ClientAppPage.tsx:260-266`, `frontend/src/pages/client/ClientChatPage.tsx:119-139`. 이 기획의 목록 진입 UX는 현재 목록에 노출되는 방을 대상으로 하며, 멤버십만 있는 사용자의 전체 진입 보장은 별도 정합성 작업이 선행되어야 한다.

따라서 목표는 목록에서 방 정보를 확인하고, 허용된 주체가 **공유되는 표시 이름**을 바꾸되 기존 방 식별과 메시지 전달을 보존하는 것이다. 목록 정렬 기능은 별도 기획 범위다.

## 2. 요구사항과 범위 제안

### 2.1 MVP 필수

1. 상담사·내담자 목록의 각 방에 `⋯` 메뉴와 `채팅방 설정` 진입점을 제공한다. 편집 권한이 없어도 해당 방 접근 권한이 있으면 정보 조회가 가능하다.
2. direct/group 방은 권한 있는 host가 공유 이름을 변경한다. 저장 전 “이 이름은 모든 참여자에게 표시됩니다”를 안내한다. 개인별 별칭은 이번 범위에 포함하지 않는다.
3. session 방은 정보 조회만 제공한다. 이 모달에서는 이름이나 원본 세션 정보를 변경하지 않는다.
4. 방 종류, 표시 이름, 생성일, 참여자 수를 표시한다. direct는 상대방 이름, session은 세션 제목·예정일을 추가 표시한다. UUID를 사용자용 이름으로 표시하지 않는다.
5. 서버가 계산한 `can_rename`과 변경 불가 사유를 사용한다. 실제 PATCH 요청에서도 권한을 다시 검증한다.
6. 저장 성공 후 현재 목록·선택된 방 제목·모달을 같은 응답으로 갱신한다. 설정 열기 자체는 읽음 처리나 채팅방 이동을 발생시키지 않는다.

현재 데이터로 가능한 정보 표시를 우선한다. `participant_count`의 기존 의미는 direct=2, group=참여자 수+host, session=세션 참여자 행 수이며 session은 host를 별도로 더하지 않는다. 따라서 session에는 “세션 등록 참여자 N명”으로 표시한다. 근거: `backend/app/services/chat_service.py:333-345`.

### 2.2 선택 요구사항 — 참여자 관리

MVP에서는 **참여자 수 조회까지만** 제공하고 추가·내보내기·방장 위임은 제외한다. 현재 RoomResponse에는 참여자 명단이 없으며, 그룹 생성 때만 참여자를 검증해 저장한다. 근거: `backend/app/schemas/chat.py:57-69`, `backend/app/services/chat_service.py:208-248`.

후속 참여자 관리가 필요하면 group 전용 별도 API·명단 조회·기관 멤버십 재검증을 기획한다. 과거 메시지 열람 범위, 제거 직후 REST/소켓 접근 회수, 읽음 집계의 일관성을 먼저 정의해야 한다. direct 상대 교체는 새 방 생성으로, session 참여자 변경은 세션 도메인으로 분리한다. 이번 PATCH에는 `participant_ids`를 받지 않는다.

### 2.3 데이터 설계 대안과 권장안

- **권장: direct 표시 이름 컬럼 추가 + group의 기존 name 수정.** 기존 식별 구조를 보존하면서 두 유형의 이름 변경을 제공한다. API 응답에 통일된 `display_name`을 추가해 화면별 분기를 줄인다.
- 대안: direct 내담자 ID를 정식 FK 컬럼으로 이관하고 모든 방의 name을 표시 이름으로 통일한다. 장기적으로 명확하지만 데이터 검증·백필·모든 식별 의존부 수정이 필요해 이번 기능보다 범위가 커진다.
- 축소안: group만 이름 변경을 허용한다. 마이그레이션은 줄지만 direct 이름 변경 요구를 충족하지 못한다.

이하 설계는 권장안을 기준으로 한다.

## 3. UX 설계 제안

### 3.1 목록 → 설정 모달

1. 목록 행 오른쪽에 항상 접근 가능한 `⋯` 버튼을 둔다. 메뉴 항목은 `채팅방 설정`이다.
2. 목록 본문의 방 열기 버튼과 메뉴 버튼을 형제 요소로 구성한다. 현재 행 전체가 button이므로 내부에 button을 중첩하지 않는다. 메뉴 조작이 방 선택으로 전파되지 않게 한다. 근거: `frontend/src/pages/chat/ChatPage.tsx:125-152`, `frontend/src/pages/client/ClientChatPage.tsx:168-206`.
3. 모바일도 같은 버튼을 제공한다. 롱프레스는 후속 편의 기능이며 유일한 진입 방식으로 사용하지 않는다.
4. 모달을 열 때 `GET /chat/rooms/{id}`로 최신 이름·권한·정보를 읽는다. 로딩 중 저장을 잠그고 오류 시 재시도 또는 닫기를 제공한다.
5. 보라 `#5F0080`, 흰 배경, 둥근 모서리 등 기존 생성 모달의 스타일을 따른다. 근거: `frontend/src/components/chat/CreateRoomModal.tsx:155-162`, `frontend/src/components/chat/CreateRoomModal.tsx:240-246`.
6. 모달 제목·닫기 버튼·입력 라벨을 제공하고, 포커스 이동/가두기, Esc 닫기, 종료 후 호출 버튼으로 포커스 복귀를 지원한다.

### 3.2 이름 변경 흐름

`⋯ → 채팅방 설정 → 최신 정보 조회 → 이름 입력 → 유효성 확인 → 저장 중 → 성공 안내 및 화면 갱신`

- 입력 라벨: `채팅방 이름`. 길이 안내: `1~120자`. 공통 안내: `모든 참여자에게 표시되는 이름입니다.`
- direct의 미설정 사용자 지정 이름은 빈 입력으로 두고 상대방 이름을 placeholder로만 표시한다. 조회자마다 달라지는 상대방 이름을 공유 이름으로 자동 저장하지 않는다.
- group도 미설정이면 빈 입력과 `그룹 채팅` placeholder를 제공한다.
- trim 후 유효한 이름이 현재 저장값과 다를 때만 저장 가능하다. 서버도 동일 검증을 수행한다.
- 저장 중에는 중복 제출과 모달 닫기를 막는다. 성공하면 `채팅방 이름을 변경했습니다` 안내 후 닫고 목록과 현재 제목을 갱신한다.
- 저장 실패 시 입력을 보존하고 다시 시도할 수 있게 한다. 변경 전 닫기는 미저장 변경이 있을 때만 폐기 확인을 표시한다.
- 편집 불가 사용자는 읽기 전용 정보와 사유를 본다. session 안내는 `세션 채팅방 이름은 세션 제목을 따릅니다.`로 한다.
- 기본 이름으로 초기화하는 기능은 MVP에서 제외한다. 빈 문자열을 초기화 명령으로 해석하지 않는다.

### 3.3 정보 표시와 갱신

- 공통: 표시 이름, 방 종류, 생성일, 유형별 참여자 수. direct에는 상대방 이름을 별도 유지해 공유 이름을 바꿔도 대상을 식별할 수 있게 한다.
- session: `session_title`이 없으면 `제목 없음`, `session_scheduled_at`이 없으면 `일정 미지정`. 현재 시각으로 대체하지 않는다.
- host 이름·참여자 명단·방 설명은 현재 응답에 없으므로 이번 모달에서 제공한다고 약속하지 않는다. 근거: `backend/app/schemas/chat.py:57-69`.
- 저장자는 응답을 즉시 반영한다. 다른 참여자는 목록 재진입, 창 포커스 복귀 또는 설정 재열기 때 서버를 재조회한다. MVP에서는 다른 기기의 즉시 소켓 동기화를 보장하지 않는다.
- 이름 변경은 메시지 생성이 아니다. `created_at`, 읽음 수, 마지막 대화 시각을 바꾸지 않으며 정렬 기능의 최근 대화 기준에도 영향을 주지 않는다.

## 4. 백엔드 API 설계 제안

### 4.1 엔드포인트와 요청

`PATCH /chat/rooms/{id}`를 신설한다. 라우터 변수명은 기존과 맞춰 `{room_id}`를 사용한다. 현재 라우터 prefix는 `/chat`이다. 근거: `backend/app/api/v1/chat.py:20`, `backend/app/api/v1/chat.py:49-55`.

요청 스키마 `RoomUpdateRequest`:

```json
{ "name": "월요일 마음돌봄 모임" }
```

- `name`: 필수 문자열. 앞뒤 공백 제거 후 1~120 Unicode 코드 포인트. 프론트·백엔드가 동일하게 계산한다.
- 줄바꿈·제어문자는 거부하고 일반 공백, 한글, 영문, 숫자, 이모지는 허용한다. HTML이 아닌 텍스트로 렌더링한다.
- `{}`, `null`, 공백만 있는 값, 120자 초과는 422. 알 수 없는 필드도 거부한다.
- `host_id`, `room_type`, `session_id`, `participant_ids`, 기관 식별자 등은 이 API로 변경할 수 없다.
- `name`은 **요청에서 공유 표시 이름을 뜻한다.** 기존 응답의 direct `name`은 레거시 ID이므로 요청값과 같은 의미라고 가정하지 않는다.

### 4.2 응답

성공은 `200 OK`, 확장된 `RoomResponse` 전체를 반환한다. 기존 필드와 의미를 유지하고 아래 필드를 추가한다. 목록 GET, 단건 GET, 생성 POST, PATCH에서 같은 직렬화 계약을 사용한다.

- `custom_name: string | null`: 편집 대상 저장값. direct는 새 `ChatRoom.display_name`, group은 기존 `ChatRoom.name`, session은 null.
- `display_name: string`: 사용자에게 보여줄 최종 제목. direct는 `custom_name → peer_name → '1:1 채팅'`, group은 `custom_name → '그룹 채팅'`, session은 `session_title → '세션'` 순으로 결정한다. 빈 레거시 이름은 표시 시에만 미설정으로 취급한다.
- `can_rename: boolean`: 현재 요청자 기준 변경 가능 여부.
- `rename_disabled_reason: string | null`: `not_host`, `role_not_allowed`, `membership_required`, `participant_scope_invalid`, `session_managed`, `host_missing` 중 하나 또는 null. 여러 조건에 걸리면 §6 검증 순서에서 처음 실패한 사유를 반환한다.

응답 일부의 의미 예시(나머지 필드는 기존 RoomResponse 그대로 포함):

```json
{
  "room_type": "group",
  "name": "월요일 마음돌봄 모임",
  "custom_name": "월요일 마음돌봄 모임",
  "display_name": "월요일 마음돌봄 모임",
  "can_rename": true,
  "rename_disabled_reason": null
}
```

direct PATCH 후에는 레거시 `name`이 내담자 ID로 유지되고 `custom_name`과 `display_name`에 새 이름이 반환된다. 프론트가 레거시 `name`을 편집기에 넣거나 제목 fallback으로 사용하지 않도록 한다.

### 4.3 인증·권한·저장 절차

1. `get_current_user`로 인증한다. 현재 의존성은 DB 사용자에서 id/role/org_id 등을 반환하며 미인증은 401이다. 근거: `backend/app/api/deps.py:14-42`.
2. 기존 `_uuid` 규칙으로 ID를 검증하고 방을 조회한다. 잘못된 ID 400, 없는 방 404 규칙을 유지한다. 근거: `backend/app/services/chat_service.py:19-23`, `backend/app/services/chat_service.py:443-449`.
3. 기존 방 접근 검증에 더해 direct는 실제 `host_id` 또는 저장된 내담자 ID와 요청자가 일치하는지 확인한다. 단건 GET에도 동일한 실제 당사자 검증을 적용한다. 같은 기관이라는 이유만으로 다른 direct 방 설정을 열람하지 못하게 한다.
4. §6의 변경 권한을 서버에서 재계산한다. 클라이언트가 전달한 role/host/can_rename은 신뢰하지 않는다.
5. 이름만 allowlist 방식으로 변경하고 트랜잭션을 커밋한다. direct는 `display_name`, group은 `name`에 쓴다. 그 후 최신 응답을 직렬화한다.
6. 같은 이름 재전송은 200으로 처리한다. 시스템 메시지·알림·읽음 기록은 추가하지 않는다.

현재 `_serialize_room()`에는 사용자 ID만 전달되므로, 새 권한 계산에 필요한 사용자 role과 멤버십은 서버 DB에서 읽는다. 목록에서는 사용자·멤버십 정보를 요청 단위로 재사용하고 참여자 조건도 일괄 조회해 방마다 동일 조회를 반복하지 않도록 설계한다. 권한 계산 결과는 요청자별 값이므로 다른 사용자에게 공용 캐시로 재사용하지 않는다. 현재 함수 입력 근거: `backend/app/services/chat_service.py:305-306`.

기존 `_ensure_member`를 이름 수정 권한으로 그대로 재사용해서는 안 된다. direct는 host 외에 해당 상담사와 연결되었거나 같은 기관인 사용자를 허용하며, 방에 저장된 내담자 ID와의 일치 검사가 없다. group/session도 구성원 접근 검증일 뿐 수정자 판정이 아니다. 근거: `backend/app/services/chat_service.py:117-159`.

### 4.4 오류 계약

- 400: 잘못된 방 ID 형식.
- 401: 인증 없음 또는 무효.
- 403: 방 접근 불가 또는 이름 변경 권한 없음. session 방도 PATCH는 403이며 안내 메시지로 세션에서 관리됨을 알린다.
- 404: 방 없음. session 정보 조회 중 연결 세션이 없을 때도 기존 규칙에 따라 404.
- 422: 요청 이름 검증 실패 또는 허용하지 않은 필드.
- 서버/통신 오류: 성공으로 표시하지 않고 입력 보존 후 재시도. 응답 유실 시 GET 재조회로 저장 여부 확인.

HTTP 오류는 기존처럼 `detail`로 설명한다. 폼 유효성 오류는 FastAPI 검증 오류 형식도 처리해야 한다. 오류 문자열 비교로 권한을 판단하지 않고 정상 GET의 권한 필드를 사용한다.

## 5. 데이터 변경 제안

### 5.1 저장 필드

- **추가:** `ChatRoom.display_name: String(120), nullable=True`. 이번 단계에서는 direct의 사용자 지정 공유 이름만 저장한다.
- **수정:** group 이름 변경은 기존 `ChatRoom.name`을 갱신한다.
- **보존:** direct `ChatRoom.name`의 내담자 ID, `host_id`, `session_id`, `created_at`. session `name`과 원본 `Session.title`도 이번 PATCH로 변경하지 않는다.
- `custom_name`, `can_rename`, `rename_disabled_reason`는 계산 응답 필드이며 DB에 저장하지 않는다. 응답의 `display_name`은 최종 표시값으로, direct용 nullable DB 필드와 구분한다.
- `description`, `updated_at`, 개인별 별칭, 수정자 이력 컬럼은 MVP에서 추가하지 않는다.

### 5.2 마이그레이션·호환성

nullable 컬럼 추가만 필요하다. 기존 direct ID를 표시 이름으로 백필하지 않으며 기존 group/session 데이터도 옮기지 않는다. 새 서버는 null일 때 기존 제목 fallback을 사용한다. 기존 클라이언트는 새 필드를 무시하며 기존 제목을 계속 표시할 수 있다.

현재 생성 모달은 direct 이름을 받지만 서버 direct 분기는 이를 저장하지 않으므로, 구현 단계에서는 신규 direct 생성 시 입력 이름을 새 표시 이름 컬럼에 저장하도록 함께 맞춘다. 기존 direct 방을 반환하는 POST 재사용 경로에서는 입력 이름으로 기존 이름을 덮어쓰지 않는다. 이름 변경은 PATCH로 명시적으로 수행한다. 근거: `frontend/src/components/chat/CreateRoomModal.tsx:155-162`, `backend/app/services/chat_service.py:172-194`, `backend/app/services/chat_service.py:259-275`.

마이그레이션 다운그레이드 시 새 direct 표시 이름은 손실되지만 내담자 식별값은 보존된다. 이는 향후 구현·배포 시 검증할 항목이며 이 문서 작성에서는 마이그레이션을 실행하지 않는다.

## 6. 권한 정의 제안

### 6.1 현재 권한의 정확한 해석

SDD-089의 `_share_org()`는 **상담사의 active UserOrgMembership 기관 집합**과 **내담자의 User.org_id**를 비교한다. 상담사의 단일 `User.org_id`만으로 판단하지 않는다. 생성 시에는 기존 `ClientCounselorLink`가 있거나 `_share_org()`가 참이면 통과한다. 근거: `backend/app/services/chat_service.py:26-45`, `backend/app/services/chat_service.py:223-232`, `backend/app/services/chat_service.py:264-273`.

이는 모든 기존 채팅 요청이 현재 멤버십을 재검증한다는 뜻은 아니다. `_ensure_member()`의 host 분기는 바로 통과하고 group은 등록 참여자, session은 세션 host/참여자를 확인한다. 근거: `backend/app/services/chat_service.py:117-159`. 멤버십 모델은 기관별 role과 active/invited/left 상태를 별도로 갖는다. 근거: `backend/app/models/user_org_membership.py:27-37`.

### 6.2 방 유형·사용자별 정책

- **direct:** 실제 host인 상담사만 이름 변경이 기본 원칙이다. host 본인이 기관 관리자 역할이라면 아래 조건 충족 시 동일하게 허용한다. 실제 상대 내담자는 정보 조회만 가능하며 공유 이름이나 개인 별칭을 수정할 수 없다. 같은 기관의 다른 상담사/내담자에게는 변경 권한이 없다.
- **group:** 실제 host인 상담사 또는 host인 기관 관리자만 아래 조건 충족 시 이름 변경 가능하다. 등록 참여자는 역할과 무관하게 정보 조회만 가능하다.
- **session:** host/참여자는 기존 접근 정책에 따라 정보 조회 가능하다. host를 포함한 모든 사용자에게 이 PATCH의 이름 변경은 금지한다. 세션 이름·일정·참여자는 세션 도메인의 별도 변경 절차 대상이다. 세션 방 생성 시 `ChatRoom.host_id`를 채우지 않으므로 이를 세션 host로 간주하면 안 된다. 근거: `backend/app/services/chat_service.py:147-168`.
- **기관 관리자(org_admin):** 관리자 역할이나 같은 기관 소속만으로 타인의 방 수정·열람 권한을 부여하지 않는다. direct/group의 실제 host일 때만 일반 host 조건을 적용한다.
- **플랫폼 관리자(platform_admin):** 이 기능에서는 관리자 우회 권한과 이름 변경을 제공하지 않는다.
- **비로그인/게스트:** 인증된 사용자 기반 설정 API에 접근할 수 없다.

### 6.3 direct/group host의 변경 조건

아래 조건은 **새 설정 변경 권한에 대한 제안**이며 기존 채팅 접근 전체의 동작이라고 설명하지 않는다.

1. session 유형은 `session_managed`로 거부한다.
2. direct/group의 host가 null이면 `host_missing`으로 거부한다.
3. 요청자 ID가 `ChatRoom.host_id`와 다르면 `not_host`로 거부한다.
4. 현재 DB 사용자 role이 counselor 또는 org_admin이 아니면 `role_not_allowed`로 거부한다.
5. host에게 role이 counselor/org_admin이고 status가 active인 기관 멤버십이 최소 1개 있어야 한다. 없으면 `membership_required`로 거부한다.
6. direct 상대 또는 group 등록 참여자 각각에 대해 기존 생성 정책인 `ClientCounselorLink 존재 OR _share_org(host, participant)`를 확인한다. 식별 대상이 없거나 하나라도 충족하지 못하면 `participant_scope_invalid`로 거부한다. 내담자 ID가 손상된 direct 역시 이 사유로 거부한다.

기존 연결 허용 경로를 유지하므로 “동일 기관만 허용”이라고 표현하지 않는다. active 멤버십이 전혀 없는 host의 변경 제한은 이번 설정에 추가하는 정책이다. 연결의 active 상태만 허용하는 등 기존 Link 판단을 바꾸려면 별도 정책 검토가 필요하다.

ChatRoom에는 기관 귀속 컬럼이 없으므로 임의의 기관을 방 소유 기관으로 추정하거나 기관 관리자에게 일괄 수정 권한을 주지 않는다. 근거: `backend/app/models/chat.py:13-25`. 여러 기관의 참여자를 포함한 기존 group은 각각의 연결/공유 기관 조건을 검사하며 새로운 단일 기관 조건을 만들지 않는다.

## 7. 엣지케이스와 검증 기준

1. **빈 이름/공백/null/누락:** 422, 기존 이름 유지. 정상 이름의 앞뒤 공백만 제거한다. 120자 성공, 121자 실패를 한글·이모지 포함 검증한다.
2. **기존 미설정 이름:** 조회는 허용하고 fallback을 표시한다. 빈 값 저장은 허용하지 않는다. direct의 레거시 UUID가 입력이나 제목에 노출되지 않는다.
3. **권한 없는 사용자:** 버튼 숨김만으로 보호하지 않는다. 내담자·타 host·타 기관 관리자·플랫폼 관리자 직접 PATCH는 403. 같은 기관의 다른 내담자가 direct 설정 GET에 접근해도 403.
4. **권한이 도중에 바뀜:** 모달에서 편집 가능했더라도 저장 시 host/role/멤버십/참여자 조건을 다시 확인한다. 실패 시 서버 값과 권한을 재조회하고 입력은 복사 가능한 상태로 보존한다.
5. **session 방:** 모든 상태에서 PATCH 금지. 모달의 정보 조회로 원본 세션 제목·일정이 바뀌지 않는다. 세션 host는 `Session.host_id`로 판단한다.
6. **동일 이름/중복 이름:** 같은 값 재요청은 성공하는 무변경 처리. 다른 방과 이름 중복은 허용하고 방 ID로 식별한다.
7. **동시 편집:** MVP는 마지막으로 성공한 쓰기가 최종값이다. 이름 버전이나 409 충돌 검사는 추가하지 않는다. 이 한계를 안내하고 모달 재열기·창 포커스 시 최신값을 다시 읽는다.
8. **네트워크 실패/중복 클릭:** 한 번만 제출한다. 응답 유실은 GET으로 확인하고 동일 이름 재시도를 허용한다. 실패를 성공으로 표시하지 않는다.
9. **목록·읽음 보존:** 설정 열기만으로 방 경로/activeRoom/읽음 상태를 변경하지 않는다. 저장 응답 반영 시 다른 방 데이터와 최신 읽음 수를 덮어쓰지 않고 이름 관련 필드만 불변 갱신한다. 기존 store의 배열 map 방식 참고: `frontend/src/stores/chatStore.ts:40-49`.
10. **direct 회귀:** 이름 변경 전후 `name(client_id)`, `peer_id`, 방 ID, 재사용 생성 결과, 내담자 목록 조회, 메시지 수신 대상이 동일해야 한다. §1.2의 각 의존부를 검증한다.
11. **손상/삭제된 데이터:** 없는 방은 404. 접근 불가 방의 정보는 반환하지 않는다. 기존 direct 상대 식별 실패나 host 누락은 수정 금지하고 추정값을 저장하지 않는다.
12. **생성 흐름:** 신규 direct의 이름 입력은 저장되고, 기존 direct를 다시 생성 요청해도 이름이 암묵적으로 변경되지 않는다. group 생성·변경의 이름 길이 규칙도 일치시킨다.
13. **정렬 기획과 병행:** 이름 변경은 방 배열 순서·메시지·last_message 관련 필드를 변경하지 않는다. 상대 참여자의 갱신은 §3.3의 재조회 시점 기준이며 즉시 전파로 검증하지 않는다.
14. **기관 멤버십만 있는 내담자:** 현재 목록/진입 제한을 이름 변경 회귀와 구분한다. 이미 노출되는 방은 변경 후에도 동일하게 조회되어야 한다. 연결 기록 없는 내담자에게 목록 설정 진입까지 제공하려면 §1.2의 별도 정합성 작업을 먼저 완료해야 하며, 이번 이름 저장만으로 해결됐다고 판정하지 않는다.

## 8. 구현 Task 목록 — 향후 작업, 이번에는 미수행

### T1. 모델·마이그레이션

- `backend/app/models/chat.py`: direct용 nullable `display_name` 추가. 기존 name 식별값 보존.
- `backend/alembic/versions/<새 revision>_chat_room_display_name.py` **신규 예정**: 컬럼 추가/제거, 기존 ID·group 이름 보존 검증. 실제 revision은 구현 시 발급.

### T2. 스키마·서비스·API

- `backend/app/schemas/chat.py`: `RoomUpdateRequest`, 이름 유효성 검증, RoomResponse의 계산 필드 4개 추가. 생성 이름 규칙도 일치.
- `backend/app/services/chat_service.py`: 공통 설정 권한 계산, direct 실제 당사자 검증, 표시 이름 직렬화, `update_room` 추가. 기존 방 탐색·수신자 결정은 보존. direct 신규 생성 시에만 사용자 지정 이름 저장.
- `backend/app/api/v1/chat.py`: 인증된 PATCH 추가, 같은 권한 계산을 쓰는 GET/응답 연결. 단건 GET의 direct 당사자 검사 반영.
- `backend/tests/test_chat.py`: §7의 API·권한·회귀 시나리오 추가. 기존 테스트는 조회/전송/읽음 및 오류 응답을 다룬다. 근거: `backend/tests/test_chat.py:58-178`, `backend/tests/test_chat.py:219-346`.

### T3. 프론트 공통 계약·상태

- `frontend/src/lib/api/chat.ts`: 응답 타입 확장, `UpdateChatRoomPayload`, `updateChatRoom()` 추가.
- `frontend/src/stores/chatStore.ts`: 방 ID 기준 이름 관련 필드 갱신 액션 추가. 메시지/읽음/다른 방 데이터 보존.
- `frontend/src/lib/chat-room-label.ts` **신규 예정**: 서버 display_name 우선 사용 및 이전 응답에 대한 유형별 fallback 공통화. direct name은 fallback으로 사용하지 않음.

### T4. 설정 모달·목록 진입

- `frontend/src/components/chat/room-settings-modal.tsx` **신규 예정**: GET 로딩·읽기 전용 정보·이름 입력·검증·PATCH·오류·포커스 처리.
- `frontend/src/components/chat/room-actions-menu.tsx` **신규 예정**: 공통 ⋯ 메뉴, 키보드 접근성, 방 선택과 이벤트 분리.
- `frontend/src/pages/chat/ChatPage.tsx`, `frontend/src/pages/client/ClientChatPage.tsx`: 목록 진입점 및 공통 모달 연결, 표시 제목 일치, 창 포커스/재진입 재조회. 기존 내담자 상담사 연결 안내 조건은 별도 이슈로 남겨 이 기능에서 임의 변경하지 않음. 해당 조건 근거: `frontend/src/pages/client/ClientChatPage.tsx:63-66`, `frontend/src/pages/client/ClientChatPage.tsx:119-139`.
- `frontend/src/components/chat/CreateRoomModal.tsx`: 신규 direct 이름 저장 계약 안내, 공통 길이·공백 검증 연결.
- 연관 제목 소비처 `frontend/src/pages/client/ClientChatListPage.tsx:117-125`, `frontend/src/pages/client/ClientSessionListPage.tsx:385-405`: 표시 이름 일관성 점검. 상담사 찾기용 peer_name과 공유 방 제목을 분리하고 사용자 지정 이름으로 상담사를 매칭하지 않도록 유지. 실제 사용 경로 확인 후 필요한 표시부만 반영.

### T5. 검증·문서화

- 신규 모달·메뉴·표시 이름 유틸리티 테스트: 정보 조회, 저장, 403/422/통신 오류, 키보드 조작, direct UUID 비노출, 읽음 불변.
- 상담사/내담자 화면의 목록 → 설정 → 이름 변경/읽기 전용 흐름을 브라우저에서 확인. 상대 사용자는 재조회 후 공유 이름이 보이는지 확인.
- backend 채팅 대상 테스트, 프론트 대상 테스트, 프론트 빌드 실행 후 범위에 맞게 회귀 검증. 여기에는 실행 결과를 미리 기재하지 않는다.
- 실제 구현 전 프로젝트 SDD 절차에 맞게 spec/plan/verify를 작성하고 승인된 범위로 진행한다. 이 문서는 Phase 1 기획 산출물이며 구현 완료 또는 승인 기록이 아니다.

## 9. 검토할 제안 정책 요약

- direct/group의 공유 이름은 실제 host만 변경하며 기관 관리자 우회와 내담자 개인 별칭은 제공하지 않는다.
- session 설정은 조회 전용이다.
- direct 식별용 name을 보존하고 nullable 표시 이름 컬럼을 추가한다.
- 참여자 관리는 후속 범위다. 이번에는 기존 데이터로 방 정보를 표시한다.
- 코드 근거는 로컬 파일로 확인했다. 운영 DB·실제 API·브라우저 동작은 이번 문서 작성에서 검증하지 않았다.
