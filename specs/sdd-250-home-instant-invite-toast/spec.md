# SDD-250 — 홈 즉석 클래스 초대 실시간 표시·앱 인앱 알림 토스트

- 상태: Stage ① Spec 확정(대표 결정 반영, 2026-10-28) → ②③ 진행
- 브랜치: `sdd/250-home-instant-invite-toast`
- 작성일: 2026-10-28
- 시안: `~/.hermes/share/mb-sdd250-20261028/index.html` (공유 서버 :8001 경유)
- 관련: SDD-226(즉석 클래스), SDD-190·192(푸시), SDD-093(토스트 딥링크), SDD-209(입장 화면)

## 1. 문제

| # | 증상 | 대표 요청 |
|---|---|---|
| A | 상담사가 즉석 클래스(지금 바로 시작)를 만들어 회원을 초대해도, 회원 홈 '다음 일정' 카드는 "예정된 일정이 없어요" 그대로이고 알림 목록에만 쌓인다 | 토스트 → 카드 즉시 표시 → 바로 입장 |
| B | 웹은 알림이 오면 토스트가 뜨지만, 앱(Android)은 푸시뿐인데 푸시가 안 보이는 경우가 많다 | 앱에서도 종 아래 인앱 토스트, 누르면 해당 화면 이동 |

## 2. 목표

1. 즉석 클래스 초대 후 회원이 **새로고침·재진입 없이** 토스트로 알림을 받고, 홈 '다음 일정'에서 **바로 입장**한다.
2. 앱·모바일 웹·데스크톱 웹 **모두 같은 인앱 토스트**(종 아이콘 아래, 누르면 이동)를 쓴다. OS 푸시에 의존하지 않는다.
3. LINK BAND 없이도 동일 동작(기존 원칙 유지).

## 3. 현황 조사 (코드 근거)

### 3-1. 왜 알림에만 쌓이는가 (A)

| # | 사실 | 근거 |
|---|---|---|
| 1 | 즉석 초대는 `class_invited` 알림 1건을 만든다. `extra.params = {start_now:true, session_id}`, 본문에 입장 주소 포함 | `backend/app/services/class_effect_service.py:244-276` |
| 2 | 알림은 DB 저장 + Socket.IO(`new_notification`)로 실시간 전달(outbox ws 채널) | `backend/app/services/notification_service.py:283-300` |
| 3 | 프론트는 `new_notification`을 받으면 **읽지 않은 수·세션 초대 목록·토스트만** 갱신한다. **홈 '다음 일정'이 쓰는 클래스 목록은 갱신하지 않는다** | `frontend/src/hooks/useNotificationSocket.ts:60-92` |
| 4 | 홈 '다음 일정'은 클래스 목록의 `next_session`을 `adaptMixedHome`으로 고른다. 클래스 목록은 **창 포커스·탭 가시성 복귀 시에만** 재조회(`invalidateClassReads`) — 주기 갱신 없음 | `frontend/src/pages/client/member-structure-home-page.tsx:23-25`, `frontend/src/lib/class-structure/invalidation.ts:8-16` |
| 5 | **결정적 원인**: 즉석 회차는 생성 순간 `scheduled_at = now`다. 서버 `_next_session`은 `scheduled_at >= now`(미래)만 후보로 보고, 프론트 `adaptMixedHome`도 `at < now`이면 버린다 → 즉석 회차는 "다음 일정" 후보가 될 수 없다 | `backend/app/services/class_schedule_service.py:15-27`, `backend/app/services/class_read_service.py:151-157`, `frontend/src/lib/class-structure/adapters.ts:137-141` |
| 6 | 서버는 이미 `open_session_id`(열린·진행 중 회차, 진행 중 우선)를 목록에 내려주지만 홈 '다음 일정'은 이 값을 쓰지 않는다 | `backend/app/services/class_read_service.py:163-173,206-212`, `adapters.ts:107-108` |
| 7 | 토스트를 눌러 이동하는 경로는 있다(`/class/{sessionId}/enter`). 홈 카드만 못 따라간다 | `frontend/src/lib/api/notifications.ts:159-167` |

→ 요약: 알림은 실시간으로 오지만 홈 카드의 **데이터 소스(예정 회차만 봄)** 와 **갱신 트리거(포커스 시에만)** 둘 다 즉석 클래스를 못 잡는다.

### 3-2. 웹 토스트는 어떻게 뜨는가

| 항목 | 현황 | 근거 |
|---|---|---|
| 전달 | Socket.IO `/chat` 네임스페이스 `new_notification` (싱글톤 소켓). SSE·폴링 없음 | `useNotificationSocket.ts:25-29,60`, `ClientShell.tsx:90` |
| 상태 | Zustand `notificationStore.toast` **1개만**. 새 알림이 오면 이전 토스트를 덮어씀. 4초 후 자동 닫힘 | `notificationStore.ts:52-58` |
| 억제 | 현재 보고 있는 채팅방 알림만 억제 | `useNotificationSocket.ts:82-84` |
| 표시 위치 | 종 버튼 아래 `absolute top-full right-0 w-72`. **데스크톱 헤더(`hidden md:flex`) 안에만 렌더링 — 모바일 헤더에는 토스트가 없다** | `ClientShell.tsx:176,193-232`, `AppShell.tsx:171-210`, 모바일 헤더 `ClientShell.tsx:111-140` |
| 클릭 | `resolveNotificationTarget(extra, role)` → `navigate` | `ClientShell.tsx:105-112`, `notifications.ts:122-` |
| 서비스워커 | `public/sw.js`는 **웹 푸시(백그라운드 OS 알림)** 전용. 인앱 토스트와 무관 | `frontend/public/sw.js` |

→ **모바일 웹·앱(WebView)은 소켓으로 알림을 받아도 토스트를 그릴 자리가 없다.** 앱에 토스트가 안 보이는 1차 원인.

### 3-3. 앱 푸시 처리 (Capacitor)

| 항목 | 현황 | 근거 |
|---|---|---|
| 등록 | 로그인 후 권한 확인 → 토큰을 `/devices`에 등록. 권한 요청은 **기기당 1회만** 자동(`mb.push.permission-asked`), 이후엔 설정에서 수동 | `lib/native/push.ts:140-160` |
| 포그라운드 수신 | `pushNotificationReceived` 리스너가 **읽지 않은 수만 새로고침**. 토스트·화면 갱신 없음 | `push.ts:126-128` |
| 탭 처리 | `pushNotificationActionPerformed` → 허용 딥링크만 `navigate` | `push.ts:129-133` |
| iOS 포그라운드 | `presentationOptions: ['badge','sound','alert']` 로 배너 허용 | `frontend/capacitor.config.ts:8-10` |
| **Android 포그라운드** | 위 옵션은 **iOS 전용**. Android는 앱이 켜져 있으면 FCM `notification` 메시지를 **시스템이 표시하지 않는다** | Capacitor/FCM 동작, `capacitor.config.ts` |
| 서버 발송 | FCM v1 `notification{title,body}` + `data{deeplink,message_id}`만. **`android.notification.channel_id`·`priority` 없음** | `backend/app/services/push_service.py:97-106`, `tasks/push_task.py:172-185` |
| 푸시 대상 이벤트 | `report_ready, session_invited, class_invited, session_started` + 사용자 push 설정 on | `notification_service.py:224,329-` |

### 3-4. 안드로이드 푸시가 안 보이는 원인 후보 (우선순위 순, 실기기 로그로 확정 필요)

| # | 후보 | 판별 방법 |
|---|---|---|
| 1 | **포그라운드 미표시** — 앱을 보고 있는 상태에서는 Android가 푸시를 안 띄운다. 수업·앱 사용 중 초대가 오는 이번 시나리오와 정확히 일치 | 앱을 닫고(백그라운드) 같은 초대를 보내 보기 |
| 2 | **알림 권한 거부/미요청** — Android 13+ `POST_NOTIFICATIONS`. 자동 요청은 기기당 1회뿐이고 한 번 "허용 안 함"이면 이후 팝업이 안 뜬다 | 설정 → 앱 → 알림 상태 / `[push] 알림 권한 미허용` 로그 |
| 3 | **서버·앱 미설정** — `google-services.json` 없으면 빌드가 플러그인을 건너뜀(조용히 푸시 불가, `android/app/build.gradle:154-161`), 서버 `FCM_PROJECT_ID`/서비스계정 미설정이면 발송 행을 건드리지 않고 로그 1줄(`push_task.py:68`) | 빌드 산출물·서버 로그 `[OUTBOX-PUSH] FCM 미설정` |
| 4 | **채널·중요도 미지정** — 서버가 채널을 지정하지 않아 기본 채널로 가서 헤드업 배너 없이 상태바 아이콘만 뜰 수 있음. 제조사 절전(배터리 최적화)도 영향 | 알림 설정에서 채널 중요도, 헤드업 여부 |
| 5 | **푸시 설정 off / 기기 토큰 만료** — 사용자 push 설정 off 이거나 `UNREGISTERED` 토큰 해지 | `/devices` 등록 이력, 설정 화면 |

→ 결론: 푸시를 고치는 것만으로는 "앱을 보고 있을 때"를 못 막는다. **인앱 토스트가 근본 해법**이고, 푸시 채널·중요도는 백그라운드 보완책이다. (1~5는 코드 근거 기반 후보이며 실기기 로그 확인 전에는 단정하지 않는다.)

### 3-5. 알림 종류별 이동 대상 (`resolveNotificationTarget`, 회원 기준)

| 알림(`target_type`·event) | 이동 | 근거 |
|---|---|---|
| 채팅 `chat_room` | `/app/chat/{roomId}` | `notifications.ts:152-158` |
| 즉석 클래스 초대 `class_invited` + `start_now` | `/class/{sessionId}/enter` (회차 공용 입장 주소) | `notifications.ts:159-165` |
| 일반 클래스 초대·공지 `class` | `/app/classes/{classId}` | `notifications.ts:166` |
| 회차 열림·시작·대기열 승격 `session_opened/started/waitlist_promoted` | `/class/{sessionId}/enter` | `notifications.ts:114,175-178` |
| 회차 변경·초대 `session` | `/app/classes/{classId}?sessionId=…` 또는 `/app/sessions/{id}` | `notifications.ts:179-187` |
| 상담 `counseling` | `/app/counseling/{id}` (비공개 시 `/app/classes`) | `notifications.ts:168-172` |
| 리포트 `report` | `/app/reports?report={id}` (모달) | `notifications.ts:188-` |
| 대상 없음 | 이동 없이 닫기 | `notifications.ts:147` |

푸시 딥링크 허용 목록도 동일 경로를 다룬다(`push.ts:7-21`, 서버 `_push_deeplink` `notification_service.py:228-261`).

## 4. 목표 흐름

```
[상담사] 즉석 클래스 열기 → 회원 초대
   │ 서버: class_invited 알림 + (소켓) new_notification + (푸시 설정 시) FCM
   ▼
[회원 앱/웹 – 어느 화면에 있든]
   ① 종 아이콘 아래 토스트: "지금 시작한 클래스에 초대됐어요 · [입장하기]"
   ② 홈이면 '다음 일정' 카드가 즉시 "지금 입장 가능 · 즉석 클래스"로 바뀜
   ③ [입장하기] 또는 카드 → /class/{sessionId}/enter
```

- 홈 밖에 있어도 토스트는 뜨고, 홈으로 돌아오면 카드가 이미 반영돼 있다.
- 소켓이 끊겨 있어도 홈 진입·포커스 복귀 시 재조회로 보정한다(기존 동작 유지).

## 5. 요구사항

### 5-1. 홈 '다음 일정' 카드 (A)

| # | 규칙 |
|---|---|
| H1 | 후보에 **진행 중·입장 가능 회차**(`open`/`in_progress`, 서버 `open_session_id`)를 포함한다. 과거 `scheduled_at`이라도 열려 있으면 후보 |
| H2 | **우선순위: 진행 중 즉석 클래스 > 진행 중/입장 중 일반 클래스 > 예정(가장 가까운 순)**. 동순위는 최근 시작 순 |
| H3 | 즉석 카드 표기: 칩 `지금 입장 가능`(보라 live 칩) + `즉석 클래스` 칩, 제목, 지도사, `{n}분 전에 시작했어요`, 버튼 `입장하기`(→ `/class/{sessionId}/enter`) |
| H4 | 여러 개: 1순위만 큰 카드, 나머지는 카드 아래 "이어서 예정된 일정 N건" 한 줄 목록(최대 2건, 더보기는 `/app/classes`) |
| H5 | 갱신: `new_notification`(`class_invited`·`session_started`·`session_opened` 등 클래스 계열) 수신 시 `invalidateClassReads()` 호출 → 홈 즉시 재조회. 회차 종료(`completed/cancelled`) 시 카드에서 사라짐(기존 `useSessionLiveSocket` 경로 재사용) |
| H6 | 일정 없음 문구는 기존 유지("예정된 일정이 없어요") |
| H7 | 점수·순위·종합 지표 표시 없음 |

### 5-2. 인앱 토스트 (A·B 공통)

| # | 규칙 | 값 |
|---|---|---|
| T1 | 표시 위치 | 종 아이콘 바로 아래. 모바일: 상단바(56px) 아래 좌우 16px 여백 전체폭. 데스크톱: 종 아래 우측 정렬 폭 360px(현재 288px에서 확대) |
| T2 | 노출 시간 | 일반 알림 5초(현재 4초). **클래스 초대(입장 가능)형 8초**. 손가락/마우스 올리고 있으면 일시정지 |
| T3 | 중복 | 같은 알림 id는 1회만. 같은 클래스·같은 회차 알림이 연달아 오면 하나로 합침("2건") |
| T4 | 여러 개 | 최신이 위. 동시에 최대 3개 쌓아 표시, 초과분은 `+N` 뱃지로 접고 종 배지로 확인. 새 토스트가 이전 것을 덮어쓰지 않음 |
| T5 | 클릭 | 본문 탭 → `resolveNotificationTarget` 이동 + 읽음 처리 + 닫기. 이동 대상이 없으면 닫기만 |
| T6 | 닫기 | ✕ 버튼, 위로 스와이프(모바일), Esc(데스크톱). 닫기만으로는 읽음 처리하지 않음(알림 목록에 남음) |
| T7 | **클래스 진행 중 방해 금지** | 플레이어 화면(`/sessions/*/player`, 입장 후 수업 화면)에서는 **토스트를 띄우지 않고** 종 배지만 올린다. 수업 종료 후 놓친 알림은 "놓친 알림 N건" 1개 토스트로 요약 |
| T8 | 채팅 | 현재 보고 있는 채팅방 알림은 기존대로 억제 |
| T9 | 유형 | ①클래스 초대형(보라 채움 + `입장하기` 버튼) ②일반 알림형(크림 + 보라 악센트 바, 기존 웹 스타일) |
| T10 | 접근성 | `role="status" aria-live="polite"`, 클래스 초대형은 `assertive`. 포커스를 빼앗지 않음. 터치 영역 44px 이상 |
| T11 | 반응형 | 모바일/앱: 상단 고정(safe-area-inset-top 반영). 데스크톱: 종 아래 팝오버 |

### 5-3. 웹/앱 차이

| 항목 | 웹(데스크톱) | 웹(모바일) | 앱(Capacitor) |
|---|---|---|---|
| 전달 | 소켓 | 소켓 | 소켓(포그라운드) + FCM(백그라운드) |
| 토스트 | 현재 있음(종 아래) | **없음 → 추가** | **없음 → 추가** |
| 푸시 | 웹 푸시(백그라운드) | 웹 푸시 | FCM |
| 포그라운드 푸시 | — | — | 수신 시 **시스템 배너 대신 토스트로 대체**(`pushNotificationReceived` → 토스트) |
| 탭 처리 | 토스트 클릭 | 토스트 탭 | 토스트 탭 / 푸시 탭(`pushNotificationActionPerformed`) |
| 중복 방지 | 소켓 알림 id 기준 | 동일 | 소켓·푸시 둘 다 올 때 알림 id(`message_id`)로 1회만 |

### 5-4. 안드로이드 푸시 보완 (백그라운드용, 범위 내 최소)

- 서버 FCM 메시지에 `android.priority=HIGH`, `android.notification.channel_id`, `sound` 지정.
- 앱 시작 시 해당 채널(중요도 HIGH) 생성.
- 권한 거부 상태면 "알림이 꺼져 있어요 · 설정 열기" 안내(`components/native/permission-guide.tsx` 재사용 여부는 plan에서 확인).
- 실기기 확인 전에는 원인 1·2를 단정하지 않는다(3-4 판별 방법으로 확정).

## 6. 비범위

- 상담사/기관관리자 화면의 토스트 신규 규칙(공통 컴포넌트 적용 시 모바일 토스트 추가만 따라감, 회원 우선).
- 알림 센터(`/app/notifications`) 화면 변경, 알림 종류·문구 신설.
- 즉석 클래스 생성 흐름(SDD-226) 변경, 초대 대상 규칙 변경.
- 소리·진동 커스텀, 알림 그룹/요약 푸시, iOS 네이티브 추가 작업.
- 푸시 메시지 본문(비식별 원칙) 변경.
- 홈 하단 '내 클래스'·상담 섹션 변경.

## 7. 구현 범위 예고 (plan 단계에서 확정)

| 영역 | 변경 | 재빌드/배포 |
|---|---|---|
| 서버 | `class_read_service` 홈용 후보에 열린 회차 포함(가산 필드 또는 기존 `open_session_*` 활용 판단), FCM 메시지에 Android 채널·우선순위 추가 | 백엔드 재배포. DB 마이그레이션 없음 |
| 웹(프론트) | 홈 후보 선정 규칙, 소켓 수신 시 클래스 목록 재조회, 공용 토스트 컴포넌트(모바일 포함·쌓임), 플레이어 억제 | 프론트 빌드·배포 |
| 앱 | 프론트 변경이 WebView에 반영되려면 **앱 번들 재빌드**(Capacitor `webDir: dist`). 포그라운드 푸시→토스트 연결(JS), Android 채널 생성(네이티브) → **Android 앱 재빌드·재설치 필요**. iOS도 번들 내장이라 JS 변경 시 새 빌드 필요 | Android·iOS 앱 새 빌드 |

## 8. 수락 기준 (구현 시 verify.md로 이관)

- [ ] 일정 없는 회원 홈에서 상담사가 즉석 클래스를 초대하면 **새로고침 없이 3초 이내** 토스트가 뜨고 '다음 일정'이 즉석 카드로 바뀐다.
- [ ] 카드/토스트의 입장 버튼이 `/class/{sessionId}/enter`로 이동한다.
- [ ] 즉석 > 진행 중 일반 > 예정 우선순위가 단위 테스트로 고정돼 있다.
- [ ] 모바일 웹·Android 앱 포그라운드에서 토스트가 종 아래에 보인다(실기기 확인).
- [ ] 토스트 3개 이상 쌓일 때 덮어쓰지 않고 `+N`으로 접힌다.
- [ ] 수업 플레이어 화면에서는 토스트가 뜨지 않고 종 배지만 증가한다.
- [ ] 같은 알림이 소켓·푸시로 두 번 와도 토스트 1회.
- [ ] 390px 가로 넘침 0, 터치 영역 44px 이상.
- [ ] LINK BAND 없이 동일 동작. 점수·순위 표기 없음.
- [ ] `npx tsc -b --noEmit`, `npx eslint src/`, vitest, pytest 통과 + dev 서브도메인 실화면 확인.

## 9. 위험

| 위험 | 대응 |
|---|---|
| 열린 회차를 '다음 일정'에 넣으면 오래 열려 있는 회차가 노출 | 열린 상태 + 시작 후 N시간 이내만 후보. N은 plan에서 확정 |
| 소켓·푸시 이중 수신 | 알림 id 기준 dedupe(T3) |
| 토스트가 수업 흐름을 끊음 | T7 억제 + 종료 후 요약 |
| 앱 재배포 지연 | 서버·웹 선배포로 웹/모바일 웹 먼저 해결, 앱은 다음 빌드에 포함 |
| 안드로이드 원인이 설정 문제(2·3)일 때 서버 변경만으로 해결 안 됨 | 3-4 판별을 구현 첫 Task로 두고 로그 확인 |

## 10. 결정 필요 항목 (비즈니스만)

| # | 질문 | 제안(참고) |
|---|---|---|
| D1 | 수업(플레이어) 진행 중 토스트를 완전히 막고 종료 후 요약해도 되는가? | 막고 종료 후 "놓친 알림 N건" 요약 |
| D2 | 일반 알림(채팅·리포트 등)도 모바일/앱에서 모두 토스트로 띄울까, 즉석 클래스 초대만 먼저? | 전부 띄우되 클래스 초대형만 강조 |
| D3 | 앱을 보고 있을 때는 푸시 배너 대신 토스트만 보여도 되는가? | 토스트만 |
| D4 | 즉석 클래스가 열려 있는 동안 홈 '다음 일정'에 입장 카드를 계속 보여줄까? | 종료 전까지 유지, 오래 열린 회차는 N시간 후 제외 |
| D5 | 앱(안드로이드) 재빌드·재배포는 서버·웹 먼저 내고 다음 빌드에 합류해도 되는가? | 웹 선배포 |

## 10-1. 대표 결정 (2026-10-28, D1~D5 모두 제안대로)

| # | 결정 |
|---|---|
| D1 | 수업(플레이어) 중 토스트 차단, 종료 후 "놓친 알림 N건" 요약 토스트 1개 |
| D2 | 일반 알림(채팅·리포트 등)도 모바일·앱에서 모두 토스트. 클래스 초대형만 강조(보라 채움 + 입장하기) |
| D3 | 앱 포그라운드는 OS 푸시 배너 없이 토스트만 |
| D4 | 즉석 클래스는 종료 전까지 홈 카드 유지. 오래 열린 회차는 **시작(예정) 후 6시간** 지나면 제외 (N=6, plan 확정) |
| D5 | 서버·웹 먼저 develop/dev 배포(감독 수행). 앱은 안드로이드 dev 빌드를 로컬 설치해 테스트만(스토어 제출 없음) |

시안 피드백(2026-10-28): 홈 카드의 칩↔타이틀 여백이 넓다 → 칩·타이틀을 한 덩어리(시각 간격 6~8px)로 수정, 실제 구현에도 동일 규칙 적용.

## 11. 시안

`~/.hermes/share/mb-sdd250-20261028/` — `index.html`(전체), `overview.png`, 개별 PNG, `README.md`.
화면: 홈 다음 일정(일정 없음 / 즉석 도착 / 여러 개), 앱 토스트(1개 / 쌓임 / 클래스 초대형 / 일반 알림형), 웹 토스트 현재 vs 제안, 수업 중 억제.
