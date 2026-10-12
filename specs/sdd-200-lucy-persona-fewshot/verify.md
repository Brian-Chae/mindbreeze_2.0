# [SDD-200] — Verification (Pre-Implementation)

## Test Scenarios
### TS1: few-shot 예시가 프롬프트에 포함
- `build_prompt("(없음)", user_text="...", task="...")` 반환값에 예시 문구 포함

### TS2: 금지 표현 없음
- 예시에 진단명·점수·숫자 척도·조언 표현 없음

### TS3: 어조 기준
- 예시가 2~4문장·존댓말·이모지 없음

## Edge Cases
- [ ] 예시 개수 4~5개 이내(프롬프트 비대화 방지)
- [ ] 기존 SYSTEM_RULES 규칙과 모순 없음
