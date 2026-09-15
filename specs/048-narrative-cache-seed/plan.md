# SDD-048 Plan — 서사 캐시 pre-seeding + 주기적 업그레이드

## 워커: 단일 BE (codex)

### T1. source 컬럼 추가
- `NarrativeCache`에 `source`(rule/llm) + `updated_at` 추가
- Alembic 마이그레이션

### T2. pre-seeding
- 규칙 기반 `fallback_narrative`으로 대표 패턴(실제 빈도 높은 상위 N개) 캐시 채우는 스크립트/함수
- 배포 시 또는 관리자 명령으로 실행 (source='rule')

### T3. 주기적 업그레이드
- Celery beat 주기 태스크: source='rule' 항목을 일부(예: 매회 N개)씩 LLM으로 재생성 → source='llm'
- 매회 개수 제한 (비용 제어)

## 완료 기준
- BE pytest 통과
- pre-seeding + 주기적 업그레이드 동작
