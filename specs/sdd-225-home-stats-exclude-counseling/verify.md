# SDD-225 Verify (구현 전 QA 체크리스트)

- [ ] V1 상담사 홈: 클래스 회차 2 + 상담 세션 1 시드 → `total_classes==2`, `classes` 에 상담 세션 id 없음
- [ ] V2 상담사 홈: `in_progress_classes`·`completed_classes` 가 상담 세션 상태를 세지 않음
- [ ] V3 상담사 홈: 상담 세션의 참여자·검토 대기 리포트가 `total_participants`·`pending_review_count` 에 불포함
- [ ] V4 기관 홈: `total_classes`·`total_participants`·`completed_classes`·`in_progress_classes`·`classes` 가 클래스 회차만 반영
- [ ] V5 기관 홈: `counselors[].class_count/participant_count/completed_count` 가 클래스 회차만 반영
- [ ] V6 HTTP 응답(response_model 통과 후)에 위 필드가 모두 존재
- [ ] V7 상담 세션 없는 기존 시드의 결과 불변(SDD-221 대시보드 테스트 통과)
- [ ] V8 backend 전체 pytest 통과
