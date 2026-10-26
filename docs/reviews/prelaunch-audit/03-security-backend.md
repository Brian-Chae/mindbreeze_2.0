# 03. 공개 전 보안·코드 리스크 감사 (백엔드·프론트 번들·앱 셸)

- 감사일: 2026-10-18 / 대상: `mindbreeze_2.0` develop (HEAD `c02ebbc1`)
- 방식: 정적 분석 + 로컬 도구(grep, AST 라우트 열거, `npm audit`, `pip-audit`) 한정. 코드 수정·git 쓰기·서버/DB 접속·고객 개인정보 조회 없음.
- 시크릿 값은 출력하지 않음(경로·접두사·길이만).
- 표기: **확인** = 코드/출력으로 직접 확인, **추정** = 코드 정황상 추론(실서버 미확인).
- 전제: "마켓 공개 = 불특정 다수가 내담자(client)로 자가 가입 가능 + 클래스 입장 코드로 비회원(게스트) 접근 가능". 상담사·기관관리자는 신청/초대 승인제(`signup_applications`, 초대 토큰)라 공개 가입 대상이 아님(확인).

---

## 1. 발견 사항 (심각도순)

| 심각도 | 항목 | 근거 파일:라인 | 문제 | 권고 조치 |
|---|---|---|---|---|
| **차단** | 내담자 자가 계정 삭제(탈퇴) 기능 없음 | `backend/app/api/v1/auth.py` (`DELETE /users/me` 없음, `PATCH /users/me`만 :943), `admin.py:276` (관리자 전용 `DELETE /users/{user_id}`), FE `src/` 에 탈퇴 UI 없음(grep 확인) | 앱스토어(Apple 5.1.1(v))·Play 데이터 삭제 정책은 앱 내 계정 삭제 제공을 요구. 뇌파·상담 기록 등 민감정보 서비스라 심사 거절 + 개인정보보호법(삭제 요구권) 리스크. 확인 | 본인 `DELETE /auth/users/me`(비밀번호/재인증 필수) 추가: 개인정보 비식별화·S3 원본(녹음/EEG raw) 삭제·토큰 전체 폐기·연구동의 철회 연동(`retention_sweep_service`, `original_deletion_service` 재사용 가능). 설정 화면에 진입점 |
| **차단** | Google 로그인만 제공, Apple 로그인 없음 | `frontend/src/` Apple 연동 코드 없음(grep: design 목업만 hit), `auth.py:739` `/google` 만 | iOS 앱에 서드파티 소셜 로그인(Google)을 제공하면 Apple 4.8 에 따라 "Sign in with Apple" 또는 동급 대안 필수. 심사 거절 사유. 확인(코드 부재) — 심사 판정은 01-store-policy 문서와 교차 확인 | Sign in with Apple 추가(백엔드 `/auth/apple` id_token `aud`·`iss` 검증 포함) 또는 iOS에서 소셜 로그인 제거(이메일 로그인만) |
| **높음** | 공개 가입 후 비용 폭주 방어 없음 — 내담자 AI 에이전트(Gemini) 호출에 사용자별 쿼터/레이트리밋 없음 | `api/v1/agent.py:70-110` (`POST /agent/messages`, `/messages/stream` 은 `require_roles("client")`만), `schemas/agent.py:109`(메시지 1,000자 상한뿐), `services/agent_service.py` 에 일일 횟수/토큰 상한 grep 결과 없음. 전역 레이트리밋 라이브러리 없음(`slowapi|Limiter` grep 0건) | 이메일 OTP 통과한 계정 N개(무료 가입)로 스트림 호출을 반복하면 Gemini 비용이 선형 증가. `agent_llm.py` 의 `ThreadPoolExecutor(max_workers=4)` 는 동시성만 제한할 뿐 총량 제한이 아님. 확인 | 사용자별 일/분 상한(Redis 카운터, 예: 분당 N회·일 M회) + 전역 일일 예산 서킷브레이커 + 상한 초과 시 429. 가입 단계에 IP/디바이스 기준 가입 제한도 병행 |
| **높음** | 공개 엔드포인트 IP 단위 레이트리밋 부재 — OTP 메일 발송(메일 폭탄·Resend 비용·발신 평판) | `auth.py:276-284` `request-otp`: 이메일별 60초 쿨다운(`otp_service.py:30`)만 존재, IP 제한 없음. `/auth/password/forgot`(`password_reset_service.py:48`)도 이메일별 쿨다운만. `signup_applications.py:38,63` 도 이메일별 쿨다운만(`signup_application_service.py:46`) | 서로 다른 이메일 주소를 대량으로 넣으면 제한 없이 메일이 발송됨(제3자 스팸·발신 도메인 블랙리스트·Resend 과금). 확인 | IP+전역 슬라이딩 윈도우 제한(엣지 nginx `limit_req` 또는 앱 레벨), 일일 발송 상한, 가입 폼에 봇 방어(Turnstile/reCAPTCHA) |
| **높음** | 프론트 의존성 취약점: `@capacitor/ios`·`@capacitor/android` 8.3.4 (critical) | `frontend/package.json:28,31,32` 정확 고정 `8.3.4`; `npm audit --omit=dev`: GHSA-rvm3-566m-v7fv ("내부 HTTP 프록시 경로로 앱 오리진에 원격 콘텐츠 로드", 영향 8.0.0–8.3.4), 수정 8.5.3 | 앱 WebView 오리진(토큰 보관 localStorage 포함)에 원격 콘텐츠가 로드될 수 있는 네이티브 셸 취약점. 앱 번들에 그대로 포함되어 사용자가 업데이트하기 전까지 고정. 확인 | `@capacitor/core/ios/android` 를 8.5.3 이상으로 일괄 상향 후 `cap sync`, 실기기 BLE/푸시/Google 로그인 회귀 테스트 |
| **높음** | 프론트 의존성 취약점: `react-router` (high 다수) / `socket.io-parser` / `ws` / `brace-expansion` | `npm audit --omit=dev` 결과 8건(critical 2·high 4·moderate 2). `package.json:46` `react-router-dom ^7.15.1` 이 영향 범위(≤7.18.1)에 해당 | `<Link>`/`useNavigate` 백슬래시 open redirect(CVE-2025-68470 우회) 등. SSR/RSC 계열은 이 SPA에 비해당(추정)이나 open redirect 는 해당 가능. 확인(목록) / 영향도는 추정 | `npm audit fix`(일부 non-force) 적용 후 `package-lock.json` 갱신·빌드·E2E 재실행 |
| **높음** | 백엔드 의존성 취약점 12건(6개 패키지) | `backend/requirements.txt` 대상 `pip-audit --no-deps`: `python-socketio 5.16.1`(PYSEC-2026-3042, fix 5.16.2), `python-multipart 0.0.29`(PYSEC-2026-3036/3037 fix 0.0.30, 3040 fix 0.0.31), `python-jose 3.5.0`(PYSEC-2026-4298, 수정 버전 미표기), `pydantic-settings 2.14.1`(GHSA-4xgf-cpjx-pc3j, fix 2.14.2), `weasyprint 68.1`(3412/3940/4311, fix 70.0), `pypdf 6.18.1`(4157/4159/4160, fix 6.19.0) | multipart·socketio는 인터넷에 직접 노출되는 파서(업로드/WS). weasyprint 는 리포트 PDF 생성에 사용 — 사용자 입력이 HTML에 들어가면 SSRF/파일 접근 경로. 세부 영향은 어드바이저리별 확인 필요(추정). `weasyprint`·`pypdf` 는 requirements.txt 에 보이지 않고(상단 50행 기준 미확인) 다른 요구 파일/venv 로 설치되었을 수 있음 — 선언·고정 위치 재확인 필요 | 최소 `python-multipart`·`python-socketio`·`pydantic-settings`·`pypdf`·`weasyprint` 상향 후 pytest. `python-jose` 는 유지보수 둔화 → `PyJWT`/`authlib` 이전 검토 |
| **높음** | 비회원/내담자 raw EEG presigned PUT 에 ContentLength 상한 미서명 → 임의 대용량 업로드 가능 | `services/storage_service.py:136-148` (서명 Params 에 `ContentLength` 없음; 600s 만료), `schemas/eeg.py:94` `size_bytes: int \| None = Field(None, ge=0)`(상한 없음), `eeg_raw_service.py:218-224` ack 는 클라이언트가 신고한 size 와 비교만 | 서명 URL 로 키 범위는 세션/참가자 경로로 제한되지만(확인: 서버가 key 결정) 크기 제한이 없어 S3 저장 비용 남용·스토리지 고갈 가능. 청크 배치 500개/요청 × 반복 요청에도 세션 총량 상한 없음(`eeg_raw_service.py` 에 MAX 총량 grep 0건). 확인 | presign 시 `ContentLength`(또는 POST policy `content-length-range`)를 서명에 포함, `size_bytes` 필수화 + 상한(청크 N MB), 세션/참가자당 총 청크 수·용량 상한 |
| **높음** | 운영 API 에 OpenAPI/Swagger 문서 노출 | `backend/app/main.py:153-158` `FastAPI(...)` 에 `docs_url/redoc_url/openapi_url=None` 지정 없음; nginx `location /`(`deploy/templates/nginx/mindbreeze.conf.tpl:103`)가 전체 프록시 | 공개 시 `/docs`, `/openapi.json` 으로 관리자·내부 엔드포인트 전체 명세가 누구에게나 노출되어 공격 표면 탐색을 도움. 확인(코드) / 실서버 응답은 미확인 | 운영(`environment=production`)에서 `docs_url=None, redoc_url=None, openapi_url=None` 또는 nginx 에서 차단 |
| **중간** | 앱 빌드 스크립트 기본값이 dev API 를 가리킴 / 현재 번들이 모두 dev 빌드 | `frontend/package.json:16,18` `cap:sync`, `cap:ios` 는 `npm run build`(모드 지정 없음) → `frontend/.env`(=`dev-api.mindbreeze.looxidlabs.com`, 미추적) 사용. `:prod` 스크립트(`:17,20,22`)만 `--mode prod` → `.env.prod`(`api.mindbreeze.looxidlabs.com`). 현재 `frontend/dist`, `ios/App/App/public`, `android/.../assets/public` 모두 `dev-api` 하드코딩 포함(각 4파일), 빌드시각 10/15–10/16 | 실수로 `cap:ios`/`cap:sync`/`cap:android`(비-prod) 로 아카이브하면 스토어 앱이 dev 서버(테스터 계정 15개 DB)를 바라봄. 확인 | `cap:ios`/`cap:android`/`cap:sync` 기본 스크립트 제거 또는 prod 로 치환, 릴리즈 스크립트에 "번들 내 `dev-api` 문자열 0건" 검사 게이트 추가(CI `release-build.yml` 에는 이미 prod 호스트 주입이 있으므로 로컬 경로만 정리) |
| **중간** | 프로덕션 번들에 디자인/내부 페이지 포함 및 비인증 노출 | `frontend/src/App.tsx:55-62,202-209` `/design`, `/design/homepage`, `/design/app`, `/design/user-app`, `/design/report`, `/design/docs`, `/design/class-player`, `/design/class-flow` — **RoleGuard 없음**(비로그인 접근 가능). 번들에 `DesignIndexPage-*.js`, `PlaygroundPage-*.js` 포함(dist 확인). `/playground`(:264)는 `RoleGuard`(역할 무관 로그인 시 접근) | 내부 디자인 문서·기능 목업이 외부에 공개되고 앱 심사 시 미완성/내부 페이지로 비칠 수 있음. 데이터 노출 자체는 정적 목업(추정). `/playground` 는 내담자도 접근 가능한 BLE 디버그 화면 | `import.meta.env.DEV` 또는 빌드 플래그로 `design/*`·`playground` 라우트·청크 제거, 최소 `RoleGuard role="platform_admin"` |
| **중간** | 공개 정적 `chat-test.html` 이 번들(dist)에 포함 | `frontend/public/chat-test.html`(→ `dist/chat-test.html`, 103행) | 운영 웹 호스트에 테스트 페이지가 배포됨(내용은 레이아웃 데모로 보이며 비밀 없음 — 확인). 내부 산출물 노출 | `public/` 에서 제거 |
| **중간** | 네이티브 refresh token 을 WebView localStorage 에 평문 저장 | `frontend/src/lib/api/client.ts:15-33` `NATIVE_REFRESH_KEY='mb_native_refresh'` → `localStorage.setItem`, 서버가 `X-MB-Native: capacitor` 헤더만 있으면 refresh 토큰을 응답 헤더로 반환(`auth.py:119-122`). `Capacitor Preferences/SecureStorage/Keychain` 사용 흔적 없음(grep) | XSS·앱 번들 취약점(위 Capacitor critical) 발생 시 14일짜리 refresh 토큰이 탈취됨. 또한 아무 클라이언트나 헤더만 붙이면 토큰을 헤더로 받을 수 있음(단, CORS 허용 오리진 제한은 있음) — 확인. access token 은 메모 보관(`client.ts:56`, 양호) | 네이티브는 Keychain/Keystore 기반 보안 저장 플러그인으로 이전, 앱 무결성(오리진 `capacitor://localhost`/`https://localhost`) 확인 |
| **중간** | access token 수명 48시간 + 서버측 즉시 폐기 수단 제한 | `backend/app/config.py:42` `access_token_expire_minutes=2880`; 운영 매니페스트도 2880(`deploy/env-manifest.tsv:11`) | 의료·상담 민감 데이터 앱 기준 길다. 정지/삭제 계정은 매 요청 DB 재조회로 차단(`deps.py:~50`, 양호)하나, 비밀번호 변경 후 기존 access token 은 최대 48h 유효(refresh 는 전체 폐기 — 확인 `refresh_token_service`) | 15–60분으로 단축(refresh 로 연장), 비밀번호 변경 시각 이후 발급분만 허용하는 클레임 검사 |
| **중간** | 로그인 잠금 키가 클라이언트 IP 에 의존 — 프록시 설정에 따라 우회/오탐 | `auth.py:233` `request.client.host`, `session.py:100` `_client_ip` 동일. uvicorn 은 `--host 127.0.0.1` 만 지정(`deploy/templates/systemd/mindbreeze-backend.service.tpl:13`, `--proxy-headers` 미지정이나 uvicorn 기본값은 활성 + 신뢰 IP 127.0.0.1), nginx 는 `$proxy_add_x_forwarded_for`(`mindbreeze.conf.tpl:98,110`) | 지금 구조(nginx→127.0.0.1)는 실 클라이언트 IP 가 복원될 가능성이 높음(추정). 단 ALB/CloudFront 가 앞에 추가되면 전 사용자가 단일 IP 로 보여 클래스 입장코드 시도 제한(`class_code_attempt_service`)이 서로 간섭하거나, 반대로 헤더 신뢰 설정 오류 시 위조 가능 | 운영 토폴로지 확정 후 `--forwarded-allow-ips`·실제 IP 복원 e2e 확인. 로그인은 이메일+IP 복합이므로 (이메일 단독 전역 상한도 추가) |
| **중간** | 계정 열거 가능 경로 (로그인 역할 불일치 메시지, 가입 OTP) | `auth.py:138-143` `_ensure_login_role`: 비밀번호가 맞은 뒤에만 403 반환(양호 — 비밀번호 검증 후). `auth.py:228-250` 로그인 실패 메시지는 통일(양호). 반면 `/auth/email/request-otp` 는 가입 가능 여부를 응답에서 구분하는지 `_create_user_with_role` 이전에는 확인되지 않음 | 로그인·비밀번호 재설정은 열거 방지됨(확인). 가입 완료 단계(`_create_user_with_role`)의 중복 이메일 응답이 열거 수단이 될 수 있음 — 해당 함수 중복 처리 분기는 이번에 정독하지 않음(추정, 낮음) | `register` 중복 시 응답 문구 통일 또는 OTP 단계에서 항상 동일 응답 |
| **중간** | 공개 무인증 조회(기관 코드·상담사 코드) 무차별 대입 제한 없음 | `api/v1/org_public.py:17` `GET /o/{org_code}`(6자리 영숫자 `code_service.py:15-16` → 36^6≈2.2×10^9), `org.py:112,168` 검색/상세, `auth.py:538` `counselor-code/check`(OTP 토큰 보유자 한정이나 가입은 무료) | 열거 비용이 높아 즉시 위험은 낮으나 요청 수 제한이 없어 자동화 스캔 가능. 기관/상담사 목록 수집·상담사에게 원치 않는 내담자 연결 시도 가능 | 엣지 레이트리밋, 실패율 기반 차단 |
| **중간** | 보안 헤더 미흡 (CSP·X-Frame-Options 없음) | `deploy/templates/nginx/mindbreeze.conf.tpl:39-41,62-63,81-82` HSTS·nosniff·Referrer-Policy 만 | 웹 버전에서 클릭재킹·XSS 완화 부족. 확인 | `Content-Security-Policy`(frame-ancestors 포함)·`X-Frame-Options`·`Permissions-Policy`(마이크/카메라/BLE) 추가 |
| **중간** | 서버 업로드 크기 한도와 nginx 설정 불일치 가능 | `services/upload_service.py:19-21` 오디오 청크 50MB·비디오 청크 200MB. nginx 템플릿에 `client_max_body_size` 지정 없음(grep 0건, 기본 1MB) | 운영 nginx 에서 1MB 초과 청크가 413 으로 실패할 수 있고(기능 리스크), 반대로 크게 풀면 비인증 경로 포함 대용량 요청 공격 표면이 커짐. 추정(별도 nginx.conf 에서 설정되었을 가능성) | 경로별(`/sessions/*/audio|video/chunk` 만) 한도 명시, 그 외 기본 소량 유지 |
| **중간** | 보고서 열람·재설정 토큰이 쿼리스트링 → 접근 로그 잔존 | `reports.py:29,39` `GET /reports/view?token=`, `session.py:744` `report-email/view?token=`; uvicorn 접근 로그에 `token=` 마스킹 없음(`core/log_redaction.py` 는 `/by-code/`·`access_code=` 만 마스킹) | 이메일 링크 방식이라 불가피하나, 로그 접근자가 유효 토큰으로 리포트(PII)를 열람 가능. 응답 헤더(no-store, no-referrer)는 적절히 설정됨(양호) | `log_redaction` 패턴에 `token=` 추가, 토큰 TTL·일회성 점검 |
| **중간** | 운영 설정 fail-fast 가 `ENVIRONMENT` 명시 설정에 의존 | `main.py:118` `if cfg.environment != "production" or "environment" not in cfg.model_fields_set: return []`; `config.py:98` 기본값 `production` | 운영에서 `ENVIRONMENT` 를 누락하면 CORS·S3·dev 주소 검증이 전부 건너뛰어짐(소켓 CORS 도 `"*"` 폴백: `cors.py:45-49`). `JWT_SECRET_KEY` 는 길이/엔트로피 검사 없이 비어있지만 않으면 통과(`main.py:138`). 확인 | `ENVIRONMENT` 필수화(미설정 시 기동 실패), JWT 시크릿 최소 길이(32+) 검사 |
| **낮음** | 비밀번호 정책 단순 | `schemas/auth.py:8` 정규식 8자 이상+영문+숫자+특수문자, 최대 길이·유출 비밀번호 검사 없음(로그인 요청 `password: str` 무제한 `:43,98`) | 해시는 argon2(`passlib[argon2]`) — 긴 비밀번호 입력으로 인한 CPU DoS 가능성(추정). 복잡도 규칙 위주라 `Password1!` 류 허용 | `max_length=128` 지정, 일반/유출 비밀번호 차단 |
| **낮음** | 구글 `access_token` 경로는 `email_verified` 미검사 | `auth.py:788-797` access_token 분기는 `userinfo` 응답 `email_verified` 확인 없이 진행(id_token 분기 `:773` 은 검사) | 신규/기존 계정 병합 시 미인증 이메일로 기존 계정에 연결될 가능성(Google 계정 대부분 검증됨 → 실현성 낮음, 추정). aud 검증은 양쪽 모두 존재(양호) | access_token 분기에도 `email_verified == true` 강제 |
| **낮음** | 로그에 이메일 평문 | `services/notification_service.py:182` `logger.error(f"... {to_email}")` (다른 곳은 마스킹: `tasks/email.py:65`) | 개인정보 로그 잔존(소량). 확인 | 마스킹 헬퍼 통일 |
| **낮음** | 개발 전용 라우트 존재(운영 제외 조건 확인됨) | `api/v1/__init__.py:41-47` `environment != "production" and enable_dev_role_simulation` 일 때만 `dev_auth` 포함; `main.py:129` 운영에서 켜져 있으면 기동 중단; FE `LoginPage.tsx:13`, `authStore.ts:180` 는 `import.meta.env.DEV` 게이트 | 방어는 이중으로 양호. 단 `dev` 서버 도메인에서는 `ENABLE_DEV_ROLE_SIMULATION` 이 켜져 있다면(추정) 스토어 검수용 빌드가 dev 를 가리킬 때 전 계정 가장 가능 | 스토어 제출 빌드가 dev 로 향하지 않게 위 "빌드 스크립트" 항목 조치 |
| **낮음** | 안드로이드 `android:allowBackup="false"` 양호이나 `<access origin="*"/>` (Cordova 호환 설정) | `android/app/src/main/res/xml/config.xml:3` | Capacitor 는 이 설정을 네비게이션 제한에 쓰지 않으나(추정) 불필요한 와일드카드. `capacitor.config.ts` 에 `server.allowNavigation`·cleartext 없음(양호) | 불필요 시 제거 |

---

## 2. 항목별 점검 결과 요약 (범위 (1)~(7))

### (1) 시크릿
- 번들 grep(`AKIA|AIza|sk-|re_…|ghp_|xox*|PRIVATE KEY`): `frontend/dist`, `ios/App/App/public`, `android/app/src/main/assets/public` **0건**(확인).
- git 추적 `.env*`: `backend/.env.dev.template`, `backend/.env.prod.template` **2개뿐**(템플릿, 값 마스킹 후 확인 — 실값 없음). `frontend/.env*`, `backend/.env` 는 `.gitignore:6-7` 로 무시됨(확인).
- 워크플로 `VITE_*` 주입: `VITE_GOOGLE_CLIENT_ID`(공개 클라이언트 ID, 비밀 아님), `VITE_API_BASE_URL`, `VITE_PUBLIC_APP_URL` 만. 서버 시크릿(`GEMINI_API_KEY`, SSH 키)은 서버 측 단계에서만 사용(`deploy-dev.yml:97-172`). **프론트 번들에 비밀이 주입되는 경로 없음**(확인).
- git 히스토리 `git log --all -S` (`AKIA`, `BEGIN PRIVATE KEY`, `BEGIN RSA PRIVATE KEY`, `AIzaSy`, `sk-proj`): hit 6개 커밋 모두 **테스트 픽스처/마스킹 정규식**(`AKIAX`, `AKIAREALKEY123` 등 더미)으로 확인. 실키 유출 정황 없음. `.pem/.key/.p12/.jks/google-services/serviceAccount` 추적 파일 0건. (※ 가벼운 `-S` 검색 한정 — 전수 스캔은 아님. 공개 전 `gitleaks`/`trufflehog` 1회 권장)
- 워크플로 권한: `deploy-prod/release-build/rollback-prod` 는 `permissions:` 선언(확인). 서드파티 액션은 `appleboy/*` 가 태그 고정(`@v0.1.7`,`@v1.0.3`, SHA 미고정) — 낮은 위험, SHA 고정 권장.

### (2) 환경 분리
- `release-build.yml:116-120` 은 prod 호스트 주입 + `GOOGLE_CLIENT_ID_PROD` 미설정 시 중단(양호).
- 번들 내 URL: `dev-api.mindbreeze.looxidlabs.com`(현 dist = dev 빌드), `localhost:8000`(env 미주입 폴백, `client.ts:35`, `socket.ts:35`, `api/video.ts:6`, `api/audio.ts:6`). prod 빌드는 `.env.prod`/CI env 가 주입되므로 폴백은 미사용(양호). `18.183.86.88` 은 소스·번들에 없음(확인).
- 테스트 계정(`counselor@test.com`, `client@test.com`, `test1234`) : `frontend/src` 및 번들 **0건**(확인).
- 테스트/디자인 라우트: 위 표 참조(프로덕션 번들 포함).

### (3) 백엔드 인증/인가
- AST 로 `backend/app/api/v1` 전체 라우트 열거 후 인증 의존성(`get_current_user*`/`require_*`) 없는 라우트를 추림 → 무인증은 **의도된 공개**뿐: 로그인/가입/OTP/비밀번호 재설정/`/google`, `signup-applications`(기관·개인상담사 신청), 기관 공개 조회(`/org/search`,`/org/{id}`,`/o/{code}`), 리포트 이메일 토큰 열람, 클래스 오디오 트랙 목록, 정규화 활성 모델, 클래스 입장(`/sessions/enter*`, 시도 제한 있음), 연구 내보내기(서비스 토큰 헤더), `/dev/auth/*`(운영 미등록). **인증 누락 엔드포인트 없음**(확인).
- `agent`/`agent_counselor` 라우터는 `require_roles`(client / counselor) 사용(확인).
- 관리자 API(`admin.py` 전체) 및 `normalization`: `require_roles`/`require_platform_admin` 적용. 기관관리자 범위는 `org.py:43 _require_org_admin`(membership 기반 — 타 기관 접근 차단, 확인).
- IDOR 표본 점검(호출 서비스 정독): 세션 상세(`session_service.get_session` → 참여자/호스트 검사 + PII 는 호스트만), 리포트(`report_service.get_report`: 참여자 소유자 검사, counselor 리포트는 내담자 차단 — 코드 주석 `RPT-IDOR-001`), 영상 URL/스트림(`video.py:64,95`: 호스트 또는 platform_admin 만), EEG 롤업(`session.py:616` 호스트 전용), LiveKit 호스트 토큰(`session.py:691` 호스트 전용), 내담자 목록/상세(`client_service.py:115,161`: 활성 연결만), 데이터 내보내기(`data_exports.py` 작업 소유자 기준 조회 + 거부 감사). **표본 범위 내 IDOR 미발견**. (전 엔드포인트 정독은 아님 — `chat`, `notifications`, `onboarding`, `records`, `credential` 은 의존성 존재만 확인)
- WebSocket: `/chat`·`/record` 는 JWT 검증 + 계정 상태 재확인 + 방 가입 시 멤버십 검사(`chat_namespace.py:46-107`, `record_namespace.py:53-136`), `/session-live` 는 입장 자격/참여자 검증 후 역할별 룸 분리(호스트/전체/본인, `session_live_namespace.py:257-267`). 미발견. 단 운영 CORS 폴백 `"*"` 은 위 표(환경변수 의존).
- 업로드 URL(S3 presigned): PUT 은 서버가 키를 정하고 SSE 강제·만료 ≤900s(`storage_service.py:27-28,120`), GET 은 ≤300s(`:369`)로 양호. 단 ContentLength 미서명(표 참조).

### (4) 가입/인증
- 로그인: 이메일+IP 5회/15분 잠금(`login_attempt_service.py`), 실패 메시지 통일, suspended/pending 차단. 양호.
- 비밀번호 재설정: 항상 204(열거 방지), jti 기반 일회용 + Redis TTL(`password_reset_service.py:56-62`), 재설정 시 전체 세션 폐기(스킬 S12 기준 — 코드 직접 정독은 `initiate_reset` 까지; `complete_reset` 폐기 호출은 미재확인 → 추정 양호).
- refresh: 회전 + 재사용 감지 시 전체 폐기(`auth.py:582-635`), httpOnly+SameSite=Lax 쿠키(`:123-131`). 양호.
- 소셜: id_token·access_token 모두 `aud` 검증(`auth.py:760-795`), `google_client_id` 미설정 시 503(fail-closed). 양호 (Apple 부재는 위 표).
- 회원가입 남용: 이메일 OTP 필수(`auth.py:184-225`), 약관·민감정보 동의 필수. 단 IP/디바이스 제한·봇 방어 없음(위 표).

### (5) 데이터
- 에러 응답: 전역 핸들러가 스택 비노출(`main.py:185-191`, 양호).
- CORS: `allow_credentials=True` + 오리진 화이트리스트(와일드카드 아님, `main.py:160-168`). 운영은 `CORS_ALLOWED_ORIGINS` 필수 + `*`/dev/http 오리진 시 기동 실패(`main.py:63-72`) — 단 환경변수 명시 설정 의존(위 표). 허용 오리진에 `https://localhost`·`capacitor://localhost`(앱 WebView) 포함 — 앱 특성상 필요.
- 로그 PII: 이메일·푸시토큰 마스킹 헬퍼 사용이 대부분(양호), 예외 1곳(위 표). 비밀번호/JWT 직접 로그 grep 0건.
- 토큰 저장: access=메모, refresh=웹 httpOnly 쿠키(양호) / 네이티브 localStorage(위 표). 사용자 객체(이름·이메일·역할)는 localStorage(`authStore.ts:70-78`) — 비밀 아님.
- 웹뷰: `capacitor.config.ts` 에 `server.url`/`allowNavigation`/cleartext 없음, iOS Info.plist 에 `NSAppTransportSecurity` 예외 없음, Android `usesCleartextTraffic`·`networkSecurityConfig` 지정 없음(기본 안전, 확인). `dangerouslySetInnerHTML` 사용 0건(`src`, 테스트 제외).

### (6) 의존성
- 프론트 `npm audit --omit=dev`: 8건(critical 2: Capacitor ios/android, high 4: brace-expansion·react-router·socket.io-parser·ws, moderate 2). 표 참조.
- 백엔드 `pip-audit -r requirements.txt --no-deps`: 12건/6패키지. 표 참조. `--no-deps` 이므로 전이 의존성은 미포함 — 추가 취약점 가능(추정).

### (7) 부하/남용
- 업로드: 오디오 청크 50MB·비디오 200MB 스트리밍 상한(`upload_service.py:19-47`, 양호). 자격증명 파일은 MIME 화이트리스트 + 매직바이트 검증(`credential_service.py:25-82`, 양호).
- 비용 발생: STT/요약은 상담사(승인제) 녹음 흐름이라 공개 가입의 직접 표면은 아님(확인). **공개 가입자가 직접 호출 가능한 비용 엔드포인트는 내담자 AI 에이전트 + 메일 발송(OTP/재설정)** — 둘 다 쿼터 없음(표 최상단 높음 항목).
- 게스트(입장 코드) 경로: 코드 시도 제한 있음(`session.py:104-125`). 게스트가 쓰는 EEG feature/raw presign/report-email 은 입장 자격 필요(양호) — 단 presign 용량 상한 부재(표).

---

## 3. 권고 우선순위 (공개 전 필수 → 권장)

1. [차단] 내담자 자가 계정 삭제 구현 + 설정 진입점
2. [차단] iOS 소셜 로그인 정책 해소(Apple 로그인 추가 또는 소셜 제거)
3. [높음] 내담자 AI 에이전트 쿼터/레이트리밋 + 전역 일일 예산 차단기
4. [높음] OTP·재설정·신청 메일 IP/전역 레이트리밋 + 봇 방어
5. [높음] Capacitor 8.5.3+ 상향, `npm audit fix`, 백엔드 의존성 상향
6. [높음] presigned PUT ContentLength 서명 + 세션 총량 상한
7. [높음] 운영 `/docs`·`/openapi.json` 비활성
8. [중간] 비-prod `cap:*` 스크립트 제거 + "번들 내 dev-api 0건" 릴리즈 게이트
9. [중간] `design/*`·`playground`·`chat-test.html` 운영 번들 제외
10. [중간] 네이티브 refresh token 보안 저장소 이전, access TTL 단축, CSP/보안 헤더, `ENVIRONMENT` 필수화

---

## 4. 깨끗한 항목 (확인 후 문제 없음)

- 번들·워크플로·git 추적 파일에 실제 시크릿 없음(패턴 grep + `git log -S` 가벼운 검색 기준).
- 백엔드 라우트 인증 누락 없음(AST 열거), 관리자·기관관리자·상담사·내담자 역할 게이트 적용, 표본 IDOR 미발견.
- WebSocket 3개 네임스페이스 인증·룸 권한 검사 존재.
- JWT: type 클레임 분리(access/refresh), 미설정 시 기동 실패, refresh 회전·재사용 감지, 정지 계정 매 요청 차단.
- 구글 로그인 `aud` 검증(양쪽 경로), 로그인 실패 메시지 통일, 로그인 잠금, 비밀번호 재설정 열거 방지.
- 전역 예외 핸들러가 스택 미노출, CORS 와일드카드 아님(+운영 fail-fast), 접근 로그에 입장 코드 마스킹.
- 업로드: 청크 크기 상한, 자격증명 파일 MIME+매직바이트 검증, S3 SSE 강제, presigned 만료 단기.
- 개발 전용 로그인(`dev_auth`)은 운영 미등록 + 이중 기동 차단, FE 도 `DEV` 게이트.
- 웹뷰: cleartext/allowNavigation/ATS 예외 없음, `allowBackup=false`, `dangerouslySetInnerHTML` 없음.
- 테스트 계정 정보가 프론트 소스·번들에 없음.

## 5. 한계

- 실서버/DB/운영 nginx 실제 설정·응답은 확인하지 않음(정적 분석 한정). "추정" 표기 항목은 운영 설정 확인 필요.
- 전 엔드포인트 서비스 로직 정독은 아님(표본). 채팅·알림·온보딩·기록·자격증명의 소유권 검사는 별도 정밀 감사 권장.
- `git log -S` 는 가벼운 패턴 검색 한정. 공개 직전 전용 스캐너(gitleaks 등) 1회 권장.
- 의존성 취약점의 실제 도달 가능성(사용 코드 경로)은 어드바이저리별로 검증하지 않음.
