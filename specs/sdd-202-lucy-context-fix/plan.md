# SDD-202 Plan — 루시 대화 맥락 상실 수정

> 사후 작성: 구현 완료 후 기록 정리 목적. 구현 전 승인 게이트 아님.

- 근거: `summary.md` 의 원인 분석·수정 내용, 커밋 기록. 아래는 실제 구현 순서를 정리한 것이다.

## 1. 구현 단계 (커밋 순)

| # | 날짜 | 내용 | 주요 파일 | 커밋 |
|---|---|---|---|---|
| 1 | 10-10 | 내담자 채널 최근 N개 메시지를 컨텍스트에 추가(`client_recent_messages`, `recent_messages`, "■ 최근 대화" 블록). SYSTEM_RULES 에 "짧은 인사·동의에 질문 억지 금지", few-shot "고마워 친구" 추가 | `agent_policy.py`, `agent_llm.py` | `8f00a21b` |
| 2 | 10-11 | 인사·감탄사 동문서답 수정(감정 해석 금지 규칙, "안녕??" few-shot, task 문구) | `agent_llm.py` | `10944223` |
| 3 | 10-11 | 첫 채팅 진입 시 키보드 자동 열림 방지, 공감+질문 템플릿 완화 | 프론트, `agent_llm.py` | `a16d4084`, `f535597c` |
| 4 | 10-12 | LLM 실패 시 고정 폴백 제거 — 스트리밍 read 타임아웃 40s, 첫 토큰 전 1회 재시도, `LLMUnavailableError` → SSE `llm_unavailable`, 프론트 [다시 시도] | `agent_llm.py`, `agent_service.py`, 프론트 | `0eae626c` |
| 5 | 10-12 | 상담사 연결 제안형 문구 + `talk_to_counselor` CTA 서버 부착, 타임아웃 60s, 스레드풀 2→4 | `agent_service.handoff_cta` 등 | `5cb7e348` |
| 6 | 10-12 | 거절 시 버튼·제안 반복 방지(`handoff_declined`) | 동일 | `b4847eb3` |
| 7 | 10-12 | 체크인 6턴 고정 종료 폐지(마무리 신호·30분 무응답), 반복 입력 대응(`is_repeated_message`, `REPEAT_TASK`) | `agent_checkin.py`, `agent_llm.py` | `a1bb36ee` |

## 2. 설계 판단

- recent_messages 는 루시와 내담자의 1:1 대화 원문을 프롬프트에 다시 싣는 것이라 새 정보 노출이 아니다. 저장본·상담사 전달 경로는 기존(요약만)을 유지한다.
- 상담사 채널의 `counselor_recent_messages`(SDD-195)와 대칭으로 구성한다.
- 연결 방식은 A(이동만)이므로 "상태 전달"은 말하지 않는다. 대화 요약 전달·동의 확인 단계는 후속(B).

## 3. 테스트 전략

- `test_agent_memory.py`, `test_agent_llm_stream_failure.py`, `test_agent_handoff_cta.py`, `test_agent_checkin_close_repeat.py`, 프론트 `agent-page.test.tsx` 재시도 시나리오.
- 매 단계 `test_agent_*.py` 전체 회귀.
