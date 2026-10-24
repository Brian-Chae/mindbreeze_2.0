# 앱 푸시 알림 미수신 수정 결과

## 결론

- 코드로 확정한 결함: 일반 알림의 push outbox 생성 누락, 주요 이벤트의 push 기본값 누락, 채팅 push OFF 무시, 네이티브 등록 실패 후 앱 복귀 시 재시도 누락, 서버 등록 전 성공 안내.
- 리포트 도착·세션 초대·클래스 초대·시작은 신규 이벤트부터 push를 생성한다. 채팅은 기존 즉시 발송 경로를 유지한다.
- 과거 채팅 3건의 실제 최종 상태와 422의 실제 실패 필드는 현재 자료만으로 확정할 수 없다. dev SSH·DB·환경파일·토큰을 열람하지 않았다.
- **Android versionCode 5 이상 / iOS build 4 이상 재빌드 필요.** 저장소 기본 버전을 5/4로 올렸다. 네이티브 빌드·서명·업로드·배포·실기기 수신은 수행하지 않았다.

## 원인과 코드 근거

### 1. 이벤트 생성과 선호

수정 전 `notification_service.notify_event`는 ws/email만 생성했다(기준 a22b0eb3의 `backend/app/services/notification_service.py:256-290`). push 선호를 읽어도 실제 push 경로는 없었다. 기본 push 선호도 회차 변경 네 종류뿐이었다(기준 `backend/app/models/user.py:91`).

기존 push 생성 이벤트는 다음과 같다.

- 채팅 `chat_message`: `backend/app/services/chat_service.py:1505,1601`. 수신자별 전용 outbox. 수정 전 사용자 push 선호를 확인하지 않았다.
- 클래스: `backend/app/services/class_effect_service.py:260-299`. 시작 60분 이내의 `session_host_changed`, `session_host_change_requested`, `session_updated`, `session_cancelled`만 별도 push. `class_invited`는 포함되지 않았다.
- AI 메시지·체크인·브리핑 등의 `agent_message`: `backend/app/services/agent_service.py:293-341`의 전용 push.
- 위험 신호 `risk_signal`: `backend/app/services/agent_risk.py:406-442`의 전용 push.

수정 후 `notification_service.py:224,326-336`의 allowlist 네 종류만 일반 push를 생성한다: `report_ready`, `session_invited`, `class_invited`, `session_started`. 기본값은 `models/user.py:91-96`에 위 네 종류와 `chat_message`를 ON으로 추가했다. 기존 명시적 OFF는 그대로 우선한다. `session_opened`까지 켜서 열림·시작 두 번 알리지 않는다. 나머지 일반 이벤트는 이번 수정으로 추가 발송하지 않는다. 기존 회차 변경·AI·위험 신호의 전용 push 동작은 유지한다. 단, AI의 리포트 도착 메시지는 이미 같은 사용자의 같은 리포트 push가 있으면 추가 발송하지 않는다(`agent_service.py:324-336`). 이 분기에서도 report_ready OFF를 존중한다. AI ON/OFF × push ON/OFF × in_app ON/OFF와 재승인을 검증했다.

클래스 회차 시작은 기존 `session_service.py:1243-1257`에서 `session_started`로 발화한다. 클래스/플레이어·밴드 소스는 수정하지 않았다. push는 인앱 선호와 독립적이며 `commit=False`에서는 호출자 트랜잭션에만 적재한다. 신규 일반 알림은 cron(최대 약 1분)을 통해 전달한다.

잠금화면에는 이름·상담 내용 없는 고정 문구만 보낸다. `notification_service.py:227-259`는 역할별 딥링크를 만들며 UUID만 경로에 넣는다. 리포트는 목록의 리포트 모달, 회원 시작·즉시 초대는 회차 입장 화면으로 이동한다.

### 2. 네이티브 토큰·422

- `frontend/src/lib/native/push.ts:100-109`: `{token, platform, app_version}` POST. `platform.ts:4-6`는 ios/android/web을 반환한다.
- `backend/app/schemas/device.py:43-59`: 토큰 1~512자, platform은 정확히 ios/android/web, app_version 최대 50자. 웹에만 keys와 허용 HTTPS endpoint가 필수다. 현재 네이티브 payload는 이 계약과 일치한다.
- 검증 테스트에서 iOS 163자·Android 512자 토큰은 200, 빈/513자 토큰·iOS 대문자 플랫폼·51자 버전·keys 없는 웹 구독은 422다. **로그에 있는 422를 네이티브 형식 오류라고 단정할 수 없다.** 스키마를 임의 완화하지 않았다.
- iOS `frontend/ios/App/App/AppDelegate.swift:33-49`는 APNs를 Firebase Messaging에 연결하고 **FCM 문자열 토큰**을 JS 등록 이벤트로 전달한다. 변환 누락이 아니다.
- `App.entitlements:5-6`, `App.xcodeproj/project.pbxproj:322,347`에 aps-environment 및 Debug development / Release production 설정이 있다. FirebaseCore/Messaging 의존성과 plist 리소스 참조도 존재한다.
- Android `frontend/android/app/build.gradle:82-89`는 google-services.json이 없으면 플러그인을 생략한다. iOS는 plist가 없으면 Firebase를 초기화하지 않는다. 두 자격 파일은 git 제외 파일이라 이 워크트리에 없고 원본 저장소에는 존재함만 확인했다(내용·키는 미열람). **실제 TestFlight 3 / Play 4에 포함됐는지는 미검증**이며 빌드 담당자가 확인해야 한다.
- `use-push-registration.ts:22`, `push.ts:128-132`: 첫 설치에서 자동 권한 창을 띄우지 않으며 설정의 사전 안내 확인 후 요청한다. 이미 허용한 기기는 시작 시 등록한다. 권한 허용이 선행되어야 한다.
- 수정 전 `/devices` POST 실패를 삼킨 뒤 앱을 다시 시작하기 전에는 재시도 기회가 없었다. `push.ts:120-125`에 앱 복귀 시 권한 허용 기기의 재등록을 추가했다. 실패 토큰은 성공 캐시에 저장하지 않으므로 동일 토큰 재시도가 가능하며, 성공한 동일 토큰은 중복 POST를 억제한다. 로그아웃 후에는 재등록하지 않는다.
- `WebPushCard.tsx:32`는 서버 등록 성공을 단정하지 않고 OS 권한 승인 결과를 정확하게 안내한다. 토큰·서버 오류 본문은 로그에 출력하지 않는다.

### 3. 즉시 발송·cron과 채팅 3건의 한계

- 채팅 수신자는 `chat_service.py:1447-1496`에서 방 유형·발신자·참여자·차단 관계로 계산한다. 수신자 0명이면 push 행도 없다. POST 201은 메시지 저장 성공이며 푸시 성공의 증거가 아니다.
- `_enqueue_chat_push`는 **별도 commit 후** `dispatch_push_now`를 호출한다(`chat_service.py:1530,1601-1605`). 정상 경로의 미커밋 행을 즉시 스레드가 먼저 조회하는 구조는 아니다. 적재 예외는 rollback하고 `Failed to enqueue chat push`를 남겨도 메시지 API는 201일 수 있다.
- `NotificationOutbox.available_at`는 DB now 기본값(`backend/app/models/notification_outbox.py:41`). 소비자는 pending + push + available_at<=now만 조회한다(`tasks/push_task.py:79-92`). 24시간 초과는 expired, 무토큰은 skipped, 1개 이상 성공은 sent, 전부 실패는 백오프/3회 후 failed다. terminal 행은 다음 cron 조회에 잡히지 않는다.
- `configured=True`는 FCM/VAPID 중 하나 이상 준비됐다는 뜻이다. 등록 기기의 발송기가 준비되지 않은 경우 processed를 다시 차감하고 pending을 유지하는 경로도 있다(`push_task.py:95-102`). 따라서 processed=0만으로 pending 자체가 없다고 할 수 없다.
- API와 cron 모두 `app.core.database.SessionLocal`을 사용한다. 배포 템플릿의 backend/job은 동일 WorkingDirectory와 EnvironmentFile을 사용한다(`deploy/templates/systemd/mindbreeze-{backend,job@}.service.tpl:11-13`). 코드에는 별도 push DB가 없다. 실제 배포 설정·DB 동일성은 이번 권한 범위에서 확인하지 않았다.
- 즉시 스레드가 sent/skipped/failed로 처리한 행은 cron에 0건으로 보일 수 있다. 기존 성공·무토큰 처리는 로그가 없었고 모듈 INFO는 uvicorn의 로거 핸들러를 직접 상속하지 않았다. `push_task.py:27,199`와 `chat_service.py:1531-1533`에 uvicorn INFO 경로를 통한 **적재/수신자 건수·즉시 처리 집계**를 추가했다. 개인정보·토큰·메시지 내용은 포함하지 않는다.
- 10/23 세 건이 무수신자/적재 실패/즉시 소비/다른 설정 중 어디에 해당하는지는 원본 outbox 상태·안전한 오류 필드·동일 릴리스 확인 없이는 구분할 수 없다. 과거 행을 추정해 재생성하지 않는다.

## 변경 파일

- backend: `app/models/user.py`, `app/services/notification_service.py`, `app/services/chat_service.py`(푸시 헬퍼), `app/services/agent_service.py`(리포트 중복 억제만), `app/tasks/push_task.py`, `tests/test_app_push_delivery.py`, `tests/test_agent_report_chat.py`(단일 푸시·PII 단언 유지, 일반 본문·직접 리포트 링크 계약 보강).
- frontend: `src/lib/native/push.ts`, `src/components/settings/WebPushCard.tsx`, `tests/native-push.test.ts`, `tests/sdd220-permissions.test.tsx`(리스너 mock만 보완), `android/app/build.gradle`, `ios/App/App.xcodeproj/project.pbxproj`.
- 문서/검증: 이 폴더의 `plan.md`, `verify.md`, `summary.md`, `run-offline-pytest.py`.

## 발송 폭주 방지

기존 outbox의 status/available_at을 변경하는 migration·backfill·재처리 스크립트는 없다. 신규 일반 push는 네 이벤트만 허용하고, 별도 push 발화 지점과 겹치지 않는다. 채팅은 기존 수신자 범위를 유지하고 명시적 push OFF를 존중한다. 기존 24시간 만료·백오프·terminal 상태 정책도 유지한다. terminal 네 상태 보존과 새 알림 한 건만 mock FCM으로 전달되는 것을 테스트했다. 과거 pending 행에 대한 cron의 기존 동작은 변경하지 않았다.

## 검증

- RED: 신규 backend 회귀 7 failed/5 passed로 일반 push 누락·OFF 무시 재현. native-push 회귀 1 failed/28 passed로 복귀 재시도 누락 재현.
- GREEN: 관련 pytest **243 passed**(15개 모듈), 관련 vitest **88 passed**(6개 파일), `npx tsc -b --force` exit 0.
- 독립 검증자는 diff·라우트·전용 이벤트 중복을 검토하고 backend 초기 24개·리포트 보완 48개 및 최종 frontend 88개를 별도 실행했다. 차단 결함 없음. 감독도 diff와 관련 테스트를 재확인했다.
- pytest는 아래 진입점에서 `_env_file=None`과 외부 소켓 연결 차단을 강제한다. SQLite/fakeredis, mock FCM/VAPID/이메일만 사용했다. 실제 FCM·메일 발송 없음.

```bash
# 저장소 루트에서 실행. Python 환경에는 backend 테스트 의존성이 있어야 한다.
python fix-notes/app-push-not-delivered/run-offline-pytest.py \
  tests/test_app_push_delivery.py tests/test_chat_push_outbox.py \
  tests/test_push_outbox.py tests/test_push_service.py tests/test_devices_api.py \
  tests/test_notification.py tests/test_notification_outbox.py tests/test_web_push.py tests/test_chat.py \
  tests/test_agent_report_chat.py tests/test_agent_api.py tests/test_agent_counselor_api.py \
  tests/test_agent_counselor_briefing.py tests/test_agent_reminder.py tests/test_agent_risk_flow.py
cd frontend
npm test -- tests/native-push.test.ts tests/web-push.test.ts tests/client-notification.test.ts tests/sdd220-permissions.test.tsx tests/sdd216-instant-notification.test.ts tests/sdd216-entry-notification.test.ts
npx tsc -b --force
```

### 범위를 넓힌 실행의 한계

- backend 전체 시도(`--ignore=tests/pg --maxfail=3`, 외부 소켓 차단)는 중단 시 **2274 passed, 11 skipped, 2 failed**였다. 하나는 이번 변경의 리포트 이중 push 회귀로 위의 단일 소유 분기로 고쳤으며 최종 관련 suite에서 통과했다. 다른 하나는 `test_sdd210_install_release.py::test_첫_설치는_current_venv_링크를_만들고_앱_유닛과_timer_17개를_설치한다`: 현행 jobs는 18개인데 테스트는 17개 기대. 해당 deploy 소스·테스트는 이번 변경에서 수정하지 않았다. 전체 suite 완료·통과를 주장하지 않는다.
- frontend `npm test` 전체는 브라우저 테스트까지 실행되어 실패를 확인한 뒤 중단했다. 관측 파일: `org-management-browser.test.cjs` 2개, `sdd234-a-mobile-home.test.tsx` 4개, `org-counselor-management-browser.test.cjs` 1개, `report-server-pdf.test.cjs` 2개, `report-modal-pdf.test.cjs` 2개. 이들 브라우저/화면 실패 원인은 이번 범위에서 확정하지 않았다. 테스트가 갱신한 화면 증거 파일은 실행 전 Git 내용으로 복구했으며 커밋에 포함하지 않았다.
- `agent-counselor-page.test.tsx` 2개(스크롤 기대값, input/textarea 불일치), `chat-message-deeplink.test.ts` 2개(input disabled 기대)는 변경 전 HEAD의 push.ts/WebPushCard.tsx를 Vite load override로 공급해도 **동일 4 failed/12 passed**로 재현했다. 기존 실패로 분리한다.
- 전체 실행에서 발견한 `sdd220-permissions.test.tsx` mock 누락은 App.addListener mock만 보완했다. 기존 단언은 유지했고 최종 관련 suite 88개가 통과했다.
- PostgreSQL·네이티브 signed build·실기기·실제 Firebase/APNs 자격 연동은 검증하지 않았다. 전체 suite의 기존/환경 실패는 이 푸시 수정과 섞어 고치지 않았다.

## 대표님 실기기 확인 절차 — 후속 승인된 빌드·배포 뒤 수행

1. 빌드 담당자가 git 제외 Firebase 파일 포함, 올바른 앱/프로젝트 연결, Firebase의 APNs 연결 설정을 확인하고 Android **5 이상**, iOS **4 이상**으로 빌드한다. 이 PR에서는 빌드·업로드하지 않았다.
2. 각 기기에서 새 버전을 열어 로그인 → 설정 → 앱 알림 → 사전 안내 확인 → OS 알림 허용. OS 알림 설정에서 앱 허용 및 집중 모드/방해 금지 상태를 확인한다.
3. 등록 요청을 확인할 때는 HTTP 상태와 실패 필드 경로/오류 유형만 공유한다. **토큰·요청/응답 전문은 캡처/공유하지 않는다.** 정상은 `/devices` 200. 422이면 field/type만으로 수정할 지점을 판정한다.
4. 본인 테스트 계정 두 개로만 진행한다. 수신 앱을 백그라운드·잠금 상태로 두고 다른 계정에서 채팅 1건 → 한 번 수신되는지, 탭하면 올바른 채팅방인지 확인한다. 이후 포그라운드에서도 알림 목록 갱신을 확인한다.
5. 새 리포트 도착, 클래스 초대(일반/즉시), 회차 시작을 각각 한 번 발생시켜 약 1분 이내 수신과 탭 이동(리포트 모달/클래스/회차 입장)을 확인한다. 초대와 시작은 서로 다른 이벤트이므로 각각 한 건이 정상이다.
6. 일시 네트워크 단절 후 복구·앱 복귀로 등록 재시도를 확인하고, 로그아웃 뒤 해당 기기로 추가 푸시가 오지 않는지 확인한다. push OFF(설정/API로 명시된 계정)는 수신하지 않아야 한다.
7. 운영 담당자는 개인정보 없이 `[OUTBOX-PUSH] chat enqueued=... recipients=...`, `immediate result=...`와 cron 집계를 비교한다. 과거 미발송 알림을 수동 재발송하지 않는다.

머지·develop 푸시·배포·스토어 업로드는 하지 않는다. 사용자 요청대로 작업 브랜치 푸시와 develop 대상 PR 생성까지만 진행한다.

검증 후 frontend/node_modules 심링크를 제거했으며 커밋에는 포함하지 않았다.
