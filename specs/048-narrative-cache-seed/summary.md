# SDD-048 Summary — 서사 캐시 pre-seeding + 주기적 업그레이드

## 구현 결과
- `narrative_cache.py`: `source`(rule/llm) + `updated_at` 컬럼 추가
- `report_narrative.py`: `seed_narrative_cache` — 규칙 기반으로 대표 패턴 캐시 채우기 (source='rule')
- `upgrade_narrative_cache.py`: `upgrade_rule_narratives` — source='rule' 항목을 force_refresh LLM으로 일부씩 업그레이드
- Alembic 마이그레이션 e036a0000004

## 핵심
- 초기 pre-seeding: 규칙 기반(비용 0)으로 캐시 채워 첫 세션부터 캐시 히트
- 주기적 업그레이드: source='rule' 항목을 소량씩 LLM으로 재생성 (비용 분산, 품질 점진 향상)

## 검증·배포
- BE pytest 407 passed (신규 6)
- 커밋 `9d8b51f` → Deploy Dev `34934651391` 성공
