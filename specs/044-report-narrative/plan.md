# SDD-044 Plan — 서사 규칙 기반 자동화 + 샘플 개선

## 워커: 단일 FE (cursor)

### T1. narrative.ts (규칙 기반)
- `frontend/src/lib/report/narrative.ts`: 변화량 → 방향성 → 문장 매핑 + 종합 여정 조합
- 순수 함수, AI/API 호출 없음

### T2. ReportSamplePage 개선
- SDD-043 디자인(보라/그린 크림, 서사형, 변화량 중심) 적용
- 하드코딩 문장 → narrative.ts 사용
- 섹션: 종합 여정 → 몸의 변화 → 마음의 변화 → 마무리

## 완료 기준
- build 0 error, 규칙 기반 서사 + SDD-043 디자인 반영
