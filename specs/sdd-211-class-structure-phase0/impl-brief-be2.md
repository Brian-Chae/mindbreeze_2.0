# 워커 BE-2 — 계약 스냅샷·PG 스모크·M0 사전 조회 설계
공통 브리프 `impl-brief-common.md` 를 먼저 읽는다. worktree: `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd211-be2` (브랜치 `sdd/211-be2`).
Task: **C1 → C2 → C3** (골든 = 현재 동작 박제, BE-1 의 A3 보다 먼저 완료·커밋할 것 — 최우선), **P0 → P1**, **P3**, **P4**, **M1**. 
- **P2 는 하지 않는다**(dev DB 읽기 필요 — Brian go 필요). 대신 P2 가 쓸 `backend/tests/fixtures/pg/` 자리와 위생 가드 스크립트·합성 시드 초안·CI 단계 스텁(비활성/조건부)만 준비하고 보고에 "P2 대기"로 적는다. P1 의 "일부러 깨뜨린 리비전으로 잡 실패 확인(머지 금지)"은 푸시 금지이므로 **로컬에서 `act` 불가하면 PG 로컬 임시 클러스터로 동일 단계를 수동 재현**해 로그로 대체하고 CI 실증은 I1 에서 한다고 명시.
- **M2·M3 는 하지 않는다**(Brian 승인 단계). M1 은 SQL/러너와 러너 단위 테스트, 빈 PG `EXPLAIN` 검증까지. U5=A(커밋 보고서는 전체 합계·분포만), U6(라벨 원문 `platform_admin` 역할 전체에 열람 허용, 커밋 보고서·Linear 제외) 반영.
- 마이그레이션 `30c1bfbc724f` 는 존재 검사 가드로만 멱등화(리비전 id·체인 불변), 결과 테이블 수 62 확인.
