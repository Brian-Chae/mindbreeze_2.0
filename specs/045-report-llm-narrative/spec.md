# SDD-045 — 실제 리포트 서사형 전환 (LLM 서사 + 서사형 디자인)

> 규칙 기반(narrative.ts) 대신, 기존 LLM 요약 파이프라인(Deepseek→Gemini)을 활용해
> 몸·마음 생체 지표를 서사 문장으로 생성하고, 실제 리포트(ReportDetailPage)에 SDD-043 서사형 디자인을 적용한다.

## 1. 배경

- SDD-043에서 서사형 디자인 기본안(HTML) 완성, SDD-044에서 규칙 기반 서사(narrative.ts)로 샘플에 적용
- 사용자 결정: 규칙 기반 자동화는 뒤로 하고, **일단 LLM 쓰는 기존 버전**으로 실제 리포트를 만든다
- mindbreeze 기존 LLM 파이프라인: `summary_task.py` (Deepseek 1차 → Gemini 폴백), STT 전사 → JSON 요약

## 2. 구현 범위

### T1. 백엔드 — LLM 서사 생성 (BE codex)
- 리포트 생성(report_task) 시, 세션의 몸·마음 지표(변화량)를 LLM에 넘겨 서사 문장 생성
- 기존 Deepseek/Gemini 호출 재사용 (summary_task 패턴)
- 생성할 서사: 종합 여정(한 문단) + 몸의 변화 설명 + 마음의 변화 설명
- 리포트 content에 서사 필드(narrative) 추가

### T2. 프론트 — 서사형 디자인 적용 (FE cursor)
- ReportDetailPage를 SDD-043 서사형 디자인으로 개편
- 섹션: 종합 여정 → 몸의 변화 → 마음의 변화 → 마무리
- LLM 생성 서사 + 지표 변화량(방향성 ↑/↓ + ±%/±단위) 표시
- 점수(0~100) 노출 최소화 (서사 우선)

## 3. 주의
- LLM 실패 시 규칙 기반 narrative.ts 폴백 (이중 안전망)
- mindbreeze 디자인 토큰 (#5F0080, #F5EDFC, #F0F9F5)
- 기존 리포트 계약(content) 하위호환 유지

## 4. 완료 기준
- 리포트가 LLM 서사 + 서사형 디자인으로 표시
- BE pytest 통과, FE build 0 error
