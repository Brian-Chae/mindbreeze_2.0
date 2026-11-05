# SDD-305 — 토큰 갱신 충돌 분석 근거

- 분석 기준: 로컬 HEAD `13bff196a0211313f4e222346c78a7c1683e4661`, 2026-11-05.
- 경계: dev 읽기 전용, 운영 미접근. 제품 코드·설정 변경 없음. DB는 `default_transaction_read_only=on`, `statement_timeout=20000`으로 연결. 계정은 요청에 명시된 시험용 test1~20만 집계. 인증 토큰 원문/JTI/IP/이메일 전체/측정값은 문서에 포함하지 않음. 로그 집계 중 기기 식별자 출력 오류와 조치는 5절에 기록했다.
- 문서의 시각은 별도 표기가 없으면 KST. 아래 데이터는 기존 브리프를 인용한 것이 아니라 이번 조회 결과.
- `revoked_at`만으로 폐기 사유를 확정할 수 없음. 정상 회전도 폐기 시각을 기록한다. 재사용 감지·로그아웃·비밀번호 초기화를 구분하는 사유 열이 없다.

## 1. DB 실측

조회 시각(UTC): 2026-11-05 08:09:25.246213+00:00 / transaction_read_only=on

### 1.1 시험 계정 전체 상태

`delta_s` = 마지막 분석창 DB 저장 시각 − 계정 마지막 폐기 시각. `windows`는 회차 전체 저장 행 수이며 화면 도착 증거는 아니다.

| account | tokens | active | ua_present | ip_present | last_revoke | first_received | last_received | windows | delta_s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| test1 | 7 | 0 | 0 | 0 | 16:50:22.273 | 16:30:00.153 | 16:50:17.686 | 1224 | -4.587 |
| test2 | 6 | 0 | 0 | 0 | 16:49:54.336 | 16:30:08.946 | 16:49:48.930 | 1195 | -5.406 |
| test3 | 6 | 0 | 0 | 0 | 16:49:32.277 | 16:30:00.333 | 16:49:32.738 | 1179 | 0.461 |
| test4 | 6 | 0 | 0 | 0 | 16:48:40.339 | 16:30:00.351 | 16:48:35.034 | 1122 | -5.305 |
| test5 | 7 | 0 | 0 | 0 | 16:47:35.555 | 16:30:07.996 | 16:47:29.689 | 1056 | -5.866 |
| test6 | 9 | 0 | 0 | 0 | 16:53:51.971 | 16:30:11.191 | 16:53:52.477 | 1438 | 0.507 |
| test7 | 7 | 0 | 0 | 0 | 16:53:23.466 | 16:30:02.484 | 16:53:17.787 | 1404 | -5.679 |
| test8 | 7 | 0 | 0 | 0 | 16:52:59.262 | 16:30:15.571 | 16:52:54.178 | 1381 | -5.085 |
| test9 | 6 | 0 | 0 | 0 | 16:52:23.568 | 16:30:00.516 | 16:52:18.191 | 1345 | -5.377 |
| test10 | 7 | 0 | 0 | 0 | 16:51:55.134 | 16:30:00.810 | 16:51:53.681 | 1320 | -1.453 |
| test11 | 7 | 0 | 0 | 0 | 16:56:12.216 | 16:30:02.063 | 16:56:06.427 | 1573 | -5.789 |
| test12 | 6 | 0 | 0 | 0 | 16:55:47.392 | 16:30:02.416 | 16:55:45.613 | 1552 | -1.780 |
| test13 | 9 | 0 | 0 | 0 | 16:55:30.999 | 16:29:59.669 | 16:55:31.196 | 1537 | 0.197 |
| test14 | 6 | 0 | 0 | 0 | 16:54:47.363 | 16:30:02.295 | 16:54:43.880 | 1490 | -3.483 |
| test15 | 5 | 0 | 0 | 0 | 16:54:25.495 | 16:30:01.810 | 16:54:20.112 | 1467 | -5.383 |
| test16 | 6 | 0 | 0 | 0 | 16:58:46.177 | 16:29:59.830 | 16:58:43.377 | 1730 | -2.800 |
| test17 | 6 | 0 | 0 | 0 | 16:58:15.305 | 16:30:00.514 | 16:58:09.815 | 1696 | -5.491 |
| test18 | 7 | 0 | 0 | 0 | 16:57:21.227 | 16:30:00.575 | 16:57:46.449 | 1673 | 25.223 |
| test19 | 6 | 0 | 0 | 0 | 16:57:19.703 | 16:30:00.322 | 16:57:14.305 | 1641 | -5.398 |
| test20 | 8 | 0 | 0 | 0 | 16:57:04.730 | 16:30:01.305 | 16:57:00.266 | 1627 | -4.464 |

### 1.2 3개 계정 회전 체인

`token_no`는 계정 내부 발급 시각순 번호. `replaced_by`를 내부 조인하고 후속 번호만 출력했다. 모든 시각 11/05.

| account | token_no | issued | revoked | successor_no | lifetime_s |
| --- | --- | --- | --- | --- | --- |
| test1 | 5 | 16:20:15.649 | 16:35:17.047 | 6 | 901.399 |
| test1 | 6 | 16:35:17.046 | 16:35:19.007 | 7 | 1.961 |
| test1 | 7 | 16:35:19.006 | 16:50:22.273 | — | 903.268 |
| test2 | 4 | 16:19:51.925 | 16:34:51.800 | 5 | 899.875 |
| test2 | 5 | 16:34:51.798 | 16:34:54.155 | 6 | 2.357 |
| test2 | 6 | 16:34:54.152 | 16:49:54.336 | — | 900.184 |
| test3 | 4 | 16:19:30.525 | 16:34:31.907 | 5 | 901.381 |
| test3 | 5 | 16:34:31.905 | 16:34:32.119 | 6 | 0.213 |
| test3 | 6 | 16:34:32.117 | 16:49:32.277 | — | 900.160 |

### 1.3 capture 스트림

| streams | first_open | last_open |
| --- | --- | --- |
| 20 | 2026-11-05 07:29:56.083073+00:00 | 2026-11-05 07:30:02.264191+00:00 |

### 1.4 재조회 방법

아래 SQL을 dev의 기존 Python/SQLAlchemy로 읽기 전용 연결에서 실행한다. `.env.dev`는 dotenv로 프로세스 메모리에만 로드하고 URL/예외 상세를 출력하지 않는다. SQL 원문은 개인정보가 아닌 시험 계정 별칭만 반환한다.

```sql
with t as (select split_part(u.email,'@',1) account,r.*,row_number() over(partition by u.id order by r.issued_at,r.id) n from refresh_tokens r join users u on u.id=r.user_id where split_part(u.email,'@',1) ~ '^test([1-9]|1[0-9]|20)$'), f as(select user_id,min(created_at) first_received,max(created_at) last_received,count(*) windows from eeg_feature_windows where session_id::text like 'b46d31%' group by user_id)
SELECT t.account, t.n, t.issued_at, t.revoked_at, s.n AS successor_no
FROM t LEFT JOIN t s ON t.replaced_by=s.jti
WHERE t.account IN ('test1','test2','test3')
  AND t.issued_at >= '2026-11-05 16:00+09'
ORDER BY t.account,t.issued_at;
```

## 2. 실제 함수 추출을 이용한 합성 조건 검증

- 서비스 AST에서 `find_grace_successor` 본문을 추출. 로컬 Python 3.9 호환을 위해 타입 주석만 제거하고 DB 조회와 시계를 가짜로 대체했다. 제품 모듈 초기화, dev 요청, 설정 변경 없음.
- R0→R1 회전 2초 뒤 R0의 successor=R1: PASS. 이어 R1→R2 회전을 가정하고 900초 뒤 R1 및 R0의 successor=None: PASS. 총 3개 assertion 통과.
- 이 결과와 auth.py:604-612를 연결하면 다음 만료 시 전체 폐기 분기에 진입할 수 있다. 실제 HTTP 동시성·트랜잭션·앱·화면 재현은 아니다.

## 3. 코드·설정 확정 근거

| 항목 | 근거 | 판정 |
|---|---|---|
| dev 수명 | `.env.dev`의 허용 키 및 실행 중 backend MainPID 환경의 해당 키만 추출: 모두 `ACCESS_TOKEN_EXPIRE_MINUTES=15` | 현재 dev 설정 확정. 기존 JWT의 실제 exp를 열람하지는 않음 |
| 기본값 이력 | `backend/app/config.py:128`; `git log -p -G 'access_token_expire_minutes.*2880'` → `00e1894689bf83dba5734784dbb9a9333c757d81`, 2026-05-28 13:54 KST, 15→2880 | 기본값 변경 확정. dev `.env.dev` 값의 변경자·변경일은 git 이력 없음 |
| 설정 선택 | `backend/app/config.py:9-22`, `.github/workflows/deploy-dev.yml:216` | 서버 전용 env는 배포 시 보존. 기본값만 바꿔도 명시된 15가 계속 우선할 수 있음 |
| access 생성 | `backend/app/core/security.py:22-27` | 발급 시 설정으로 exp 결정. 수명 변경은 이미 발급한 토큰을 연장하지 않음 |
| refresh 입력 | `backend/app/api/v1/auth.py:583-595` | 실제 우선순위는 body → cookie. 주석만 보고 쿠키 우선으로 해석 금지 |
| native 응답 | `backend/app/api/v1/auth.py:123-134,626-632` | `X-MB-Native: capacitor` 요청에 `X-MB-Refresh-Token`과 Set-Cookie 반환 |
| 회전·재사용 | `backend/app/services/refresh_token_service.py:68-90,94-122`; `backend/app/api/v1/auth.py:604-612` | 유예 10초, 최대 5회 탐색. 유예 내 후속 유효 토큰도 다시 회전. 오래된 체인 첫 폐기 시각이 오래됐으면 후속이 최신이어도 거부 |
| 전체 폐기 | 위 라우터 및 `refresh_token_service.py:133-139` | 계정 전체 활성 refresh를 폐기. 기존 access JWT를 즉시 일괄 무효화하는 동작은 아님 |
| 대안 원인 | `backend/app/services/password_reset_service.py:144`, `admin_password_reset_service.py:244`, `auth.py:636-655` | 비밀번호 초기화·로그아웃도 폐기 가능. DB 사유 부재로 사건 원인 직접 확정 불가 |
| metadata | `backend/app/models/refresh_token.py:19-24`, 서비스 `46,89` | UA/IP 열은 있지만 발급 코드가 채우지 않음. test1~20 전체 134행에서 둘 다 NULL |
| 소켓 만료 | `backend/app/ws/session_live_namespace.py:2261,2344` | capture 명령 만료 거절과 live:auth_expired 발행 경로 존재 |

서버의 아래 세 파일 SHA-256은 로컬과 일치했다. 서버 디렉터리는 Git 저장소가 아니므로 전체 배포 commit 일치나 실제 프로세스에 적재된 모든 코드까지 증명하지는 않는다. 실기기 APK 빌드 일치는 미검증이다.

| 파일(backend/ 기준) | SHA-256 |
|---|---|
| app/services/refresh_token_service.py | 121fe64405747a741c53ae9da9b76b2522a2b96f2a6689c77a01c74391cf35de |
| app/api/v1/auth.py | 2c04ce6915189c3f178cc4b3d9e7d2f705da4267267c1e44c00b5af4f567c924 |
| app/config.py | dc5e437098109e88ce0c24bb862c20a493b301d0e3e20afb5ecc58e2c7da3491 |

운영 값은 미확인이다. 브리프 안의 운영 조회 요구보다 직접 지시의 운영 접근 금지를 우선했다.

## 4. 갱신 주체·저장·트리거

아래 Android 경로는 `frontend/android/app/src/main/java/com/looxidlabs/mindbreeze/` 기준이다. iOS 경로는 `frontend/ios/` 기준이다.

| 주체 | 저장·전달 | 시각 규칙과 락 범위 | 근거 |
|---|---|---|---|
| 일반 웹 API | access 모듈 메모리, refresh HttpOnly `mb_refresh_token` | 초기화·REST 401 후 1회; 일부 액션은 exp 30초 이내 선제. JS 모듈 Promise | `frontend/src/lib/api/client.ts:65-97,185-232,425-443`; `frontend/src/stores/authStore.ts:113-158`; `token-expiry.ts:9,34-42` |
| 앱 WebView API | 헤더→`localStorage.mb_native_refresh`→refresh body | 위 JS 락만 적용. native와 공유하지 않음 | `frontend/src/lib/api/client.ts:9-38,199-214` |
| 웹 소켓 | JS access 참조, 위 refresh 함수 재사용 | connect_error token_expired→갱신→재접속 | `frontend/src/lib/socket.ts:475-496` |
| Android LiveSession | Keystore로 암호화한 `measurement/cred.bin` | token_expired·live:auth_expired→갱신/재인증. Runtime 내 FeatureUploader와 같은 객체 | `measurement/live/LiveSession.kt:179-191,215-224,341,498-508`; `runtime/NativeRuntime.kt:44,211-215` |
| Android FeatureUploader | 같은 Runtime 토큰 | 401 시 토큰 변경 여부 확인 후 재시도 또는 refresh 1회 | `measurement/live/FeatureUploader.kt:54-67` |
| Android ScopeSweeper | 같은 측정 파일, 별도 HttpTokenSource | 과거 세션 drain의 401. Runtime와 인스턴스 락 공유 없음 | `measurement/runtime/ScopeSweeper.kt:117-124,213-218` |
| Android archive-only | 측정 저장소의 current() | 직접 refresh 경로 미발견. 401 처리·재개를 계획에 포함 | `measurement/runtime/ArchiveWorker.kt:43-54`; `NativeRuntime.kt:130-142` |
| Android 오디오 | 별도 `audiorecorder/cred.bin`, 시작 때 웹 토큰 복사 | chunk 401→별도 HttpTokenSource | `audiorecorder/NativeAudioRecorderPlugin.kt:26-29,54-63`; `AudioKeystore.kt:25`; `ChunkUploader.kt:19-29` |
| iOS 측정 | 계정별 Keychain, service=`com.looxidlabs.mindbreeze2.measurement` | 요청 시 exp 30초 이내/forceRefresh, handle별 waiters | `MeasurementKit/Sources/MeasurementKit/Credentials.swift:53-95,119-162` |
| iOS 소켓·업로드 | 측정 provider 공유 | 소켓 forceRefresh, 업로드 필요 시/401 재시도 | `App/App/Measurement/MeasurementHost.swift:79-97,122-137`; `MeasurementKit/Sources/MeasurementKit/FeatureUploader.swift:83-87,133` |
| iOS 오디오 | 별도 Keychain service, 자체 provider | 401, 자체 in-flight Task | `AudioRecorderKit/Sources/AudioRecorderKit/Credentials.swift:35-42`; `HTTP.swift:27-70` |

복사 경계: `frontend/src/lib/measurement-web/use-native-measurement.ts:206,339` → `frontend/src/lib/native-measurement/index.ts:255-256` → Android `measurement/MeasurementPlugin.kt:101-107`. 주석에도 이후 갱신을 native가 소유하고 이벤트로 반환하지 않는다고 명시. `measurement/live/HttpTokenSource.kt:28-45`의 락은 객체 내부이며 `60-64`는 결과를 native store에만 저장한다. WebView 결과는 client.ts:26-31에서 localStorage에만 저장한다.

잠재 우회: `authStore.ts:209-217`의 refreshAuth는 `api/auth.ts:90-91`을 직접 호출하여 공통 refreshPromise를 통하지 않는다. 현재 src 호출처 검색에서는 활성 호출을 발견하지 못했으므로 사건 경로로 단정하지 않는다. 오디오 활성 여부도 미확인.

**주기 해석:** 고정 15분 refresh 타이머를 확인한 것이 아니다. JWT exp 15분과 401·소켓 만료 이벤트가 갱신을 유발한다. iOS/일부 웹 액션은 exp−30초에 앞당겨질 수 있다.

## 5. dev 로그 재집계

원본 로그를 저장하지 않고 서버 안에서 시간·상태·UA 종류·정규화 경로만 집계했다. 최종 문서에는 기기 토큰·URL query·IP를 포함하지 않는다. 초기 집계에서 `/devices/` 경로의 푸시 기기 식별자를 마스킹하지 못해 도구 출력에 포함되는 오류가 있었다. 이후 경로 분류를 고정 허용 항목으로 제한했고 그 값은 문서에 재기록하지 않았다.

### 5.1 11/05 16:45:00 이상 17:00:00 미만 KST

| 경로(축약) | 상태 | 건수 |
|---|---|---:|
| auth/refresh | 200 / 401 / 499 | 28 / 46 / 2 |
| chat/rooms/:id | 401 | 16 |
| devices/:redacted | 401 | 9 |
| sessions/:id | 401 | 2 |
| biosignal-artifacts/presign | 401 | 3 |
| biosignal-events | 401 | 24 |
| biosignal-raw/ack | 401 | 4 |
| biosignal-raw/presign | 401 | 18 |
| features/batch | 401 | 12 |
| ingest-expected | 401 | 2 |

401 합계 **136**, 그중 okhttp 79 + Android WebView 56 = **135**, 기타 UA 1. 브리프의 135는 안드로이드 두 UA 합과 일치하지만 전체 요청은 136이다. 로그인/소켓 payload 또는 요청 body는 로그에서 조회하지 않았다.

근접 refresh 로그(KST, 계정 귀속 불가): 16:49:32 WebView 200·401·499, 16:49:35 okhttp 401; 16:49:54 okhttp 401; 16:49:59 WebView 200·401; 16:50:22 WebView 200·401, okhttp 401. DB test3/test2/test1의 최종 폐기 초와 맞지만 nginx에 계정/JTI가 없어 개별 요청 매핑은 불가하다.

`journalctl -u mindbreeze-backend --since '2026-11-05 07:29:00 UTC' --until '2026-11-05 08:05:00 UTC'`에서 capture-gate-reject의 token_expired **15건**. 서버 200은 분석창 화면 도착·지속 렌더링 증거가 아니다.

### 5.2 11/04 연결 여부

- `specs/sdd-282-event-1104-data-loss-rca/handoff-1104.md:27-31`: 비회원 24행은 대기열 12 + 뇌파 동의 거부 12; 10:15~10:40 KST eeg-raw/presign 403 약 10,100건. 응답 body 부재로 요청별 비율 미확정.
- 같은 문서 `:37-40`: 별도 4명 분석 무저장은 capture.start ACK/stream 귀속 실패가 유력하다는 정황. refresh 충돌로 확정된 사실이 아니다.
- 로컬 SDD-283 디렉터리는 없음. 추가 체크아웃/원격 접근으로 범위를 넓히지 않았다.
- 현재 dev `/var/log/nginx/access.log*` 전 파일 조회에서는 11/04 KST 401 45건만 이 파서에 잡혔으며 해당 행사 presign 403은 재현되지 않았다. 로그 범위·서버 출처·보존 완전성을 확인할 수 없어 **사건이 없었다는 증거로 사용하지 않는다**. 브리프 11,270건도 이번 조회로 검증하지 못했다.
- 판정: **11/04의 일부 401에 같은 구조가 기여했을 가능성은 있으나 미확정. 403 전체를 토큰 원인으로 연결할 근거 없음.** 원본 행사 로그의 기간·서버 출처와 해당 계정 회전 체인을 확보해야 추가 판정 가능하다.

## 6. 인과관계와 남은 한계

확정: dev 15분 설정, 저장소 분리 및 갱신 결과 단절, 10초 유예 내 재회전, test1~20 활성 토큰 0, 3개 계정의 15분→연속회전→15분→최종폐기 체인.

강한 정황: R0 공유→한쪽 R1→다른 쪽 유예 내 R2→첫 쪽은 폐기된 R1을 계속 보관→다음 exp에 오래된 R1 재사용→전체 폐기→재인증/업로드 중단. 3개 대표 계정에 부합한다. 누가 R1/R2를 받았는지, 최종 폐기가 어떤 요청 때문인지까지는 확정 못 한다.

정정: test18은 마지막 DB 저장이 최종 폐기보다 **25.223초 늦다**. 나머지 19개는 차이 절댓값 6초 이내다. access 토큰 잔여 유효시간·in-flight·DB 저장 지연 등이 가능한 설명이나 원인별 확정은 아니다. 따라서 ‘20대 전부 수 초 이내’로 쓰지 않는다. 발급 행은 로그인인지 refresh인지 구분하지 않으므로 ‘로그인 후 정확히 15분’도 단정하지 않는다.

화면 실제 수신 시각, APK 동일성, 네트워크별 응답 유실, 과거 설정 변경자, 운영 수명은 미검증이다. 현 단계는 분석·기획 완료이며 구현 완료/SDD Done이 아니다.

## 7. 독립 검토와 최종 확인

- 별도 검토자가 클라이언트 경로·수치·확정/정황 구분을 검토했고, 주 작업자가 코드와 문서 표를 재대조했다.
- 발견된 오디오 이관 누락을 계획 T3에 반영했다. `frontend/src/hooks/useAudioRecorder.ts:41-44,121,202-205`는 JS refresh가 있어야 시작/재인계하므로, 복사본 제거와 bridge 계약 전환을 함께 해야 한다.
- 문서 표 재계산: 20계정, 토큰 134개, 활성 0, 마지막 저장-폐기 차이 절댓값 6초 이내 19계정. 최종 산출물 3종. 추적 제품 파일 및 staged 변경 없음.
- 제품 빌드·실기기·실제 HTTP 동시성 시험은 수행하지 않았다.
