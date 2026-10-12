# [SDD-199] — Verification (Pre-Implementation)

## Test Scenarios
### TS1: 감정 6종 감지
- "요즘 너무 슬프고 눈물이 나요" → sadness
- "내일 발표가 불안하고 걱정돼요" → anxiety
- "상사 때문에 화가 나요" → anger
- "요즘 너무 피곤하고 지쳐요" → fatigue
- "혼자 있으면 너무 외로워요" → loneliness
- "오늘 좋은 일이 있어서 기뻐요" → joy

### TS2: 중립
- "내일 점심 뭐 먹을까요" → neutral, intensity 없음

### TS3: 강도
- "조금 힘들어요" → mild
- "너무 힘들어요" → strong
- "힘들어요" → moderate

### TS4: 오탐 방지
- "화요일에 만나요" → anger 아님 (단어 경계)

### TS5: 프롬프트 반영
- 감정 감지 결과가 "■ 현재 감정" 블록으로 직렬화됨

## Edge Cases
- [ ] 감정 키워드 없음 → neutral
- [ ] 여러 감정 동시 → 최다 매칭 우선
- [ ] 진단·점수 표현 미사용 유지
