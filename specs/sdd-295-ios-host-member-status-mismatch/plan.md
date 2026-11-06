# SDD-295 Plan
1. 서버 기록 조회(읽기)로 회차별 스트림·ledger·outbox·windows 확인 → 원인 확정.
2. 판정 코드 대조(spec §3).
3. RED: `frontend/tests/sdd295-member-ring-server-confirm.test.ts` (수정 전 3건 실패 확인).
4. GREEN: `member-player-case.ts`(입력·waitingText), `MemberStage.tsx`, `MemberClassContainer.tsx`(serverConfirmed 주입).
5. `tsc -b`, 관련 vitest 회귀.
