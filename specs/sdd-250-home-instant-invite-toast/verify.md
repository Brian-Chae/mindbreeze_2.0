# SDD-250 — Verify (구현 전 QA 체크리스트)

## Test Scenarios

### 서버 (pytest)
- **S1** 열린(`open`/`in_progress`) 회차가 있는 클래스 요약에 `open_session`(id·seq·scheduled_at·started_at·status·host)이 채워진다. Expected: 값 존재, `next_session` 은 기존 의미(미래 회차) 그대로.
- **S2** 열린 회차가 없으면 `open_session` = null. 기존 필드(`has_open_session`, `open_session_id` 등) 값 불변.
- **S3** 즉석 클래스(`scheduled_at = now`)가 `next_session` 에는 안 잡히고 `open_session` 에는 잡힌다.
- **S4** FCM 메시지에 `android.priority=HIGH`, `android.notification.channel_id=mindbreeze_default` 포함. 기존 `notification`·`data` 키 불변(구 앱 호환).
- **S5** `GET /api/v1/classes` 응답 기존 키 전부 유지(가산만).

### 프론트 순수 규칙 (vitest)
- **F1** 우선순위: 진행 중 즉석 > 진행 중 일반 > 입장 중 > 예정(가까운 순). 동순위는 최근 시작 순.
- **F2** 열린 회차가 시작 후 6시간 초과면 후보 제외. 종료(`completed/cancelled`) 제외.
- **F3** 기존 `adaptMixedHome` 동작(미래 회차만, 상담 경쟁, 부분 실패 보존) 회귀 없음.
- **F4** 즉석 카드: 칩 `지금 입장 가능`+`즉석 클래스`, `N분 전에 시작했어요`(1분 미만 `방금`), 버튼 → `/class/{id}/enter`.
- **F5** 이어서 예정된 일정: 1순위 제외 최대 2건.
- **F6** 토스트 큐: 최대 3개 표시, 초과는 `overflow` 카운트, 새 토스트가 이전 것을 덮어쓰지 않음.
- **F7** 같은 알림 id 1회만(소켓+푸시 중복 방지). 같은 회차 클래스 알림 연속 도착은 합침.
- **F8** 노출 시간: 일반 5초, 클래스 초대형 8초. 일시정지 시 타이머 정지.
- **F9** 플레이어 경로(`/sessions/*/player`, 수업 화면)에서는 큐에 안 넣고 `missed` 카운트만 증가, 이탈 시 "놓친 알림 N건" 1개 요약.
- **F10** 현재 보는 채팅방 알림 억제 유지.
- **F11** 클릭 → `resolveNotificationTarget` 이동 + 읽음 + 닫기. 대상 없으면 닫기만. ✕ 는 읽음 처리 안 함.
- **F12** 소켓 `class_invited`/`session_started`/`session_opened` 수신 시 `invalidateClassReads` 호출.
- **F13** 앱 포그라운드 푸시 수신 → 토스트 1회(message_id 가 이미 소켓으로 본 id 면 무시).

### 화면 (Playwright 390×844 로컬 캡처)
- **V1** 1-B·1-C: 칩→제목 8px, 제목→박스 12px, 박스→버튼 12px(실측), 시안과 대조.
- **V2** 토스트가 모바일 헤더 종 아래에 표시, 가로 넘침 0, 터치 영역 44px 이상.

## Edge Cases
- [ ] 열린 회차 여러 개 → 진행 중 우선·최근 시작
- [ ] `open_session` 필드가 없는 구 서버 응답 → 기존 동작
- [ ] 소켓 단절 → 포커스 복귀 재조회 유지
- [ ] 토스트 4개 이상 동시 → overflow 숫자
- [ ] 알림 title 없음 → 토스트 없음(기존)

## Security Review
- [ ] 토스트·푸시에 개인정보 추가 없음(기존 제목·본문만)
- [ ] 딥링크는 `resolveNotificationTarget`/`allowedPushDeeplink` 화이트리스트만
- [ ] 점수·순위·종합 지표 표기 없음
- [ ] 응답 필드 가산만(제거·의미 변경 0), DB 마이그레이션 0
