# SDD-049 — 리포트 자동 승인 토글

> 상담사 승인 절차를 자동화한다. 리포트 목록 우상단에 자동 승인/수동 승인 토글 스위치를
> 배치하고, 자동 승인 ON이면 리포트 생성 즉시 승인·발행한다.

## 1. 배경

- 리포트 상태머신: pending_analysis → pending_review(승인 게이트) → completed
- 현재는 상담사가 수동으로 approve_report 호출해야 completed + sent_at.
- 자동 승인 ON이면 생성 직후 자동 승인·발행.

## 2. 구현 범위

### BE (codex)
- `User` 모델에 `auto_approve_report` Boolean 컬럼 추가 (default false) + Alembic 마이그레이션
- `report_service.generate_report`: 리포트 생성 후 host(상담사)의 auto_approve_report가 True면
  `approve_report` 호출 (자동 승인·발행 — 알림·메일·sent_at 모두 적용)
- 설정 API: GET/PATCH `/reports/auto-approve` (상담사 전용) — enabled 조회/변경

### FE (cursor)
- `ReportListPage` 우상단(rightSlot)에 자동 승인/수동 승인 토글 스위치
- 진입 시 현재 설정 조회, 토글 시 PATCH 호출
- 토글 라벨: "자동 승인" / "수동 승인"

## 3. 주의
- 자동 승인은 counselor 역할만 해당. client/org_admin 등은 노출/적용 안 함
- approve_report 재사용 → 멱등·알림·메일·sent_at 일관성 유지
- 게스트 리포트(user_id 없음)도 정상 처리

## 4. 완료 기준
- 자동 승인 ON → 리포트 생성 즉시 completed + sent_at
- 토글 스위치 정상 표시·변경
- BE pytest 통과, FE build 0 error
