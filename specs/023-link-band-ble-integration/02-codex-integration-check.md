# SDD-023 LINK BAND 실연동 통합 검증

판정: **통합 승인 보류**. 이식 파일은 도착했지만 타입 검사 실패, 런타임 의존성 누락, GATT 서비스 권한 누락 및 업로드 소유권 검증 문제가 있다. mock E2E는 절차를 작성했으며 실제 통과 판정은 하지 않았다.

- 최종 비교 스냅샷: **2026-09-07 23:16 KST**. 검사 도중 다른 작업자의 이식·백엔드 코드가 추가되어 재검사했다. 이후 변경은 이 판정의 대상이 아니다.
- MB HEAD: `5b6e4f0e57eac27557b563cee80004e569edfd5d`, SDK HEAD: `e309ce4dd7e8db471b3cd75231be5e6932d4ca2b`. HEAD가 아닌 해당 시점 디스크 파일을 비교했다.
- 기준: 같은 디렉터리 `spec.md`, `plan.md`, `verify.md`. 코드 수정 없이 이 문서만 작성했다. 다른 작업자의 변경은 보존했다.
- `SDK/` = `/Volumes/Looxid SSD/looxid/repository/link-band-sdk-web/src/`, `MB/` = `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/`. `파일:행`은 근거 위치다.
- 재현용 SHA-256 파일 manifest: `/tmp/sdd023-codex-snapshot.json`. 정렬 JSON 집계 해시: `4d40aa46cac41f7c475b684254604402ec6a56813fbf9183b77c1201223ee141`.

## 이식 정합 검증(누락/오역 목록)

### 1. 원본 utils 23개 전수 대조

원본 전체 파일을 열거하고 대응 파일의 전체 바이트·diff 및 import를 비교했다. **8개 동일, 10개 변경, 5개 미이식**이다. T5 열거 대상 18개는 모두 존재한다. 미이식 5개는 T5 범위 밖이며 필수 의존 누락으로 단정하지 않는다. 아래 경로는 원본 utils 및 MB frontend/src/lib/eeg 기준이다.

1. `ACCSignalProcessor.ts` — 동일. 타입의 일반 import도 그대로다(1행).
2. `BasicSignalProcessor.ts` — 변경: `../types/eeg`→`./types/eeg` 변경(2행), @ts-ignore 제거. fft.js/biquadjs import 유지.
3. `EEGSignalProcessor.ts` — 변경: `../types/eeg`→`./types/eeg` 변경(2행), @ts-ignore 제거. 계산 로직 동일.
4. `PPGSignalProcessor.ts` — 변경: @ts-ignore 제거. biquadjs 의존·계산 로직 유지(4행).
5. `SessionManager.ts` — 미이식, T5 제외. 포함 시 jszip/sonner/storageStore/timeUtils까지 의존(원본 1–6,321,650행).
6. `SimpleCircularBuffer.ts` — 동일. raw 타입·원형 버퍼 보존.
7. `SmartCircularBuffer.ts` — 미이식, T5 제외. StreamProcessor는 SimpleCircularBuffer 계열을 직접 사용하므로 현재 필수 아님.
8. `StoragePersistence.ts` — 미이식, T5 제외. 이식 그래프의 import 참조 없음.
9. `StreamProcessor.ts` — 변경: eeg 타입을 `./types/eeg`, 분석 서비스를 `./AnalysisMetricsService`로 변경(6–7행). 나머지 로직 동일.
10. `TimestampSynchronizer.ts` — 동일. 시각 정규화 로직 보존.
11. `bleConnection.ts` — 변경: eeg 타입 상대 경로만 수정(1행).
12. `blePacketParser.ts` — 동일. signed ADC·µV 환산·lead-off·timestamp 보존.
13. `bluetooth/BluetoothProvider.ts` — 동일.
14. `bluetooth/NativeBluetoothProvider.ts` — 변경: Capacitor 구현을 미지원 예외 스텁으로 교체. isConnected는 false. 웹 제외 스코프에 맞는 의도적 변경.
15. `bluetooth/WebBluetoothProvider.ts` — 동일. 서비스 요청 권한 문제도 원본 그대로 남음.
16. `bluetooth/index.ts` — 변경: Capacitor 동적 import/native 분기를 제거하고 WebBluetoothProvider만 생성. resetBluetoothProvider 추가.
17. `bluetoothService.ts` — 변경: eeg 타입 상대 경로 수정(1행), NodeJS.Timeout을 ReturnType<typeof setInterval>로 변경(158행).
18. `brainStateAnalysis.ts` — 변경: eeg 타입 상대 경로만 수정(3행).
19. `logger.ts` — 동일.
20. `mockDataGenerator.ts` — 변경: protocol raw 타입을 SimpleCircularBuffer 타입으로, analysis 타입을 types/processed-data로 대체(6–12행). 생성 로직은 동일.
21. `pathUtils.ts` — 미이식, T5 제외. 이식 그래프의 import 참조 없음.
22. `signalProcessing.ts` — 동일.
23. `timeUtils.ts` — 미이식, T5 제외. SessionManager를 제외한 현재 그래프에서 참조 없음.

추가된 파일 6개도 확인했다. `types/eeg.ts`, `types/processed-data.ts`, `types/bluetooth.d.ts`는 SDK 대응 파일과 동일하다. `index.ts`는 MB 진입점, `types/vendor-modules.d.ts`는 수동 패키지 선언이다. `AnalysisMetricsService.ts`는 원본 1,400여 행 서비스를 155행 경량 구현으로 대체했다. utils 외부 타입·store 경로를 해결한 방향은 맞지만 **서비스의 의미적 동등성은 성립하지 않는다**.

### 2. P0/P1 — 실제 검증 실패 및 미반영

- **타입 검사 실패:** `cd frontend && ./node_modules/.bin/tsc -b`는 종료 코드 2, 최종 오류 **57개**. TS6133 45개, TS1484 7개, TS2339 4개, TS6196 1개. 로그 `/tmp/sdd023-codex-tsc-final.log`. 직전 55개 오류 로그는 `/tmp/sdd023-codex-tsc.log`이며 다른 작업자의 수정으로 개수가 달라졌다. 이 스냅샷은 build의 tsc 게이트를 통과하지 못한다.
- **타입 import 충돌:** ACC/EEG/PPGSignalProcessor 1행, StreamProcessor 1·6행의 타입 import가 `verbatimModuleSyntax=true`에 위배되어 TS1484가 실제 발생했다. `bluetoothService.ts:158`의 NodeJS namespace 오류는 ReturnType 변경으로 최종 검사에서 해소됐다. 미사용 멤버/인자는 noUnusedLocals/noUnusedParameters 오류를 낸다.
- **Biquad 선언 오역:** `MB/frontend/src/lib/eeg/types/vendor-modules.d.ts:3`은 `apply(sample)`만 선언하지만 실제 코드는 `applyFilter`를 호출한다(EEGSignalProcessor:513,564; BasicSignalProcessor:381; PPGSignalProcessor:311). 이 네 곳에서 TS2339가 발생했다. SDK 설치본 biquadjs의 d.ts에는 실제 applyFilter와 factory 선언이 있다. makeBandpassFilter의 실제 인자는 `(freqStart, freqEnd, sps, resonance?)`인데 MB 수동 선언은 `(frequency, sampleRate, Q?)`로 의미가 잘못됐다. 숫자 타입이 같아도 API 계약은 같지 않다.
- **biquadjs/fft.js 미반영:** 검사 시점 MB package.json과 package-lock에 두 패키지가 없으며 biquadjs 설치 디렉터리도 없다. vendor 선언은 런타임 설치를 대체하지 않는다. SDK는 각각 `^1.1.0`, `^4.0.4`를 사용한다. BasicSignalProcessor를 포함했으므로 fft.js도 필요하다.
- **훅·UI 코드 도착:** useBand, API client, SessionLivePage 및 GuestMeditationPanel 연결 코드가 추가됐다. 초기 “훅/API 없음” 판정은 철회한다. 그러나 아래 mock의 raw 우회 및 1초 윈도우 문제가 있어 실연동 완료는 아니다.

### 3. P1 — 원본에서 이어지는 웹 연결 결함

`MB/frontend/src/lib/eeg/bluetoothService.ts:412,461`은 provider.requestDevice에 namePrefix만 전달한다. `bluetooth/WebBluetoothProvider.ts:29`는 optionalServices를 빈 배열로 만든다. 뒤의 getPrimaryServices/getPrimaryService(58,86행)에 필요한 서비스 권한이 없다. 이름 필터를 쓰면 별도 서비스 권한이 필요하다는 [Chrome 공식 문서](https://developer.chrome.com/docs/capabilities/bluetooth#name_filter)와 대조한 정적 판정이다.

EEG·PPG·ACC·battery UUID(bluetoothService:29–44)를 요청 경로 모두에 전달해야 한다. **이식 과정의 오역이 아닌 원본 결함의 유지**이며, 하드웨어 재현은 미실행이다. mock raw 주입으로는 이 결함을 잡을 수 없다.

### 4. P1 — 분석 의미·품질 계약 변화

- 경량 `AnalysisMetricsService.ts:103–115`는 movingAverageValues에 현재 값을 그대로 복사한다. 원본 `SDK/services/AnalysisMetricsService.ts:165` 부근의 SQI≥80 품질 큐·이동평균이 제거됐다. PPG/ACC는 no-op(121–137행)이고 broadcastStore 의존도 사라졌다. PPG/ACC 제외는 스코프와 맞지만 EEG 품질·평균 변화는 별도 결정과 테스트가 필요하다.
- `AnalysisMetricsService.ts:76`의 signalQuality는 processed overall 원값이다. 새 `useBand.ts:78–80,106`에서 100으로 나누고 0–1로 clamp하여 BE 계약에 맞췄다. 정규화 누락 우려는 해소됐으나 FE deviceStatus는 SQI<40만 lead_off(useBand:116), BE는 0.7 미만도 degraded→lead_off라서 SQI 40–69에서 상태가 다르다. 임계값을 정합화해야 한다.
- EEGSignalProcessor:77–83의 `|| 0` fallback은 그대로다. 산출 불가를 NULL로 보존한다는 MB 모델 계약과 다르다. 새 BE도 `_quality_from_signal`에서 None을 valid로 취급한다(session_service.py:783 부근). 품질 불명 데이터를 유효 측정으로 승인하는 정책인지 결정해야 한다.
- mock은 fp1/fp2/leadOff를 생성하지만 StreamProcessor:248–270은 ch1/ch2/leadoff_ch1/leadoff_ch2를 읽는다. 명시적 어댑터가 필요하다.
- 원본/이식 EEGSignalProcessor:68은 최소 500샘플, StreamProcessor:94는 1250샘플 버퍼다. 500샘플 이후 청크마다 분석하므로 1초 feature 주기는 useBand에서 보장해야 한다(284–285행).
- meditationLevel은 relaxationIndex 복사다(StreamProcessor:629). MB 리포트 두뇌휴식도는 relaxation_score다(backend/app/tasks/report_task.py:130). 현재 BE live-metrics는 raw relaxation_index를 current_efficiency로 반환하므로 리포트와 점수 정의를 대조해야 한다.

### 5. P1 — 새 useBand의 mock·시간·종료 계약

- **raw E2E 미충족:** `useBand.ts:216–232`의 startMock은 generateEEGAnalysis와 난수 band power를 ingestMetrics에 바로 전달한다. `generateEEGRaw`·StreamProcessor·필터는 실행하지 않는다. VITE_USE_MOCK_EEG=true의 UI/업로드 성공은 **feature→API 시험**으로만 인정한다.
- **1초 윈도우 미보장:** `useBand.ts:188–192`는 분석 콜백마다 second_offset을 1 증가시킨다. 실제 BLE는 StreamProcessor가 500샘플 이후 패킷마다 분석하므로 샘플의 실제 1초와 offset이 어긋난다. mock의 1초 타이머가 이 문제를 가린다. 재마운트 때 offset=0(useBand:144)으로 돌아와 기존 저장 초와 중복될 수도 있다.
- **종료 잔여 유실:** 명시 disconnect는 flushFeatures를 호출하지만(240행), unmount cleanup은 flush 없이 타이머/stream만 종료한다(355–369행). 연결 중 raw가 계속 들어오면 flush 이후 stream 종료 전 생긴 윈도우도 남을 수 있다. 공급 중단→분석 완료→잔여 flush 순서를 검증해야 한다.
- **재시도 정책:** 업로드 실패는 배치를 되돌리는 코드가 있다(177–184행). 다만 4xx/5xx를 구별하지 않고 5초마다 재시도하며 in-flight 직렬화·상한·백오프는 없다. 종료 시 실패 배치가 복원된 뒤 더 이상 flush되지 않는 경우도 확인한다.

## mock E2E 검증 절차(단계별)

**아래는 구현 완료 후 실행할 검증 절차다. 이번 검사에서는 E2E를 실행하거나 통과시키지 않았다.** 현재 타입 검사·의존성이 막혀 있고 훅 mock은 raw 처리를 우회한다. 아래 body는 도착한 backend schema를 기준으로 하며 실행 시 OpenAPI와 재대조한다.

### 1. 실행 전 계약과 환경 고정

1. 이식 파일, useBand, ingestion 라우트가 있는 고정 스냅샷을 확보한다. 현재 mock 진입점은 `VITE_USE_MOCK_EEG=true npm run dev`(frontend에서 실행)다. 이 모드는 아래 raw 경로를 검증하지 않으므로 feature→API smoke 용도로만 먼저 실행한다. FE/BE 커밋, 브라우저·Node 버전, lockfile, 테스트 DB 식별자를 기록한다.
2. 격리된 로컬 테스트 DB를 사용하고 그 DB에 필요한 migration이 적용되어 있는지 확인한다. 이 검증 문서는 운영 DB 마이그레이션을 지시하지 않는다.
3. 실제 OpenAPI에서 `POST /api/v1/sessions/{session_id}/features` 계약을 확인한다. 현재 `EEGFeatureBatchRequest`는 `{ participant_id?: string, features: EEGFeatureItem[] }`, 각 item의 필수값은 `second_offset >= 0`이며 timestamp와 feature는 nullable이다. 성공 응답은 HTTP 200 `{session_id, saved}`다. quality는 payload 필드가 아니라 signal_quality로 BE가 산출한다(backend/app/schemas/session.py:231 이하, api/v1/session.py:162). `/api/v1`은 현재 클라이언트 기본 prefix다(`MB/frontend/src/lib/api/client.ts:3`). 이 endpoint가 없다면 이 단계에서 BLOCKED로 기록한다.
4. 호스트 H, EEG 동의한 로그인 참여자 A, 다른 참여자 B, 미참가자 X를 준비한다. 실제 가입·참여 플로우로 테스트 세션 S를 만들고 진행 상태로 전환한다. 비로그인 게스트 G도 준비하되 아래 소유권 취약점 검증을 먼저 수행한다.
5. 브라우저 테스트는 실제 useBand와 실제 HTTP·DB를 사용한다. 교체하는 것은 BLE 입력뿐이다. POST/live-metrics 응답을 mock하면 저장까지의 E2E 증거가 되지 않는다. 현재 startMock의 analysis 직결을 raw→동일 StreamProcessor 입력으로 교체하는 테스트 진입점이 필요하다. 이는 담당 구현자의 선행 작업이며 이번 문서 작성자가 코드를 수정하지 않았다. 해당 진입점 없이 별도 콘솔 업로드만으로 전체 E2E를 통과시키지 않는다.

### 2. 재현 가능한 raw 생성과 입력 어댑터

1. `mockDataGenerator.generateEEGRaw(7500)`으로 30초분을 한 번 생성해 테스트 fixture로 보관한다. 실행 seed를 제어하거나 생성 결과를 고정해야 반복 비교가 가능하다. 생성된 analysis 값은 사용하지 않는다. `generateEEGAnalysis()`는 난수 지표로 raw 처리 결과가 아니다(`SDK/utils/mockDataGenerator.ts:82` 부근).
2. 기준 시각 T0를 정하고 각 샘플의 timestamp를 `T0 + i * 4` ms로 고정한다. 원본 generator는 호출마다 Date.now와 파형 인덱스를 초기화하므로 250개씩 빠르게 여러 번 호출하면 중첩 시각과 파형 경계가 생길 수 있다.
3. generator 결과를 새 객체로 변환한다. 문서용 어댑터 예시는 다음과 같다. 실제 타입은 이식된 EEGDataSample을 사용한다.

```ts
const samples = raw.map((point, i) => ({
  timestamp: t0 + i * 4,
  ch1: point.fp1,
  ch2: point.fp2,
  leadoff_ch1: point.leadOff.ch1,
  leadoff_ch2: point.leadOff.ch2,
}));
```

4. 샘플 수 7500, 두 채널 유한수, 인접 시각 차이 4ms, lead-off false를 검증한다. mock signalQuality 80–100을 stream의 lead-off 기반 0–1 품질값과 혼용하지 않는다(`SDK/utils/StreamProcessor.ts:450` 부근).
5. 실제 BLE가 사용하는 `{ type: 'eeg', samples }` 입력 경계로 250샘플씩 1초 간격 전달한다(`SDK/utils/bluetoothService.ts:621`). useBand의 동일 processor 인스턴스를 사용해야 한다. 별도 StreamProcessor 호출은 하위 처리 시험일 뿐 훅 전체 E2E가 아니다.

### 3. raw → feature 검증

1. raw callback의 수신 누계를 입력 누계와 비교한다. 처음 250샘플에서는 feature가 없어도 정상이며, 최소 500샘플 이후 콜백을 기다린다. 비동기 분석 완료 전에 다음 결과가 있다고 가정하지 않는다.
2. `onProcessedEEG`의 bandPowers와 indices를 수집한다(`SDK/utils/StreamProcessor.ts:637`). delta/theta/alpha/beta/gamma 구조 및 유한수 여부, timestamp 순서, focus/relaxation/stress 산출을 확인한다.
3. 같은 raw fixture를 동일 길이의 슬라이딩 구간으로 원본 EEGSignalProcessor와 이식본에 넣고, 필터링 파형·밴드파워·indices·품질을 비교한다. 허용 오차는 예를 들어 `1e-6 × max(1, |원본값|)`를 출발점으로 명시하고 초과 이유를 조사한다. 품질이 나쁜 난수 fixture에서 특정 지표가 반드시 양수여야 한다고 가정하지 않는다.
4. useBand에서 실제 1초당 최대 한 윈도우로 정규화되는지 확인한다. 초기 워밍업 구간의 second_offset→window_index 기준, 재연결 시 인덱스 유지, 늦게 완료된 결과 처리 정책을 기록한다. 5초 분석 구간과 5초 업로드 주기는 서로 다른 개념이다.
5. camelCase → snake_case 매핑을 검증한다: focusIndex→focus_index, cognitiveLoad→cognitive_load, relaxationIndex→relaxation_index, stressIndex→stress_index, emotionalStability→emotional_stability, hemisphericBalance→hemispheric_balance. totalPower→total_neural_activity는 단위·정의를 확인한 뒤에만 채택한다. 현재 schema에는 faa/total_neural_activity 입력이 없고 ingestion도 이 컬럼을 채우지 않는다. total_power와 total_neural_activity는 별개 컬럼이므로 리포트 입력 누락을 별도로 판정한다(`SDK/utils/EEGSignalProcessor.ts:55–63`, `MB/backend/app/services/session_service.py:898` 부근).

### 4. 5초 배치 업로드 검증

1. 실제 훅의 업로드 타이머를 관측하고, 워밍업 이후 5초 주기마다 그동안 완료된 윈도우만 POST하는지 Network 로그로 확인한다. 초기 배치가 반드시 5개라고 가정하지 않는다. 청크 주기를 100ms로 바꿔도 초당 윈도우 수가 10배로 늘지 않아야 한다.
2. 각 요청에 대해 발송 시각, 세션·참여자 식별자, window_index 목록, quality, feature 값, 응답 상태·저장 결과를 기록한다. 토큰은 증거 파일에 남기지 않는다.
3. 요청 body를 OpenAPI 계약과 대조한다. 현재 예시는 `{ "participant_id": "<A의 ID>", "features": [{ "second_offset": 0, "timestamp": 0, "relaxation_index": 0.6, "signal_quality": 0.9 }] }`다. 실제 E2E에서는 timestamp와 feature를 관측한 raw 처리 결과로 채운다. 200 응답의 saved와 DB 신규 행 수를 함께 비교한다. 같은 배치를 재전송하면 현재 구현상 saved=0을 기대한다.
4. 한 배치를 네트워크 오류로 실패시키고 복구한다. 실패한 윈도우를 성공 전에 큐에서 제거하지 않는지, 재전송으로 중복 저장되지 않는지 확인한다. 영구 4xx는 무한 재시도하지 않아야 한다.
5. 세션 종료 직전에 남은 1–4개 윈도우를 생성하고 잔여 flush 정책을 확인한다. 종료·unmount 후 타이머가 추가 요청을 보내지 않는지 검사한다.

### 5. EEGFeatureWindow 저장 검증

1. POST 완료 후 **별도 DB 연결**에서 저장 내용을 조회해 commit 여부를 확인한다. 아래는 현 모델에 맞는 읽기 전용 조회 예시이며 UUID를 테스트 세션 값으로 치환한다.

```sql
SELECT session_id, participant_id, user_id, window_index, quality,
       focus_index, relaxation_index, stress_index, faa, created_at
FROM eeg_feature_windows
WHERE session_id = '<테스트 세션 UUID>'::uuid
ORDER BY participant_id, window_index;
```

2. DB 행과 전송한 각 윈도우를 식별자로 1:1 대조한다. 유한 feature 값의 보존, NULL 보존, 성공 저장 개수, 실패 배치의 원자성·부분 성공 정책을 확인한다.
3. 같은 배치를 다시 보내 중복 키 처리와 멱등성을 검증한다. 단순 500 IntegrityError는 실패다. 최신 값을 다른 값으로 덮어쓸 수 있는지 정책도 명시한다.
4. A와 B가 같은 window_index를 전송하는 경우를 반드시 포함한다. 새 모델·migration은 `(session_id, participant_id, window_index)` 키다. 두 참여자의 같은 초가 모두 저장되는지 확인하고, 예전 migration까지만 적용된 DB에서는 충돌/컬럼 오류가 나는지도 구별한다. migration 파일 존재만으로 적용 완료라 하지 않는다.

### 6. live-metrics·UI 연결 검증

1. H로 `GET /api/v1/sessions/{S}/live-metrics`를 호출한다. 응답의 A 행에 표시된 최신값이 DB의 **A 최신 윈도우**에서 계산됐는지 대조한다. HTTP 요청은 `/api/v1` prefix와 호스트 인증을 사용한다(`MB/backend/app/api/v1/session.py:181` 부근).
2. A와 B에 서로 다른 raw fixture를 넣어 최신값·평균값이 섞이지 않는지 검증한다. 현재 current_efficiency는 해당 참여자의 최대 window_index 행의 relaxation_index, avg_efficiency는 null 제외 전체 평균을 소수점 4자리 반올림한 값이다(_aggregate_window_stats). 이 계산으로 비교하되 invalid 품질 포함 여부와 리포트 점수 차이를 별도 실패/결정 항목으로 남긴다.
3. 호스트 테이블과 게스트 화면을 열어 같은 계약의 값과 연결 상태를 확인한다. 게스트 응답에는 relaxation_index/focus_index/stress_index/signal_quality가 추가됐지만 UI 연결은 별도 검증한다. X의 호스트 조회는 접근 거부돼야 한다.
4. EEG mock만으로 battery 실측을 검증했다고 하지 않는다. 별도 battery 이벤트를 입력하거나 null을 유지하고, 장치 미연결·재연결 이벤트를 별도로 주입한다.
5. 입력을 중지하고 승인된 stale 시간 이후 delayed/disconnected 표시를 확인한다. 마지막 데이터 저장 시각과 센서 측정 시각을 구별한다. 현재 응답 last_eeg_at은 created_at이고 device_timestamp_ms를 사용하지 않으므로 재전송 데이터가 새 실측처럼 보이지 않게 해야 한다.

### 7. 실패·권한·동의 시나리오

- 미참가자 X가 S에 업로드하면 verify.md 요구대로 403이며 DB 증가가 없어야 한다. 다른 참여자 ID를 payload에 넣어도 우회되지 않아야 한다.
- 미동의·대기열 참여자·종료 세션의 처리 정책을 정하고 거부/허용 결과 및 DB 불변 여부를 확인한다.
- G의 guest participant ID만 아는 제3자가 업로드할 수 없어야 한다. 현재 participant_id만으로 소유권 검사를 통과하므로 이 음성 시나리오는 실패가 예상된다. 인증 증명 보강 후 재검증한다.
- null feature, 비유한수, 음수/중복/역순 인덱스, 잘못된 quality, 초과 배치 크기를 넣고 스키마 거부 또는 명시된 처리 결과를 확인한다.
- lead-off true 입력이 정상 valid 지표로 저장되지 않는지 확인한다. 밴드를 사용하지 않는 상담·명상 흐름은 동작하고 측정 지표는 대기/null이어야 한다.

### 8. BLE 파서와 최종 증거

- 위 raw 주입은 **GATT·바이트 파서를 우회**한다. 별도 하드웨어 없는 parser 시험에서 `4 + 7*N` 바이트 EEG fixture를 구성한다. 헤더는 little-endian 32768Hz tick, 각 샘플은 lead-off 1바이트 + 채널별 24-bit big-endian signed 값이다. 알려진 ADC 값→µV 변환, lead-off bit 0/2, 마지막 샘플 기준 4ms 역보간을 검증한다(`SDK/utils/blePacketParser.ts:68–101`). PPG·ACC는 각 파서 계약으로 별도 검사한다.
- 전체 시험은 raw fixture, processor 출력, POST·응답 로그, 별도 연결 DB 조회, live-metrics JSON, UI 캡처를 같은 세션·참여자·인덱스로 연결해 남긴다. 데이터 비교 증거 없이 UI 숫자만 바뀐 것은 통과가 아니다.
- 구현 후 `cd frontend && npm run build`, `cd backend && ./venv/bin/python -m pytest -q`를 실행하고 종료 코드와 통과/실패/skip 수를 기록한다. 이번 검증에서 backend pytest, HTTP/DB E2E, 브라우저 UI 시험은 미실행이다.

## 리스크·결정 포인트

### P0 — 업로드 소유권·동의 검증

`MB/backend/app/api/v1/session.py:162`의 ingestion은 get_current_user_optional을 사용한다. `session_service.py:864` 부근에서는 payload.participant_id가 있으면 세션 소속 여부만 확인하고 **현재 로그인 사용자와 participant.user_id의 일치 여부를 검사하지 않는다**. 비로그인 요청도 다른 참여자의 ID를 알면 업로드할 수 있는 정적 경로다. 사용자 UUID가 추측하기 어렵다는 점은 소유권 검증을 대체하지 못한다. guest 전용 인증 증명과 로그인 참가자 소유권 검사를 분리하고, 타인 ID 제출·무토큰 제출에 대한 실패 시험을 필수로 둔다.

ingest_features에는 consent_eeg, is_waitlisted, 세션 종료 상태를 확인하는 분기도 없다. 단순히 세션 참가자 행이 존재한다는 것과 EEG 업로드 권한은 구분해야 한다. 실제 HTTP 공격 재현은 하지 않았으며 코드 경로로 확인한 사항이다.

### P1 — DB migration·리포트·stale 상태

새 `eeg_feature.py:24`는 participant 단위 unique key, nullable user_id, participant_id와 device_timestamp_ms를 도입했다. `backend/alembic/versions/c9e1f2a3b4d5_sdd_023_eeg_feature_ingestion.py:42` 이하에 migration도 있다. **초기 검사에서 발견한 다중 참여자 키·게스트 NOT NULL 문제는 모델 수준에서 해소됐다.** 실제 DB 적용은 미검증이다. nullable participant_id의 기존 행 backfill 및 PostgreSQL NULL unique 동작, 기존 데이터가 있는 상태의 migration도 검증해야 한다.

리포트는 여전히 세션 전체 행을 하나의 시계열로 읽는다(`backend/app/tasks/report_task.py:76–80`). 다중 사용자 같은 초가 들어오면 섞이므로 참여자별 리포트 분리가 필요하다. ingestion은 total_power만 저장하고 리포트 입력인 total_neural_activity/faa는 채우지 않는다. 후속 변환 계약이 필요하다.

현재 조회는 데이터가 하나라도 있으면 upload_status=streaming이며 최신 품질만으로 device_status를 정한다(`session_service.py:670` 부근). 시간 만료 검사가 없어 입력 중단 후에도 실시간으로 표시될 수 있다. band_connected도 업로드 성공 시 true로만 바뀐다(932행 부근). stale TTL·종료·disconnect 정책을 확정해야 한다. 배터리는 여전히 None으로, verify.md의 배터리 실값 수락 기준은 미충족이다.

동시 중복 요청은 기존 인덱스 조회 후 insert이므로 race 가능성이 있다. unique 충돌을 처리하는 코드가 없어 500 가능성을 동시 요청 시험으로 확인한다. features 최대 길이, float 유한성, signal_quality 0–1 범위 제한도 현재 schema에 없다.

### P1 — Web Bluetooth·Capacitor 제거

Chrome 공식 문서는 secure context와 사용자 클릭/터치로 requestDevice 호출을 요구하며 OS별 지원 차이도 명시한다. Chromium 이름만으로 지원을 단정하지 말고 window.isSecureContext, navigator.bluetooth, 연결 실패·취소를 구분한다. 프로젝트의 Safari/Firefox 미지원 안내를 유지하고 밴드 없는 핵심 흐름을 제공한다. [Chrome 공식 요구사항](https://developer.chrome.com/docs/capabilities/bluetooth#security_requirements)

Capacitor 런타임 import는 현재 factory·native 스텁에서 제거됐다. 남은 주석과 스텁 이름은 패키지 잔존으로 판정하지 않는다. 이는 웹 범위에 맞는 변경이며 native 기능 제공을 의미하지 않는다. 다만 원본에서 이어진 optionalServices 누락은 별도 해결이 필요하다.

### P1 — biquadjs × Vite/Rolldown

현 MB 설치본은 Vite 8.0.13이며 package.json에서 rolldown 1.0.1 의존을 확인했다. SDK 설치본 biquadjs 1.1.0은 main=dist/BiquadFilters.js, module=dist/BiquadFilters.esm.js, types=dist/BiquadFilters.d.ts, type=module이다. **타입 선언이 없다는 이식본 vendor 주석은 설치본과 다르다.** 실제 d.ts 94–95행의 factory 계약에 맞춰 선언을 검증한다.

최종 tsc는 57개 오류로 실패했으므로 해당 스냅샷 production build는 진행하지 않았다. 라이브러리 설치·타입 오류 해소 뒤 실제 production entry에서 필터 생성·유한 출력·고정 raw fixture 결과를 확인해야 한다. tree-shaking된 미사용 패키지나 Node 단독 import 성공만으로 브라우저 호환을 승인하지 않는다.

이식 도착 **전** 기준선은 다음 명령으로 통과했다. 현재 이식본의 통과 증거가 아니다.

```bash
cd frontend
./node_modules/.bin/tsc -b && ./node_modules/.bin/vite build --outDir /tmp/sdd023-codex-build
```

기준선 결과: 종료 코드 0, tsc 오류 없음, 755개 모듈, 빌드 2.09초. tokens.css import 해석 경고, 500kB 초과 청크 경고, 외부 outDir 안내가 있었다. 이식 도착 후 첫 tsc는 종료 코드 2/55개 오류, 후속 tsc는 종료 코드 2/57개 오류다. 이식 전 성공과 이식 후 실패를 구분한다.

### P2 — 수명주기·계산 부하

StreamProcessor 생성자 setInterval(117행)은 핸들을 저장하지 않고 cleanup(189행 부근)도 이를 해제하지 않는다. 연결 반복·React 재마운트 시 잔존 타이머를 검사한다. AnalysisMetricsService singleton의 latestEeg와 콜백도 세션 전환 때 초기화/구독 해제 정책이 필요하다.

PPG/ACC 분석 서비스는 no-op이지만 StreamProcessor는 처리기를 생성하고 신호 분석을 호출한다(97–103,310–413행). 파싱만 수행한다는 스코프와 실행 비용이 다르다. EEG 분석도 패킷 단위로 호출되므로 1초 주기·메인 스레드 지연을 측정해야 한다.

## 최종 권고안

1. **통합 승인 보류:** T5의 18개 파일은 도착했으나 최종 타입 검사 57개 오류, biquadjs/fft.js 미반영, mock raw 우회 상태다.
2. **우선 차단 해소:** 참가자 업로드 소유권·동의, GATT optionalServices, Biquad 실제 API 선언, 타입 import, raw mock·1초 윈도우·종료 flush를 정합화한다. 코드 변경은 담당 구현자가 수행한다.
3. **의미 계약 확정:** 분석 SQI 정규화는 구현됐으며 FE/BE 접촉 임계값, 경량 서비스의 이동평균 제거, null 품질 처리, 휴식 점수·리포트 입력, stale TTL을 확정한다.
4. **재검증:** 고정 스냅샷 파일 diff → tsc/production build → 동일 raw 원본 대비 → 실제 훅·HTTP·별도 DB 연결·live-metrics → 타인 ID/게스트/다중 참여자/재전송/종료 flush → UI와 실장치 연결 순으로 진행한다.
5. **실행 범위:** 정적 전수 대조 및 프론트 기준선 빌드 및 이식 이후 두 차례 타입 검사를 수행했다. backend pytest, HTTP·DB mock E2E, 브라우저 UI, 하드웨어 연결은 미실행이다. 이 문서를 구현 후 Verify의 통과 증거로 사용하지 않는다.
