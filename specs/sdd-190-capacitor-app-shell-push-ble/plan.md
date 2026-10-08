# [SDD-190] — Implementation Plan

**Goal:** Capacitor 앱 셸 + 푸시(등록·발송·딥링크) + BLE 어댑터.
**Architecture:**
```text
앱(Capacitor) ─ PushNotifications ─▶ POST /api/v1/devices ─▶ device_tokens
notification_outbox(push,pending) ─▶ process_push_outbox_cron ─▶ push_service(FCM v1) ─▶ 기기
푸시 탭 ─▶ deeplink(/app/ai | /agent) ─▶ 라우터
BLE: useBand ─▶ BluetoothAdapter ─┬ WebBluetoothAdapter(기존)
                                   └ CapacitorBleAdapter(앱, 참조 저장소 방식)
```

## Contract
| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/v1/devices` | `{token: string, platform: 'ios'\|'android', app_version?: string, device_label?: string}` | `{id: string, token: string, platform: string}` (upsert, 현재 사용자) |
| DELETE | `/api/v1/devices/{token}` | — | 204 (본인 토큰만, 없으면 404) |
FCM data payload: `{"deeplink": "/app/ai", "message_id": "<uuid>"}` + notification `{title, body}` (SDD-188/189 Outbox payload 그대로).
환경변수: `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_JSON`(파일 경로 또는 JSON 문자열) — 둘 다 있을 때만 발송.

## Files to Change
| Action | File | Description |
|---|---|---|
| Create | `backend/alembic/versions/e036a0000038_sdd_190_device_tokens.py` | down=e036a0000037 |
| Create | `backend/app/models/device_token.py` + `models/__init__.py` | 모델 |
| Create | `backend/app/services/push_service.py` | FCM v1 발송·토큰 revoke |
| Create | `backend/app/services/device_service.py`, `backend/app/api/v1/devices.py` + 라우터 등록 | 등록/해지 API |
| Create | `backend/app/tasks/push_task.py`, `backend/process_push_outbox_cron.py` | 소비 cron |
| Modify | `backend/app/config.py` | FCM 설정(.env 값은 읽지 않음, 이름만) |
| Modify | `.github/workflows/deploy-dev.yml` | cron 등록·파일 복사 |
| Create | `backend/tests/test_push_*.py`, `test_devices_api.py` | 테스트 |
| Modify | `frontend/package.json`, lock | Capacitor 의존성·스크립트 |
| Create | `frontend/capacitor.config.ts` | 앱 설정 |
| Create | `frontend/android/`, `frontend/ios/` (가능한 범위) | 네이티브 프로젝트 |
| Create | `frontend/src/lib/native/platform.ts`, `push.ts`, `use-push-registration.ts` | 플랫폼 감지·푸시 |
| Create | `frontend/src/lib/ble/*` (어댑터) / Modify `hooks/useBand.ts` | BLE 어댑터 도입(웹 경로 무변경) |
| Modify | 앱 루트/로그인·로그아웃 지점 | 푸시 등록/해지 연결 |
| Create | `frontend/tests/native-*.test.ts`, `ble-adapter*.test.ts` | vitest |
| Create | `docs/capacitor-app-셸-운영가이드.md` | 빌드·FCM 설정·APNs·권한 절차 |

## Tasks
1. 마이그레이션·모델·API (15m) 2. push_service(FCM, 모킹 테스트) (15m) 3. 소비 cron·outbox 충돌 점검·deploy (15m) 4. 백엔드 테스트 (10m) 5. Capacitor 도입·config·cap add (20m) 6. 푸시 등록 훅·딥링크 (15m) 7. BLE 어댑터(참조 저장소 분석 후) (25m) 8. vitest·회귀·운영 가이드 (15m)
BE(backend/)와 FE(frontend/, docs/) 병렬 가능. 마이그레이션 revision id 038 고정.

## Testing Strategy
pytest(푸시 모킹: httpx MockTransport), `alembic heads`, `npm run build`, `tsc`, `vitest run`, `npx cap sync`(가능 시), 웹 회귀(`isNativeApp()`=false).
