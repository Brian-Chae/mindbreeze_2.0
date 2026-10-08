# [SDD-192] Summary — 웹 푸시

## What Was Built
| File | Description |
|---|---|
| `backend/app/config.py` | `VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT` 설정 |
| `backend/alembic/versions/e036a0000040_sdd_192_web_push.py` | `device_tokens.p256dh/auth` 추가 (head 단일 확인) |
| `backend/app/models/device_token.py` | 컬럼 2개 |
| `backend/app/schemas/device.py` | platform `web`, `keys`, endpoint https+푸시 서비스 도메인 allowlist(SSRF 방지) |
| `backend/app/services/device_service.py` | keys 저장 |
| `backend/app/services/web_push_service.py` | pywebpush(VAPID) 발송, 404/410 → 구독 revoke |
| `backend/app/api/v1/devices.py` | `GET /devices/web-push/public-key`(미설정 503), `DELETE /devices?token=`(endpoint에 `/`가 있어 경로 파라미터 불가) |
| `backend/app/tasks/push_task.py` | 기기별 분기(web→VAPID, 앱→FCM), 설정된 발송기만 대상, 둘 다 미설정이면 행 유지 |
| `.github/workflows/deploy-dev.yml` | push cron에 VAPID env 전달 |
| `frontend/public/sw.js` | push/notificationclick, 포커스 창이면 알림 생략, 딥링크 allowlist |
| `frontend/src/lib/web-push.ts` | 지원 감지·구독·서버 등록/해지·SW 메시지 수신 |
| `frontend/src/components/settings/WebPushCard.tsx` + `SettingsPage.tsx` | 설정 "브라우저 알림" 토글 |
| `frontend/src/lib/native/use-push-registration.ts`, `stores/authStore.ts` | 로그인 시 재등록·메시지 수신, 로그아웃 시 구독 해지 |

## Test Results
- ✅ TS1~TS7 `backend/tests/test_web_push.py` 21건 + 기존 push/devices 56건 통과 (FCM 경로 회귀 0)
- ✅ 전체 backend pytest 실패 0
- ✅ TS8 `frontend/tests/web-push.test.ts` 14건 + native-push/bootstrap 회귀 통과
- ✅ 실제 VAPID 서명+암호화 검증: 로컬 HTTP 수신기로 `Authorization: vapid …`, `Content-Encoding: aes128gcm` 확인
- ✅ `tsc -b`, `npm run build`(dist/sw.js 생성), `alembic heads`=`e036a0000040`, 마이그레이션 SQL 렌더 확인
- ⚠️ 프론트 전체 vitest 16건 실패(client-report-list·modal, agent-counselor-sidebar) — 'NEW' 배지/AI 대화 배지 관련으로 이 SDD와 무관. 작업 트리에 다른 진행 중 변경(App.tsx, BottomTabBar 등 8파일)이 있음.
- ⏳ 실제 Chrome 알림 수신은 dev 배포 + VAPID 키 설정 후 확인 필요

## 후속 변경 (dev 검증 중 발견)
- **기본 ON:** 로그인 시 자동 구독(권한 미요청이면 1회만 팝업, 이미 허용이면 조용히 구독). 설정에서 직접 끈 브라우저만 제외(`mb_web_push_opt_out`).
- **포커스 중에도 시스템 알림 표시:** 초기 구현의 "포커스 창이면 알림 생략"은 테스트 중 알림이 안 뜨는 것처럼 보이게 해 제거. 창에는 갱신 메시지를 함께 보낸다.
- **중복 구독 정리:** 브라우저가 마지막으로 등록한 endpoint 를 localStorage 에 두고, 새 endpoint 로 바뀌면 이전 것을 해지.

## Debugging Journey
- **dev 알림 미수신(코드 무관):** 서버는 `sent`·FCM 201·복호화까지 정상. 원인은 사용자 Chrome 의 `chrome://gcm-internals` Connection State 가 `CONNECTING` 에 멈춘 것 — Chrome 재시작으로 해결. DevTools Push 버튼은 이 연결을 쓰지 않아 정상으로 보인다. 진단 순서: 서버 outbox 상태 → 직접 발송 201 → gcm-internals.
- 웹 endpoint가 `/`를 포함 → `DELETE /devices/{token}` 404 → 쿼리 파라미터 해지 엔드포인트 추가.
- push_task가 FCM 미설정이면 전체 조기 종료 → FCM/VAPID 각각 게이트로 분리, 설정 안 된 발송기의 기기는 행 유지.
- 기존 테스트가 "FCM 미설정" 로그 문구에 의존 → 문구에 포함 유지.

## Notes for Reviewer
- **운영 설정 필요(미설정이면 카드가 "사용할 수 없어요"로 표시, 발송 없음):** 서버 `.env.dev`에 `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`(raw base64url), `VAPID_SUBJECT=mailto:…`. 키 교체 시 기존 구독은 전부 무효(재구독 필요).
- 키 생성: `cryptography`로 P-256 생성 후 개인키 32바이트·공개키 65바이트(비압축) base64url (`specs/sdd-192-web-push/` 검증 스크립트와 동일 방식).
- 로그아웃 시 구독을 해제하므로 재로그인 후 설정에서 다시 켜야 한다(공용 PC 보호).
- iOS Safari는 홈 화면에 추가한 PWA에서만 동작.
