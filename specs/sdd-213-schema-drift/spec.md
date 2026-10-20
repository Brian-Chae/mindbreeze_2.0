# SDD-213 — dev 스키마 드리프트 정리

> 사후 작성: 구현 완료 후 기록 정리 목적. 구현 전 승인 게이트 아님.

- 유형: [Fix]
- 근거: `plan.md`(원인 분석·확정 결정·사전 조회), `verify.md`, `summary.md`, PR #10(2026-10-18), 드리프트 보고서 `specs/sdd-211-class-structure-phase0/drift-report.md`(DR)

## 1. 목적

dev DB 는 과거 `create_all`·수동 DDL 로 만들어져 Alembic 체인이 만드는 DB 와 스키마가 다르다. 어느 쪽에서 시작하든 리비전 하나를 적용하면 같은 모양이 되도록 정리한다. 특히 체인으로 새로 만든 DB(CI·재해복구)에서 `chat_messages.read_by` 가 `varchar(36)[]` 라 앱이 JSON 리스트를 쓰면 실패하는 문제(D-01), Phase 1 M1 의 `users` 변경이 전제하는 `auth_provider NOT NULL`(D-03)을 해소한다.

## 2. 확정 결정 (Brian)

1. dev 전용 컬럼 5개(DR D-11)는 보존한다.
2. 범위는 DB 변경 9항목(DR D-01~D-09). 모델 `Index` 선언·모델 `ondelete` 변경(E-01~E-11)은 제외한다.
3. 정식 릴리즈 전이므로 dev 에 바로 배포한다(Deploy Prod·main 머지 금지).
4. `careers.organization` NULL 행은 빈 문자열 `''` 로 채운다.

## 3. 범위

단일 리비전 `e036a0000052`(`down_revision=e036a0000051`)에 D-01~D-09 를 멱등 가드로 구현한다. 삭제·컬럼 제거 없음, 데이터 보존, `downgrade()` 는 no-op. D-10·D-12·D-13 은 허용 차이라 조치 없음.

## 4. QA (수락 기준)

`verify.md` 참조. 요지: 두 출발점(덤프 복원 DB / 빈 체인 DB)이 `upgrade head` 후 수렴, 데이터 보존, 재실행 멱등, dev 전용 컬럼 5개 보존, 단일 head 유지.
