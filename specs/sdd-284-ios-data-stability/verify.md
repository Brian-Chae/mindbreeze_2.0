# SDD-284 Verify — 구현 전 합격 기준 (Stage ③)

- 환경: **dev 서버** + dev(또는 TestFlight 후보) iOS 빌드, iPhone 실기기 + LINK BAND 2.0, 회원 계정(예: client@test.com 계열), 뇌파 동의, 회차 `participant_mode=group`.
- 측정 방법은 서버가 보는 값(DB·nginx·ledger)을 기준으로 하고, 앱 화면 값은 보조로 쓴다. 개인정보는 건수만 기록.
- "기대량"은 앱이 보고한 `ingest-expected`(feature/raw/ppg/acc 총량, final=true)이며, 보고 자체를 신뢰하지 않도록 경과 시간 환산(분석 1창/초 × 측정 초)도 병행한다.

## A. 합격 기준 (모두 충족해야 합격)

| ID | 기준 | 측정 방법 | 합격선 |
|---|---|---|---|
| A1 | 측정 시작 후 스트림 확정 | `capture_stream` 생성 + `capture.renew` 첫 기록까지 시간 | 시작 후 **30초 이내**, renew 10초 주기 유지(누락 연속 3회 미만) |
| A2 | 분석 데이터 도착률 (30분 이상) | `eeg_feature_windows` 행 수 / (측정 초 − 밴드 끊김 구간) | **≥ 99%**, sequence 결측 0 또는 설명 가능(끊김 구간 기록) |
| A3 | 원시 데이터 도착률 | `eeg_raw_chunks` v2 신호별(eeg/ppg/acc) 청크 수 vs 앱 보고 기대량 | **≥ 99%**, `biosignal-raw/summary` 대조 일치 |
| A4 | 종료 후 완결 | `final=true` 보고, 서버 `progress.state` | `all_received`, 기대량 대비 불일치 0 또는 사유 문서화 |
| A5 | 실시간 지표 | 코치 화면에 6지표 매초 갱신(지연 3초 초과 연속 10초 미만) | 6종 모두 표시, 멈춤 없음 |
| A6 | 백그라운드·화면 잠금 | 측정 중 잠금 10분 + 타 앱 전환 5분 후 복귀 | 서버 feature 행이 구간 내 계속 증가(결측 ≤ 1%), 복귀 후 적체 해소 |
| A7 | 소켓 단절 복구 | Wi-Fi 끄기 2분 → 켜기 | 5분 내 소켓 재연결(`live 상태 → ready`), 단절 중 생성 창이 복귀 후 서버에 전부 도착(A2 기준) |
| A8 | 스트림 확정 실패 자동 복구 (T1·T2) | `capture.start` ACK를 인위 지연(dev 프록시 15초 지연 또는 앱 시작 직후 비행기 모드 5초) | 자동 재시작 또는 `web_wasm` 하강으로 **60초 이내** feature 도착 시작, 사용자 조작 없음 |
| A9 | 네이티브 정지 복구 (T1 건강 점검) | 측정 중 앱에서 강제로 manager 상태 이상(진단 모드 `stopMeasurement` 직접 호출) | 15초 내 재시작 감지, feature 증가 재개 |
| A10 | 강제 종료 후 재실행 | 앱 스와이프 종료 → 재실행 | `recoverOnLaunch`로 이어서 측정 또는 gap으로 기록, 이전 구간 데이터 서버 도착 |
| A11 | 다인 동시 시작 | iPhone 3대 + Android 1대 동시 입장·시작 | 4대 모두 A1 충족, 서버 5xx 0 |
| A12 | 회귀 | Android 앱·웹 측정, 게스트 앱 측정 | 기존 시험 전부 통과, 정상 동작 |

## B. 구현 전 자동 시험 (vitest/pytest)

- B1. `decideMeasurementPath`: `nativeFailed` 미지정 시 기존 결과 전부 동일(기존 시험 통과) + `native && !guest && nativeFailed && webBluetooth(앱=true) && bandConnected` → `web_wasm`.
- B2. `useNativeMeasurementV2`: (a) 스냅샷이 20초 안에 `streamId` 제공 → `running`, (b) 미제공 → stop 후 새 requestId로 재시작, (c) 재시작 5회 소진 → `nativeFailed=true`, (d) `running` 중 `BLOCKED` 감지 → 재시작, (e) 화면 이탈 시 확인 타이머 정리(누수 없음), (f) 이전 화면 늦은 정리가 새 소유자를 끊지 않음(기존 `activeOwner` 시험 유지).
- B3. 진단 패널: 금지 표현 문자열 부재 검사(기존 금지어 lint 규칙 재사용), 토큰·개인정보 미노출.
- B4. (Swift, APP 창구) T3-a: `.arming` + READY 후 8초 → 같은 `command_id` 재전송 1회, 응답 `applied/duplicate`면 adopt, stream 생성 1개.

## C. 실행 절차와 증거 (구현 후, Stage ⑤)

1. 사전: 시험 회차 생성, 서버 기준선 쿼리(`evidence/a1.sh` 변형) 저장.
2. 기기 로그: Mac에 iPhone 연결, Console.app 필터 `subsystem:com.looxidlabs.mindbreeze2 category:measurement` 로그 파일 보관(`analysis.md` §5).
3. 시나리오 A1~A12 수행, 각 결과를 `summary.md`에 표로 기록(통과/실패/측정값/증거 파일).
4. 실패 시 원인 분류(확정/가설/모름) 후 재시험. 임계값(20초 등)은 근거와 함께 조정.
5. 합격 후 APP 창구에 빌드 전달 → TestFlight 후보로 동일 A1~A7 재실행(릴리즈 빌드 기준).

## D. 합격 판정 규칙
- A1~A7·A12 전부 충족 + A8~A11 중 실패 0 → **TestFlight 공개 베타 배포 가능**.
- A2/A3 중 하나라도 99% 미만이면 배포 보류, 원인 문서화 후 재시도.
- 구현자와 검증자는 분리(검증 워커는 diff·서버 쿼리로 독립 확인).
