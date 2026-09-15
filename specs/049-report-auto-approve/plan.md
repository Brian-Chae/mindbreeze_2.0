# SDD-049 Plan — 리포트 자동 승인 토글

## 워커: BE(codex) + FE(cursor) 병렬

### BE (codex)
- T1. User.auto_approve_report 컬럼 + Alembic 마이그레이션
- T2. generate_report 자동 승인 (approve_report 재사용)
- T3. GET/PATCH /reports/auto-approve 설정 API

### FE (cursor)
- T1. ReportListPage 우상단 자동/수동 승인 토글 스위치
- T2. 설정 조회 + PATCH 연동

## 완료 기준
- 자동 승인 ON → 생성 즉시 completed+sent_at
- BE pytest, FE build 0 error
