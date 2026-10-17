# 워커 FE-1 — 용어 사전·내비 키 전환·금지어 가드·리포트 `리뷰 중` 표시
공통 브리프 `impl-brief-common.md` 를 먼저 읽는다. worktree: `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd211-fe1` (브랜치 `sdd/211-fe1`, `frontend/node_modules` 는 원본 심볼릭 링크가 이미 있음 — 없으면 `ln -s`).
Task 순서: **(프론트 기준선 기록 `baseline-fe.md`: vitest 전체·tsc·eslint 실패 목록 — 기존 실패 16건 확인) → T0-FE → T1 → T2 → T3 → X3**.
- X3 는 BE 의 `in_review` 필드 계약(plan TD5·X2)에 맞춰 **타입에 가산(optional)** 로 구현하고, 서버 없이 목 응답으로 테스트(BE 병합은 감독자). 문구는 `리뷰 중` 배지 / `리뷰 중이에요. 확인이 끝나면 알려드릴게요.` (용어 가드 통과 필수). 점수·% 등 금지 규칙 유지.
- 배지 계산식은 통합하지 말 것(plan TD9). `label ===` 비교 0건이 되도록 키로 전환하되 렌더 결과 골든(T0-FE)은 무수정 GREEN.
