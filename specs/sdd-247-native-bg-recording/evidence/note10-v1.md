# SDD-247 Note10 실기기 검증 v1 — 판정: 보류 (로그인 단계에서 중단)

## 판정
- 합격/불합격 판정 불가. 상담사 로그인이 401로 실패하여 지시에 따라 1회 시도 후 중단.
- 녹음·청크·DB 조회 단계는 수행하지 않음(청크 표·logcat 요약 없음).

## 시각별 절차 (KST 2026-10-26)
1. 기기 R3CMA0C3Y4T 연결 확인(adb), 배터리 100%/USB, 화면 잠금 상태 → 깨우기+스와이프로 해제(잠금 PIN 없음).
2. 앱 com.looxidlabs.mindbreeze2.dev 실행(pid 31058), WebView CDP(webview_devtools_remote → adb forward 9333) 연결 성공. 초기 화면 https://localhost/login.
3. 상담사 탭에서 counselor@test.com + loadtest_mb2.py 의 비밀번호로 로그인 1회 시도.
   - 결과: `POST https://api.mindbreeze.looxidlabs.com/api/v1/auth/login` → **401**("이메일 또는 비밀번호가 일치하지 않습니다"). 직전 `auth/refresh` 도 401(저장된 세션 없음).
4. 계정 잠금 방지를 위해 재시도하지 않고 중단. 배터리 unplug·deviceidle force 등 기기 설정은 변경하지 않았으므로 원복 대상 없음. 클래스 생성/시작 없음.

## 발견 사항 / 가설
- APK 가 호출하는 API 호스트가 `api.mindbreeze.looxidlabs.com` 이다. 이 호스트가 dev 서버(18.183.86.88, dev DB)인지 확인 필요. 다른 환경(prod 등)을 가리키면 dev 시험계정이 존재하지 않아 401 이 되는 것이 자연스럽다. 빌드 시 VITE_API_BASE 등 dev 환경 변수 주입 누락 가능성(파일:줄은 frontend 빌드 설정/capacitor env 확인 필요 — 미확인).
- 그렇지 않다면 loadtest_mb2.py 와 dev DB 의 counselor@test.com 비밀번호 불일치.
- 서버 저장 코드(origin/develop `audio_service.save_chunk`)는 확인함: 바이트를 형식 검사 없이 `.bin` 으로 저장, (session_id, chunk_index) 멱등. 업로드 연속성 시험 자체는 가능하다.

## 다음 단계 제안
- 앱의 API 베이스가 dev 인지 확인(CDP 로 번들 설정 확인, 읽기 전용) 후 계정 유효성은 dev DB 읽기 조회(건수·존재 여부)로 확인.
- 해결 후 본 시험 재개: 로그인 → 대면 클래스 → 동의·녹음 → 화면 끔 5분+ → 복귀 → 종료 → 청크 조회/ffprobe.

## 원복
- 기기 설정 변경 없음(화면 해제·앱 실행만). adb forward 9333 은 제거함.

---
# 2차 시도 (dev-api 재빌드 APK, 설치 20:16:23) — 판정: 보류 (앱 크래시)

## 절차
- 20:17 앱 재실행(pid 31778). CDP로 번들 JS 9개 검사: `dev-api.mindbreeze` 4건, 운영 `//api.mindbreeze` 0건 → API 주소 dev 확인.
- 상담사 탭에서 counselor@test.com 로그인 1회 제출 → 20:17:34 로그인 직후 **앱 크래시**(ApplicationExitInfo reason=4 APP CRASH).
- 20:19 재실행(pid 32045): 세션 유지 안 됨(로그인 화면). CDP에서 `PushNotifications.register` 를 JS로 덮어쓴 뒤 다시 로그인 시도 → 다시 크래시(덮어쓰기는 네이티브 브리지에 무효). 이후 재시도 중단.

## 크래시 원인 (logcat -b crash)
- `FATAL EXCEPTION: CapacitorPlugins`
- `IllegalStateException: Default FirebaseApp is not initialized in this process com.looxidlabs.mindbreeze2.dev`
  at `PushNotificationsPlugin.register(PushNotificationsPlugin.java:114)` → `FirebaseMessaging.getInstance`.
- 원인: 이 워크트리에 `frontend/android/app/google-services.json` 이 없어 Firebase 미초기화(.env 누락과 같은 계열의 gitignore 파일). 로그인 성공 직후 `frontend/src/lib/native/push.ts:73,138,147,154` 의 `PushNotifications.register()` 가 호출되며 네이티브 예외로 프로세스가 종료됨. JS try/catch 로 못 잡는 네이티브 스레드 예외.

## 결함
1. (빌드/환경) 워크트리 빌드에 google-services.json 누락 → 로그인 후 크래시. 메인 체크아웃의 파일을 복사해 재빌드하면 해결 예상.
2. (코드, 방어) Firebase 미구성 빌드에서도 앱이 죽지 않도록 push.ts register 호출 전 가드(또는 네이티브 측 try/catch)가 없음. 선택 개선 사항.

## 미수행/원복
- 녹음·청크·logcat 대기·DB 조회 미수행. 기기 설정 변경 없음(배터리·deviceidle 미조작), adb forward 제거 완료.
- 로그인 요청의 서버 응답 코드는 크래시로 확인 못 함(크래시 직전까지 진행했으므로 인증 자체는 통과했을 가능성).

## 필요 조치
- google-services.json(dev 앱 패키지 com.looxidlabs.mindbreeze2.dev 용 클라이언트 포함)을 워크트리에 배치 후 APK 재빌드·재설치.

---
# 3차 시도 (google-services.json 포함 APK, 설치 20:19:38) — 판정: **불합격** (네이티브 녹음이 시작되지 않음)

## 시각별 절차 (KST)
- 20:20 앱 실행, API=dev-api 유지. counselor@test.com 로그인 1회 → `auth/login` **200**, 크래시 없음(Firebase 수정 확인).
- 20:21 새 클래스 → "지금 바로 시작" → 오프라인(대면)·30분·주소 입력(초대 없음) → 대기실(코드 4198, 세션 699d2cc8-1a4c-4539-9d7c-cb3bb02c416d) → "지금 시작하기"(수업 시작, 20:21:45경).
- 20:22:01 녹음 패널 → "녹음 시작" → 동의 모달 → 20:22:24 "동의하고 녹음 시작".
  - `POST /sessions/{id}/audio/start` 200 (2회).
  - 그러나 UI 는 "녹음 전 / 아직 녹음되지 않았습니다" 그대로, 녹음 타이머 00:00, 상태 recording 으로 전환 안 됨. 에러 토스트·권한 팝업 없음. 20:24 재시도도 동일.
  - 앱 프로세스 RECORD_AUDIO `granted=false` 유지(권한 요청조차 안 뜸), 마이크 사용(`rec update`) 기록 없음, 이후 5분 대기 단계는 진행할 의미가 없어 생략(화면 끄기·battery unplug·deviceidle 미조작).
  - Capacitor 브리지 호출 추적: `NativeAudioRecorder.isAvailable` 만 호출되고 `addListener`/`start` 호출 0건. isAvailable 응답은 `{"available":true}`.
- 20:26 클래스 종료(재로딩 후 "클래스 종료" 확인) → 세션 status=completed, 요약 화면 정상.
- DB(읽기 전용): 해당 세션 `audio_chunks` **0건**, `sessions.status`=completed, `session_records.status`=recording(종료 후 확인 전 값; 쓰기 없음).

## 청크 표
| 항목 | 값 |
|---|---|
| 청크 수 / 인덱스 범위 | 0 / 없음 |
| 누락·간격·크기·ffprobe | 해당 없음(청크 없음) — 저장 파일 ftyp 확인 불가 |

## logcat 요약
- 필터(NativeAudioRecorder·AndroidRuntime·Capacitor/Console, 토큰 제외): 로그인 후 크래시 없음.
- 핵심 1건: `E Capacitor/Console: Uncaught (in promise) Error: "NativeAudioRecorder.then()" is not implemented on android` — 녹음 시작 시도마다(20:21:39, 20:22:24, 20:24:04) 직후 발생.
- FGS: 수업용 `AndroidForegroundService`(채널 mindbreeze_class_session)만 동작. 녹음용 FGS·업로드 로그 없음.

## 결함 (원인 확정)
1. **[치명] 네이티브 플러그인 프록시를 async 함수에서 반환** — `frontend/src/lib/native-audio-recorder/index.ts:32` (`return res?.available ? plugin : null;` in `async resolveNativeAudioRecorder`).
   - Capacitor `registerPlugin` 프록시를 Promise 로 resolve 하면 JS 가 `.then` 을 조회하고, 프록시는 이를 플러그인 메서드 호출로 취급해 `"NativeAudioRecorder.then() is not implemented on android"` 로 reject.
   - 결과: `useAudioRecorder.ts:107` `await resolveNativeAudioRecorder()` 가 throw → `startNative` 실패 → `start()` catch(`useAudioRecorder.ts` 약 176~186행)에서 에러 처리되나 UI 에는 표시되지 않아 사용자는 "아무 일도 안 일어남"을 겪고, 서버에는 `audio/start` 만 200 으로 남아 세션 기록 상태 `recording` 인데 청크 0.
   - 수정 방향(참고, 이번 검증에서 수정하지 않음): 프록시를 직접 반환하지 말고 `{ plugin }` 같은 래퍼로 감싸거나 boolean 만 반환(`isNativeRecorderAvailable()`) 후 호출부에서 `getNativeAudioRecorder()` 사용. 단위 테스트가 mock 객체여서 통과했을 가능성 — 실제 Capacitor 프록시 `then` 동작 테스트 필요.
2. `useAudioRecorder.start` 에러가 UI 에 드러나지 않음(state=error 인데 패널이 "녹음 전" 표시, 사용자 피드백 없음) — 보조 결함. 
3. `종료` 버튼이 한 번 클릭 후 `meta.ending` 으로 잠긴 채 확인 모달이 열리지 않는 현상(HostLiveView.tsx:257 `endDisabled={meta.ending}`) — 페이지 새로고침 후 정상. 녹음 실패와 무관한 별도 관찰, 재현 조건 미확인.

## 원복
- 배터리 unplug·deviceidle force·화면 끄기 미실시(해당 단계 도달 못 함) → 원복 대상 없음. battery status 5/level 100, mForceIdle=false 확인.
- adb forward 9333 제거. 시험 클래스 종료(completed). /tmp 사본 없음. RECORD_AUDIO 권한은 부여된 적 없음.
- 참고: 시험 세션의 `session_records.status` 가 recording 으로 남아 있을 수 있음(서버 정리 로직 확인 필요).

## 다음 단계
- index.ts:32 수정 후 APK 재빌드·재설치 → 본 시험(5분 화면 꺼짐) 재실행.
