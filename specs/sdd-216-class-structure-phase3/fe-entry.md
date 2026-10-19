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

## 구현 결과

- E1: `apiClient` 모든 요청 옵션에 `signal` 연결. 호출자 취소는 `AbortError`, 기존 시간 초과는 408. 공유 인증 갱신은 유지하되 취소 요청은 즉시 반환하고 인증 재요청·로그아웃 처리에 진입하지 않는다. 클래스 읽기의 실제 fetch도 취소한다.
- E2: 로그인 회원은 공개 부모 코드를 확인한 뒤 가입 버튼을 누른다. 열린 회차 0개도 미래 일정 가입 가능. 1개는 `sessionId` 선택, 2개 이상은 클래스 상세에서 선택한다. 404만 기존 단건 코드 확인으로 이어지고 403·429·가입 오류는 우회하지 않는다. 비회원 기존 개인정보·회차 입장 자격 흐름은 유지한다.
- E3: 클래스 회차 알림은 회원 `?sessionId=`, 강사 회차 경로에 연결한다. 진행자 요청은 강사 링크 `?requestId=`로 보존한다. 실제 강사 회차 푸시 경로를 추가 허용하며 기존 외부 URL·경로 우회 차단은 유지한다. 신규 이벤트 12종 한글 라벨을 추가했다.

## 검증 결과

- TDD: 요청 취소 3건·알림 4건 RED 확인 후 구현. 코드 가입·권한 오류 3건 RED 확인 후 구현.
- 신규 18개: 요청 6개, 코드 8개, 알림 4개.
- 인접 기존 66개 포함 **8파일 84 passed, 2.77초**.
- 실행 파일: `sdd216-entry-request`, `sdd216-entry-code`, `sdd216-entry-notification`, `class-flow-member-entry-views`, `class-flow-member-entry`, `class-flow-notification-target`, `native-push`, `client-notification`.
- 테스트는 fetch·가입 API·인증 상태를 제어한 단위/DOM 검증이다. 실제 BE·푸시 서버·브라우저 시각 검증은 미확인.
- 전체 BE/FE 회귀·빌드 미실행. 통합 빌드는 상위 담당이 한 번 수행한다.
- 임시 테스트 설정 `frontend/.sdd216-entry-vitest.mts`, 캐시 `frontend/.vitest-entry/`는 워커 경로 안에만 생성하며 커밋에서 제외한다.
- 새 정책 결정 없음. `requestId` 쿼리의 요청 강조/선택은 해당 회차 운영 화면 담당의 통합 확인 항목이다.
