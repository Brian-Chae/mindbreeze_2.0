# 웹 페이지 로딩 속도 개선 결과

## 결론과 원인

주원인은 React 19 Suspense의 fallback 300ms throttle이다. TanStack Query는 package.json에 없고 실제 React 버전은 19.2.8이다. gzip·전송 용량과 별개로, 인증이 완료되어야 RoleGuard가 lazy 페이지를 렌더하고, 그 순간 표시한 전역 Suspense fallback의 커밋 지연 때문에 페이지 effect/API도 기다렸다.

### 실제 dev Chrome CDP 근거

첫 dev /classes 기록(문서 navigation 기준, ms): auth/refresh 477~530, 페이지·공통 청크 완료 583, fallback 타이머 설치 587(timeout 245ms), 후속 렌더가 같은 deadline으로 재예약, TimerFire 834, 배경5 이미지 요청 835, API 시작 855~860, 마지막 알림 응답 1104. 청크 완료~TimerFire 구간 FunctionCall 합집합은 약 2.92ms로, 250ms의 JS 파싱/실행이 아니다. background5는 렌더 시 CSS에서 발견된 요청이며 이미지 응답(946ms) 전에 API가 시작했다. 폰트/이미지 완료를 기다리는 await도 없다.

근거 코드:
- 변경 전 `frontend/src/App.tsx` RootLayout 전역 Suspense와 React.lazy 목록 페이지.
- `frontend/src/components/auth/RoleGuard.tsx`의 `isInitialized` 조건: 인증 검증 후 처음 lazy를 읽음.
- 원본 node_modules `react-dom/cjs/react-dom-client.production.js:10793`: `globalMostRecentFallbackTime + 300 - now()`로 커밋 타이머 예약.
- 배경 위치: `frontend/src/pages/classes/host-classes-page.tsx`의 background5 inline CSS.
- 민감 정보 제거 CDP 이벤트: [dev-trace-evidence.json](dev-trace-evidence.json). 전체 원본 trace는 개인정보/헤더 보존을 피하려고 커밋하지 않았다.

### 같은 로컬 조건의 수정 전후 CDP

첫 /classes 표본: 변경 전 refresh 완료 284ms, 청크 완료 307ms, 첫 API 608ms(둘 다 준비된 뒤 301ms 대기). 변경 후 refresh 완료 308ms, 청크 완료 275ms, 첫 API 311ms(3ms 대기). 변경 전 299/275/184ms 재예약 타이머가 있고 변경 후에는 해당 50~300ms 타이머가 없다. [before-trace.json](before-trace.json), [after-trace.json](after-trace.json), [before.json](before.json), [after.json](after.json).

독립된 합성 API production 번들 검증도 수행했다. refresh 50ms/페이지 청크 60ms 지연을 양쪽에 동일하게 주었을 때 준비 후 대기는 257→34ms. 인증 실패 시 두 번들 모두 보호 API 요청 0건, 로그인으로 이동했다. [verify-routing.cjs](verify-routing.cjs), [routing-verification.json](routing-verification.json).

## 변경

- `frontend/src/App.tsx`: 홈·클래스·회원·리포트·채팅 목록(+채팅 상세)의 청크를 React Router lazy가 준비한 후 렌더. 부가 화면의 기존 분할은 유지.
- `frontend/src/main.tsx`: 세션 초기화를 엔트리에서 시작하여 라우트 청크 다운로드와 병렬화. RoleGuard의 서버 검증은 유지.
- `frontend/src/lib/api/client.ts`: 알림 목록/미읽음 개수, 채팅방 목록, 강사 후보의 동일 전체 URL에만 in-flight 공유와 30초 메모리 캐시. 일반 화면/상세/PDF는 캐시하지 않음. 실패 미보관, 소비자별 abort 격리, 객체 복사, 계정 전환/로그아웃 격리, 변경 요청 전후 무효화.
- `frontend/src/hooks/useNotificationSocket.ts`: 알림 수신 시 즉시 알림 무효화·배지/초대 재조회. 채팅 이벤트는 방 목록만 무효화. 최초 연결은 진행 중 seed를 공유하되 완료된 seed는 재검증하고, 재연결은 진행 요청도 다시 확인.
- `frontend/src/components/layout/AppShell.tsx`: 방 목록 응답에 요청 시작 snapshot과 unmount 가드를 적용해 실시간 변경 덮어쓰기 방지.
- `frontend/tests/shared-read-cache.test.ts`, `shared-read-socket.test.tsx`: 캐시 경합·TTL·취소·쓰기·계정 격리 및 실제 Zustand→DOM 배지 검증 15개 추가.
- 별도 읽기 전용 리뷰에서 발견한 2건(전역 취소의 후보/방 로딩 실패, 최초 connect 전 알림 누락)을 보완했고 재리뷰에서 추가 차단 이슈 없음.

## 화면별 전후

Chrome headless(설치된 Google Chrome executable), 1440×1000, CPU/네트워크 제한 없음. 각 화면/진입 방식 3회 중앙값. 같은 worktree의 변경 전후 production Vite build를 envFile:false/mode:speed로 빌드했고 dev-api를 사용했다. preview의 정적 파일을 원래 dev 웹 origin에서 전달해 쿠키·CORS 조건을 유지했다. Playwright route 때문에 HTTP 캐시는 비활성화되어 양쪽 모두 같은 조건이다. 메뉴는 실제 링크 클릭이며 30초 캐시 안에서 측정했다.

데이터 완료=해당 navigation/클릭 이후 마지막 API resource responseEnd. 인증 refresh 포함, CORS preflight 제외. 중복=전체 pathname+query가 동일한 요청의 추가 횟수. 알림 limit/event가 다른 조회는 중복으로 세지 않는다. API 응답 시간의 변동이 있으므로 절대 수치를 배포 성능 보장으로 해석하지 않는다.

| 화면 | 진입 | 데이터 완료 ms 전→후 | API 수 전→후 | 동일 URL 중복 전→후 |
|---|---|---:|---:|---:|
| 홈 | 새로고침 | 826 → 511 | 10 → 9 | 1 → 0 |
| 홈 | 메뉴 이동 | 314 → 266 | 9 → 5 | 1 → 0 |
| 클래스 | 새로고침 | 735 → 427 | 8 → 7 | 1 → 0 |
| 클래스 | 메뉴 이동 | 200 → 137 | 7 → 3 | 1 → 0 |
| 회원 | 새로고침 | 752 → 515 | 6 → 6 | 0 → 0 |
| 회원 | 메뉴 이동 | 214 → 164 | 5 → 2 | 0 → 0 |
| 리포트 | 새로고침 | 725 → 598 | 7 → 7 | 0 → 0 |
| 리포트 | 메뉴 이동 | 233 → 131 | 6 → 3 | 0 → 0 |
| 채팅 | 새로고침 | 740 → 486 | 6 → 5 | 1 → 0 |
| 채팅 | 메뉴 이동 | 231 → 104 | 5 → 1 | 1 → 0 |

실서비스 데이터는 읽기만 수행했다. 모든 HTTP 쓰기는 auth/login·refresh 외 차단했고 소켓 연결도 차단했다. 따라서 수치는 소켓 최초 연결 시 재검증을 제외한 비교다. 실시간 이벤트는 dev에 발송하지 않고 모의 소켓으로 즉시 배지·재연결을 검증했다. 실제 소켓 전달 지연/네트워크 복구는 이 증거에 포함하지 않는다. dev에는 배포하지 않았다.

추가로 실제 5개 화면을 두 진입 방식에서 변경 전후 각 1회 확인했다. 공통 셸 표시, 로딩 상태 종료, 화면 alert 없음, JS 예외 없음 및 API HTTP 상태를 확인한다. [before-visible-verification.json](before-visible-verification.json), [after-visible-verification.json](after-visible-verification.json). 강사 후보만 이 계정에서 변경 전부터 403이며 기존 UI는 `편성 준비 중` 비활성 버튼을 표시한다. 변경 전 2회→변경 후 1회로 합쳐졌고 403은 캐시에 보관하지 않는다. 이 권한/서버 편성 조건을 바꾸거나 후보 데이터가 정상 제공된 것으로 보고하지 않는다. 다른 데이터 API 오류는 없었다.

## 검사

- Vite build: 변경 전후 통과(envFile:false, dev-api, sourcemap). 기존 dynamic/static import 경고는 유지.
- 관련 vitest: 6개 파일, 40개 통과(새 캐시·소켓 15개 포함). RED에서 동일 요청 공유/취소 실패와 계정 전환 응답 격리 실패를 확인 후 GREEN.
- 전체 npm test: 변경 전 230개 파일 중 223 통과/7 실패, 2,620 통과/13 실패. 변경 후 232개 파일 중 225 통과/7 실패, 2,635 통과/13 실패. 실패 테스트 이름 집합 동일.
- tsc --noEmit -p tsconfig.app.json: 통과.
- 변경 파일 ESLint: 통과. 전체 npm run lint: 변경 전후 모두 기존 11개 오류(기존 agent-page, sdd217-presence, sdd222-band/background, use-eeg-raw-upload, use-media-check 테스트). 규칙·테스트를 완화하지 않았다.
- 기존 테스트가 덮어쓴 SDD-234 스크린샷/JSON은 시작 상태로 복구했고 PR에 넣지 않았다.
- 테스트 상세: [test-results.json](test-results.json).

기존 실패 13개: agent-counselor-page 2개(scroll 기대값/입력 요소), chat-message-deeplink 2개(scroll 기대값), org-management-browser 2개/ org-counselor-management-browser 1개(5175 브라우저 harness timeout/fetch 실패), report-modal-pdf 2개/ report-server-pdf 2개(5175 fetch 실패), sdd234-a-mobile-home 2개(회원 768/1440 기존 계산 스타일 불일치). 모두 변경 전 소스 snapshot에서 동일 재현. 원인 수정을 본 속도 변경에 섞지 않았다.

## 재현

1. 원본 frontend/node_modules 심링크를 준비한다(커밋 금지).
2. `node fix-notes/web-load-speed/build-preview.mjs /tmp/mb-speed-build 4180` 실행. `.env`는 로드하지 않는다.
3. MB_SPEED_PASSWORD를 환경에 설정하고 `node fix-notes/web-load-speed/measure.cjs 4180 /tmp/mb-speed-result.json` 실행. MB_SPEED_EMAIL은 생략 시 요청에 지정된 테스트 계정 사용. MB_SPEED_RUNS 기본 3.
4. dev 직접 측정은 첫 인수를 `dev`로 지정. 독립 라우팅 검증은 변경 전 4178/변경 후 4180 preview를 준비하고 `node fix-notes/web-load-speed/verify-routing.cjs /tmp/mb-routing.json`.
5. 비밀/계정 응답/전체 trace는 기록하지 않는다. 결과 JSON은 endpoint 경로·시간·개수만 보관한다.

## 백엔드 추가 제안(미수정)

- 공통 배지용 리포트가 페이지마다 limit=100 목록을 내려받는다. 역할별 미열람·검토중 개수만 반환하는 작은 엔드포인트 또는 dashboard bootstrap 응답으로 통합할 수 있다.
- 알림 목록은 초대(event=session_invited), 홈(limit=5), 기관 변경(기본 목록)처럼 의도가 다른 요청이다. 배지·초대·메뉴 카운트를 한 번에 받는 bootstrap API를 검토하면 추가 감소 여지가 있다.
- 강사 후보 403은 계정 권한/서버 편성 활성화 조건을 담당자가 확인할 항목이다. 이번 읽기 전용 작업에서는 설정을 변경하지 않았다.
- home dashboard의 개별 API 서버 처리시간/쿼리 수를 서버 측 tracing으로 확인하면 남은 지연을 구분할 수 있다. 이번에는 SSH·DB·backend·환경 파일에 접근하지 않았다.
