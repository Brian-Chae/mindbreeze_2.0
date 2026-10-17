# 워커 BE-1 — 호스트 판정·역할 가드·R6-X1·서버 문구 (직렬)
공통 브리프 `impl-brief-common.md` 를 먼저 읽는다. worktree: `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd211-be1` (브랜치 `sdd/211-be1`).
Task 순서(직렬, plan §3·§4.2): **G0 → A0 → T0-BE → X1 → A1 → A2 → A3 → R1 → X2 → T4**. 각 Task 완료 기준·소유 파일·테스트 ID 는 plan §3.1~3.6 / verify.
- G0: 백엔드 기준선(전체 `pytest -q` CI 제외 항목 동일)을 `specs/sdd-211-class-structure-phase0/baseline-be.md` 에 기록(통과/실패/스킵, 실패 파일명). 실패가 많으면 상위 원인만.
- **C3 골든(BE-2 가 만듦)이 A3 보다 먼저 커밋돼야 하는 의존**: A3 착수 전에 `git -C <be2 worktree> log` 로 C3 커밋 존재를 확인하고, 없으면 대기하지 말고 A3 직전 단계까지 먼저 진행한 뒤 보고. (병합은 감독자가 한다.)
- R1·X2: **확정 결정 반영** — 역할 가드 3역할(counselor·org_admin·platform_admin), 리포트 `리뷰 중`(U1=B: 행 유지, 본문·지표 10개·코멘트 초안·generation_error·pdf_url 마스킹, `in_review` 가산, 상세 마스킹 200 + `is_read` 불변, `mark_all_read` 승인분만, `recent_report` 가산), **U3 변경: `report_generation_failed` 알림은 호스트에게만**(회원 대상 중단, 테스트 먼저). 계약 스냅샷 예외는 등록하지 않는다(CS-11 키 보존).
- role=client 로 세션을 만들던 기존 테스트가 있으면 role 을 임의로 바꾸지 말고 목록화해 보고.
