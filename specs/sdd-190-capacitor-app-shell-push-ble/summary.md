# [SDD-190] — Summary

> 상태: Stage ④~⑥ **코드·모킹 테스트 완료**, 실기기/자격증명 검증은 미완료. Review 대기.

## What Was Built
| File | Description |
|------|-------------|
| `backend/alembic/versions/e036a0000038_sdd_190_device_tokens.py`, `models/device_token.py` | 디바이스 토큰 |
| `backend/app/services/device_service.py`, `api/v1/devices.py` | `POST /api/v1/devices`(upsert·소유 이전), `DELETE /api/v1/devices/{token}` |
| `backend/app/services/push_service.py` | FCM HTTP v1 발송(`FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_JSON` 설정 시에만), 잘못된 토큰 revoke |
| `backend/app/tasks/push_task.py`, `backend/process_push_outbox_cron.py` | push Outbox 소비(행 선점·재시도·skipped/expired), 미설정 시 비소비 |
| `.github/workflows/deploy-dev.yml` | push cron 등록 |
| `frontend/capacitor.config.ts`, `package.json`, `package-lock.json` | Capacitor 8.3.4 + app/push-notifications + bluetooth-le 8.2.0 (참조 저장소와 동일 버전대) |
| `frontend/android/`, `frontend/ios/` | `cap add android/ios` 성공(iOS는 SPM), 권한(BLE/알림), 자격증명 파일 gitignore |
| `frontend/src/lib/native/*`, `main.tsx`, `stores/authStore.ts` | 플랫폼 감지, 푸시 등록/해지, 딥링크 화이트리스트(`/agent`, `/app/*`), 웹 no-op |
| `frontend/src/lib/ble/*`, `hooks/useBand.ts`, `lib/eeg/bluetooth/index.ts` | Web/Capacitor BLE 어댑터(기존 웹 경로 유지) |
| `docs/capacitor-app-셸-운영가이드.md` | 빌드·FCM·APNs·권한·미완료 항목 |
| tests | 백엔드 푸시/디바이스 테스트, 프론트 native-push/native-bootstrap/ble-adapter |

## Test Results
- ✅ 백엔드 전체 1533 passed / 0 failed, `alembic heads` 단일 `e036a0000038`
- ✅ 프론트 `tsc -b --noEmit`·`npm run build` 통과 (`npm install --legacy-peer-deps`로 App/Push 설치 후 Supervisor 확인), `npx cap sync` 정상(플러그인 3종)
- ✅ 프론트 vitest: 신규 41 passed, 전체 395 passed / 15 failed(기존 무관)

## Debugging Journey
- FE 워커 샌드박스는 네트워크가 막혀 `npm install` 실패 → 참조 저장소의 설치본으로 부분 생성. Supervisor가 네트워크 환경에서 `npm install --legacy-peer-deps`로 보완, 타입·빌드 통과 확인.

## Not Verified / 운영 설정 필요
1. **FCM 자격증명 없음**: 서버 `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_JSON` 설정 + Firebase 앱 설정 파일 배치 전에는 푸시가 나가지 않는다(Outbox `pending` 유지, 24시간 후 expired).
2. **iOS**: APNs 키를 Firebase에 업로드, Xcode 서명·Push capability 확인 필요.
3. **실기기 검증 필요**: 로그인·푸시 권한/수신/탭/로그아웃, BLE 스캔·연결·재연결(Android/iOS 모두).
4. Xcode/Gradle 네이티브 컴파일은 실행하지 않음.
5. 스토어 등록·심사는 범위 밖.
