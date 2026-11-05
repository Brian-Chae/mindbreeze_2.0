# SDD-305 — 토큰 갱신 중단 수정 계획

> 후속 구현자는 승인된 spec과 이 계획을 읽고 `superpowers:subagent-driven-development` 또는 `superpowers:executing-plans`로 진행한다. 아래 체크박스는 모두 **미실행**이다. 현재 위임은 분석·기획만 허용한다.

- 목표: 인증 갱신이 측정·적재·화면 수신을 영구 중단시키지 않게 한다.
- 구조: Android의 계정별 인증 조정자를 단일 소유자로 삼고, WebView와 모든 native 업로더가 이 경로를 사용한다. 서버는 짧은 중복 요청을 같은 결과로 수렴시키는 별도 방어를 제공한다.
- 기술: React/TypeScript, Kotlin/OkHttp/Keystore, FastAPI/SQLAlchemy/PostgreSQL. iOS Swift/Keychain은 별도 일정.
- 기준: [spec.md](spec.md), [evidence.md](evidence.md). 소요는 구현·리뷰·검증을 포함한 추정이며 인력·배포 승인은 확보되지 않았다.

## 1. 핵심 판단

서버 수명을 48시간으로 올리면 **새 로그인 뒤 한 시간 시험에서 만료가 오지 않게 하는 완화**는 가능하다. 저장소 분리와 중복 회전은 그대로여서 앱 재시작·강제 refresh·네트워크 응답 유실·48시간 경계에 재발할 수 있다. 기존 발급 JWT는 15분 exp를 유지하며, 이미 폐기된 refresh는 설정 변경만으로 복구되지 않는다.

현재 10초 유예는 동일 결과 반환이 아니라 successor 재회전이다. 숫자만 크게 늘리면 구 토큰의 재사용 허용 범위를 늘리며, 최대 5회 체인 탐색과 계속되는 저장소 불일치도 남는다. 따라서 **유예 확대만으로 해결 선언하지 않는다**.

## 2. 옵션 비교

| 안 | 효과 | 위험·한계 | 예상 변경 파일/영역 | Android 재빌드 | 시험·소요 추정 |
|---|---|---|---|---|---|
| A 서버만: access 2880분 임시 적용, 유예 확대는 별도 선택 | 다음 시험에서 access 만료 빈도 감소 | 충돌 지연일 뿐. bearer 노출 시 유효기간 15분→48시간(192배); 기존 access 일괄 즉시 폐기 아님. 유예 확대는 오래된 refresh 수용 위험·hop 한계 | dev 전용 `.env.dev` 허용 키(별도 승인 후); 유예를 바꾸면 `backend/app/services/refresh_token_service.py:96` 및 회귀시험 | 불필요 | 새 발급 수명·20대 재로그인·60분 연속 시험. 준비 1~2시간 + 실기기 60분. 15분 가속 시험에서는 미해결이 드러나야 함 |
| B 서버+클라이언트: 갱신 주체·저장·락 단일화 | 근본적인 복사본 경쟁 제거, background 대응 | bridge·로그인 bootstrap·계정 전환·구버전 호환 설계 필요. native 내부 여러 객체도 통합해야 함 | 아래 T2/T3 파일; 서버 auth 응답 계약·진단 및 회귀시험 | 필요 | 단위/bridge/실기기·APK 설치 포함 2~3 엔지니어일 추정. 내일 전 전면 적용 보장 불가 |
| C 서버 갱신 응답 멱등화 | 같은 R0의 짧은 중복에 동일 access/refresh 결과, 정상 동시 경합 흡수 | 유예보다 늦은 stale 요청·독립 오디오 저장소까지 해결하지 않음. raw 응답 캐시 보호·원자성·응답유실·정지/로그아웃 경쟁 필요 | `backend/app/services/refresh_token_service.py`, `backend/app/api/v1/auth.py`, 필요 시 refresh 모델/마이그레이션 또는 보호된 Redis 캐시, 서버 시험 | 서버 단독은 불필요 | 진짜 PG 동시성·캐시 장애 시험 포함 1~2 엔지니어일. 내일 전 검증 완료 미확약 |

선택안: **11/06에는 승인 시 A의 수명 변경만 제한된 dev 시험에 적용**, 10초 유예는 무분별하게 늘리지 않는다. **11/11 전 목표는 B(Android 우선) + C**이며 각각 시험을 통과해야 한다. A만 통과한 결과는 ‘측정 경로 시험 통과’로 표시하고 ‘토큰 갱신 해결’로 표시하지 않는다. 갱신 자체를 검증하려는 내일 시험은 격리 환경에서 15분 유지 또는 시간 가속으로 병행한다.

보안 선택은 JWT 수명을 무조건 늘리는 기술 결정이 아니라, 행사 전 임시 안정성과 재인증 정책의 비즈니스 결정이다. 웹을 단일 소유자로 만드는 대안은 구현량이 적을 수 있지만 background에서 JS 정지 시 native가 갱신할 수 없어 측정 요건에 불리하다.

## 3. 승인 후 실행 단위

### T0 — 사전 검증 게이트와 기준 고정

담당: 계획 담당자, 검증자는 별도. 산출: `specs/sdd-305-token-refresh-collision/verify.md` (구현 전 작성).

- [ ] 대표의 임시 수명·우선순위 결정을 반영하고 승인 범위를 기록한다.
- [ ] 아래 T1~T5 시나리오, 사용 계정/단말/설치 APK 버전, 기준 서버 commit, 측정 간격을 verify에 고정한다.
- [ ] 실제 APK와 분석 코드의 일치를 확인한다. 일치하지 않으면 해당 APK 소스 기준으로 경로를 재검증한다.
- [ ] 격리 시험 환경을 정하고 dev 공유 서버의 수명을 짧게 바꾸는 실험은 하지 않는다. 운영은 별도 승인 전 접근하지 않는다.

### T1 — 충돌 재현과 원인 관측 (수정 전 RED)

예정 시험: `backend/tests/test_refresh_collision.py` 신설; existing auth/refresh 관련 테스트는 파일 목록을 확인해 함께 선택. 제품 로그 수정은 이 단계 승인 후에만 한다.

- [ ] 가상 W(WebView)·N(native)가 같은 R0을 복사하고 서로 다른 store를 갖도록 구성한다.
- [ ] 실제 `/auth/refresh` 요청으로 W가 R0→R1, 2초 뒤 N이 R0→R2를 얻은 뒤 다음 15분 경계에서 W가 R1을 제출한다. 현재 코드에서 전체 폐기를 재현한다.
- [ ] 대조군: 단일 owner, 11초 지연, 5-hop 초과, 완전 동시 요청, 응답 유실 후 재시도, 401과 live:auth_expired 동시 도착을 각각 시험한다.
- [ ] PostgreSQL 실제 트랜잭션의 경쟁과 라우터 정책을 검증한다. SQLite나 함수 mock만으로 동시성 합격을 선언하지 않는다.
- [ ] 비밀 없는 `refresh_outcome`(rotated/duplicate/reuse/invalid), 호출 경로·요청 ID·세대를 기록해 향후 계정 전체 폐기 원인을 구별한다. 임의 UA만으로 신뢰 또는 보안 판정을 내리지 않는다.

실행 예정: `cd backend && pytest tests/test_refresh_collision.py -q`. 현재는 실행하지 않았다. 초기 기대: 불일치 시나리오 실패, 수정 후 같은 시나리오 성공.

### T2 — Android 인증 소유자 통합 (B)

예정 파일(기존 Android package 하위): `measurement/live/HttpTokenSource.kt`, `measurement/runtime/SealedTokenStore.kt`, `NativeRuntime.kt`, `ScopeSweeper.kt`, `ArchiveWorker.kt`, `measurement/MeasurementPlugin.kt`, 오디오 `NativeAudioRecorderPlugin.kt`, `AudioKeystore.kt`, `ChunkUploader.kt`. 새 `auth/NativeAuthCoordinator.kt`; 시험 `src/test/java/com/looxidlabs/mindbreeze/auth/NativeAuthCoordinatorTest.kt`.

제안 인터페이스(미구현): `ensureAccess(accountId, forceRefresh, observedGeneration)` → `{accessToken, expiresAt, generation}`. refresh token은 coordinator 내부에만 보관. 갱신 요청·응답 적용은 계정별 직렬화하며 generation이 지난 응답은 버린다. JS에 access를 제공하는 bridge는 기존 refresh 반환 금지 계약을 유지하도록 별도 계약 검토한다.

- [ ] 먼저 Runtime+Sweeper+오디오 동시 401에도 refresh HTTP 1회, 같은 결과 공유를 검증하는 RED 시험 작성.
- [ ] 모든 token source를 계정별 공용 owner로 연결한다. 파일의 synchronized만으로 갱신 요청 전체 락을 대신하지 않는다. 프로세스 구성 확인 후 다중 프로세스라면 IPC 단일 소유자를 사용한다.
- [ ] archive current-only 경로가 만료 토큰으로 반복 실패하지 않도록 승인된 coordinator를 통해 최신 access를 얻고 재시도하게 한다.
- [ ] 로그아웃·계정 전환·프로세스 재시작·네트워크 실패·키 저장 실패에서 stale 응답 덮어쓰기, 다른 계정 outbox 전송, 원본 삭제가 없는지 시험한다.
- [ ] 기존 로컬 암호화 outbox를 유지한 상태로 구 저장소→단일 owner 전환을 검증한다. 재로그인 필요 상태를 명시하며 silent 데이터 삭제로 이관하지 않는다.

### T3 — WebView/소켓 bridge 통합 (B)

예정 파일: `frontend/src/lib/api/client.ts`, `frontend/src/lib/api/auth.ts`, `frontend/src/stores/authStore.ts`, `frontend/src/lib/socket.ts`, `frontend/src/lib/native-measurement/index.ts`, `frontend/src/lib/measurement-web/use-native-measurement.ts`, `frontend/src/hooks/useAudioRecorder.ts`, `frontend/src/lib/native-audio-recorder/types.ts`, `frontend/src/lib/native-audio-recorder/index.ts`, measurement/audio bridge 계약 정의·fixture. 시험: `frontend/tests/native-auth-refresh.test.ts` 신설.

- [ ] native 모드에서 모든 refresh 진입점(초기화·401·소켓·refreshAuth)이 T2를 통하도록 실패 시험을 작성한다. 일반 웹은 HttpOnly 쿠키 경로를 유지한다.
- [ ] 로그인 bootstrap은 native 저장 확인 후 JS의 복제 refresh를 더 이상 독립 갱신에 쓰지 않도록 이관한다. JS reload·foreground 전환도 native owner에서 access를 복구한다.
- [ ] 오디오 시작·앱 복귀 재인계는 JS refresh 복사본 대신 불투명한 account/credential handle을 사용하는 계약으로 전환한다. `useAudioRecorder.ts:41-44,121,202-205`의 현재 토큰 쌍 필수 조건을 함께 수정하고, JS refresh가 없는 상태의 녹음 시작·복귀 및 구 APK fallback을 시험한다.
- [ ] native 결과의 access/generation만 JS 메모리와 소켓에 전달한다. Refresh token 반환 이벤트를 추가하지 않는다.
- [ ] 구 APK의 bridge 부재는 기능 탐지로 분리한다. 웹 변경만 먼저 배포하여 구 APK를 강제 고장내지 않는다. 단일 소유 계약·bridge 버전·fixture 통과 후 Android 앱을 배포한다.

### T4 — 서버 짧은 중복 요청의 멱등화 (C)

예정 파일: 비교표 서버 파일 + `backend/tests/test_refresh_collision.py`. B와 독립 리뷰 가능하지만 함께 검증해야 한다.

- [ ] 동일 old_jti의 동시 요청이 1개 successor와 **동일 access/refresh 응답**을 받는 RED 시험 작성.
- [ ] old_jti 기준 원자적 잠금/조건부 갱신과 응답 결과 보존을 설계한다. 초기 후보는 현재 10초 중복 창을 유지하는 보호된 결과 캐시이며 최종 TTL은 가속 시험으로 결정한다.
- [ ] 토큰 원문을 일반 DB/로그에 저장하지 않는다. 응답 캐시가 필요하면 암호화·접근 제한·TTL을 적용하고, DB 회전 커밋 후 캐시 저장 실패 시 복구 가능한 정책을 정한다. 단순 ‘회전 성공 후 best-effort cache’는 허용하지 않는다.
- [ ] 후속 토큰이 이미 폐기되었거나 계정이 정지·로그아웃된 경우 오래된 캐시로 되살리지 않는다. 유예 밖 진짜 재사용은 차단한다. 멱등화만으로 15분 묵은 복사본을 허용하지 않는다.
- [ ] worker 재시작·복수 인스턴스·응답 손실·캐시 장애·취소된 클라이언트 요청·비밀번호 초기화 동시 실행을 검증한다.

### T5 — 독립 검증·단계적 적용

- [ ] 구현자가 선택 시험과 빌드/타입 검사를 통과시킨다. 독립 검증자는 diff, 실제 동작, 아래 20대 증거를 다시 확인한다.
- [ ] Android APK 설치/배포는 별도 승인된 후속 작업에서 수행한다. iOS 동일 소유권 문제는 SDD-301 담당자에게 문서로 인계하되 별도 승인 없이 빌드하지 않는다.
- [ ] summary.md에 테스트·실기기 결과·잔여 위험을 기록한다. 확인되지 않은 iOS/운영까지 해결됐다고 보고하지 않는다.
- [ ] 서버 적용·push·PR·배포·정리 삭제는 이번 계획의 실행 권한에 포함되지 않는다. 후속 명시 승인에 따른다.

## 4. 시험 설계와 수치 기준

### 격리 가상 시험

- 15분 만료를 시간 가속할 경우 서버 JWT 검증 시계·서비스 시계·클라이언트 exp 판단 시계를 함께 제어한다. 단순 sleep 단축으로 결과를 왜곡하지 않는다. 또는 격리 서버만 access=60초로 두고 실제 시간이 흐르게 한다.
- W/N 두 저장소, Runtime/Sweeper/오디오 경쟁, 20계정 동시 경계를 각각 검증한다. 서버 재사용 유예는 실제 10초로 두고 요청 간격 0·2·11초 및 다음 access 만료 시점을 포함한다.
- 4회 이상 갱신 경계, 응답 지연 역전, 네트워크 단절 복구, background 20분, 앱 재시작, 로그아웃·정지·계정 전환을 시험한다.
- 합격: 모든 소비자가 단일 generation에 수렴, 비정상 계정 전체 폐기 0, 다른 계정 전송 0, 영구 실패 0. 보호 목적의 실제 탈취/로그아웃/정지 거절 시험은 계속 성공해야 한다.

### 20대 실기기 시험

1. 20대 새 로그인, 단말별 APK 버전·시험용 별칭·갱신 횟수·처음/마지막 수신 시각을 기록한다. 원본 토큰은 기록하지 않는다.
2. **근본 수정 합격 시험은 15분 정책으로 60분 이상**, 단말별 성공 갱신 최소 3회. 수명 48시간인 임시 시험은 이 항목을 대체할 수 없다.
3. 분석창은 단말별 예상 1초 생성 주기를 기준으로 서버 DB와 상담사 화면을 함께 계측한다. 안정 네트워크에서 10초 초과 연속 공백 0, 서버 저장/화면 반영 p95 지연 각각 5초 이하를 제안 합격선으로 고정한다. 기존 정상 환경도 이 기준을 못 맞추면 시험 전 측정 근거로 조정하며 사후 완화하지 않는다.
4. refresh 401=0, **미복구** REST 401=0, 비정상 계정 전체 폐기=0. 정상 토큰 회전의 revoked_at은 허용한다. Android가 401 후 갱신하는 동안 발생하는 일회성 최초 401은 별도 집계한다. 원시 401=0을 필수로 하려면 선제 갱신 구현까지 요구해야 한다.
5. auth 만료를 포함한 소켓 재접속/reauth가 10초 안에 회복되고 capture lease·stream 귀속이 유지되며 재로그인 없이 표시가 이어진다. BLE 원시 수집은 갱신 중에도 중단되지 않아야 한다.
6. 시험 종료 후 outbox drain, feature sequence 중복·누락, raw presign→upload→ack 일치와 종료 close를 확인한다. HTTP 200만으로 통과 처리하지 않는다. 강제 오프라인 시험은 고의 공백과 복구 후 보충 완료를 별도 판정한다.

실패 시: 한 대라도 영구 auth 실패/전체 폐기/허용 밖 공백이면 행사 투입 게이트 미통과. 재로그인으로 시험 시간을 다시 시작하고 성공으로 포장하지 않는다. 데이터를 보존하고 원인·적용 버전·미전송량을 기록한다.

## 5. 일정 판단과 대표 결정

- 11/06 전: A의 제한적 dev 적용은 기술적으로 가능성이 높다. 승인·서버 적용·새 로그인·60분 시험 시간이 필요하며 **현재 반영된 것은 없다**. C 단독이나 B 전면 수정의 다음 날 검증 완료는 보장하지 않는다.
- 11/11 전: B Android 우선 + C를 목표로 한다. 예상 합산 3~5 엔지니어일이며 병렬화·통합·실기기 검증 상황에 따라 행사 전 완료가 불확실하다. 최소 11/10에 20대 합격 증거가 있어야 하고 미달 시 A의 잔여 위험을 수용할지 또는 시험/행사 범위를 줄일지 대표가 결정한다.
- 임시 설정을 되돌릴 시점은 시험/행사 종료 후 승인된 점검 창으로 명시한다. 수명을 줄여도 이미 발급된 48시간 JWT는 즉시 단축되지 않으므로 ‘설정 복원=즉시 보안 복원’으로 설명하지 않는다.

대표 결정 질문(최대 3개, 이번 분석을 막지 않음):

1. 내일 dev 재시험에 한해 access 수명 48시간을 임시 허용하고 새 로그인 후 진행할 것인가, 15분을 유지해 갱신 재현 시험을 우선할 것인가?
2. 행사 전 개발 우선순위를 Android 인증 단일화·서버 멱등화에 두고 iOS 수정을 SDD-301 별도 일정으로 분리할 것인가?
3. 11/10까지 20대·60분·반복 갱신 기준을 못 넘기면 행사 사용 범위를 축소/연기할 것인가, 임시 완화의 잔여 위험을 수용할 것인가?
