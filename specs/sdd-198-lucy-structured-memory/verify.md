# [SDD-198] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: 체크인 마무리 시 구조화 기억이 저장된다
1. 내담자가 "딸 이서, 아들 이준이 있어요" 대화 → 체크인 마무리
2. `AgentMemoryItem` 조회
- **Expected:** `fact` 카테고리 "자녀"="이서(딸), 이준(아들)" 저장

### TS2: 같은 키는 최신 값으로 갱신
1. 첫 대화 "자녀 이서", 이후 "이준도 태어났어요"
2. 재추출
- **Expected:** (client_id, category, key) 중복 없이 최신 값으로 갱신

### TS3: client_context에 구조화 기억 포함
1. 기억 있는 내담자로 `client_context` 호출
- **Expected:** `structured_memories` 포함, `context_to_text` 에 "■ 기억" 블록

### TS4: 진단·점수는 저장 안 됨
1. "우울증인 것 같아요" 대화 추출
- **Expected:** agent_guard 통과분만 저장, 진단·점수 표현 없음

## Edge Cases
- [ ] 기억 0개 → 빈 목록, 블록 생략
- [ ] LLM 키 없음/실패 → 폴백(빈 결과), 크래시 없음
- [ ] key 최대 80자·value 최대 300자 초과 시 절단

## Security Review
- [ ] 진단·점수·민감 표현은 agent_guard 로 차단
- [ ] 본인(client_id) 기억만 조회
- [ ] 기억은 루시 대화에만 노출, 상담사 프로파일과 분리
