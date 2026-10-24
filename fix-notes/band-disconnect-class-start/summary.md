# 수업 시작 시 밴드 끊김·반복 재연결·상담사 수치 미표시

## 결론과 증거 범위

- 기준 `a22b0eb3`, 브랜치 `fix/band-disconnect-class-start`. 프론트만 수정했다.
- 세 증상은 하나의 캐시 결함이 아니다. BLE 인계 상태/수명 결함과 소켓 객체 교체 결함, 네이티브 복귀 시 잘못된 단절 판정이 구분된다.
- 아래 조건에서 **코드 결함과 재현은 확정**했다. 다만 10/23 21:52~21:56 UTC 실사용 사건의 최초 물리 BLE 단절 원인, 사용 기기 플랫폼과 배터리 read 오류 여부는 주어진 서버 로그만으로 확정할 수 없다. **실기기 BLE 미검증**이다.
- 서버 SSH·DB·환경 파일 조회, dev 데이터 변경, 머지·develop 푸시·배포는 수행하지 않았다. 사용자 제공 journalctl 사실은 재조회하지 않았다.

## 증상별 원인과 수정

### 1. 수업 시작 시 끊어진 상태

- 정상 BLE 인계에서도 기존 `useBand.ts:1116`이 무조건 `connecting`으로 변경했다. 초기 `connected`로 `everConnected=true`가 된 회원 화면은 `frontend/src/lib/class/player-case.ts:32`의 규칙에 따라 이를 `lost`로 표시한다. 물리 disconnect 없이도 보이는 거짓 끊김이다.
- `EntryPage.tsx:382`의 대기 화면에는 `useBand`가 없다. 준비 단계 언마운트는 BLE를 끊지 않지만 재연결 타이머를 정리한다. 대기 중 실제 단절이 발생하면 이전 소유자는 재시도하지 않고, 기존 마운트 인계는 `isConnected()`일 때만 실행하여 끊긴 캐시 기기는 그대로 남았다.
- 기기 선택 비동기 작업 도중 수업으로 전환하면 이전 훅이 뒤늦게 스트림/콜백을 차지하는 경합도 있었다.
- 수정: `frontend/src/hooks/useBand.ts:1124`에서 이미 연결되었으면 `connected` 유지, `:1416`에서 캐시된 기존 기기와 진행 중 선택도 인계. `:1113`의 연결 세대로 늦은 완료를 차단하고, 물리 연결 완료 뒤 활성 소유자만 스트림을 설치한다. 수동 해제는 연결이 끊긴 경우에도 캐시를 비운다. StrictMode 재마운트도 수명 effect를 인계 effect 앞에 두어 처리한다.
- 재현: 배터리 Promise 지연 중 상태 강등, 대기 중 단절→수업 마운트, 선택 Promise 지연 중 화면 전환, 단절 후 수동 해제, 배터리 조회 중 해제, StrictMode 스트림 인계. 수정 전 실패→수정 후 통과.

### 2. 끊김→재연결 반복

- 네이티브 `CapacitorBleAdapter.verifyConnection()`은 배터리 read 한 번 실패하면 직접 BLE를 끊었다. 배터리 서비스는 원래 선택적이므로 서비스 부재·일시 read 오류에서도 앱 복귀마다 정상 연결을 강제 해제할 수 있었다.
- 수정: `frontend/src/lib/ble/capacitor-ble-adapter.ts:149`에서 read 실패 후 OS 연결 목록을 확인한다. iOS는 필수 EEG 서비스 UUID로 조회한다. 연결이 확인되면 유지하고, 조회도 실패하면 단절로 단정하지 않는다. 실제 단절 확인 때만 복구하며 늦은 이전 연결의 검증 결과는 새 연결에 적용하지 않는다.
- 재현: iOS/Android 각각 배터리 실패 + OS 연결 유지 상태로 복귀 3회, OS 조회 실패, 이전 read 실패의 늦은 완료. 기존에는 실제 disconnect 호출/상태 소실, 수정 후 유지.
- 이 경로가 해당 실사용 기기에서 발생했는지는 미확인이다. Web Bluetooth의 실제 무선 단절은 이번 자료만으로 원인을 확정하지 않는다.

### 3. 상담사 수치가 대부분 `-`

- 기존 `frontend/src/lib/socket.ts:401`은 `disconnected=true`인 소켓을 폐기했다. 이 값은 최초 핸드셰이크와 자동 재연결 중에도 true다. `useBand`와 `useSessionLiveSocket` 등이 연속 조회하면 첫 훅의 구독자가 이전 객체에 남고 새 소켓만 연결된다. 서버의 반복 websocket 접속 현상과 양립하는 코드 경로다.
- `frontend/src/components/class/player/host/host-live-model.ts:49`는 연결·접촉 정상과 10초 이내 freshness를 요구한다. 집중·정서는 WS extras에 의존하고 HRV도 sdnn/WS extras를 사용한다. REST `SessionLiveMetric`에는 이 세 필드가 없어 소켓 구독이 사라지면 해당 수치를 복구할 수 없다(`backend/app/schemas/session.py:526`). 모든 `-`가 이 하나로 설명된다고 단정하지 않는다.
- 수정: `frontend/src/lib/socket.ts:401`에서 연결 중/재연결 중에도 같은 객체와 구독자를 보존한다. 자동 재연결이 꺼진 서버 종료 상태는 같은 객체에서 connect하고, 토큰 refresh 실패 후 같은 인증으로 반복 연결하지 않는다. 로그아웃의 명시적 소켓 폐기는 유지한다.
- 재현: 실제 accessor + 네트워크 대역에서 EEG 구독 전달이 수정 전 0회→수정 후 1회. 독립 검토자가 실제 설치 Socket.IO를 네트워크 없이 실행하여 최초 연결/재연결/서버 종료/토큰 갱신 실패 및 새 토큰 복구를 재검증했다.

## #70 및 백엔드 판정

- 공유 캐시는 `frontend/src/lib/api/client.ts:282`의 정확한 네 가지 경로(알림, 미읽음 수, 채팅방, 강사 후보)만 허용한다. `live-metrics`, `entry-state`, 세션 상세는 원래 대상이 아니다. 각각 동시 2회 + 반복 1회 요청이 모두 실제 fetch하고 서로 다른 최신 응답을 받는 회귀 테스트를 추가했다. 캐시 구현 수정은 불필요했다.
- `git diff b3ad7b4d^1 a22b0eb3 -- frontend/src/hooks/useBand.ts frontend/src/lib/socket.ts frontend/src/lib/ble/capacitor-ble-adapter.ts` 결과는 비어 있다. 이번 원인 파일은 **#70 이전부터 동일**하다. #70은 목록 라우트 lazy 전환이며 Entry/Player 경로 자체를 변경하지 않았다. lazy 타이밍이 증상을 드러냈는지는 미확인이다.
- `live-metrics`는 `backend/app/services/session_service.py:3010,3333`의 DB EEGFeatureWindow 집계다. 프로세스 메모리만 읽는 API가 아니다. WS 서버의 quiet signal/audio/집계 throttle 메모리와 구분해야 한다.
- raw presign/ack 성공은 feature 성공의 증거가 아니다. `StreamProcessor.ts:308` raw 수신 콜백과 500샘플 이후 고급 분석은 별도 경로다. 백엔드 변경 및 pytest 실행은 없다.

## 검증

최종 수치와 전체 실패 목록은 `test-results.json`에 기록한다.

- RED: 최초 핵심 10건 실패, 추가 수동 취소·비동기 인계/소켓 inactive 경계 4건 실패, StrictMode 스트림 인계 1건 실패를 확인했다.
- GREEN: 관련 55파일 **1,013/1,013 통과**, 독립 BLE 3파일 43건 통과. 신규 테스트 21건 추가.
- 전체 기준 232파일 **2,633 통과 / 15 실패 / 2,648건**, 수정 후 233파일 **2,654 통과 / 동일한 15 실패 / 2,669건**. 실패 이름 집합 완전 동일, 새 실패 0건.
- `cd frontend && npx tsc --noEmit -p tsconfig.app.json` 통과. 변경된 TS/TSX 7파일 ESLint 통과. `git diff --check` 통과.
- 독립 실행 `node fix-notes/band-disconnect-class-start/verify-socket.cjs` 통과. 실제 Socket.IO의 로컬 상태 전이를 사용하며 네트워크를 열지 않는다. 결과는 `socket-verification.json`. 실제 서버 handshake 검증은 아니다.
- 전체 실행은 `npm test -- --reporter=json --outputFile=...`. 기준은 `git archive a22b0eb3`의 별도 임시 복사본에서 같은 원본 node_modules를 사용했다. 테스트·assertion을 삭제/skip하지 않았다.
- 과거 #70 기록은 13건 실패였지만 이번 기준 실행은 15건이다. 기존 13건에 `sdd234-a-mobile-home`의 host 768px/1440px 스타일 비교 2건이 더 재현됐다. 실제 비교는 이번 기준 결과로 수행한다.
- 전체 테스트가 생성한 SDD-234 스크린샷/계측 파일은 작업 시작 시 깨끗했던 추적 파일만 원상복구했고 커밋하지 않는다. 테스트용 node_modules 심링크는 제거했다.

## 변경 파일과 충돌 범위

- 제품 코드: `frontend/src/hooks/useBand.ts`, `frontend/src/lib/socket.ts`, `frontend/src/lib/ble/capacitor-ble-adapter.ts`.
- 테스트: `sdd222-band-reconnect.test.tsx`, `sdd222-ble-verify-connection.test.ts`, `shared-read-cache.test.ts`, 신규 `session-live-socket-identity.test.ts`.
- 작업 기록: 이 폴더의 plan/verify/summary/test-results와 독립 검증 스크립트/결과.
- PR #72 파일 272개를 API 전체 페이지로 비교했다. 수정 파일 교집합 없음. `ClassPlayerPage`, EntryPage, MemberClassContainer, 보고서/요약 파일을 수정하지 않아 직접 충돌 범위를 피했다.

## 대표님 실기기 확인 절차

1. 회원은 준비 화면에서 LINK BAND를 연결하고 배터리·접촉 상태를 확인한다. 대기 후 상담사가 수업을 시작한다. 회원 화면이 인계 도중 `끊김`으로 바뀌지 않고, 추가 기기 선택창 없이 실측을 이어가는지 확인한다.
2. 준비 화면의 기기 선택 중 수업 시작→지금 입장도 수행한다. 선택 완료 후 수업 화면에 연결·수치가 나타나는지 확인한다.
3. 대기 중 밴드를 끄고 다시 켠 후 수업을 시작한다. 기존 기기로 자동 복구되는지 확인한다. 수동 연결 해제 후에는 화면을 바꿔도 자동 연결되지 않아야 한다.
4. 수업 중 한 차례 밴드 전원을 껐다 켜고, 네트워크도 잠시 차단·복구한다. BLE 재연결과 서버 소켓 재연결을 구분하여 확인한다. 회원과 상담사 양쪽에서 새 수치가 계속 도착해야 한다.
5. iOS/Android 앱을 각각 백그라운드→복귀 3회 반복한다. 정상 BLE가 복귀마다 강제 해제되지 않는지 확인한다. 정상 접촉·신호에서 상담사의 집중/정서/HRV 등을 30초 이상 관찰한다. HRV 등 산출에 시간이 필요한 값과 접촉 불량의 `-`는 정상일 수 있다.
6. 반복 시 기기/OS/브라우저, 시각, 회원 밴드 상태, `last_eeg_at`, BLE 갭 로그, `/session-live` connect/disconnect 이유와 feature ACK를 함께 기록한다. 실제 사용자 정보·인증 토큰은 기록하지 않는다.
