# [SDD-194] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: client_context에 기억이 포함된다
1. 체크인을 마무리해 summary 생성
2. `client_context(내담자, db)` 호출
- **Expected:** `memories` 에 summary 항목이 최신순·시간순으로 포함, 최대 100개

### TS2: context_to_text에 기억 블록이 나타난다
1. memories 가 있는 context 로 `context_to_text` 호출
- **Expected:** "■ 지난 대화 기억" 블록 + 각 summary 한 줄

### TS3: 루시 응답이 기억을 참조한다 (회귀 없음)
1. 리포트·일정 있는 내담자가 메시지 전송
2. 루시 응답 확인
- **Expected:** 기존 리포트 대화·감정 대화 동작 유지 (기억이 컨텍스트에 추가되어도 폭주 없음)

### TS4: 체크인 대화 중에도 기억이 로드된다
1. 체크인 열린 내담자가 메시지 전송
2. respond 경로에서 기억 포함 확인
- **Expected:** 프롬프트에 memories 블록 포함, 응답 정상

### TS5: 요약은 agent_guard 통과분만
1. 요약에 진단·점수 표현이 있으면 걸러짐
- **Expected:** 기억에 진단·점수 표현 없음 (기존 sanitize 유지)

## Edge Cases
- [ ] 기억이 0개인 내담자 → memories 빈 목록, 블록 생략
- [ ] 100개 초과 → 최근 100개만
- [ ] 요약이 비어 있으면 제외

## Security Review
- [ ] 기억은 요약만 (원문 아님) — D1 유지
- [ ] 내담자 채널 격리 — 본인(client_id) 기억만 조회
- [ ] 진단·점수 표현은 `agent_guard` 로 차단 유지
