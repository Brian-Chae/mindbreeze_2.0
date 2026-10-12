# SDD-045 Plan — 실제 리포트 LLM 서사 + 서사형 디자인

## 워커: BE(codex) + FE(cursor) 병렬

### BE (codex): LLM 서사 생성
- `summary_task.py`/`report_task.py`에 생체 지표 → 서사 LLM 호출 추가
- Deepseek→Gemini 폴백 재사용, 실패 시 narrative 규칙 폴백
- 리포트 content에 `narrative` 필드 추가 (종합/몸/마음)

### FE (cursor): 서사형 디자인
- ReportDetailPage를 SDD-043 디자인으로 개편
- LLM 서사 + 변화량 표시, 점수 최소화

## 완료 기준
- BE pytest 통과, FE build 0 error
- 리포트가 LLM 서사 + 서사형 디자인 표시
