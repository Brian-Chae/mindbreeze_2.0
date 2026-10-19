# SDD-216 — 입장·요청 취소·알림 연결

- 구현 전 기대값 기록. 기존 verify V-06 및 API 계약을 따른다.
- 전체 BE/FE 회귀와 빌드는 실행하지 않는다. 파일별 초점 Vitest만 사용한다.

| Task | 소유 파일 | 기대값 | 검증 |
|---|---|---|---|
| E1 | lib/api/client.ts, class-structure.ts의 read 한 줄 | 외부 signal 실제 fetch 전달, 즉시 취소·refresh 대기 취소 후 재시도 없음, timeout 408 유지 | 요청 취소 단위 테스트 |
| E2 | lib/api/class-code.ts, pages/class/CodeEntryPage.tsx | 공개 코드 해석 후 로그인 회원 가입, 미래 일정도 가입 가능. 404만 기존 단건 코드로 복귀, 403·429 숨기지 않음. 코드 URL/저장소 기록 없음 | 코드 API 및 화면 테스트 |
| E3 | lib/api/notifications.ts, lib/notification-format.ts, lib/native/push.ts | class_id 기반 회원 sessionId·강사 회차 경로, request_id 보존, 기존 상담·세션 경로 유지 | 알림 경로 테스트 |

- 신규 테스트는 frontend/tests/sdd216-entry-*.test.*에 한정한다.
- 상위 워크트리·BE·배포·다른 트랙 파일은 수정하지 않는다.
