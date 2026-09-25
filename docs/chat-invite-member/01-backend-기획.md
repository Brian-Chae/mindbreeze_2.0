# 채팅방 회원 초대 — 백엔드 기획

> 2026-09-25 · `docs/chat-invite-member/00-research-brief.md` 기반 백엔드 기획.
> **구현 없음 — 기획 문서만.** 모든 현재 상태 근거는 `파일:라인`.

---

## 1. 배경

현재 채팅 모델은 direct(상담사↔내담자 1:1) + group(상담사 host가 내담자를 초대한 그룹방)이다 (SDD-089/090/091).
이번 기능은 **기존 채팅방에 새 채팅 회원(특히 다른 상담사)을 초대**하는 것으로, 여러 상담사가 함께 참여하는 그룹 명상 세션 채팅방을 만들 때 쓴다. 초대 시 **"기존 대화 유지하고 추가" vs "새 방으로 만들기"**를 선택한다.

### 현재 코드의 한계 (근거)

| 한계 | 근거 |
|---|---|
| `add_room_participants()`는 참여자를 **내담자로만** 검증 — `ClientCounselorLink(host↔대상)` OR `_share_org(host, 대상)` | `backend/app/services/chat_service.py:587-613` |
| `_share_org()`는 상담사의 active 멤버십 org 집합 ∩ **내담자의 `User.org_id`** — 내담자 대상 전용, 상담사↔상담사 판별 불가 | `backend/app/services/chat_service.py:26-45` |
| `create_group_room()`도 참여자를 내담자로만 검증 (동일 Link OR `_share_org`) | `backend/app/services/chat_service.py:208-248` |
| `ChatRoomParticipant`는 `room_id, user_id, joined_at`만 존재 — **role 컬럼 없음** | `backend/app/models/chat.py:55-64` |
| 참여자 관리(추가/내보내기/명단)는 `_ensure_group_host()` → **group 방 + host만** 허용 | `backend/app/services/chat_service.py:573-584` |
| 기존 방을 복사해 새 방을 만드는 경로 없음 (`create_room`은 direct/group 신규 생성만) | `backend/app/services/chat_service.py:251-278` |
| 상담사 후보 조회 API 없음 — `GET /org/{org_id}/counselors`는 **org_admin 전용**이라 일반 상담사가 재사용 불가 | `backend/app/api/v1/org.py:206-213`, `backend/app/api/v1/org.py:41-47` |

---

## 2. 요구사항

- R1. group 방 host(상담사)가 **다른 상담사**를 기존 방에 초대할 수 있다.
- R2. 내담자 초대는 기존 정책(Link OR 공유 기관) **그대로 유지** (하위 호환).
- R3. host는 "기존 방에 추가" 대신 **"새 방으로 만들기"**를 선택할 수 있다 — 기존 참여자 + 새 참여자를 복사한 새 group 방 생성, 대화 이력은 복사하지 않음, 기존 방은 그대로 유지.
- R4. host가 초대 후보 상담사 목록(공유 기관의 active 상담사)을 조회할 수 있다.
- R5. 참여자 명단에서 상담사/내담자를 구분해 표시할 수 있다 (프론트 요구).
- R6. 기존 API의 동작·응답 스키마는 변경·삭제 없이 **추가만** 한다.

---

## 3. 초대 가능 대상 정의

### 3-1. 상담사 초대 (신규)

초대 대상 상담사 `T`가 초대자(host) `H`와 **같은 기관에 active 소속**이어야 한다.

| 검증 항목 | 기준 | 근거 |
|---|---|---|
| 대상 역할 | `User.role ∈ {counselor, org_admin}` (org_admin도 상담 역할 수행 — 멤버십 role은 counselor/org_admin 두 가지뿐) | `backend/app/models/user.py:38`, `backend/app/models/user_org_membership.py:27-28` |
| 대상 계정 상태 | `User.status == 'active'` (suspended/pending 초대 불가) | `backend/app/models/user.py:43` |
| 공유 기관 | `H`의 active `UserOrgMembership.org_id` 집합 ∩ `T`의 active `UserOrgMembership.org_id` 집합 ≠ ∅ | `backend/app/models/user_org_membership.py:17-37` |

내담자 판별에 쓰는 기존 `_share_org()`는 내담자 쪽이 `User.org_id`(단일)라서 (`chat_service.py:32-35`) 상담사↔상담사에 재사용할 수 없다. **양쪽 모두 멤버십 집합**으로 비교하는 신규 헬퍼 `_share_org_counselor(host_id, counselor_id, db)`가 필요하다. 멤버십 status는 `invited/active/left` 중 **active만** 인정한다 (`user_org_membership.py:29-30`).

### 3-2. 내담자 초대 (기존 유지 — 하위 호환)

현행 그대로: `ClientCounselorLink(counselor_id=host, client_id=대상)` 존재 **OR** `_share_org(host, 대상)` 통과 (`chat_service.py:600-609`). 이 분기는 코드·에러 메시지("연결되지 않은 내담자가 포함되어 있습니다", `chat_service.py:609`) 모두 변경하지 않는다.

### 3-3. 대상 role 판별 방식

요청 스키마에 role을 받지 않고, **서버가 `User.role`로 분기**한다:

- `role == 'client'` → 3-2 내담자 검증 (기존 경로)
- `role ∈ {counselor, org_admin}` → 3-1 상담사 검증 (신규 경로)
- `role == 'platform_admin'` 또는 사용자 없음 → 403/404

이렇게 하면 기존 프론트가 보내는 `POST /chat/rooms/{id}/participants` + `participant_ids`(내담자만) 요청이 코드 경로까지 동일하게 유지된다 (`backend/app/api/v1/chat.py:74-85`, `backend/app/schemas/chat.py:39-41`).

---

## 4. 초대 권한 (누가 초대할 수 있나)

**group 방의 host(상담사)만.** 기존 `_ensure_group_host()`(group + host 검증, `chat_service.py:573-584`)를 그대로 사용한다.

- **기관 관리자(org_admin) 우회 없음**: SDD-090의 이름 변경 권한 설계와 동일 기조 — "direct/group은 실제 host(상담사)만 허용. 기관·플랫폼 관리자 우회 없음" (`chat_service.py:350-363`). org_admin이라도 **본인이 host인 방**에서만 초대 가능.
- **초대된 상담사(참여자)는 초대 불가**: 참여자 관리 계열 API는 전부 host 전용으로 유지 (`chat_service.py:616-653`). 참여자 상담사가 확장이 필요하면 host에게 요청하거나 새 방을 직접 만든다.
- **host role 명시 검증 추가**: 현재 `create_group_room`/`add_room_participants`에는 host의 `User.role` 검사가 없다 (내담자 host는 Link/`_share_org` 검증에서 사실상 403으로 걸러질 뿐). 상담사 초대 경로가 추가되면 검증 우회 면적이 넓어지므로, 신규/확장 함수에서 `host.User.role ∈ {counselor, org_admin}`을 명시적으로 검사한다.

---

## 5. "기존 대화 유지 vs 새 방" 백엔드 로직

프론트가 초대 확정 시 둘 중 하나의 API를 호출한다. 백엔드에 "선택" 상태는 없다 — 서로 다른 두 연산일 뿐이다.

### 5-1. 기존 방에 추가 = `add_room_participants` 확장

`POST /chat/rooms/{room_id}/participants` (기존 엔드포인트, `api/v1/chat.py:74-85`) 유지. 서비스 로직만 확장:

```
add_room_participants(room_id, user_id, participant_ids, db):
  room, uid = _ensure_group_host(...)          # 기존 그대로 (chat_service.py:589)
  for pid in participant_ids:
      본인/기존 참여자 → skip                    # 기존 그대로 (chat_service.py:596-599)
      target = User 조회 (없으면 404)
      if target.role == 'client':
          기존 검증: Link OR _share_org          # 기존 그대로 (chat_service.py:600-609)
      elif target.role in ('counselor', 'org_admin'):
          신규 검증: target.status=='active' AND _share_org_counselor(uid, target)
          실패 시 403 "같은 기관에 소속된 상담사만 초대할 수 있습니다"
      else:
          403
      ChatRoomParticipant(room_id, user_id) 추가  # 기존 그대로 (chat_service.py:610)
```

- 대화 이력은 그대로. 새 참여자는 방의 모든 과거 메시지를 볼 수 있다 (`list_messages`는 참여자 여부만 검사, `chat_service.py:656-669`).
- 추가된 상담사는 이후 접근·메시지 수신·방 목록에 **추가 변경 없이** 포함된다: `_ensure_member`의 group 분기는 `ChatRoomParticipant` 행만 본다 (`chat_service.py:133-146`), 수신자 계산도 participants 전체 (`chat_service.py:686-696`), 방 목록도 participant 기준 (`chat_service.py:495-500`).

### 5-2. 새 방으로 만들기 = 복제 생성 (신규 `fork_group_room`)

`POST /chat/rooms/{room_id}/fork` (신규). 로직:

```
fork_group_room(room_id, user_id, participant_ids, name, db):
  room, uid = _ensure_group_host(room_id, ...)   # 원본 방도 group + host 전용
  기존 참여자 = ChatRoomParticipant where room_id  # 재검증 없이 그대로 승계
  새 참여자   = participant_ids 각각 5-1과 동일한 role 분기 검증
  전체 = (기존 ∪ 새) - host, 최소 1명 (아니면 422)
  새 ChatRoom(room_type='group', host_id=uid, name=name or 원본 display 이름 + " (새 채팅)")
  전체를 ChatRoomParticipant로 insert
  return _serialize_room(새 방)
```

정책 결정:

| 항목 | 결정 | 근거/이유 |
|---|---|---|
| 대화 이력 | **복사하지 않음** | 브리프 §3 확정. 새 방은 `ChatMessage` 0건으로 시작 |
| 기존 방 | **그대로 유지** (보관/삭제/알림 없음) | `ChatRoom`에 archived/status 컬럼이 없고 (`models/chat.py:13-27`) 보관 개념 도입은 이번 범위 밖. host가 원하면 기존 방을 계속 사용 |
| 기존 참여자 재검증 | **하지 않음** | 원본 방 생성/추가 시점에 이미 검증된 자격 (`chat_service.py:217-233, 600-609`). Link 해제·기관 탈퇴로 현재 검증을 못 통과하는 기존 참여자가 있어도 승계 — 기존 방에서도 자동 제거하지 않는 것과 일관 |
| 새 참여자 0명 fork | **422** — 참여자 변화 없는 복제는 초대 기능의 목적 밖 | `create_group_room`의 "참여자 1명 이상" 검증과 동일 기조 (`chat_service.py:215-216, 234-235`) |
| 중복 fork | **허용** (같은 구성의 group 방 여러 개 가능) | group 방은 direct와 달리 유니크 제약이 없음 (`chat_service.py:236-247` vs direct의 기존 방 재사용 `chat_service.py:172-194`) |
| direct 방 fork | **이번 범위 제외** (group 전용) | 초대 진입점이 그룹방 설정 모달(`frontend/src/components/chat/RoomSettingsModal.tsx`)이고 `_ensure_group_host` 재사용. direct→group 승격은 후속 확장으로 §9에 기록 |

---

## 6. `ChatRoomParticipant.role` 컬럼 추가 여부 — **추가하지 않음**

**판단: 컬럼을 추가하지 않고 `User.role` JOIN으로 구분한다.**

근거:

1. **파생 정보의 중복 저장**: 참여자가 상담사인지 내담자인지는 `User.role`(`models/user.py:38`)이 이미 갖고 있다. `ChatRoomParticipant`에 복사하면 role 변경(예: counselor↔org_admin 전환, `org.py:288` update_counselor) 시 불일치가 생긴다.
2. **조회 비용 증가 없음**: 참여자 명단 조회는 이미 `User`를 JOIN하고 있다 (`chat_service.py:639-645`). SELECT 컬럼에 `User.role`만 추가하면 된다.
3. **권한 판단에 불필요**: 접근 제어(`_ensure_member`)·수신자 계산(`_resolve_recipients`)·읽음 처리 어디에도 참여자 role이 필요 없다 — 전부 `ChatRoomParticipant` 행 존재 여부만 본다 (`chat_service.py:136-146, 691-696`).
4. **마이그레이션 불필요**: Alembic 수동 리뷰 원칙(`.claude/rules/architecture.md`) 하에서 스키마 변경 없는 설계가 배포 리스크도 낮다.

대신 **응답 스키마에만** role을 노출한다: `RoomParticipantOut`(`schemas/chat.py:44-48`)에 `role: str` 필드 추가 (조회 시점의 `User.role` 값). 프론트는 이 값으로 상담사/내담자 뱃지를 그린다.

> 반론 검토 — "초대 시점의 자격을 스냅샷해야 하지 않나?": 참여 자격의 원천은 Link/멤버십이지 role이 아니고, 자격 상실 시에도 참여자를 자동 제거하지 않는 것이 현행 정책이므로 스냅샷의 실익이 없다.

---

## 7. API 설계

### 7-1. `POST /chat/rooms/{room_id}/participants` — 기존 방에 추가 (기존 확장)

- 요청: `RoomParticipantsAddRequest` **변경 없음** (`participant_ids: list[str]`, 1~100개, `schemas/chat.py:39-41`)
- 응답: `RoomResponse` **변경 없음** (`schemas/chat.py:100-119`)
- 변경점은 서비스 내부 검증 분기(§5-1)뿐. 기존 호출(내담자만 담긴 `participant_ids`)은 바이트 단위로 동일하게 동작 — **하위 호환**.
- 오류: `403` 검증 실패(내담자: 기존 메시지 유지 / 상담사: 신규 메시지), `404` 방·대상 없음, `422` 유효성.

### 7-2. `POST /chat/rooms/{room_id}/fork` — 새 방으로 만들기 (신규)

- 요청 (신규 `RoomForkRequest`):

```json
{
  "participant_ids": ["<uuid>", "..."],   // 새로 초대할 대상 1~100명 (필수)
  "name": "그룹 명상 A반"                  // 선택, 미지정 시 서버 기본 이름
}
```

- 응답: `201 Created` + **새 방**의 `RoomResponse` (기존 스키마 재사용, `_serialize_room` 결과 — `chat_service.py:366-413`)
- 오류: `403` 원본 방 host 아님/group 아님(`chat_service.py:579-583` 재사용)·검증 실패, `404` 방·대상 없음, `422` 새 참여자 0명.

### 7-3. `GET /chat/invitable-counselors` — 초대 후보 상담사 조회 (신규)

`GET /org/{org_id}/counselors`가 org_admin 전용(`org.py:206-213`)이라 일반 상담사용 후보 조회 API가 필요하다 (브리프 §2 "상담사 후보 조회 API 없음").

- 권한: 로그인 사용자 중 `role ∈ {counselor, org_admin}` (본인 멤버십 기반이므로 org_id 파라미터 불필요)
- 로직: 요청자의 active `UserOrgMembership` org 집합 → 해당 org들의 active 멤버십 보유자 중 `User.status=='active'` AND `User.role ∈ {counselor, org_admin}` AND 본인 제외
- 응답 (신규 `InvitableCounselorsResponse`):

```json
{
  "counselors": [
    { "user_id": "<uuid>", "name": "김상담", "role": "counselor",
      "org_names": ["마인드센터 강남"] }
  ]
}
```

- `org_names`는 요청자와 **공유하는** 기관 이름만 담는다 (다른 기관 소속 정보 노출 방지 — 프라이버시 최소 노출 원칙, `.claude/rules/data-privacy.md`).
- 쿼리 파라미터 `q`(이름 검색, 선택)는 프론트 검색 UX용으로 지원.

### 7-4. `GET /chat/rooms/{room_id}/participants` — 응답 필드 추가 (기존 확장)

- `RoomParticipantOut`에 `role: str` 추가 (§6). 필드 추가만이므로 하위 호환.
- 권한(host 전용, `chat_service.py:636-638`)은 이번 범위에서 변경하지 않는다 (§9 엣지케이스 E8 참고).

---

## 8. 데이터 변경 사항

| 항목 | 변경 | 비고 |
|---|---|---|
| DB 스키마 | **없음** | role 컬럼 미추가(§6). 신규 테이블 없음. Alembic 마이그레이션 불필요 (최신: `e036a0000014_sdd_090_chat_display_name.py`) |
| `ChatRoomParticipant` 데이터 | 상담사 user_id 행이 새로 생기기 시작 | 기존 조회 로직은 role 무관하게 동작하므로 영향 없음 (`chat_service.py:136-146, 495-500, 691-696`) |
| 시스템 메시지 (선택) | 초대/새 방 생성 시 `ChatMessage(type='system', event_type='participants_invited')` 기록 | 기존 `send_system_message`는 session 방 전용(`system_message_service.py:11-12`)이라 재사용 불가 — room 직접 지정 헬퍼 신규 필요. `type='system'`/`event_type`은 모델·스키마가 이미 지원 (`models/chat.py:42,45`, `schemas/chat.py:8`). **v1 권장 포함**(입장 안내가 없으면 새 참여자 입장이 조용히 일어남) |

---

## 9. 엣지케이스

| # | 케이스 | 처리 | 근거 |
|---|---|---|---|
| E1 | 본인(host)을 `participant_ids`에 포함 | skip (기존 동작 유지) | `chat_service.py:598` |
| E2 | 이미 참여 중인 사용자 재초대 | skip (기존 동작 유지) | `chat_service.py:598-599` |
| E3 | 다른 기관 상담사 초대 | 403 "같은 기관에 소속된 상담사만 초대할 수 있습니다" — 기존 내담자용 메시지(`연결되지 않은 내담자…`)를 상담사 실패에 그대로 쓰지 않도록 분기별 메시지 | `chat_service.py:609` |
| E4 | 멤버십 `invited`/`left` 상태의 상담사 초대 | 403 — active 멤버십만 인정 | `user_org_membership.py:29-30` |
| E5 | `suspended`/`pending` 계정 초대 | 403 — `User.status=='active'`만 | `models/user.py:43` |
| E6 | 초대된 상담사가 이후 기관 탈퇴(`left`) | 참여자 **자동 제거 안 함** — 내담자 Link 해제 시에도 자동 제거하지 않는 현행 정책과 일관. host가 수동 내보내기(`DELETE …/participants/{user_id}`) | `chat_service.py:616-633` |
| E7 | 새 참여자의 과거 메시지 unread 표시 | 기존 방 추가 시 새 참여자에게 과거 메시지 전부가 unread로 잡힘(`총 메시지 - 본인 읽음` 계산). 과거 메시지의 `recipient_count`는 발송 시점 스냅샷이라 재계산되지 않음 — SDD-090 내담자 추가와 동일한 기존 동작이므로 이번 범위에서 수정하지 않되 verify 시나리오에 명시 | `chat_service.py:431-440, 739-741` |
| E8 | 초대된 상담사가 참여자 명단 조회 | 403 — 명단 조회는 host 전용 유지. 프론트는 참여자에게 명단 UI를 숨김. 참여자 전체 공개는 후속 확장 | `chat_service.py:636-638` |
| E9 | direct 방에서 초대/fork 시도 | 403 "그룹 채팅방만…" — direct→group 승격(1:1 대화에서 상담사 합류)은 후속 확장 후보로 기록 | `chat_service.py:579-580` |
| E10 | 내담자가 fork/초대 시도 | 403 — host 검증 + host role 명시 검사(§4) | `chat_service.py:582-583` |
| E11 | fork에서 새 참여자 전원이 검증 실패 | 403 (첫 실패 시점에 전체 중단, 부분 생성 없음 — 방 생성 전에 전 대상 검증) | `create_group_room`도 검증 후 생성 순서 (`chat_service.py:217-244`) |
| E12 | 새 방 이름 미지정 | 서버 기본 이름 부여(원본 그룹명 기반). `name` 유효성은 `RoomUpdateRequest`와 동일 규칙(120자, 제어문자 금지) 적용 | `schemas/chat.py:25-36` |
| E13 | 초대 알림 | 신규 참여자에게 `notify_event` 기반 알림(선택, v1 포함 권장). 메시지 수신 알림은 기존 경로가 자동 처리 | `chat_service.py:745-762` |
| E14 | `platform_admin` 초대 | 403 — 초대 가능 role은 client/counselor/org_admin뿐 (§3-3) | `models/user.py:38` |

---

## 10. 구현 Task 목록 (파일 단위, 대략)

SDD 절차(spec → plan → verify → implement)를 따르며, 아래는 plan 단계 입력용 초안이다.

| # | 파일 | 작업 |
|---|---|---|
| T1 | `backend/app/services/chat_service.py` | `_share_org_counselor()` 신규 — 양측 active 멤버십 org 교집합 판별 (§3-1) |
| T2 | `backend/app/services/chat_service.py` | `_validate_invitee(host_uuid, target_uuid, db)` 신규 — `User.role` 분기 검증(내담자=기존 경로 재사용, 상담사=신규 경로) + host role 명시 검사 헬퍼 (§3-3, §4) |
| T3 | `backend/app/services/chat_service.py` | `add_room_participants()` 확장 — 검증부를 T2로 치환하되 내담자 경로·에러 메시지 하위 호환 유지 (§5-1) |
| T4 | `backend/app/services/chat_service.py` | `fork_group_room()` 신규 — 기존 참여자 승계 + 새 참여자 검증 + 새 group 방 생성 (§5-2) |
| T5 | `backend/app/services/chat_service.py` | `list_invitable_counselors()` 신규 — 공유 기관 active 상담사 후보 조회 (§7-3) |
| T6 | `backend/app/services/chat_service.py` | `get_room_participants()` 응답에 `role` 추가 (JOIN 중인 `User`에서 SELECT만 확장, §6) |
| T7 | `backend/app/schemas/chat.py` | `RoomForkRequest`, `InvitableCounselorOut`, `InvitableCounselorsResponse` 신규 + `RoomParticipantOut.role` 필드 추가 (§7) |
| T8 | `backend/app/api/v1/chat.py` | `POST /rooms/{room_id}/fork`, `GET /invitable-counselors` 라우트 추가 (§7-2, §7-3) |
| T9 | `backend/app/services/system_message_service.py` | room 직접 지정 시스템 메시지 헬퍼 신규(선택) — 초대/새 방 생성 안내 (§8) |
| T10 | `backend/tests/` (`test_chat_invite_member.py` 신규) | 상담사 초대 성공/타기관 403/left·suspended 403, 내담자 기존 경로 하위 호환, fork 승계·이력 미복사·기존 방 유지, 후보 조회 권한, E1~E14 시나리오 |

- 프론트(후보 검색 UI·선택 다이얼로그·`forkChatRoom` API 클라이언트)는 `02-frontend-기획.md`(Codex) 범위.
- DB 마이그레이션 Task 없음 (§8).
