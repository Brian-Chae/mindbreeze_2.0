# SDD-235 — Verify

> FE 항목은 프론트 워커가 추가한다. 아래는 BE 항목(구현 전 작성).

## BE
- [ ] BE-1 호스트가 회원의 손을 내림 → 200, raise_hand=false, lowered_by="host"
- [ ] BE-2 호스트 내리기 후 speaking 값 유지(발언 중이면 true 그대로)
- [ ] BE-3 호스트 내리기 멱등: 이미 내려간 상태 재호출 200, 통지 없음
- [ ] BE-4 다른 회원(타인)이 내리기 → 403, 손 유지
- [ ] BE-5 비진행 로그인 사용자(다른 상담사 등)가 내리기 → 403
- [ ] BE-6 본인 내리기(로그인/입장 자격) 기존대로 200, lowered_by="self"
- [ ] BE-7 자격 없음 401, 종료 세션 400(호스트 호출 포함), 세션 불일치 404
- [ ] BE-8 호스트 내리기 시 `_notify_speaking_changed` 1회 호출
- [ ] BE-9 기존 test_sdd094_speaking_rights 전체 회귀 통과, 마이그레이션 없음
