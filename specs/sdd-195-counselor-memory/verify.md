# [SDD-195] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: counselor_context에 최근 대화가 포함
1. 상담사가 루시에게 메시지 전송
2. `counselor_context(상담사, db)` 호출
- **Expected:** `recent_messages` 에 최근 메시지가 시간순으로 포함(최대 20개)

### TS2: counselor_context_to_text에 블록
1. recent_messages 있는 context 로 직렬화
- **Expected:** "■ 최근 대화" 블록 + sender/content 한 줄씩

### TS3: 기존 규칙 의도 응답 회귀 없음
1. "오늘 일정", "<이름> 지난 요약", "브리핑 시간" 질문
- **Expected:** 기존 규칙 응답 그대로 (recent_messages 추가가 회귀 유발 안 함)

## Edge Cases
- [ ] 대화방 없음 → 빈 목록
- [ ] 20개 초과 → 최근 20개만
- [ ] 빈 content 제외

## Security Review
- [ ] 내담자 이름 등은 기존 counselor_context 와 동일 수준(이미 LLM 경유)
- [ ] 상담사 본인 대화방(channel=counselor)만 조회 — 타 상담사 대화 불가
