# [SDD-090] — Verification (Pre-Implementation)

## Test Scenarios

### 정렬
- TS1: 메시지 보낸 방이 목록 최상단으로 (last_message_at 내림차순, 0건 방은 created_at 폴백)
- TS2: "세션순" 토글 → 세션 방 `scheduled_at` 내림차순 상단, direct/group은 그 아래 최신 대화순
- TS3: "안읽음 우선" 체크 → unread>0 방 상단 그룹
- TS4: 정렬 모드 localStorage 저장·복원 (새로고침 유지)

### 설정(이름 변경)
- TS5: group host가 PATCH 이름 변경 → 200, display_name 갱신
- TS6: direct host가 PATCH → display_name 변경, `name`(내담자ID) 불변
- TS7: session 방 PATCH → 403 (조회 전용)
- TS8: 비 host(내담자/타 상담사) PATCH → 403
- TS9: 기관 관리자 우회 → 403
- TS10: 빈 이름/공백/121자 → 422

### 참여자 관리 (group)
- TS11: group host가 참여자 추가(기관 멤버십 유효) → 200
- TS12: host가 참여자 내보내기 → 200, 해당자 방 접근 403
- TS13: 비 host가 추가/내보내기 → 403
- TS14: direct/session 방 참여자 API → 403/404

## 수락 기준 (≥3)
- Q1: 정렬 3모드 + 안읽음 우선이 상담사/내담자 양쪽에서 동작
- Q2: 이름 변경 후 direct 방 식별(수신자 결정)이 깨지지 않음
- Q3: 기존 테스트(test_chat.py 17개) 무회귀
