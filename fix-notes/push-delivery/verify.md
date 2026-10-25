# 구현 전 검증 체크리스트 — 푸시 알림 미수신(기기 토큰 미등록)

원인 가설: `use-push-registration.ts:22`가 `requestOnStart=false`로 시작 → 권한 'prompt' 상태(첫 설치)에서는 OS 권한을 한 번도 묻지 않고 토큰도 등록하지 않는다. 설정 화면 '알림 허용하기'가 유일한 진입점.

## 프론트
- [ ] 네이티브 로그인 직후 권한 granted → 즉시 register() → 토큰 POST /devices
- [ ] 권한 prompt + 아직 안 물어봄 → 1회만 requestPermissions, 허용 시 등록
- [ ] 이미 한 번 물었던 기기(prompt/denied) → 재요청 안 함(설정 화면에서만)
- [ ] denied → 등록 없음, 사유 로그
- [ ] registrationError·POST /devices 실패 시 console.warn (토큰 값 미포함)
- [ ] 로그아웃 시 토큰 해지 기존 동작 유지, 웹/비로그인은 호출 없음
- [ ] 기존 TS26(requestOnStart=false 시 OS 요청 0회) 유지

## 서버
- [ ] 활성 토큰 없음 skipped 시 사유 구분: 등록 이력 없음 / 전부 해지(N건) — outbox.last_error + 로그(user_id, 토큰 값 제외)
- [ ] 기존 skipped 상태 전이·카운트 유지

## 게이트
- [ ] pytest 관련, vitest(기준선 17 실패 유지), tsc, eslint, build
- [ ] 실기기: adb logcat 읽기만, 설치 금지 — 절차는 summary에 기록
