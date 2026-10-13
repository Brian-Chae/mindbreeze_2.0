# [SDD-203] — Verification (Pre-Implementation)

## Test Scenarios
### TS1: 대화 이력이 실제 턴으로 전달된다
1. history=[user,agent,user] + 현재 입력으로 `build_chat_request` 호출
2. **Expected:** contents가 user/model 교대, 마지막은 현재 입력 user 턴, system에 `최근 대화` 블록 없음
### TS2: 현재 입력 중복 제거
1. DB에 선저장된 마지막 user 메시지 == user_text
2. **Expected:** 마지막 user 턴이 1개만 존재
### TS3: 역할 정규화
1. 선두가 agent, 연속 user 2개, system 메시지 포함 이력
2. **Expected:** 선두 model 제거, 연속 동일 role 병합, system 제외 → Gemini 교대 규칙 충족
### TS4: 요청 본문 구조
1. httpx.stream/post 모킹으로 body 캡처
2. **Expected:** `systemInstruction`·`contents` 사용, temperature 0.9, 기존 prompt 문자열 경로는 기존 body 유지
### TS5: 프롬프트 내용
- **Expected:** COMPANION_SYSTEM에 끝맺음 판단 기준(열린 질문/가벼운 초대/깊은 공감/짧게 받기)·덕담 금지·직전과 다른 끝맺음 포함, "저도 ~했어요" 식 경험 지시 없음, few-shot 없음
### TS6: 문장 경계 컷
- 800자 초과 텍스트 → 마지막 완결 문장에서 끊김(문장 중간 컷 없음)
### TS7: 폴백 보존
- LLM 비활성/예외 시 기존 템플릿 폴백, 체크인 대화 테스트(TS5·TS16) 통과
### TS8: 가드 보존
- 금지 표현 제거(기존 test_agent_checkin_conversation TS5) 통과
### TS9: 회귀
- `pytest -k agent` 전체 통과
### TS10: 실제 모델 비교 (키 있을 때)
- 이번 스크린샷 대화 재현 → 마지막 문장이 덕담 단독으로 끝나는 비율 감소 확인

## Edge Cases
- [ ] 이력 0건(첫 메시지) → contents=[user 1턴]
- [ ] 이력이 전부 agent/system → 선두 제거 후 현재 입력만
- [ ] 빈 content 메시지 건너뜀
- [ ] 위험 신호(risk)·금지 주제 경로는 LLM 미호출 그대로

## Security Review
- [ ] 사용자 입력은 user 턴으로만 전달(시스템 지시와 분리) — 프롬프트 인젝션 방어 유지
- [ ] 로그에 대화 원문 미기록
- [ ] 허용 자료 밖 사실 금지·진단/점수 금지 규칙 시스템 프롬프트에 유지
