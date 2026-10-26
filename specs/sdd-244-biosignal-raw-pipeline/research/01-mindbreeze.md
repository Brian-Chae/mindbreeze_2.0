# SDD-244 — MIND BREEZE 생체신호 처리·저장·다운로드 조사

- 조사일: 2026-10-24. 조사 대상: `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0`, 브랜치 `develop`, HEAD `aa3505b5952ff09c8529c9d4b3c86959d7be5280`(조사 시 git 조회).
- 아래 `frontend/`, `backend/`, `specs/` 근거는 모두 위 **develop 루트** 기준 `파일:행`이다. SDD-243 참고만 별도 절대 경로를 사용한다.
- 코드 정적 조사이다. 서버·DB·.env·실데이터·장치·S3에 접근하지 않았고 실행 검증은 하지 않았다. “저장”은 코드상 연결 여부이며 운영 데이터의 존재·완전성을 뜻하지 않는다. 영향이 실행으로 확인되지 않은 항목은 **추정**으로 표시했다.
- 작업 범위: 본 문서 1개만 작성. 기존 SDD-244 spec 및 develop의 기존 변경 파일은 수정하지 않음. 커밋·푸시·배포·삭제·메일 발송 없음.

## 1. 결론과 핵심 표

현재 파이프라인은 **EEG 원파형 + EEG/PPG/ACC 파생 feature 일부**를 저장한다. **PPG/ACC 원파형과 당시 화면 6대 지표 스냅샷**은 저장 계약에 없다. 일반 사용자 분석 ZIP은 feature·report 중심이며 EEG raw는 별도 연구 내보내기에만 포함된다. 근거: `frontend/src/hooks/useBand.ts:286-323`, `frontend/src/hooks/useBand.ts:1223-1229`, `backend/app/services/export_package.py:12-40`, `backend/app/services/research_export_service.py:64-95`.

| 신호/데이터 | 수신 | 처리 위치·산출 | 서버 저장 | 기존 다운로드/내보내기 |
|---|---|---|---|---|
| EEG | 250Hz, Fp1/Fp2, μV | FE: notch/bandpass, SQI, Morlet PSD, 대역파워·원지표 | raw `.bin`+`eeg_raw_chunks`; feature 일부 `eeg_feature_windows` | 일반 ZIP: feature CSV만. 연구: raw bin을 binary payload로 담은 Parquet |
| PPG | 50Hz, red/IR, ADC 정수 | FE: DC 제거·bandpass·peak/RR, BPM·SDNN/RMSSD·LF/HF·호흡 | 파생값만 feature 행에 기록, raw 미연결 | 일반 CSV/연구 Parquet에 파생값만 |
| ACC | 30Hz, x/y/z, g | FE: magnitude·movement·intensity → motion 0–1 | motion만 feature 행에 기록, raw 미연결 | 일반 CSV/연구 Parquet에 motion만 |
| 화면 6대 지표 | EEG/PPG 처리 결과 | FE: 마음3 정규화, 몸3 물리 단위, 접촉·stale 게이트·반올림 | 당시 표시값·모델·게이트 스냅샷 없음 | 원 feature/리포트 집계는 존재하나 당시 화면값 다운로드가 아님 |

표 근거: `frontend/src/lib/eeg/blePacketParser.ts:62-110`, `:127-158`, `:175-237`; `frontend/src/lib/eeg/EEGSignalProcessor.ts:198-284`; `frontend/src/lib/eeg/AnalysisMetricsService.ts:195-230`; `frontend/src/hooks/useBand.ts:286-323`, `:433-493`; `frontend/src/components/class/player/member/MemberClassContainer.tsx:62-71`; `backend/app/services/export_package.py:12-49`; `backend/app/services/research_export_service.py:82-95`, `:394-403`.

## 2. BLE 수신 → 패킷 파서 → StreamProcessor

### 2.1 웹과 앱

- `lib/ble/index.ts`가 플랫폼에 따라 adapter를 선택한다. 네이티브는 Capacitor `BleClient.startNotifications`의 DataView를 전달한다. 이후 공통 bluetoothService가 동일 parser를 호출하므로 신호 계산이 네이티브 SDK로 별도 이전된 구조는 아니다. 근거: `frontend/src/lib/ble/index.ts:8-14`, `frontend/src/lib/ble/capacitor-ble-adapter.ts:97-110`, `frontend/src/lib/eeg/bluetooth/index.ts:6-11`, `frontend/src/lib/eeg/bluetoothService.ts:637-640`, `:658-664`, `:680-691`.
- `NativeBluetoothProvider.ts`의 과거 스텁 주석을 현재 네이티브 동작으로 해석하면 안 된다. 실제 factory가 기준이다. 근거: `frontend/src/lib/eeg/bluetooth/NativeBluetoothProvider.ts:2-4`, `frontend/src/lib/eeg/bluetooth/index.ts:6-11`.

### 2.2 샘플 계약

| 항목 | EEG | PPG | ACC |
|---|---|---|---|
| 샘플레이트 | 250Hz / 4ms | 50Hz / 20ms | 30Hz / 33.333ms |
| 채널 | ch1→Fp1, ch2→Fp2 | red, ir | x, y, z |
| payload | 4B 시각 + 샘플당 7B | 4B 시각 + 샘플당 6B | 4B 시각 + 샘플당 6B |
| 값 인코딩 | lead-off 1B + signed 24bit×2 | unsigned 24bit×2 | signed int16 LE×3 |
| 값 변환 | signed×4.033/12/(2²³−1)×10⁶ → μV | 보정 없는 ADC 정수 | raw×2/32768 → g(±2g) |
| 시각 헤더 | uint32 LE / 32768초 | uint32 BE / 32768초 | uint32 LE / 32768초 |
| 개별 시각 | 마지막 샘플 기준 `base+(i−N+1)×4` | 마지막 샘플 기준 `base+(i−N+1)×20` | 이전 청크와 연속 배치, 큰 차이 시 재동기화 |

근거: `frontend/src/lib/eeg/blePacketParser.ts:7-8`, `:69-110`, `:134-158`, `:184-237`; Fp1/Fp2 매핑 `frontend/src/lib/eeg/StreamProcessor.ts:280-310`.

EEG lead-off는 bit0/bit2이다. 저장되는 EEG raw는 **BLE 패킷 자체나 ADC 정수가 아니라 μV 변환 후 float32**이다. 패킷 헤더·lead-off·원 ADC 정수는 bin에 포함되지 않는다. 근거: `frontend/src/lib/eeg/blePacketParser.ts:84-109`, `frontend/src/lib/session-live/raw-encoder.ts:14-30`.

### 2.3 시간축의 실제 의미

1. TimestampSynchronizer는 첫 패킷의 `Date.now()`와 장치시각을 anchor로 잡고 `masterTimeBase + (deviceTimestamp-deviceTimeBase)`를 만든다. 5초 또는 drift 조건에 따라 재동기화한다. 서버 기준시각 동기화가 아니라 **클라이언트 벽시계 매핑**이다. 근거: `frontend/src/lib/eeg/TimestampSynchronizer.ts:75-77`, `:113-124`, `:171-176`, `:343-373`.
2. ACC는 첫 패킷 이후 `lastAccTimestamp + N×33.333ms`를 사용하고 장치시각 간격이 기대 패킷 간격의 3배를 초과할 때 재앵커링한다. 근거: `frontend/src/lib/eeg/blePacketParser.ts:192-208`.
3. parser의 `arrivalTime/deviceTimestampSec/numSamples/sensorType`는 존재하지만 StreamProcessor의 `_metadata`에서 원시 저장 콜백으로 이어지지 않는다. 근거: `frontend/src/lib/eeg/blePacketParser.ts:10-15`, `frontend/src/lib/eeg/StreamProcessor.ts:235-243`, `:280`, `:308-310`, `:342`, `:367-369`, `:396`, `:421-423`.
4. EEG raw 청크 start/end는 개별 샘플 timestamp가 아니라 수신 버퍼 시작 및 flush의 `Date.now()`이다. feature `second_offset`은 localStorage의 첫 기준시각 이후 경과초와 증가 cursor의 최댓값이다. 따라서 raw의 청크 경계, 장치 보정 시각, feature 인덱스, 서버 생성시각을 같은 시간축으로 단정하면 안 된다. 근거: `frontend/src/hooks/useBand.ts:455-482`, `:686-699`; 서버 저장 매핑 `backend/app/services/session_service.py:3496-3498`.

## 3. 처리 체인과 프론트/백엔드 경계

### 3.1 EEG: 프론트엔드

1. 5초·250Hz 링버퍼, 최소 500샘플부터 최소 1초 간격으로 분석한다. 근거: `frontend/src/lib/eeg/StreamProcessor.ts:112`, `:313-323`.
2. 60Hz notch → 1–45Hz bandpass → 앞 `floor(N×0.15)` 제거. “앞 250개”라는 주석과 달리 실제는 15%이다. 근거: `frontend/src/lib/eeg/EEGSignalProcessor.ts:198-208`.
3. SQI: 125샘플 창에서 진폭(≤150μV=1, 300μV에서 0)과 `clamp(1−variance/1000)`를 0.7/0.3 가중합한 뒤 ×100. 이름이 frequency SQI여도 실제 구현은 분산 기반이다. SQI≥15% 마스크를 사용하고 양쪽 양호 샘플 >100이면 채널별 선택 후 같은 길이로 자른다. 그렇지 않으면 전체 데이터를 분석한다. 근거: `frontend/src/lib/eeg/EEGSignalProcessor.ts:713-749`, `:758-787`, `:220-249`.
4. Morlet: 1–45Hz, 1Hz 간격 45 bin. 목표 7 cycles지만 데이터 길이에 따라 effectiveCycles가 줄어든다. 평균 복소 convolution 크기제곱 × `PSD_CALIB(0.00739181390669613)` × 주파수 보정, 코드 단위 μV²/Hz. 근거: `frontend/src/lib/eeg/EEGSignalProcessor.ts:40-48`, `:253-258`, `:818-836`.
5. 대역파워는 δ[1,4), θ[4,8), α[8,13), β[13,30), γ[30,45)의 선형합(Δf=1Hz, μV²). 계산된 45Hz bin은 대역합에서 제외된다. 좌우는 SQI 가중 기하평균으로 병합한다. 근거: `frontend/src/lib/eeg/EEGSignalProcessor.ts:79-85`, `:888-910`, `:277-284`, `:381-400`.
6. 결과에서 bandPowers·raw indices를 AnalysisMetricsService에 전달한다. 전체 PSD 배열·채널별 SQI 시계열·필터 파형은 현재 feature 전송 계약에 없다. 근거: `frontend/src/lib/eeg/StreamProcessor.ts:660-680`, `frontend/src/hooks/useBand.ts:286-323`.

### 3.2 PPG: 프론트엔드

- 실제 버퍼는 10초·500샘플이다(옆 32초 주석과 다름). 50샘플 이상부터 패킷마다 겹치는 전체 버퍼를 재분석한다. 근거: `frontend/src/lib/eeg/StreamProcessor.ts:113`, `:373-377`.
- ≥500샘플이면 앞뒤 100개, >150샘플이면 앞 100개를 **필터 전** 제거한다. red/IR DC 평균 제거 → Biquad 1–5Hz → 실제 `calculatePPGSQI` 호출로 채널 SQI 평균. 근거: `frontend/src/lib/eeg/PPGSignalProcessor.ts:178-203`, `:304-318`.
- PPG SQI 실제 수식은 25샘플 창에서 필터 진폭 절댓값≤250이면1, 500에서0이 되도록 선형 감쇠하고 창 평균×100이다. 근거: `frontend/src/lib/eeg/PPGSignalProcessor.ts:464-499`.
- BPM: filtered IR → 3점 평활·zero mean → adaptive peak(주변 0.5초, 최소 거리 0.3초, local mean+0.6×범위) → RR 이상치 제거 → 60000/RR 가중평균·검증/평활. 근거: `frontend/src/lib/eeg/PPGSignalProcessor.ts:596-661`, `:895-912`.
- HRV/RSA용 RR은 별도로 **bandpass 전 IR** peak 간격×20ms에서 만들며 200–2000ms만 허용한다. 서비스는 RR 최근 120개, 계산 간격 1초, 40<HR<200 수용 및 BPM EMA α=0.3을 사용한다. 근거: `frontend/src/lib/eeg/PPGSignalProcessor.ts:221-229`, `frontend/src/lib/eeg/AnalysisMetricsService.ts:72-80`, `:195-212`, `:354-383`.
- SDNN/RMSSD: 최근 60 RR, 최소 10개 및 RR 합≥30초. SDNN은 분모 N인 분산의 제곱근, RMSSD는 연속 RR 차이 제곱평균의 제곱근(ms). 근거: `frontend/src/lib/eeg/AnalysisMetricsService.ts:489-524`.
- 호흡: RR 합≥60초 → 4Hz 재샘플 → Welch PSD → 0.15–0.4Hz 최대 bin×60 → 최근 5회 중앙값. 실제 탐색범위 약 9–24회/분, 최종 허용 검사 6–40회/분. 근거: `frontend/src/lib/eeg/AnalysisMetricsService.ts:77-78`, `:430-486`.
- LF/HF: RR을 초로 변환·선형보간하여 4Hz 재샘플 → Welch PSD → LF 0.04–0.15Hz / HF 0.15–0.4Hz 사다리꼴 적분(경계 보간) → ×1,000,000으로 ms² 변환 → EMA·비율. 단 HF<1 및 LF>10이면 0.12–0.5Hz 확장 적분을 **×100**으로 대체하는 다른 배율의 분기가 있다. Welch는 64–256샘플 창·50% overlap·Hamming·다음 2의 거듭제곱 FFT·단측 PSD 보정·구간평균이다. 근거: `frontend/src/lib/eeg/AnalysisMetricsService.ts:639-690`, `:715-728`, `:761-854`. 계산값을 getter로 전달한다. PPG 처리기의 placeholder advancedHRV와 실제 전달값을 구별해야 한다. 근거: `frontend/src/lib/eeg/AnalysisMetricsService.ts:396-422`, `frontend/src/lib/eeg/StreamProcessor.ts:741-767`, `:814-829`.

### 3.3 ACC: 프론트엔드

- 30샘플 이상부터 분석. 저역통과 α=0.1 파형도 만들지만 movement는 원데이터에서 계산한다. 근거: `frontend/src/lib/eeg/StreamProcessor.ts:426-429`, `frontend/src/lib/eeg/ACCSignalProcessor.ts:50-56`, `:88-118`.
- magnitude=`sqrt(x²+y²+z²)`; movement=`max(0,magnitude−1)×100`; 평균·표준편차·최댓값 산출. avgMovement ≤5, ≤15, >15의 구간별 intensity(0–100)를 계산·반올림하고 `motion=clamp(intensity/100,0,1)`로 전달한다. 근거: `frontend/src/lib/eeg/ACCSignalProcessor.ts:124-141`, `:164-174`, `:202-209`, `:235-238`; `frontend/src/lib/eeg/AnalysisMetricsService.ts:218-230`.

### 3.4 백엔드의 역할

백엔드는 현재 클라이언트 feature를 검증·저장하고 라이브 전달·롤업·리포트 점수 재계산을 한다. 확인한 정상 수집 경로에는 S3 raw를 읽어 위 필터/Morlet/PPG/ACC 처리를 다시 실행하는 단계가 없다. 근거: `backend/app/services/session_service.py:3452-3528`, `backend/app/services/eeg_raw_service.py:74-82`, `:221-248`, `backend/app/services/eeg_rollup_service.py:1-11`, `backend/app/services/class_report_stats_service.py:375-414`.

## 4. 저장·전송·끊김 처리

### 4.1 EEG raw bin / S3 / ACK

- `useBand`는 세션·참여자가 있고 observationOnly가 아닐 때만 raw 업로드를 활성화한다. StreamProcessor callback은 `onEEGData`만 연결하며 PPG/ACC raw 콜백은 업로드에 연결하지 않는다. 근거: `frontend/src/hooks/useBand.ts:433-440`, `:1223-1229`.
- 250샘플 이상 모이면 **버퍼 전체**를 flush하므로 항상 정확히 250샘플이라는 보장은 없다. 끊김 때 짧은 잔여 청크도 flush한다. 근거: `frontend/src/hooks/useBand.ts:455-484`, `:1259-1264`.
- bin: 헤더 없는 LE float32 interleaved `[fp1_0,fp2_0,fp1_1,fp2_1,…]`, 샘플당 8B. 정확히 250쌍이면 2000B. schema=`eeg-raw-v1`, rate=250, unit=`uV`, channel_count=2. 샘플 시각·packet metadata·lead-off·채널명 문자열은 bin 바이트에 없다. 근거: `frontend/src/lib/session-live/raw-encoder.ts:1-30`, `frontend/src/hooks/useEegRawUpload.ts:33-39`, `:145-153`.
- raw 원장은 바이트가 아닌 manifest이며 전체 컬럼은 `id/session_id/participant_id/user_id/stream_id/chunk_index/start_ms/end_ms/sample_rate/channel_count/unit/schema_version/checksum/size_bytes/object_key/upload_status/created_at/uploaded_at`이다. DB schema_version 기본값은 `1.0`, 현 FE 전송값은 `eeg-raw-v1`이므로 레거시 버전을 동일 형식이라고 추측하면 안 된다. 근거: `backend/app/models/record.py:119-172`, `frontend/src/hooks/useEegRawUpload.ts:33-39`.
- S3 key: `eeg-raw/{session}/{participant}/{play_group_id 또는 default}/{stream_id}/{chunk_index:08d}.bin`. 근거: `backend/app/services/eeg_raw_service.py:45-71`.
- presign → S3 PUT → ack. 서버는 세션/참여자/stream/index로 기존 원장 및 object_key를 재사용하고 신규 메타를 `EEGRawChunk`에 저장한다. 근거: `frontend/src/hooks/useEegRawUpload.ts:157-184`, `backend/app/services/eeg_raw_service.py:89-135`.
- ack는 S3 HEAD 존재·크기 검증 후 uploaded/failed를 기록하고 EEGRecord.file_count를 동기화한다. 클라이언트 제공 checksum은 저장하지만 해당 ACK 구간은 본문 SHA256을 직접 재계산·대조하지 않는다. 검증 불가(None) 경로는 건너뛴다. 근거: `backend/app/services/eeg_raw_service.py:216-248`, `backend/app/services/storage_service.py:154-176`.

### 4.2 로컬 큐와 재시도

- raw는 IndexedDB `mindbreeze-eeg-raw/pending_raw_chunks`에 ArrayBuffer·메타·attemptCount·lastError를 보존한다. 키는 streamId:chunkIndex이고 동일 키는 기존 payload를 반환한다. 근거: `frontend/src/lib/session-live/raw-chunk-queue.ts:9-42`, `:104-134`.
- enqueue 후 microtask flush, 기본 4초 주기, 청크 최대 8회. S3 PUT 자체는 20초 timeout·최대3회·500ms 지수 backoff(5xx/408/429/네트워크/timeout). 오프라인 감지 때 시도를 보류한다. 근거: `frontend/src/hooks/useEegRawUpload.ts:33-34`, `:201-208`, `:287-311`; `frontend/src/lib/api/eeg-raw.ts:12-26`, `:119-145`.
- ACK HTTP 성공 후 반환 본문 확인 없이 큐 삭제. 재시도 불가 API 오류와 최대횟수 초과도 큐에서 삭제한다. 로그는 “dead-letter”라고 하나 해당 경로는 별도 보관소로 옮기지 않는다. 근거: `frontend/src/hooks/useEegRawUpload.ts:181-195`, `:225-239`; 실제 delete `frontend/src/lib/session-live/raw-chunk-queue.ts:160-180`.
- BLE 예기치 않은 끊김 때 raw 버퍼 flush, feature drain, raw 최대15초 drain 후 자동 재연결을 예약한다. BLE 콜백에서도 최소5초 간격 raw flush를 요청한다. 근거: `frontend/src/hooks/useBand.ts:475-491`, `:1252-1281`.
- 끊김 시작·종료·기간·사유·시도횟수는 메모리와 localStorage 50건 링버퍼에만 저장하고 서버로 보내지 않는다. 원장 기반 다운로드 gap 데이터와 동일하지 않다. 근거: `frontend/src/lib/eeg/ble-gap-log.ts:1-18`, `:51-60`, `:75-87`.

- 큐 자체의 용량/기간 상한은 확인되지 않았고 브라우저 quota 실패 영향은 **추정**이다. 특히 enqueue 완료를 기다리지 않고 raw 메모리 버퍼를 비우며 실패는 경고만 남기므로 적재 실패 복구 경로가 없다. SHA256 미지원 환경에서는 비암호학적 fallback 해시를 쓴다. 근거: `frontend/src/lib/session-live/raw-chunk-queue.ts:83-101`, `:104-158`; `frontend/src/hooks/useBand.ts:461-472`.

### 4.3 eeg_feature_windows 컬럼별 충전 여부

아래는 **현재 useBand 실수집 생성 → 서버 저장 경로**의 정적 매핑이다. 실제 DB 행의 non-null 비율은 조사하지 않았다. “전달”이어도 미수신·계산 불가 시 null일 수 있다. 전체 모델 근거 `backend/app/models/eeg_feature.py:56-111`; 생성/저장 근거 `frontend/src/hooks/useBand.ts:286-323`, `backend/app/services/session_service.py:3491-3522`.

| DB 컬럼(모든 컬럼 열거) | 실제 채워지는 경로/상태 |
|---|---|
| id | ORM UUID 기본값 |
| session_id, participant_id | 서버의 검증된 세션·참여자 |
| user_id | 참여자 user_id, 게스트 null 가능 |
| play_group_id | schema/서버 수용은 있지만 현재 metricsToFeature 미전달 → null |
| window_index | FE second_offset |
| quality | 서버가 signal_quality로 파생 |
| device_timestamp_ms | FE metrics.timestamp; raw bin start/end와 다름 |
| focus_index, cognitive_load, relaxation_index, stress_index, emotional_stability, hemispheric_balance | EEG 원지표 전달·저장 |
| total_neural_activity, faa | **현재 FE 미전달 + 서버 행 생성에서도 누락**; total_power/좌우 파워에서 임의 보충하지 않음 |
| delta_power, theta_power, alpha_power, beta_power, gamma_power | 병합 대역파워 전달·저장, 미확보 시 null |
| total_power | metrics.totalPower 전달·저장 |
| meditation_level, attention_level | StreamProcessor에서 이완/집중 원값을 각각 매핑 |
| signal_quality | SQI 0–100을 API 0–1로 변환하여 전달·저장 |
| sdnn, rmssd, lf_power, hf_power, lf_hf_ratio, heart_rate, respiratory_rate | AnalysisMetricsService getter 전달·저장, 준비 전 null 가능 |
| motion | ACC intensity/100 getter 전달·저장 |
| created_at | DB server_default now(), 장치 측정시각이 아님 |

추가 근거: `frontend/src/lib/eeg/StreamProcessor.ts:660-670`. **미전달 컬럼 목록은 `play_group_id`, `total_neural_activity`, `faa`**이다. 서버 생성 컬럼(id 등)은 미전달 결함으로 세지 않는다. `band_battery`는 payload에 있지만 EEGFeatureWindow 컬럼이 아니며 참여자 상태 갱신용이다(`backend/app/services/session_service.py:3481-3486`).

모델에는 raw stream/chunk 참조, 장치 clock 원값, 채널별 PSD/SQI, RR/peak 식별자, 화면 표시값/표준모델 ID·버전/빌드·표시 파이프라인 버전 컬럼이 없다. 이는 “nullable 컬럼이 안 채워짐”과 구분되는 **스키마 부재**이다. 근거: `backend/app/models/eeg_feature.py:56-111`.

### 4.4 live-metrics / Socket.IO / 리포트

- feature는 IndexedDB에 먼저 넣은 뒤 WS emit한다. `stream_id/sequence`는 전송·ACK 식별용이다. 서버 feature DB 멱등키는 session/participant/play_group/window_index이며 null play_group용 부분 unique index도 있다. 근거: `frontend/src/hooks/useBand.ts:537-553`, `:686-721`; `backend/app/models/eeg_feature.py:23-52`.
- WS namespace `/session-live`의 feature 저장 성공/실패 후 `feature_ack`, 저장된 최신값을 `eeg_feature`로 방송한다. REST 배치가 폴백이며 WS 연결이 없을 때 미확정 큐를 재전송한다. 근거: `backend/app/ws/session_live_namespace.py:680-758`, `:1223-1224`; `frontend/src/hooks/useBand.ts:558-600`, `:1169-1174`.
- REST live-metrics는 최신 feature의 raw relaxation 및 AVG(relaxation_index), BPM/호흡/RMSSD를 반환한다. 이 API 자체에서는 표준모델 점수화하지 않는다. latest/last_eeg_at/stale 판단은 created_at 기준이라 지연 업로드를 새 측정으로 볼 위험은 **추정**이다. 근거: `backend/app/services/session_service.py:3035-3045`, `:3074-3081`, `:3352-3393`.
- 화면 live 행은 efficiency(이완), SQI, 배터리/연결 상태, BPM/호흡 등을 증분 갱신한다. 이는 raw 전송 소켓이나 6대 지표 스냅샷 저장소가 아니다. 근거: `frontend/src/lib/session-live/apply-eeg-feature.ts:58-117`, `backend/app/models/eeg_feature.py:56-111`.
- 60초 롤업은 feature에서 온디맨드 파생, play_group별 bucket, 비-null 평균, valid coverage를 제공한다. 대역파워는 롤업 대상에서 제외. 알고리즘 상수 버전은 응답 시 로드하는 값이다. 근거: `backend/app/services/eeg_rollup_service.py:1-11`, `:21-43`, `:53-82`, `:85-123`.
- 리포트는 측정 시도 있었으나 feature가 없으면 lost, 없었다면 not_measured를 구별한다. 손실 표시가 전혀 없는 것은 아니다. 근거: `backend/app/tasks/report_task.py:245-255`, `:348-352`.
- 기존 개인 리포트 payload에는 `score: m.meditation_total_score` 반환이 남아 있다. 이는 현재 코드 현황이며 새 데이터센터 지표·종합점수를 만들라는 의미가 아니다. 근거: `backend/app/tasks/report_task.py:348-362`.
- 클래스 리포트는 **생성 시점 활성 모델→없으면 최신 모델**로 마음3을 다시 정규화하고 몸3은 저장 원값을 사용한다. 마음은 품질 게이트, 몸은 EEG 품질과 독립; 개인 최소60유효초·클래스 최소2명 등 집계 게이트가 있다. 결과에 normalization_version·전/후반·delta·valid_ratio 등을 넣는다. 이는 당시 화면 1초 스냅샷이 아니다. 근거: `backend/app/services/class_report_stats_service.py:27-29`, `:111-135`, `:235-250`, `:281-299`, `:375-416`.

## 5. 화면 6대 지표 계산·정규화·버전

공통 표시 경로: EEGSignalProcessor/PPGSignalProcessor → AnalysisMetricsService → useBand → MemberClassContainer.buildSnapshot → MemberStage/MemberSheets. 근거: `frontend/src/lib/eeg/StreamProcessor.ts:660-672`, `:741-767`; `frontend/src/hooks/useBand.ts:734-757`; `frontend/src/components/class/player/member/MemberClassContainer.tsx:62-71`; `frontend/src/components/class/player/member/MemberStage.tsx:59`, `frontend/src/components/class/player/member/MemberSheets.tsx:78`.

| 표시 | 원값과 경로 | SDD-036 표준모델 적용 |
|---|---|---|
| 집중 | β/(α+θ+EPS) → focusIndex → scoredIndices.focusIndex | 적용(유효 활성모델 우선, B0 fallback) |
| 이완 | α/(α+β+EPS) → relaxationIndex → scoredIndices.relaxationIndex | 적용; remoteEfficiency fallback 분기 존재 |
| 감정균형 | (α+θ)/(γ+EPS) → emotionalStability → scoredIndices.emotionalStability | 적용. FAA/hemisphericBalance/스트레스와 다른 값 |
| BPM | PPG peak/RR → BPM 검증·EMA → band.heartRate | 표준모델 0–100 변환 없음; bpm |
| 호흡 | RR RSA/Welch 최대 주파수×60·중앙값 → band.respiratoryRate | 없음; 회/분 |
| HRV | RR 표준편차 → band.sdnn | 없음; ms. RMSSD가 아닌 SDNN |

원식 근거: `frontend/src/lib/eeg/EEGSignalProcessor.ts:356-377`; 몸 지표 근거 §3.2; 실제 여섯 값 매핑 `frontend/src/components/class/player/member/MemberClassContainer.tsx:63-71`.

- 표준모델: `scoreIndices`가 캐시된 활성 모델의 지표별 `{m,s,direction}`을 우선 사용한다. 모델 없음/지표 params 무효이면 B0로 fallback하며 네트워크 실패 시 기존 캐시를 유지할 수 있다. 근거: `frontend/src/lib/eeg/eegPersonalScore.ts:69-107`, `:153-184`.
- 일반 지표는 ln(raw+EPS) 변환 후 `100×sigmoid(direction×C×((z−m)/s))` 및 clamp·반올림. FAA는 별도 편차 exp 곡선이다. 근거: `frontend/src/lib/eeg/eegSigmoidScore.ts:77-94`, `:103-131`.
- 확인 가능한 B0 버전은 constants v2 / pipeline `v2-morlet7-linear-geomean`. 소스 주석상 37세션/6명 기반 잠정값이다. **운영 활성모델 버전은 미확인**이며 DTO version 존재만 확인했다. 근거: `frontend/src/lib/eeg/eegScoreConstants.ts:1-9`, `frontend/src/lib/api/normalization-api.ts:42-48`.
- 표시 게이트: lead_off 또는 stale이면 전체 지표 null, live 연결 여부에 따라 값 공급; 최종 UI는 Math.round. 별도의 1Hz 로컬 링버퍼는 null을 넣지 않는다. 따라서 원 feature 값만으로 표시 차단·반올림·로컬 시계열까지 복원할 수 있다고 보장할 수 없다. 근거: `frontend/src/components/class/player/member/MemberClassContainer.tsx:62-71`, `:166-189`, `frontend/src/components/class/player/member/MemberStage.tsx:59`.
- FE는 원 feature를 먼저 enqueue하고 별도 scoreIndices 결과를 화면 state로 보낸다. feature 모델에는 당시 normalization/display version이 없으므로 현재 모델로 재계산한 값을 “당시 화면값”으로 표시하면 안 된다. 근거: `frontend/src/hooks/useBand.ts:699-715`, `:734-757`, `backend/app/models/eeg_feature.py:56-111`.

## 6. 90일 보관·연구 사본·retention

| 구분 | 확인된 정책/코드 | 근거 |
|---|---|---|
| 서비스 raw | 기본 보관일수90, 통합 sweep 기본 비활성 | `backend/app/config.py:158-168` |
| 기준일 | ended_at, 없으면 created_at; completed/cancelled 비템플릿; 적용하한 필터 | `backend/app/services/retention_sweep_service.py:68-85` |
| 연구 미ACK | 유효 연구동의이고 export_state가 acked/withdrawn/blocked_withdrawn/not_applicable 외이면 EEG raw 삭제 보류 | `backend/app/services/retention_sweep_service.py:42-44`, `:88-102`, `:144-149` |
| 연구 ACK 이후 | 원래 기준일+90일 규칙; ACK+90일이 아님 | `specs/sdd-238-eeg-raw-retention-90d/spec.md:22-28` |
| 연구 사본 | 영구 보관 정책. 실제 연구 저장소 영구 보존은 미검증 | `specs/sdd-238-eeg-raw-retention-90d/spec.md:22-34` |
| feature/리포트 | 위 원본 sweep 삭제 대상이 아님 | `backend/app/services/retention_sweep_service.py:5-17`, `:168-204` |
| 구 raw sweep | eeg_raw_retention_days 기본0(무기한); 양수 시 uploaded_at/created_at 기준, 통합 연구 게이트와 다름 | `backend/app/config.py:170-172`, `backend/app/services/eeg_raw_service.py:365-399` |

- 통합 sweep은 설정 활성화 및 적용하한 조건을 만족해야 실제 삭제한다. 빈 하한 소급은 별도 retroactive opt-in이다. dry-run도 실행 원장을 DB에 쓰므로 본 조사에서는 호출하지 않았다. 근거: `backend/app/services/retention_sweep_service.py:310-329`.
- 삭제는 raw 원장 행 제거, EEGRecord.file_count 재계산 후 객체 삭제를 별도 수행한다. DB commit 후 객체 삭제는 best-effort이므로 원장 성공과 물리 삭제 완료는 다르다. 근거: `backend/app/services/retention_sweep_service.py:168-204`, `:343-345`.
- 통합 sweep 활성 시 구 raw task는 skip한다. 구 retention 일수만90으로 바꾸면 연구 보류를 우회할 수 있어 기존 spec도 금지한다. 근거: `backend/app/tasks/eeg_raw_task.py:21-24`, `specs/sdd-238-eeg-raw-retention-90d/spec.md:15-16`.
- PPG/ACC raw가 현재 저장되지 않으므로 이들의 90일 정책이 이미 구현되어 있다고 볼 수 없다. 연구 사본 보관 정책과 일반 사용자 다운로드 가능기간도 별개이다. 근거: `backend/app/services/research_export_service.py:64-70`, `backend/app/services/retention_sweep_service.py:144-149`, `backend/app/services/export_service.py:106-109`.

## 7. 기존 다운로드/내보내기 형식

### 7.1 사용자 분석용 ZIP

- API: 세션×참여자 `POST .../data-exports`, 작업 상태 GET, download-url POST. 요청 include는 features/report만 허용한다. 현행 활성 상담사·플랫폼 관리자, 완료세션·소유/EEG 동의 조건이며 기관관리자는 명시 거부한다. 근거: `backend/app/api/v1/data_exports.py:15-34`, `backend/app/schemas/data_export.py:8-24`, `backend/app/services/export_service.py:50-86`.
- ZIP_DEFLATED/Zip64: `participants/p001/feature_timeseries.csv`, `participants/p001/report.json`, `session_metadata.json`, `data_dictionary.json`, `README_ko.md`, `manifest.json`. CSV는 UTF-8/쉼표/29열, None=빈 셀, 원값·invalid행 보존, 보간/정규화하지 않는다. 근거: `backend/app/services/export_package.py:12-49`, `:119-176`.
- EEG raw·PPG/ACC raw는 미포함. report.json도 whitelist 집계값이며 당시 화면6 스냅샷이 아니다. 제한 10만행·100MiB; 파일별 SHA256/바이트/행수/누락 사유 manifest. 작업 생성 시24시간 만료, presigned URL 최대300초. 근거: `backend/app/services/export_package.py:20-25`, `:40`, `:79-107`, `:127-128`, `:168-171`; `backend/app/services/export_service.py:106-109`, `:154-162`.
- 실제 FE 진입은 DataExportButton의 `mindbreeze-data.zip` 다운로드이다. 근거: `frontend/src/components/reports/DataExportButton.tsx:84-94`.

### 7.2 연구 export

- 일반 다운로드와 별도로 S3 staging→Spark(DGX) pull→ack 경로, 기본 비활성. schema2.0 / 확장동의 r5-2. 근거: `backend/app/services/research_export_service.py:3-11`, `:46-47`; `backend/app/config.py:107-110`.
- 현재 연구 export 대상은 회원(user_id 존재)·미철회 연구동의·pending·연구식별자 보유 조건이며 비회원은 제외한다. 기존 비회원 배치 재전달/ACK도 차단한다. 근거: `backend/app/services/research_export_service.py:411-424`, `:802-810`, `:823`, `:836-837`.
- 파일: sessions.parquet, subjects.parquet, facilitators.parquet, eeg_raw.parquet, features.parquet + manifest.json. 기본 prefix `research-export/`+batch UUID. 근거: `backend/app/services/research_export_service.py:539-565`, `:586-611`.
- eeg_raw.parquet은 sample-row CSV/Parquet가 아니라 **기존 bin 전체 bytes를 binary payload로 포장**한 청크 테이블이다. sample_rate/channel_count/unit/schema_version/상대 start/end를 포함한다. raw 읽기 실패 시 부분 성공 대신 실패한다. 근거: `backend/app/services/research_export_service.py:89-95`, `:394-403`.
- features.parquet은 원 feature·품질·상대시간, PPG/ACC는 파생값만. 상대시각은 참여자 feature timestamp/raw start 최솟값 기준이다. manifest도 raw 시각이 browser epoch이고 장치 clock 인증이 아님을 명시한다. 근거: `backend/app/services/research_export_service.py:64-70`, `:376-392`, `:592-594`.
- r5-2 및 세션 시작 전 동의 등 조건을 만족할 때만 확장 메타를 제공한다. manifest에는 SHA256/바이트/행수/컬럼·field-list hash·revision. batch ID/hash 및 상태를 확인한 ack로 동의 export_state를 전이한다. ack가 샘플 완전성·연구 영구 보존을 직접 실증하는 것은 아니다. 근거: `backend/app/services/research_export_service.py:228-246`, `:562-566`, `:586-600`, `:813-860`.
- 연구 출력에는 stream_id/play_group_id가 없고 uploaded raw만 선택한다. 원장 정렬 기준의 구간 식별자가 파일에서 사라져 동명 index 구분이 어려울 수 있음(**추정**). 근거: `backend/app/services/research_export_service.py:89-95`, `:364-374`, `:386-403`.

### 7.3 PDF

리포트 PDF는 서사·카드·timeline을 HTML에서 렌더링한 문서이며 원파형/feature 분석 파일이 아니다. 근거: `backend/app/api/v1/reports.py:38-41`, `:105-114`; `backend/app/services/report_pdf_service.py:54-59`, `:159-188`.

## 8. 결함·공백 목록과 SDD-244/243 연결

| 번호 | 상태 | 공백/영향 | 파일:행 근거 |
|---|---|---|---|
| G1 | 확인 | PPG/ACC raw 업로드 미연결. feature만으로 red/IR·xyz 파형 복원 불가 | `frontend/src/hooks/useBand.ts:1223-1229`; `backend/app/services/research_export_service.py:64-95` |
| G2 | 확인 | 당시 화면6 값·정규화 모델·게이트·표시 버전 미저장. 재계산값을 당시값으로 단정 불가 | `frontend/src/hooks/useBand.ts:699-757`; `backend/app/models/eeg_feature.py:56-111` |
| G3 | 확인 | total_neural_activity/faa 미전달·미저장, play_group_id 현재 FE 미전달 | `frontend/src/hooks/useBand.ts:295-323`; `backend/app/services/session_service.py:3491-3522` |
| G4 | 확인 | raw start/end는 수신/flush 시각. 샘플시각·장치 tick·packet metadata가 저장되지 않아 시간 재동기화 근거 부족 | `frontend/src/hooks/useBand.ts:455-482`; `frontend/src/lib/session-live/raw-encoder.ts:23-30` |
| G5 | 확인 | raw ACK body failed>0여도 HTTP 성공이면 클라이언트 큐 삭제. 전송 성공과 저장 확정이 어긋남 | `backend/app/services/eeg_raw_service.py:221-248`; `frontend/src/hooks/useEegRawUpload.ts:181-184` |
| G6 | 확인 | 8회 초과/특정 API 오류를 dead-letter라고 로그하지만 실제 큐 삭제, 별도 보존 없음 | `frontend/src/hooks/useEegRawUpload.ts:189-195`, `:225-239` |
| G7 | 추정 | rawChunkIndex가 mount마다0인데 feature streamId는 결정적·복구됨. 기존 pending 키 충돌로 신규 payload 누락 또는 이미 업로드된 object_key에 재PUT하여 덮어쓸 위험 | `frontend/src/hooks/useBand.ts:451-470`, `:1161-1164`; `frontend/src/lib/session-live/feature-queue.ts:132-169`; `frontend/src/lib/session-live/raw-chunk-queue.ts:124-134`; `backend/app/services/eeg_raw_service.py:113-118` |
| G8 | 확인/영향 추정 | 서버 presign은 SSE AES256을 서명하지만 FE 기본 PUT은 Content-Type만, 호출측 headers 미전달. 실제 S3 요청 실패 가능성은 추정 | `backend/app/services/storage_service.py:136-145`; `frontend/src/lib/api/eeg-raw.ts:115-130`; `frontend/src/hooks/useEegRawUpload.ts:168` |
| G9 | 확인 | BLE gap 로그는 localStorage50건, 서버 구간 원장 없음. 리포트 lost/coverage는 있으므로 손실표시 전무는 아님 | `frontend/src/lib/eeg/ble-gap-log.ts:1-18`, `:51-87`; `backend/app/tasks/report_task.py:245-255`, `:348-352` |
| G10 | 추정 | 겹치는 PPG 창의 RR을 peak-ID/time 중복제거 없이 누적하여 30/60초 gate를 실제보다 빨리 충족할 위험 | `frontend/src/lib/eeg/StreamProcessor.ts:113`, `:373-377`; `frontend/src/lib/eeg/PPGSignalProcessor.ts:224-229`; `frontend/src/lib/eeg/AnalysisMetricsService.ts:354-360`, `:436-437` |
| G11 | 확인/영향 추정 | PPG 수용 함수의 _currentSQI/_isQualityGood 미사용. 품질 낮은 RR/BPM 수용 위험은 추정 | `frontend/src/lib/eeg/AnalysisMetricsService.ts:195-212` |
| G12 | 추정 | EEG 마스크로 중간 샘플 삭제 후 250Hz로 PSD를 계산해 시간압축 영향 가능 | `frontend/src/lib/eeg/EEGSignalProcessor.ts:239-258` |
| G13 | 확인 | 전체 PSD·채널별 SQI·RR/peak·ACC xyz 등 중간 feature 미저장. “feature 모두” 요구는 기존 feature행 전체 저장과 다름 | `frontend/src/hooks/useBand.ts:286-323`; `backend/app/models/eeg_feature.py:56-111` |
| G14 | 확인/영향 추정 | 연구 export는 stream/segment·미업로드 gap 미포함. retention은 raw 행까지 삭제해 원인별 미수집/만료 구분이 어려울 가능성 | `backend/app/services/research_export_service.py:89-95`, `:370-374`; `backend/app/services/retention_sweep_service.py:168-204` |
| G15 | 확인 | 일반 ZIP raw 미포함, 연구 raw는 binary blob. 사용자용 sample CSV·시간범위 다운로드·6지표 당시값 계약 신규 필요 | `backend/app/services/export_package.py:12-49`; `backend/app/services/research_export_service.py:89-95`, `:394-403` |

SDD-243 참고 spec은 미래 수집확장 및 다운로드 요구이며 현행 구현의 증거로 사용하지 않았다. 원본/feature/당시 표시값을 구분하고 legacy 표시이력 없음·재계산 출처·버전을 명시하도록 요구한다. 근거: `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd243/specs/sdd-243-platform-data-center/spec.md:87-136`, `:178-180`.

**개발 전 결정에 필요한 조사 결과:** SDD-244에서 3신호 raw와 중간 feature의 정확한 범위, 원시 tick/보정 epoch/도착시각 및 gap 원장, 안정적인 stream/chunk 식별자, 저장 ACK 확정, 당시 화면6 스냅샷·모델/표시 버전을 먼저 계약해야 한다. SDD-243은 그 계약에 맞춰 원본·재계산·집계·당시 표시값을 분리해 제공해야 한다. 이는 G1–G15에서 도출한 설계 제안이며 구현·승인 완료를 뜻하지 않는다.

## 9. 조사 검증 범위

- 정적 확인: parser→processor→hook→payload→ORM→export 연결, 화면6 공급값, retention 분기, 발견 위험의 관련 코드 상호 대조.
- 독립 검토: 신호 처리, 저장, retention/export 조사 결과를 통합하고 주요 ACK·큐·시간축·화면 매핑은 작성자가 소스로 재확인. 문서 작성 후 신호 처리 및 retention/export 담당자가 읽기 전용 교차 검토했고 SQI·LF/HF·연구 대상 조건을 보완함.
- 미검증: 실제 밴드·웹/앱 수신, 수치 정확도·손실률, 활성 표준모델 버전, S3 PUT/ACK, 운영 DB 컬럼 충전율, 연구 저장소·스케줄러 동작, 실 다운로드와 물리 삭제. 모두 사용자 지정 조사 전용 경계에 따라 실행하지 않음.
