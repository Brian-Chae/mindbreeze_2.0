# [SDD-192] Implementation Plan

**Architecture:** 알림 이벤트 → `notification_outbox(push)` → `push_task`가 사용자 활성 `device_tokens`를 platform으로 분기: android/ios → FCM(`push_service`), web → VAPID(`web_push_service`). 브라우저 SW가 push 수신 후 표시/클릭 라우팅.

**Tech Stack:** FastAPI, SQLAlchemy/Alembic, pywebpush, React+Vite, Service Worker, vitest, pytest.

## Files to Change
| Action | File | Description |
|---|---|---|
| Edit | `backend/app/config.py` | VAPID 설정 3종 |
| Create | `backend/alembic/versions/e036a0000040_*.py` | device_tokens p256dh/auth |
| Edit | `backend/app/models/device_token.py` | 컬럼 2개 |
| Edit | `backend/app/schemas/device.py` | platform "web", keys, endpoint 검증 |
| Edit | `backend/app/services/device_service.py` | keys 저장 |
| Create | `backend/app/services/web_push_service.py` | VAPID 발송 |
| Edit | `backend/app/api/v1/devices.py` | public-key 엔드포인트, keys 전달 |
| Edit | `backend/app/tasks/push_task.py` | 플랫폼 분기, 설정 게이트 |
| Edit | `.github/workflows/deploy-dev.yml` | cron env에 VAPID |
| Create | `backend/tests/test_web_push.py` | QA |
| Create | `frontend/public/sw.js` | push/notificationclick |
| Create | `frontend/src/lib/web-push.ts` (+test) | 구독 관리 |
| Create | `frontend/src/components/settings/WebPushCard.tsx` | UI |
| Edit | `frontend/src/pages/SettingsPage.tsx`, `stores/authStore.ts` | 카드 삽입, 로그아웃 해지 |

## Tasks
1. 설정+모델+마이그레이션+스키마(10m)
2. device_service/API/public-key(10m)
3. web_push_service + push_task 분기(15m)
4. 백엔드 테스트(15m)
5. sw.js + web-push.ts + 테스트(15m)
6. 설정 카드 + 로그아웃 연동(10m)
7. 전체 pytest/vitest/build 검증(10m)

## Testing Strategy
`pytest tests/test_web_push.py tests/test_push_outbox.py tests/test_devices_api.py`, 전체 pytest, `npx vitest run`, `npm run build`, `alembic heads`.
