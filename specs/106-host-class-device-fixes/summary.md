# SDD-106 호스트 클래스 실기기 버그 진단·수정

## 확인한 원인과 수정

1. **대기 셀프뷰 테마**: `SessionPreJoinPreview`의 카드·텍스트·안내·확인창에 라이트 색상이 고정되어 있었다. `dark=false` 기본 속성을 추가하고 `ClassPlayerPage`에서만 활성화했다. 다크 퍼플 카드, 대비를 확보한 텍스트와 보조 버튼, 권한 오류·마이크 경고·확인창에도 적용했다. 기본 라이트 사용처는 유지했다.
2. **EEG 저장→호스트 전파 누락**: `useBand`의 로컬 표시와 업로드는 별개다. WS `feature` 경로는 저장 뒤 호스트에 발행하지만 REST `ingest_features`는 저장만 했다. 따라서 WS 전송이 실패하고 REST 폴백이 저장에 성공해도 실시간 EEG·그룹 집계는 갱신되지 않았다. REST가 실제 저장한 최신 항목을 호스트 전용 `eeg_feature`와 기존 주기의 `class:aggregate`로 연결했다. 중복 및 과거 backfill은 최신 표시를 덮지 않는다. 리뷰에서 혼합 배치의 중복 항목이 미저장 값을 발행하는 경우를 발견해 실제 저장 성공 항목만 후보로 제한했다.
3. **조용한 신호**: 버튼 자체에는 disabled가 없었다. 회원 화면이 고정 높이/overflow:hidden이고 내부 스크롤이 없어 짧은 화면에서 하단 버튼을 누를 수 없었다. 모바일 본문과 데스크톱 오른쪽 패널에 세로 스크롤을 허용했다. `sendSignal`은 transport 연결만으로 성공을 반환하던 경로를 수정해 서버 `joined`가 확정한 참가자 ID를 사용한다. 미입장·미식별·입장 거부·단절·재입장 대기는 false를 반환한다.

## 유지한 계약

- 게스트 participant_id와 로그인 회원 토큰의 소유권 검증, EEG 동의·대기열 검증을 유지했다. 인증 우회는 추가하지 않았다.
- 게스트·회원 join 및 quiet signal 서버 전달은 관련 테스트에서 정상이다. 실제 dev 기기의 WS 연결이 실패한 직접 원인은 이번 정적 분석만으로 확정하지 않았다.
- useBand 수집·큐, WS 이벤트 이름/필드, quiet signal boolean API는 유지했다. 서버가 기존에 보내던 joined.participant_id를 타입에 명시했다.
- `sendSignal=true`는 기존처럼 소켓 전송을 의미한다. 서버 수신 ACK 계약을 새로 추가하지 않았다.
- 기존 persist_feature_windows의 int 반환 및 REST saved 응답을 유지했다.

## 검증

- 테마 회귀: 수정 전 dark 테스트 실패 → 수정 후 light/dark 2개 통과.
- 신호 연결 회귀: 수정 전 실패 → join 전/확정 ID/거부/재연결 4개 통과.
- 프런트 전체 TypeScript Vitest: `npx vitest run --exclude '**/*.cjs'` — 32파일 253개 통과.
- `npm run build` 통과. 기존 디자인 토큰 CSS import 경고와 500kB 청크 경고는 남아 있다.
- `node --test tests/signal-metric-parity.test.cjs` — 8개 통과.
- 실제 브라우저 390×600, 1280×420에서 스크롤·hit-test·3종 신호 클릭 회귀: 수정 전 2개 실패 → 수정 후 2개 통과. BLE/네트워크는 fixture로 대체한다.
- 백엔드: REST 폴백·WS·권한·조용한 신호 관련 47개 통과. `DATABASE_URL=sqlite:// /tmp/mindbreeze-host-fixes-venv/bin/python -m pytest tests/test_rest_feature_live_fallback.py tests/test_sdd024_session_live_ws.py tests/test_sdd026_live_session_p0.py tests/test_class_quiet_signal.py -q`
- 회원 화면 브라우저 전체 5개 통과. 기존 3개 테스트가 이미 제거된 진행 중 BGM 요소를 요구해 실패하여 현재 무재생 정책에 맞춰 fixture를 갱신했다. 신규 짧은 화면 회귀 2개와 함께 검증했다.
- 코드 리뷰: 혼합 중복 배치 P2 수정 후 재리뷰에서 해결 확인. 테마/CSS/신호 연결 변경에 추가 중요 결함 없음.

### 전체 Vitest 명령의 기존 테스트 실행 제약

`npx vitest run`은 Node의 별도 test runner용 CJS까지 수집해 9파일 실패했다. TypeScript 테스트 249개는 당시 모두 통과했다(추가 신호 연결 4개를 포함한 최종 결과는 위 253개).

- Node test suite 형식 불일치: login-page.test.cjs, login-role.test.cjs, narrative-sections.test.cjs, org-management-api.test.cjs, signal-metric-parity.test.cjs.
- Playwright 모듈 미설치: org-counselor-management-browser.test.cjs, org-management-browser.test.cjs, report-modal-pdf.test.cjs, report-server-pdf.test.cjs.
- 관련 브라우저 테스트는 임시 설치된 Playwright를 NODE_PATH=/tmp/node_modules로 지정해 별도 실행했다. 프로젝트 의존성/lockfile은 변경하지 않았다.

## 범위

코드 정적 분석, 자동화 회귀 테스트와 로컬 브라우저 검증을 수행했다. dev 서버 배포 및 실제 LINK BAND 두 기기 연결 재검증은 수행하지 않았다. 사용자 요청에 따라 승인 게이트 없이 구현했다.
