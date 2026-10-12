# SDD-047 Summary — LLM 서사 시그니처 캐시

## 구현 결과
- `narrative_cache.py`: `NarrativeCache` 모델 (signature String(6) PK → narrative JSONB)
- `report_narrative.py`: `build_narrative_signature` — 6지표 방향성(↑/↓/→) → 6자리 시그니처
- `summary_task.py`: `_call_narrative_llm`에 캐시 조회/저장
  - 히트: `db.get(NarrativeCache, signature)` → 저장된 서사 반환 (LLM 스킵)
  - 미스: LLM(Deepseek→Gemini) → `db.merge`로 캐시 저장
  - 실패: 규칙 폴백도 캐시 저장
- Alembic 마이그레이션 `e036a0000003_add_narrative_cache`

## 핵심
- 같은 방향 패턴 → 기존 서사 재사용 (LLM 호출 0건, 비용·지연 0)
- 유한 패턴(3⁶=729)이라 캐시 크기 작음

## 검증·배포
- BE pytest 401 passed (신규 4)
- 커밋 `648741c` → Deploy Dev `34932690781` 성공
