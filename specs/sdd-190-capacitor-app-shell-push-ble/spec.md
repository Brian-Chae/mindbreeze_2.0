# [SDD-190] Capacitor 앱 셸 + 푸시 알림 + BLE

> 기획: `docs/AI-에이전트-양방향-채널-기획.md` v0.5 §5.4 / 결정 D2(앱 푸시만)·D13(BLE는 LINK BAND SDK Web의 Capacitor 방식과 동일)·D14(MVP1 동시)

## Goal
기존 React SPA를 **Capacitor 하이브리드 앱**(iOS/Android)으로 감싸고, (1) 푸시 알림 등록·수신·탭 라우팅 + 서버 푸시 발송, (2) LINK BAND BLE 연결(앱에서는 Capacitor BLE)을 제공한다. 웹은 기존대로 동작한다.

## Context
- SDD-188/189가 `notification_outbox`에 `channel="push"`, `pending` 행을 적재하지만 소비자·디바이스 토큰이 없다.
- 현재 `frontend/package.json`에 Capacitor가 없다. BLE는 Web Bluetooth(`hooks/useBand.ts`, `lib/eeg/*`).
- **참조 구현:** `/Volumes/Looxid SSD/looxid/repository/link-band-sdk-web` (Capacitor + `android/` + `ios/` + `capacitor.config.ts` + `src/utils/bluetooth/BluetoothProvider`). D13: 이 저장소의 Capacitor BLE 방식을 그대로 따른다(플러그인·연결/재연결·권한 처리).
- Firebase/APNs 자격증명은 이 환경에 없다 → **환경변수 설정 시에만 실제 발송**, 미설정 시 안전하게 비활성(테스트는 모킹).

## Scope
### ✅ In-scope
**백엔드** (마이그레이션 `down_revision=e036a0000037`, **revision id 고정: `e036a0000038`** — SDD-189와 병행되므로 번호 고정)
1. `device_tokens`(user_id, token UNIQUE, platform `ios|android`, app_version, device_label, created_at, last_seen_at, revoked_at)
2. API: `POST /api/v1/devices`(upsert, 현재 사용자), `DELETE /api/v1/devices/{token}`(본인 것만), 로그아웃 시 해지 지원
3. 푸시 발송기 `push_service.py`: FCM HTTP v1(`google-auth` + `httpx`, 설정: `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_JSON`(파일 경로 또는 JSON)). 미설정이면 발송하지 않고 상태 유지. 응답 `UNREGISTERED/INVALID_ARGUMENT` 토큰은 revoke. iOS는 FCM을 통해 APNs로 전달(별도 APNs 직접 연동 없음)
4. 소비 cron `process_push_outbox_cron.py`(매 1분): `channel="push"` pending 행 → 사용자 활성 토큰 전체에 발송 → `sent`/`failed`(재시도 3회, 백오프) / 24시간 초과 pending은 `expired`. 토큰 없는 사용자는 `skipped`. 기존 email/ws 소비 cron과 **행 선점 충돌 없음**(channel 필터 확인)
5. `deploy-dev.yml` cron 등록
6. 푸시 payload의 `deeplink`(`/app/ai`, `/agent`)와 `message_id`를 data 필드로 전달, 본문 비식별 유지

**프론트엔드**
7. Capacitor 도입: `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/ios`, `@capacitor/push-notifications`, `@capacitor/app`, BLE 플러그인(**참조 저장소가 쓰는 것과 동일**). `capacitor.config.ts`(appId `com.looxidlabs.mindbreeze`, appName `MIND BREEZE`, webDir `dist`), npm 스크립트(`cap:sync` 등). `npx cap add android`/`ios` 시도(ios는 CocoaPods 필요 — 환경에서 실패하면 문서화하고 건너뜀). 생성 산출물의 `.gitignore` 정리(빌드 산출물 제외)
8. 플랫폼 감지 유틸(`isNativeApp()`), 푸시 등록 훅: 로그인 후 권한 요청 → 토큰을 `/devices`로 등록, 로그아웃 시 해지, 푸시 탭 → 딥링크 라우팅(내담자 `/app/ai`, 상담사 `/agent`), 포그라운드 수신 시 인앱 알림/배지 갱신. **웹에서는 아무 동작 없음(no-op)**
9. BLE 어댑터: 기존 `useBand` 경로를 깨지 않고 **Web Bluetooth / Capacitor BLE 선택 어댑터** 도입(참조 저장소 `BluetoothProvider` 구조를 따름). 앱에서는 Capacitor BLE로 스캔·연결·재연결·notify 구독, 웹은 기존 경로 유지. 미지원 브라우저 안내 UX 유지. (실기기 BLE 검증은 범위 밖 — 단위·어댑터 테스트까지)
10. 앱 권한 문구: Android(BLUETOOTH_SCAN/CONNECT, POST_NOTIFICATIONS), iOS(`NSBluetoothAlwaysUsageDescription`, 푸시 capability 안내 주석)

### ❌ Out-of-scope
- 스토어 등록·서명·심사, Firebase 프로젝트 생성/자격증명 발급, 실기기 푸시·BLE 동작 검증, APNs 직접 연동, 앱 아이콘/스플래시 디자인, 오프라인 모드

## Acceptance Criteria
- [ ] 토큰 등록·갱신(upsert)·해지 API 동작, 타인 토큰 삭제 불가
- [ ] 푸시 소비 cron이 pending push 행을 활성 토큰에 발송(모킹)하고 sent/failed/expired/skipped를 기록, UNREGISTERED 토큰 revoke
- [ ] 자격증명 미설정 시 발송 시도 없이 안전(행 유지·로그), 예외 없음
- [ ] 기존 email/ws 소비 cron과 충돌 없음
- [ ] `alembic heads` 단일 `e036a0000038`(SDD-189 병합 후), 백엔드 신규 테스트 통과·회귀 0
- [ ] 프론트: Capacitor 의존성·`capacitor.config.ts`·스크립트 존재, `npm run build` 통과, `npx cap sync android`(가능 시) 오류 없음
- [ ] `isNativeApp()`=false인 웹에서 푸시 등록·BLE 어댑터가 기존 동작을 바꾸지 않음(회귀 vitest)
- [ ] 푸시 payload에 이름·상담 내용 없음

## Dependencies
SDD-188/189(Outbox push 행), 참조 저장소 `link-band-sdk-web`

## Risks
| 리스크 | 대응 |
|---|---|
| 자격증명 부재 | 환경변수 게이트 + 모킹 테스트, summary에 운영 설정 절차 명시 |
| iOS 플랫폼 추가 실패(CocoaPods) | 시도 후 실패 시 문서화, Android 우선 |
| 웹 BLE 회귀 | 어댑터 도입 시 기존 `useBand` 테스트 유지, 웹 경로 무변경 |
| 마이그레이션 head 분기 | 038 고정 + 189와 병합 순서 준수 |
| 네이티브 산출물 비대 | `.gitignore` 정리, 필요한 설정 파일만 커밋 |
