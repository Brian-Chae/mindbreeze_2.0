# SDD-250 — Verify (Stage ③, 구현 전)

## Test Scenarios

| # | 시나리오 | 방법 | Expected |
|---|---|---|---|
| TS1 | 열린 즉석 회차가 홈 후보 | pytest: 즉석 클래스(in_progress, scheduled_at=now) 요약 | `open_session.id` 가 해당 회차, `next_session` 은 None(기존 의미 유지) |
| TS2 | 6시간 윈도우 | pytest: 열린 회차 scheduled_at=now-7h / now-5h | 7h → `open_session` None, 5h → 값 있음. `has_open_session`·`open_session_id` 는 둘 다 기존대로 true |
| TS3 | 종료/취소 회차 제외 | pytest | `open_session` None |
| TS4 | 호환 | pytest: 기존 필드 키 전부 유지, 신규는 `open_session` 만 | 기존 API 계약 테스트 통과 |
| TS5 | FCM android 블록 | pytest `build_message` | `android.priority=="HIGH"`, `android.notification.channel_id=="mindbreeze_default"`, 기존 notification/data 불변, data 값 전부 문자열 |
| TS6 | 우선순위 | vitest `adaptMixedHome` | 열린 즉석 > 열린 일반 > 예정(가까운 순). 같은 회차 중복 없음 |
| TS7 | 과거 예정 회차 | vitest | 열려 있지 않은 과거 회차는 후보 아님(기존 유지) |
| TS8 | 프론트 윈도우 이중 방어 | vitest: open_session 이 6h 초과 | 후보 제외 |
| TS9 | 홈 카드 렌더 | vitest: 열린 즉석 → `지금 입장 가능`, `즉석 클래스`, 입장 링크 `/class/{id}/enter`, 부제 `n분 전에 시작했어요` | 모두 존재, 점수·순위 문구 없음 |
| TS10 | 이어서 목록 | vitest | 2건 이내, 1순위 제외 |
| TS11 | 칩↔타이틀 간격 | Playwright 390×844 `getBoundingClientRect` | 칩행 하단~타이틀 박스 상단 ≤ 4px, 글자 시각 간격 6~8px(시안과 동일), 타이틀↔박스 ≈16px |
| TS12 | 소켓→재조회 | vitest: `new_notification{target_type:'class'}` | `invalidateClassReads` 호출 1회. 채팅 알림은 호출 안 함 |
| TS13 | 토스트 큐 | vitest 스토어 | 최신 위, 4개 쌓으면 화면 3개 + `hiddenCount=1`. 기존 `toast`(최신)·`showToast`/`dismissToast` API 유지 |
| TS14 | 중복 | vitest | 같은 id 2회 → 1건. 소켓 id = 푸시 message_id 면 1건 |
| TS15 | 합침 | vitest | 같은 클래스·회차 클래스형 알림 2건 → 1건 `count=2` |
| TS16 | 수업 중 억제 | vitest: 경로 `/sessions/x/player` 에서 showToast | 큐 변화 없음, `missed` 증가. 억제 해제 후 `놓친 알림 N건` 토스트 1개 |
| TS17 | 채팅방 억제 유지 | vitest(기존 동작) | 보고 있는 방 알림은 토스트 없음 |
| TS18 | Host 렌더 | vitest | `role=status`, 클래스형 `aria-live=assertive`, 일반 polite, ✕ 동작, 본문 클릭 시 `resolveNotificationTarget` 경로 이동·dismiss, 클래스형에 `입장하기` 버튼 |
| TS19 | 노출 시간 | vitest fake timer | 일반 5초, 클래스형 8초 후 제거. 호버/포커스 중 정지 |
| TS20 | 앱 포그라운드 푸시 | vitest `native-push` | `pushNotificationReceived` → 토스트 콜백 1회(title/body/deeplink), 기존 refresh 호출 유지 |
| TS21 | Android 채널 | vitest `native-push` | Android 에서 `createChannel({id:'mindbreeze_default', importance:5})` 1회, iOS/웹 미호출 |
| TS22 | 회귀 | vitest 전체 | 기준선 8파일 외 신규 실패 0 |
| TS23 | 정적 | tsc, eslint | 0 error |
| TS24 | 시각 대조 | Playwright 캡처: 홈(일정없음/즉석/여러개), 토스트(1/쌓임/클래스형) | 시안과 구도·여백 일치, 390px 가로 넘침 0, 터치 영역 ≥44px |

## Edge Cases
- [ ] 열린 회차와 예정 회차가 같은 클래스에 공존 → 열린 회차 1순위, `이어서`에 예정 회차
- [ ] 열린 회차 host 미배정 → 지도사 `-` 표기, 입장 링크 유지
- [ ] `scheduled_at` 이 null 인 열린 회차 → `started_at` 기준, 둘 다 없으면 제외
- [ ] 구 서버(필드 없음) 응답 → 기존 동작 그대로
- [ ] 토스트 다량(10건) → 화면 3개 + `+N`, 메모리 누수 없음(타이머 정리)
- [ ] 알림 title 없음 → 토스트 생략(기존 동작)
- [ ] 서버가 `class_invited` 를 소켓·푸시 둘 다 보냄 → 1회
- [ ] 로그아웃 시 큐·missed 초기화(`reset`)

## Security Review
- [ ] 토스트 이동은 `resolveNotificationTarget` 화이트리스트/`allowedPushDeeplink` 만 사용(임의 URL 금지)
- [ ] 푸시 본문 비식별 원칙 유지(서버 메시지 본문 변경 없음)
- [ ] 신규 서버 필드에 개인정보 없음(회차 id·시각·진행자 이름은 기존 `next_session` 과 동일 범위)
- [ ] 비밀값·토큰 로그 출력 없음

## 범위 밖(감독 확인)
- dev 서버 배포, 안드로이드 dev 빌드 설치·실기기 확인, 머지.
