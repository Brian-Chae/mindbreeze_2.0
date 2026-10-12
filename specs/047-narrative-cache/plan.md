# SDD-047 Plan — LLM 서사 시그니처 캐시

## 워커: 단일 BE (codex)

### T1. narrative_cache 모델 + 마이그레이션
- `signature`(PK str 6) / `narrative`(JSONB) / `created_at`
- Alembic 마이그레이션

### T2. 시그니처 + 캐시 로직
- `_call_narrative_llm`에: 6지표 방향성 → 시그니처 → 캐시 조회 → 히트 시 반환, 미스 시 LLM + 저장
- 규칙 폴백도 캐시 저장

## 완료 기준
- 캐시 히트 시 LLM 0건, 같은 패턴 재사용
- BE pytest 통과
