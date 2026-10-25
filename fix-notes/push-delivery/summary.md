# 푸시 알림 미수신(기기 토큰 미등록) 수정 결과

## 원인
- `frontend/src/lib/native/use-push-registration.ts:22` 가 `startPushRegistration(..., false)`(requestOnStart=false)로 시작.
- `push.ts:128-133`(수정 전): 시작 시 권한이 이미 'granted'일 때만 register(). 첫 설치는 'prompt' → OS 권한을 한 번도 묻지 않고 토큰도 발급되지 않음. 유일한 진입점은 설정→알림→'알림 허용하기'(`WebPushCard.tsx:28-40`, 사용자가 찾아야 함). iOS/Android 13+ 모두 동일.
- 결과: `POST /api/v1/devices`(`backend/app/api/v1/devices.py:30`) 호출 자체가 없음 → `push_task.py:104-109` 활성 토큰 없음 → 전부 `skipped`.
- 부가: 토큰 POST 실패(`push.ts` catch)·`registrationError`가 완전히 무음이라 진단 불가.
- 서버(devices.py/device_service/push_service)는 정상. 토큰 갱신(이전 토큰 DELETE)·로그아웃(`authStore.ts:221` → revokePushRegistration)은 기존대로 동작.

## 수정
- `use-push-registration.ts:22` 로그인 직후 `requestOnStart=true`.
- `push.ts`: 로그인 직후 권한 확인 → granted면 즉시 register / 'prompt'이고 이 기기에서 한 번도 묻지 않았으면(localStorage `mb.push.permission-asked`) 1회만 요청 후 등록 / 이미 거부·재질문 안 함(설정 화면 '알림 허용하기'는 유지). 서버 등록 실패(HTTP 상태만)·registrationError·초기화 실패는 console.warn, 토큰 값은 로그 제외.
- `push_task.py`: skipped 사유 구분 — "등록 이력 없음" vs "등록 N건 전부 해지됨"을 `last_error`와 INFO 로그(outbox id, user id; 토큰 값 없음)에 기록.

## 테스트
- RED(수정 전 stash): native-push 신규 2건 실패(최초 1회 요청, 등록 실패 로그). GREEN 후 통과. 구정책 고정 테스트(`sdd220-permissions.test.tsx` TS26 부트스트랩)는 새 정책으로 갱신.
- pytest(push 4개 파일, 오프라인 러너): 66 passed. 신규: 전부 해지 사유 구분 + 등록 이력 없음 사유.
- vitest 전체: 17 failed / 3038 passed (기준선 17 실패와 동일, 8 파일). tsc·eslint 오류 0, build 성공.
- 미검증: 네이티브 빌드·실기기 수신(JS 변경이므로 앱 재빌드 필요: Android versionCode 10↑, iOS build 8↑).

## 실기기 확인 절차 (Brian)
1. 새 빌드를 설치(Android는 기존 앱을 지우거나 설정→앱→알림 권한 초기화 후 실행).
2. 로그인 직후 OS 알림 허용 팝업이 뜨는지 확인 → 허용.
3. `adb -s R3CMA0C3Y4T logcat | grep -iE "push|Capacitor/Console"` — `[push]` 경고가 없고, 서버 등록 성공이면 경고 없음. 실패 시 `[push] 기기 토큰 서버 등록 실패 <상태코드>`.
4. 서버: `ssh ... 'sudo journalctl -u <백엔드> --since "5 min ago" | grep -E "POST /api/v1/devices"'` 에서 200 확인(토큰 값은 출력 금지).
5. 앱을 백그라운드로 두고 테스트 알림(세션 초대 등) 발생 → 수신 확인. skipped 로그의 사유가 "등록 이력 없음"이면 여전히 미등록.
- 거부했던 기기: 기기 설정에서 알림 허용 후 앱 복귀 시 자동 등록(`appStateChange`).
- adb 읽기만 수행했고 설치는 하지 않음.
