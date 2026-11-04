# SDD-284 T4 — 연결 진단 코드 매핑

시안(`T4-connection-diagnostics.html`)의 코드명(`UPLOAD_BACKLOG` 등)은 예시였고, 실제 훅 값에 맞춰 아래처럼 매핑했다.
판정 로직: `frontend/src/components/class/player/member/connection-diagnostics-model.ts` (순수 함수, 시험: `frontend/tests/sdd284-connection-diagnostics.test.tsx`).

## 상태 6종 ← 실제 입력

| 화면 상태 | 시안 코드(예시) | 판정 조건(실제 값) |
|---|---|---|
| 정상 | — | 아래 조건에 해당 없음 |
| 시작 정체 | CONFIRM_TIMEOUT | `path=native` 이고 `status=starting`, `lastConfirmElapsedMs ≥ 10초`(`DIAG_START_STALL_MS`); 또는 `status=failed`. 문구에 재시작 `n/5`(`NATIVE_RESTART_MAX`=`RETRY_MAX`) |
| 실시간 연결 끊김 | SOCKET_DISCONNECTED | 소켓이 한 번 연결된 뒤 끊김(`socketBad`: 컨테이너가 이미 쓰는 소켓·LiveKit 재연결 판정과 동일). 한 번도 연결 전이면 "확인 전" |
| 업로드 적체 | UPLOAD_BACKLOG | `uploadProgressStore`의 분석 데이터 pending > 60 또는 측정 기록 파일 pending(`rawPending+rawUploading`) > 6 이 30초 이상 |
| 웹 경로 전환됨 | WEB_FALLBACK | `nativeFailed=true`(T1이 확정 실패 반복으로 하강). 회차 내 되돌아가지 않음 |
| 복구 중 | RESTARTING | `status=starting` 이고 `code ∈ {native_stream_unconfirmed, native_stream_lost}` 또는 재시작 횟수 > 0 이면서 확정 대기 10초 미만 |

복수 해당 시 알림을 모두 표시하고, 아이콘·자동 노출 판단은 우선순위 첫 항목(웹 전환 → 시작/복구 → 소켓 → 적체)을 쓴다.

## 행 매핑

| 화면 행 | 값 출처 | 값 없음 |
|---|---|---|
| 측정 경로 | `decideMeasurementPath` 결과(native / web_wasm). 둘 다 없으면 진단 자체를 그리지 않음 | — |
| 상태 | 네이티브: `status`(idle/starting/running/failed), 웹: `useWebMeasurementV2.status`(capturing 등) | — |
| 코드 | 훅 `code`(예: `native_stream_unconfirmed`, `native_stream_lost`, `native_stop_failed`, `credentials_unavailable`) | `—` |
| native 상태 | `diagnostics.nativeState` (snapshot.state) | 확인 전 |
| 측정 식별자 | `diagnostics.streamIdHead`(앞 8자리) | 시작 중이면 "확정 대기", 아니면 확인 전 |
| 실시간 연결 | 컨테이너의 소켓·LiveKit 판정 | 확인 전 |
| 재시작 횟수 | `diagnostics.restartCount / 5` | 확인 전 |
| 분석 데이터 대기·서버에 도착 | `uploadProgressStore` featurePending / featureAcked | 확인 전 |
| 측정 기록 파일 대기·서버에 도착 | rawPending+rawUploading / rawVerified | 확인 전 |

## 한계·주의
- 업로드 집계는 네이티브 이벤트(`facade.onUploadProgress`)에서만 채워진다. **웹 경로의 업로드 집계는 같은 스토어에 쓰이지 않으므로 웹 값과 섞지 않고 "확인 전"으로 둔다**(시안 notes의 출처 혼합 금지 항목).
- 업로드 적체 임계값(60 / 6 / 30초)은 평상시 pending이 작다는 정황뿐인 **가설**이다. 11/11 현장 로그로 조정한다(상수: `DIAG_BACKLOG_*`).
- `lastConfirmElapsedMs`는 훅이 확정 시도 시작부터 갱신한다. 폴링(2초) 단위라 최대 2초 늦게 보일 수 있다.
- 자동 노출: 이상이면 최초 펼침. 사용자가 접으면 **같은 종류의 이상**에서는 다시 열지 않고, 다른 종류의 이상이 새로 생기면 다시 연다(시안 design-notes 제안).
- 진단은 측정 경로가 있을 때만 만든다(`bandConnected` 가드와 같은 취지): 밴드 없는 회원은 `diagnostics=null` → 토글·패널 모두 그리지 않는다.
- 표시 금지: 토큰·개인정보·점수류 표현. 측정 식별자는 앞 8자리만.
