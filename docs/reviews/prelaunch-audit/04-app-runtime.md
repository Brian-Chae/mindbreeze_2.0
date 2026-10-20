# 출시 전 점검 04 — 클래스·세션 구조 / 모바일 앱(Capacitor) 런타임

> 2026-10-18 · 읽기 전용 감사(코드 수정·git 쓰기·외부 발송 없음) · 기준: `develop` @ `c02ebbc1`
> 표기: **확인** = 코드·로그로 직접 확인 / **추정** = 코드 정황만. 실기기(iOS/Android) 실행은 하지 않았다 → 네이티브 동작은 전부 정적 분석 기준.

## 0. 테스트·빌드 실행 결과 (develop 작업 트리, 각각 별도 실행)

| 항목 | 명령 | 결과 |
|---|---|---|
| 타입 검사 | `cd frontend && npx tsc -b --noEmit` | 출력 0줄(오류 없음) |
| 린트 | `cd frontend && npx eslint .` | 9건(오류 5·경고 4). **`src/` 는 0건**. 오류 5건은 ① `android/app/build/intermediates/**/native-bridge.js` 빌드 산출물 2건(규칙 정의 없음) ② `tests/agent-page.test.tsx` require-yield 2건 ③ `tests/use-media-check.test.tsx` react-hooks/globals 1건. CI 는 `eslint src/` 만 보므로 CI 영향 없음, 단 `eslint .` 은 빌드 산출물 때문에 상시 실패 |
| 단위 테스트 | `cd frontend && npx vitest run` | **11 실패 / 1621 통과 (파일 6 실패 / 111 통과)**. 실패 분류: ⓐ `*-browser.test.cjs`·`report-*-pdf.test.cjs` 7건 = 로컬 dev 서버(127.0.0.1:5175) 미기동으로 `ECONNREFUSED`(환경 요인, 코드 결함 아님) ⓑ `agent-counselor-page.test.tsx` 2건(`unread` 단언·jsdom `HTMLInputElement` setter 오류) ⓒ `chat-message-deeplink.test.ts` 2건(최근 대화 복귀 버튼 미발견). ⓑⓒ 4건은 원인 미조사 → 앱 코드 결함인지 테스트 노후인지 **추정 불가** |
| 백엔드 | `backend/venv/bin/python -m pytest -x -q` | **2082 통과 / 12 skip / 0 실패** (370초) |
| alembic | `alembic heads` | 헤드 1개 `e036a0000051`, 리비전 파일 84개(+`__pycache__`) |

---

## 1. 요약 — 상위 10개

1. **[차단] iOS `Info.plist` 에 카메라·마이크 사용 목적 문구(NSCameraUsageDescription / NSMicrophoneUsageDescription) 없음** — 클래스 입장·녹음·화상이 전부 `getUserMedia` 의존. 문구 없으면 iOS 가 접근 시 앱을 종료하고 App Store 심사에서 반려된다.
2. **[차단] 계정 삭제(회원 탈퇴) 기능 없음** — 앱 내 UI·API 모두 0건(Apple 5.1.1(v)·Google Play 계정 삭제 정책 필수).
3. **[차단] 심사자 접근 경로 없음** — 회원 가입은 `상담사 코드` 또는 초대 토큰 필수, 상담사는 직접 가입 불가(기관 초대 전용). 데모 모드·심사용 계정 안내 코드 없음.
4. **[높음] SDD-211 Phase 0 구현이 `develop` 에 병합되지 않음** — 역할 가드(client 세션 생성 차단)·`리뷰 중` 마스킹(승인 전 리포트 회원 노출 차단)·`session_authz`·PG 스모크가 전부 `sdd/211-phase0` 브랜치에만 있다. 현재 develop(=출시 후보)은 **승인 전 리포트 본문이 회원에게 노출**되고 **client 토큰으로 세션 생성 가능**.
5. **[높음] 구버전 앱 대응 장치 없음** — 최소 버전 체크·강제 업데이트 API/화면 0건. 기기 등록 시 `app_version` 만 저장(`backend/app/services/device_service.py:55`). 스토어 배포 후 계약 변경(SDD-211 `in_review` 마스킹 등) 시 구 앱이 빈 리포트를 렌더(plan R16).
6. **[높음] 에러 모니터링(Sentry 등) 없음** — `frontend/src`·`backend/app` 전체에 0건. 푸시 등록 실패 등이 `catch {}` 로 삼켜짐(`frontend/src/lib/native/push.ts:75,81`).
7. **[높음] 앱 백그라운드/복귀 처리 부재** — `appStateChange`·`pause/resume` 리스너 0건. 녹음 중 앱 전환 시 MediaRecorder·WebSocket·LiveKit 연결 복구 로직을 찾지 못함(iOS `UIBackgroundModes` 도 미선언). 녹음 실패 청크는 **메모리 배열에만** 보관(`hooks/useAudioRecorder.ts:66`) → 강제종료 시 유실.
8. **[높음] 번들에 대용량 정적 자산 포함** — `dist` 99MB(`public/bgm` 56MB·`mb-design` 32MB·`videos` 4.6MB)가 `webDir: dist` 로 앱 바이너리에 그대로 들어감. 스토어 용량·OTA 불가.
9. **[중간] 출시 화면에 "준비 중" 문구/죽은 버튼** — 상담사 온보딩 자격증 업로드, 회원 리포트 `PDF 생성 (준비 중)` 버튼, 기관 `가입 요청 관리`.
10. **[중간] 릴리즈 파이프라인·버전 정책 미비** — 모바일 빌드 워크플로 없음(`.github/workflows` 에 Android/iOS 없음), iOS `MARKETING_VERSION=1.0`·`CURRENT_PROJECT_VERSION=1` 고정, Android 는 `-PversionCode` 주입 의존(기본 1), `package.json` 버전 `0.0.0`, Android `minifyEnabled false`.

---

## 2. 상세 표

심각도: 차단 / 높음 / 중간 / 낮음

### (1) 미완 마이그레이션 · 구/신 구조 공존

| 심각도 | 항목 | 근거 | 문제 | 권고 조치 |
|---|---|---|---|---|
| 높음 | SDD-211 구현 미병합 | `git log develop..sdd/211-phase0` 30개 커밋·130 파일(+15043/−3048). `backend/app/services/session_authz.py`·`session_terms.py`·`backend/tests/contract/`·`frontend/src/lib/terms.ts` 가 develop 에 **없음**(ls 실패 확인) | 출시 후보(develop)에 Phase 0 안전망(역할 가드·리포트 마스킹·PG 스모크·계약 스냅샷) 부재. `specs/sdd-211-class-structure-phase0/summary.md` 도 없음(SDD 4종 미완) | 출시 범위 결정: ⓐ Phase 0 병합 후 출시 ⓑ 미병합 시 R6-X1(승인 전 리포트 노출)·R1(client 세션 생성) 을 알려진 위험으로 명시 |
| 높음 | 승인 전 리포트 회원 노출(확정 이슈) | `specs/sdd-211.../plan.md` F6 — `report_service.py:584`, `:722-765`, `client_portal.py:257-262` | 회원이 `pending_review`·생성 중·실패 리포트의 본문·지표·상담사 코멘트 초안을 목록/상세/홈에서 열람. 개인정보·의료 성격 데이터 | 위 병합 또는 동등 핫픽스 |
| 중간 | client 토큰 세션 생성/수정 가능 | plan F4 — `app/api/v1/session.py:86,203,272,288,314` 가 `get_current_user` 만 사용 | 정상 호출자는 없으나 API 직접 호출 시 가능(plan 이 확인) | 병합 시 해소(R1) |
| 중간 | SDD-208 summary 없음, SDD-211 summary 없음 | `ls specs/sdd-208-class-player-redesign`(spec·plan·verify 만), `specs/sdd-211.../`(summary 없음) | AGENTS.md "SDD 완료 = 4종" 기준 미충족 | summary 작성 |
| 낮음 | 알려진 한계: 데이터 의존 마이그레이션 가드가 실데이터로 검증 안 됨 | plan §10 #6 — `e036a0000044`(활성 코드 중복 시 중단)·`…030`·`…026` | 중복 데이터가 있는 DB 에서 `upgrade` 가 중단될 수 있음. prod 는 빈 환경이라 영향 낮음(SDD-210 컷오버 결과 = 빈 운영 환경, 커밋 `c02ebbc1`) | 추후 기관 데이터 이관 시 사전 질의로 확인 |
| 중간 | 다운그레이드 불가 리비전 5개 | 비어 있는(pass/raise) `downgrade`: `001fd31549c5`·`0e240d60b539`(merge), `e036a0000028`·`e036a0000030`·`e036a0000044` | DB 롤백은 정책상 사용 안 함(plan 롤백 총칙 = 코드 revert 만)이라 **확인된 정책과는 일치**하나, 롤백 가능성 관점에서 `…028`(paused 제거)·`…030`(이메일 정규화)·`…044`(활성 코드 유니크)는 비가역 | 배포 전 RDS 스냅샷 필수(`deploy-prod` 전 절차에 포함돼 있는지 확인 필요 — 이번에 미확인) |
| 낮음 | 구/신 라우트 공존 | `App.tsx:174` `/agent` → `/chat/lucy` 리다이렉트 유지, `src/lib/eeg/bleConnection.ts`(Web Bluetooth 전용)는 import 0건(죽은 코드) | 데이터 불일치는 아님. 죽은 코드만 존재 | 정리(비차단) |
| 낮음 | 정적 dead link | 소스의 `navigate()/to=/href=` 정적 경로를 `App.tsx` 라우트와 대조 → 불일치 0건 | 동적 생성 경로는 검사 못 함 | — |

### (2) 권한 흐름

| 심각도 | 항목 | 근거 | 문제 | 권고 조치 |
|---|---|---|---|---|
| **차단** | iOS 카메라/마이크 사용 설명 누락 | `frontend/ios/App/App/Info.plist` — `NSCameraUsageDescription`·`NSMicrophoneUsageDescription` grep 0건(Bluetooth 문구만 `:59`) | `getUserMedia` 사용처 다수(`useAudioRecorder`·`useVideoRecorder`·`useMediaCheck`·`ClassPlayerPage`·`HostLiveContainer`). iOS 는 설명 없이 접근하면 크래시, 심사 반려 | 두 키에 한국어 사용 목적 추가 |
| 중간 | iOS 푸시 백그라운드 모드·알림 문구 | `Info.plist` 에 `UIBackgroundModes` 없음(`remote-notification`·`audio` 없음). `App.entitlements` 에 `aps-environment` 는 있음 | 사일런트 푸시·백그라운드 오디오 불가. 요구 기능 범위에 따라 필요(추정) | 요구사항 확인 후 선언 |
| 높음 | WebView 미디어 권한 거부 UX | `lib/class/class-media.ts:12` 가 `NotAllowedError` → `denied` 매핑, `hooks/useMediaCheck.ts:193` 로 실패 처리 | 거부 시 상태 구분은 **확인**됨. 그러나 네이티브에서 영구 거부 후 **설정 앱으로 이동하는 안내**가 있는지는 `denied` 문구 확인 못 함(추정: 브라우저식 안내) | 네이티브 분기에서 "설정 > MIND BREEZE > 마이크/카메라" 안내 문구 확인·보강 |
| 낮음 | 푸시 권한 타이밍 | `lib/native/push.ts:90-96` — 로그인 직후 `requestPermissions()` 호출 | 맥락 설명 없이 로그인 직후 요청(수락률↓). 거부해도 로그인 불막음 — **확인** | 첫 사용 시점 프리프롬프트 고려 |
| 낮음 | 푸시 권한 영구 거부 시 | `push.ts:96` `granted` 아니면 조용히 종료 | 설정 화면에 알림 꺼짐 안내/설정 이동 UI 여부 미확인 | 설정 페이지 확인 |
| — | Android 권한 선언 | `AndroidManifest.xml:41-59` BLUETOOTH_SCAN(`neverForLocation`)·CONNECT·POST_NOTIFICATIONS·RECORD_AUDIO·CAMERA·MODIFY_AUDIO_SETTINGS, `bluetooth_le`/camera/mic `required=false` | 정합 (깨끗한 항목 참조) | — |

### (3) 수명주기

| 심각도 | 항목 | 근거 | 문제 | 권고 조치 |
|---|---|---|---|---|
| 높음 | 백그라운드/복귀 핸들러 부재 | `grep appStateChange\|App.addListener` → `lib/native/push.ts`·`hooks/useWakeLock.ts` 외 0건. `visibilitychange` 사용은 `useWakeLock.ts:71`(화면 켜짐 재요청) 하나 | 앱 전환/잠금 후 복귀 시 녹음·LiveKit·소켓 상태 동기화 코드 없음. 소켓은 `reconnection: true`(`lib/socket.ts:70,119`; 알림 소켓 `Infinity`, `:421`)로 자동 재연결되나 **복귀 시 서버 상태 재조회**는 확인 못 함(추정: 일부 화면만) | 복귀 시 세션 상태·참여 상태 재조회 훅 추가, 실기기 시나리오 테스트 |
| 높음 | 녹음 청크 유실 | `hooks/useAudioRecorder.ts:63-67` 업로드 실패 청크를 `pendingRef`(메모리)에 저장, 재전송은 `stop()` 시에만(`:116,135`). 비디오도 동일(`useVideoRecorder.ts:167`) | 네트워크 단절이 길거나 앱 강제종료·OS 메모리 회수 시 해당 구간 영구 유실(IndexedDB 등 영속 큐 없음 — 확인) | IndexedDB 청크 큐 + 복귀 시 재전송. 최소한 재전송 주기 실행 |
| 중간 | 녹음 MIME | `useAudioRecorder.ts:50` — `audio/webm;codecs=opus` 지원 확인 후 대체 | iOS WKWebView 는 구버전에서 `audio/webm` 미지원(iOS ≥18.4 에서 지원, 추정). 대체 MIME(`audio/mp4`) 업로드·서버 STT 처리 여부 미확인 | iOS 실기기에서 녹음→STT 1회 검증 |
| 중간 | 푸시 딥링크 | `push.ts:10-18,85-89` 화이트리스트(`/app`·`/agent`·`/chat`) 후 `pushState`+`popstate` 로 이동 | 보안은 양호(외부 URL·우회 차단). 단 `/class/:id/enter`·`/sessions/*` 딥링크는 **허용 목록에 없어** 세션 시작 알림이 클래스 입장으로 직행 불가(어떤 deeplink 값이 발송되는지는 미확인). 콜드스타트 시 `actionPerformed` 가 라우터 준비 전이면 유실 가능(추정) | 알림 발송 payload 의 deeplink 값 집합과 허용 목록 대조 |
| 중간 | 외부 링크/유니버설 링크 | `AndroidManifest.xml` 에 앱 링크용 intent-filter 는 LAUNCHER 하나뿐(`:22`), `Info.plist` URL 스킴은 Google 로그인용 1개, `apple-app-site-association`/`assetlinks.json` 없음 | 메일 초대 링크(`/membership-invite`, `/set-password`, `/invite/:token`)가 앱이 아닌 브라우저로 열림 | 의도 확인(웹 가입 허용이면 문제 아님) |
| 중간 | 세션 종료·리포트 생성 실패 처리 | `deploy/jobs.tsv` + `backend/sweep_stale_reports_cron.py`·`sweep_stale_open_sessions_cron.py`·`process_pipeline_outbox_cron.py`·`sweep_stale_media_cron.py` 존재, `report_progress_service.py:337 sweep_stale_reports`. Celery beat 는 의도적 제거(OS cron/systemd 타이머로 대체, `core/celery_app.py:34-38`) | 워치독 구조는 **확인**. 단 리포트 생성 전용 큐·동시성 제한·적체 모니터링 없음(plan §14 후속 항목, 미착수). 세션 종료 일괄 몰림 시 지연 | 출시 시 `jobs.tsv` 가 prod 에 모두 설치되는지 `deploy-prod` 로 1회 확인(이번엔 미확인) |
| 낮음 | 웹 전용 이탈 가드 | `hooks/useLeaveGuard.ts` | 네이티브엔 `beforeunload` 없음 → 강제종료 보호 불가(OS 한계) | 서버 측 stale 세션 정리가 보완(`sweep_stale_open_sessions`) |

### (4) 로그인 · 온보딩

| 심각도 | 항목 | 근거 | 문제 | 권고 조치 |
|---|---|---|---|---|
| **차단** | 심사자/신규 사용자 진입 경로 | 회원 가입: `RegisterClientPage.tsx:216` 초대 토큰이 없으면 `matchedCounselor`(상담사 코드) 필수. 상담사: `backend/app/api/v1/auth.py:196-198` "상담사는 직접 가입할 수 없습니다", `RegisterCounselorPage.tsx:188-193` 기관 초대 전용 | 스토어에서 받은 일반 사용자는 코드 없이 가입 완료 불가. 데모/게스트 모드 없음(`App.tsx` 에 해당 라우트 0건). 단 `/join`(`CodeEntryPage`)·`/o/:org_code` 공개 라우트는 존재 | App Store Connect/Play 심사 메모에 **심사용 계정 2종(상담사·회원) + 상담사 코드** 제공, 또는 데모 진입 제공 |
| **차단** | 계정 삭제 | `grep 탈퇴\|계정 삭제\|delete account` → `frontend/src`·`backend/app/api/v1/auth.py` 해당 기능 0건(`admin.py` 관리자 삭제만) | Apple(5.1.1(v))·Google Play 정책 위반. 개인정보 처리방침의 파기 권리와도 불일치 | 설정에 "계정 삭제" + 백엔드 익명화/파기 API |
| 높음 | 소셜 로그인 정책 | Google 로그인만 제공(`pages/LoginPage.tsx:3,31`, `lib/native/google.ts`); Apple 로그인 0건 | Apple 4.8 — 타사 소셜 로그인을 제공하면 동등한 개인정보 보호 로그인(Sign in with Apple 또는 이메일 로그인 등) 필요. 이메일/비밀번호 로그인도 제공하므로 4.8 의 "동등 옵션" 면제 요건 해당 여부는 심사 판단 → **추정** | 심사 반려 위험으로 인지, 필요 시 Apple 로그인 추가 |
| 중간 | 역할 선택 | `pages/RegisterPage.tsx:60-78` 회원/상담사/기관 3택, 상담사 안내 문구 존재 | 흐름 자체는 명확. 기관 가입은 "상담" 형태(`:78`) | — |
| 중간 | 온보딩 미완 항목 | `pages/onboarding/CounselorOnboardingPage.tsx:324` "자격증 파일 업로드 기능은 준비 중입니다." | 출시 화면에 준비 중 문구 | 숨김 또는 구현 |
| 낮음 | 빈 상태 화면 | `pages/client/ClientReportListPage.tsx` 등 EmptyState 사용 확인(일부) | 전 화면 전수 점검은 하지 않음 | 신규 계정(데이터 0)으로 수동 순회 권장 |

### (5) 기능 정합 · UI

| 심각도 | 항목 | 근거 | 문제 | 권고 조치 |
|---|---|---|---|---|
| 중간 | 준비 중 버튼(회원 리포트) | `components/reports/ClientReportViewer.tsx:150-158` 'PDF 생성 (준비 중)' → 토스트 "추후 제공됩니다" | 눌러도 동작 안 하는 버튼 노출 | 서버 PDF 완료 후 제거/숨김 |
| 중간 | 기관 가입 요청 관리 | `pages/org/OrgManagementPage.tsx:117-125` "준비 중 (API 미연동)" | 기관관리자 화면에 미연동 섹션 | 숨김 |
| 중간 | 디자인/샘플 라우트가 프로덕션 번들·라우터에 공개 | `App.tsx:202-209` `/design/*`(인증 없음), `:212` `/reports/sample`, `:264` `/playground`(로그인만), `public/chat-test.html`, `public/mb-design`(32MB) | 내부 시안 페이지가 앱에서 URL 로 접근 가능, 번들 증가 | prod 빌드에서 제외하거나 가드 |
| 낮음 | 인증 가드가 없는 라우트 | `App.tsx:197-199` `/sessions/:id/live`·`/player`·`/record` 에 `RoleGuard` 없음, `/org/:org_id`(`:191`) 도 없음 | 페이지 내부에서 처리하는지 일부만 확인(`SessionLivePage` 에 `RoleGuard/useAuth` grep 0건). API 가 인증 요구하므로 데이터 노출은 아님(추정) | 내부 가드 확인 |
| 낮음 | i18n | 번역 프레임워크 없음(`package.json` 에 i18next 등 0), 한국어 하드코딩 | 해외 심사/영문 스토어 등록 시 영어 UI 없음 | 한국 단독 출시면 무영향 |
| 낮음 | 다크모드 | `dark:` 클래스 사용 파일 6개뿐 | OS 다크모드에서 일부 화면 라이트 고정(의도 여부 미확인) | 정책 결정 |
| 낮음 | 안전영역·키보드 | `index.html` `viewport-fit` 있음(확인), `env(safe-area-inset-*)` 는 `AppShell`·`BottomTabBar`·클래스 CSS 3종에서 사용, `lib/native/keyboard.ts` 가 `KeyboardResize.Native` + 이벤트 | 기본 대응은 **확인**. 입력 화면별 가림은 실기기 필요 | 실기기 확인 |
| 낮음 | 린트 부채 | 위 §0 | 테스트 파일 규칙 위반 3건, 산출물 2건 | `eslint.config.js` ignore 에 `android/**`·`ios/**` 추가 |

### (6) 성능 · 용량

| 심각도 | 항목 | 근거 | 문제 | 권고 조치 |
|---|---|---|---|---|
| 높음 | 번들 정적 자산 | `du`: `dist` 99MB, `dist/assets` 3.1MB(JS 110개 분할). `public/bgm` 56MB·`mb-design` 32MB·`videos` 4.6MB | JS 는 양호(코드 스플릿 확인). 자산이 앱 안에 포함되어 설치 용량 증가·업데이트마다 재배포 | 대용량 미디어 CDN/S3 로 이동, 모바일 빌드에서 제외 |
| 중간 | 미해제 MediaStream/타이머 | `useAudioRecorder.ts:30` `cleanup` 에서 트랙 stop 확인. 클래스 플레이어(`ClassPlayerPage.tsx` 2천 줄급)·`audio-engine.ts` 전수 점검은 하지 못함 | 누수 가능성 **추정**(미확인) | 실기기에서 입장·퇴장 반복 후 메모리 확인 |
| 낮음 | 안드로이드 난독화 | `android/app/build.gradle` `minifyEnabled false` | 릴리즈에서 코드 축소/난독화 없음 | 정책 결정 |

### (7) 버전 · 릴리즈

| 심각도 | 항목 | 근거 | 문제 | 권고 조치 |
|---|---|---|---|---|
| 높음 | 강제 업데이트/최소 버전 체크 없음 | `grep minVersion\|forceUpdate\|min_supported\|X-App-Version` → 0건. 서버는 `device_tokens.app_version` 저장만(`models/device_token.py:35`) | 스토어 배포된 구 버전이 영구 존속. 계약 변경 시 호환은 SDD-211 계약 스냅샷(가산 전용 규칙) 의존 — 그것도 미병합 | `/app/config` 최소 버전 API + 차단 화면, 서버는 `X-App-Version` 헤더 로깅 |
| 높음 | 에러 모니터링 없음 | Sentry/Crashlytics 의존성·초기화 0건(`package.json` 확인). `google-services.json`·`GoogleService-Info.plist` 는 있으나 Firebase 는 푸시/로그인용 | 크래시·JS 오류 수집 수단 없음 | Sentry(또는 Crashlytics) 도입 |
| 중간 | 버전 정책 | iOS `project.pbxproj:311-343` `MARKETING_VERSION=1.0`, `CURRENT_PROJECT_VERSION=1`. Android `build.gradle:9-11` 기본 `versionCode=1`/`1.0`(CI 주입 전제). `package.json:4` `0.0.0` | 모바일 릴리즈 워크플로가 없어(`ls .github/workflows`: ci-feature·deploy-dev/prod·e2e-smoke·release-build·rollback-prod) 주입 주체 불명 | 빌드 번호 증가 절차 문서화/자동화 |
| 중간 | 환경 변수 기본값 | `lib/api/client.ts:35` `VITE_API_BASE_URL` 미설정 시 `http://localhost:8000/api/v1`. `.env.prod`·`.env.dev` 존재(git 미추적 — 확인), `cap:android:prod` 스크립트는 `--mode prod` 사용 | `npm run cap:sync`/`cap:ios`(모드 미지정)로 빌드하면 localhost 가 박힐 수 있음 | 모드 미지정 스크립트 제거 또는 fail-fast |
| 낮음 | `CAPACITOR_DEBUG` | `Info.plist:5-6` `$(CAPACITOR_DEBUG)` | 릴리즈 빌드 설정에서 false 인지 pbxproj 확인 필요(미확인) | 확인 |
| 낮음 | 서버 도메인 | `.env.prod` → `https://api.mindbreeze.looxidlabs.com/api/v1` (HTTPS) | cleartext 설정 없음(`AndroidManifest` 에 `usesCleartextTraffic` 없음) — 양호 | — |

---

## 3. 깨끗한 항목 (확인한 범위 내)

- **BLE 분기와 선택적 사용**: `lib/ble/index.ts` 가 `isNativeApp()` → `CapacitorBleAdapter`(`@capacitor-community/bluetooth-le`), 웹 → `WebBluetoothAdapter` 로 분기. `isBleSupported()` 는 네이티브면 true. `lib/eeg/bluetooth/index.ts` 가 이 어댑터를 사용. (`NativeBluetoothProvider` 스텁은 호출되지 않음.) `hooks/useBand.ts` 가 `isBleSupported` 를 사용.
- Android 권한 선언(BLE 신/구 API 분기, `neverForLocation`, 알림, 카메라/마이크 `required=false`, `ACCESS_COARSE_LOCATION` 제거), `allowBackup=false`, cleartext 미허용.
- iOS: `NSBluetoothAlwaysUsageDescription` 한국어 문구, 푸시 entitlement 존재.
- 푸시 딥링크 화이트리스트 검증이 엄격(외부 URL·`//`·`..`·인코딩·제어문자 차단), 로그아웃 시 `DELETE /devices/{token}` 처리와 계정 전환 경쟁 조건 방어.
- 소켓 재연결(`reconnection: true`)·화면 꺼짐 방지(`useWakeLock` 의 visibility 재요청)·오프라인 이벤트 감지(`online/offline` 리스너, `HostLiveContainer`·`MemberClassContainer`) 존재.
- 라우트: 정적 경로 dead link 0건, `/class/:sessionId/enter`·`/sessions/:id/player` 등 기획서 경로 존재.
- 백엔드 테스트 2082건 전부 통과, alembic 헤드 단일, 타입 검사 통과, `src/` 린트 0건, 코드 스플릿 양호(JS 3.1MB/110청크).
- 주기 작업(리포트·세션·미디어·EEG 스윕)이 cron/타이머로 정의(`deploy/jobs.tsv`)되어 있고 Celery beat 이중 실행 문제는 의도적으로 제거됨.
- 환경 파일(`frontend/.env*`)은 git 추적 대상이 아님.

## 4. 점검하지 못한 것

- iOS/Android 실기기·시뮬레이터 실행(권한 팝업, 백그라운드 복귀, 키보드 가림, WKWebView `getUserMedia`/LiveKit 동작).
- `ClassPlayerPage.tsx`·`audio-engine.ts` 내부의 MediaStream/타이머 해제 전수 점검.
- 푸시 발송 payload 의 실제 `deeplink` 값 집합, `deploy-prod` 가 `jobs.tsv` 전체를 설치하는지, `CAPACITOR_DEBUG` 릴리즈 값.
- `agent-counselor-page`·`chat-message-deeplink` vitest 실패 4건의 근본 원인.
