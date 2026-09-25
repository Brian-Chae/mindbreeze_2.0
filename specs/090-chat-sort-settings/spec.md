# [SDD-090] 채팅방 목록 정렬 + 채팅방 설정(이름·정보 변경) + 그룹 참여자 관리

## Goal
SDD-089로 재적용한 채팅 기능 위에 ① **채팅방 목록 정렬** ② **채팅방 설정(이름·정보 변경)** ③ **그룹 참여자 관리** 3가지를 추가한다.

## Brian 확정 결정 (2026-09-25)
1. **정렬**: 최신 대화순(기본) + 최신 세션순 2모드 + **안읽음 우선(선택 토글)**
2. **설정 권한**: direct/group은 **host(상담사)만** 이름 변경, **session은 조회 전용**, 기관 관리자 우회 없음, 내담자 개인 별칭 없음
3. **참여자 관리**: **MVP 포함** (그룹방 인원 추가·내보내기)

## 요구사항

### 기능 1 — 채팅방 목록 정렬
| ID | 요구사항 |
|----|---------|
| FR-S1 | 방 목록 응답에 `last_message`(content·created_at) + `last_message_at` 추가 (DISTINCT ON 일괄 집계, 비정규화 컬럼 없음) |
| FR-S2 | 서버 기본 정렬 = `last_message_at ?? created_at` 내림차순 |
| FR-S3 | 프론트 정렬 토글: **대화순 / 세션순** + **안읽음 우선** 체크 (상담사·내담자 공통) |
| FR-S4 | 정렬 모드는 localStorage에 저장·복원 (기본 recent_message) |
| FR-S5 | WebSocket 새 메시지 수신 시 해당 방 last_message 갱신 → 목록 재정렬 |

### 기능 2 — 채팅방 설정 (이름·정보 변경)
| ID | 요구사항 |
|----|---------|
| FR-R1 | `PATCH /chat/rooms/{room_id}` 신설 — 이름 변경 |
| FR-R2 | direct/group은 **실제 host(상담사)** 만 변경. session은 **조회 전용**(변경 403) |
| FR-R3 | direct 식별용 `name`(=내담자 ID) 보존 + 신규 `display_name` 컬럼 추가 (nullable) |
| FR-R4 | 응답에 `custom_name`/`display_name`/`can_rename`/`rename_disabled_reason` 계산 필드 추가 |
| FR-R5 | 목록 `⋯` 메뉴 → 설정 모달 (이름 입력·검증·저장, 편집 불가 시 읽기 전용+사유) |
| FR-R6 | 기관 관리자·플랫폼 관리자 우회 권한 없음. 비 host는 변경 불가 |

### 기능 3 — 그룹 참여자 관리 (MVP)
| ID | 요구사항 |
|----|---------|
| FR-P1 | 그룹방 host가 참여자 **추가** / **내보내기** |
| FR-P2 | 그룹 참여자 명단 조회 (`ChatRoomParticipant` 기반, host 전용) |
| FR-P3 | 추가 시 기존 생성 정책(`ClientCounselorLink` OR `_share_org`) 재검증 |
| FR-P4 | direct/session 방은 참여자 관리 제외 (group 전용) |
| FR-P5 | 내보낸 참여자는 즉시 방 접근·메시지 수신 회수 |

## 범위 외 (이번에 하지 않음)
- 내담자 개인 별칭, 방장 위임, session 참여자 변경, 기관 관리자 일괄 수정, 이름 충돌 검사(409), 실시간 소켓 이름 동기화

## 참고 산출물 (기획 단계)
- `docs/chat-sort-settings/01-sort-기획.md` (Claude)
- `docs/chat-sort-settings/02-settings-기획.md` (Codex)
- `docs/chat-sort-settings/00-research-brief.md`
