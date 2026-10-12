# SDD-049 Summary — 리포트 자동 승인 토글

## 구현 결과
- `user.py`: `auto_approve_report` Boolean 컬럼 (default false) + Alembic 마이그레이션 e036a0000005
- `report_service.py`: `generate_report`에서 host auto_approve ON이면 `approve_report` 재사용 (자동 승인·발행)
- `report_service.py`: get/update_auto_approve_setting
- `reports.py`: GET/PATCH /reports/auto-approve 설정 API (counselor 전용)
- FE: ReportListPage 우상단 자동/수동 승인 토글 스위치 + API 연동

## 핵심
- 자동 승인 ON → 리포트 생성 즉시 completed + sent_at (승인 없이 바로 발행)
- 자동 승인 OFF → 기존 수동 승인 유지

## 검증·배포
- BE pytest 412 passed, FE build 0 error
- 커밋 `05a02a3` → Deploy Dev `34936698507` 성공
