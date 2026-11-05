# SDD-305 — 구현 요약 (C 서버 + B Android/웹)

> 상태: 구현·자동 시험 완료. **실기기 20대 합격 시험 미수행 → "해결"로 표시하지 않는다.** 푸시·PR·배포·앱 빌드 없음.

## C — 서버 멱등화
- 같은 old refresh 의 유예(10초) 안 중복 요청은 첫 회전이 만든 **같은 access·refresh 쌍**을 받는다(추가 회전 없음).
- `refresh_tokens.rotation_result`(Fernet 암호문, 키는 `jwt_secret_key` 유도) 추가 — 마이그레이션 `d305a1rot001`(가산, NULL 허용).
- 회전 UPDATE(`revoked_at`·`replaced_by`·`rotation_result`)와 후속 토큰 INSERT 가 **한 커밋** → "회전 후 best-effort 캐시" 아님. 경쟁 패자는 승자 커밋 뒤 결과를 읽는다.
- 되살리지 않는 조건: 유예 초과, 후속 토큰 폐기(로그아웃), 전체 폐기(`revoke_all_user_tokens` 가 암호문도 비움), 정지 계정, 키 불일치/손상.
- 유예 밖 진짜 재사용은 기존대로 전체 폐기. 결과 암호문이 없는 구 행은 기존 `find_grace_successor` 경로 유지.
- 관측: `[auth] refresh_outcome=rotated|duplicate|reuse|invalid caller=web|native|native:<source> reason=…` (토큰·기기 값 없음).

## B — Android + 웹 bridge
- `auth/NativeAuthCoordinator.kt`: 저장소(파일 경로)별 단일 조정자. `ensureAccess(apiBase, http, expectedAccount, forceRefresh, observedGeneration)`.
  - 직렬 single-flight, 세대(generation)로 중복 회전 제거, epoch 로 로그아웃·계정 전환·인계 뒤 늦은 응답 폐기.
  - 키 저장소 쓰기 실패 시 서버가 회전해 준 새 쌍을 메모리에 보관했다가 재저장(옛 refresh 재사용 금지).
  - 400/401/403 만 Invalid(저장소 비움), 그 외는 Transient.
  - `adoptIfNewer`: 같은 계정에서 저장된 쪽이 더 새로우면 JS 복사본을 무시(뒤로 가지 않음).
- `HttpTokenSource`·`NativeRuntime`·`ScopeSweeper`·`ArchiveWorker`·오디오가 모두 같은 조정자를 거친다. 오디오 저장소는 측정 저장소로 통합(구 `audiorecorder/cred.bin` 은 삭제하지 않음).
- 플러그인: `getCapabilities.authCoordinator=1`, `ensureAccess`, `signOutNative`, `handoffCredentials`(뒤로 안 감). **refresh 토큰을 JS 로 돌려주는 메서드·이벤트 없음.**
- 웹: `lib/native-auth/`(기능 탐지 후에만 활성). `refreshAccessTokenResult`(초기화·401·소켓·`refreshAuth` 공통 진입점)가 native 조정자를 거침. 로그아웃·세션 만료는 `nativeSignOut`.
- 구 APK 호환: capability 없음/조회 실패 → 기존 쿠키·localStorage 경로 그대로(웹만 먼저 배포해도 안전). 일반 웹은 HttpOnly 쿠키 경로 유지.
- 구 빌드가 localStorage 에 남긴 refresh 는 native 가 비어 있을 때만 1회 이관 후 삭제.

## 시험
| 영역 | 결과 |
|---|---|
| 백엔드 `test_refresh_collision.py` (SQLite) | 8 통과 |
| 백엔드 PG 실제 경쟁 `tests/pg/test_sdd305_refresh_pg.py` (로컬 PG16 임시 DB, 8 연결 동시) | 2 통과 |
| 백엔드 auth/refresh/password/login/token 관련 전체 | 682 통과, 25 skip, 실패 0 |
| Android JVM `:app:testDevDebugUnitTest` 전체 | 296 통과, 실패 0 (신규 조정자 10건 포함) |
| 프런트 `tsc -b` / `native-auth-refresh.test.ts` | 아래 보고 참조 |

## 한계·미확인
- 실기기 20대·60분·반복 갱신, 앱 재시작/백그라운드 실측 **미수행**(verify.md §4 기준으로 후속).
- 15분 수명 격리 서버 시험은 서버 단위(C1~C10)로 충돌 재현→해소를 증명했고, 앱 레벨 가속 시험은 미수행.
- Android 앱 재빌드 필요(웹만 배포하면 구 APK 는 기존 경로로 동작 — 해결 효과 없음).

## iOS 후속 (이번 범위 밖, 문서화만)
- `MeasurementKit/Credentials.swift`·`LiveSession.swift`·`NativeBridgeAPI.swift` 와 `AudioRecorderKit/Credentials.swift` 가 **서로 다른 저장소**에서 refresh 를 회전 → Android 와 같은 위험.
- 후속: 계정별 단일 조정자(Keychain 단일 항목 + 직렬 큐 + generation/epoch), 오디오 저장소 통합, `authCoordinator` capability 로 웹 분기.
- 웹의 native 분기는 현재 `Capacitor.getPlatform()==='android'` 에서만 켜진다(iOS 는 기존 경로 유지).
