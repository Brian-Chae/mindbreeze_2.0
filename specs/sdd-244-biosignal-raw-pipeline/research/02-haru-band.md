# HARU BAND 생체 데이터 처리·저장·다운로드 조사

작성일: 2026-10-24 / 목적: SDD-244 저장 파이프라인 및 SDD-243 다운로드 설계의 입력 자료.

## 0. 범위와 판정 기준

- **소스 정적 조사만 수행했다.** 서버·DB·.env·실데이터·장치에 접근하지 않았고 앱/테스트/마이그레이션을 실행하지 않았다. 실제 배포·측정 정확도·업로드 성공·권한 차단은 검증하지 않았다.
- 이 문서 하나만 작성했다. 저장소 코드 수정, 커밋, 푸시, 배포, 메일, 삭제는 수행하지 않았다.
- 아래 `H/`는 `/Volumes/Looxid SSD/looxid/repository/haru_band_app/`, `M/`은 `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd244/`, `N/`은 `/Volumes/Looxid SSD/looxid/repository/haru-native-reference/`를 뜻한다. 모든 소스 근거는 **경로:행**으로 표기한다.
- 조회 시 H는 `develop`, HEAD `dec498634975ac63be7c931c4e04e2830955b018`, 작업 트리 clean. M HEAD `aa3505b5952ff09c8529c9d4b3c86959d7be5280`, 시작 전부터 `specs/sdd-244-biosignal-raw-pipeline/`이 untracked였다. N은 `main`, HEAD `ec3885f6ccd06f9a03be2e33784f8c22fd578785`, clean. 이는 `git status --short --branch`, `git rev-parse HEAD` 조회 결과다.
- **확정**은 소스에 존재하는 동작, **추정**은 그 동작의 운영상 결과, **제안**은 아직 구현하지 않은 MB2.0 설계다. 주석·메서드명만으로 구현 완료를 판정하지 않았다.
- N은 확인한 범위에서 Spring 명상 콘텐츠 서버다. 예: 카테고리/좋아요 SQL 서비스 `N/src/main/java/com/mindfulness/service/RestMindfulnessService.java:16-58`. `src/main/java`, `src/main/resources`의 Java/XML/SQL에서 `eeg|ppg|link.?band|hrv|biosignal` 검색 결과는 없었다. **검색 범위 내 미발견이며 저장소 전체 또는 외부 네이티브 앱에 구현이 없다는 증명은 아니다.** 따라서 N에서 신호 알고리즘의 추가 정본을 확인하지 못했다.

## 1. 핵심 결론

| 항목 | HARU에서 확인한 구현 | MB2.0 판단 | 근거 |
|---|---|---|---|
| 수신 | EEG/PPG/ACC 모두 파싱하지만 패킷 내 시각은 전부 `Date.now()` | 값 변환은 참고, 시각 처리는 MB2 유지 | H/src/services/ble-service.ts:170-238; M/frontend/src/lib/eeg/blePacketParser.ts:69-102,134-156,184-226 |
| EEG | Morlet 보정 PSD, SQI 가중 병합, raw 비율 지수, 별도 점수화 | MB2의 HARU 이식 흔적과 수식 일치 확인. 전체 동일 구현이라는 뜻은 아님 | H/src/utils/signal/EEGSignalProcessor.ts:255-275,325-360,775-807; M/frontend/src/lib/eeg/EEGSignalProcessor.ts:273-284,815-836 |
| HRV | HARU는 filtered IR RR 검출·중복 제거·시간/주파수 버퍼 분리 | MB2의 raw IR RR 추출 및 단순 누적과 다름. 저장 전에 버전·창 정의 필요 | H/src/utils/signal/PPGSignalProcessor.ts:219-230; H/src/services/AnalysisMetricsService.ts:680-745; M/frontend/src/lib/eeg/PPGSignalProcessor.ts:221-230; M/frontend/src/lib/eeg/AnalysisMetricsService.ts:354-361 |
| 호흡 | 화면 hook에서 RR→Welch→EMA로 별도 생성 | HARU PPG feature 저장만 복제하면 화면 호흡수 누락 | H/src/hooks/use-meditation-trend-buffer.ts:69-86; H/src/services/DataCollector.ts:188-206 |
| 서버 raw | 종료 시 JSON 바이트 전송, S3 이름은 `.parquet` | 포맷 계약 불일치. 완성된 저장·다운로드 참조 구현으로 사용 불가 | H/src/services/DataCollector.ts:98-113,293-300; H/backend/app/services/s3.py:37-56,104-127 |
| 내보내기 | 로컬 raw CSV/ZIP 및 관리자 raw 링크·JSON 변환 존재 | ZIP metrics는 헤더만 생성. 3신호+feature+화면 6지표의 완전한 내보내기는 확인되지 않음 | H/src/services/SessionManager.ts:740-765,814-820,892-916; H/src/pages/admin/admin-session-detail-page.tsx:263-293 |

## 2. 신호 수신·파싱·샘플레이트·단위

### 2.1 실제 수신 경로

Web Bluetooth `LXB` 이름 필터로 장치를 선택하고 EEG/PPG/ACC GATT characteristic의 notification을 각각 구독한다. `parse*Packet → StreamProcessor.handleBluetoothData → 신호별 circular buffer → raw callback + 분석기` 경로다. 관찰 전용 `startSession:false`면 서버/로컬 세션 저장을 시작하지 않는다. 근거: `H/src/services/ble-service.ts:44-55,89-138,158-165`; `H/src/services/StreamProcessor.ts:397-435,454-489,513-546`.

| 신호 | 패킷·값 파싱 | 코드상 레이트와 단위 | 시간·품질 정보 |
|---|---|---|---|
| EEG Fp1/Fp2 | 4B 헤더 뒤 7B/샘플. lead-off 1B(bit0/bit2), 두 채널 각각 BE signed 24bit. `signed × 4.033 / 12 / (2^23−1) × 10^6` | 250Hz, µV. 수신 ch1/ch2를 fp1/fp2로 변환 | 헤더 timestamp LE라는 주석은 있으나 읽지 않음. 동일 패킷 모두 같은 epoch ms. lead-off 보존 |
| PPG red/ir | 4B 헤더 뒤 6B/샘플. 각 3B BE unsigned 값 | 50Hz. 변환 없는 디지털 카운트(물리 단위 변환 없음) | timestamp BE라는 주석만 있고 읽지 않음. 동일 패킷 같은 epoch ms. 처리기에서는 leadOff 양쪽 false로 생성 |
| ACC x/y/z | 4B 헤더 뒤 6B/샘플. 축별 LE signed int16 × `2/32768` | 수신/버퍼는 30Hz, g | 동일 패킷 같은 epoch ms. raw callback에서 `sqrt(x²+y²+z²)` magnitude 추가 |

근거: `H/src/services/ble-service.ts:170-238`; `H/src/services/StreamProcessor.ts:97-101,409-428,467-481,524-540`.

- **주의: 원데이터의 의미.** 위 raw는 BLE 바이트 원본/ADC 정수 원본이 아니라 **파싱·단위 변환 후 샘플**이다. EEG/ACC 원 정수와 장치 timestamp는 이 경로에서 보존되지 않는다. 근거: `H/src/services/ble-service.ts:188-199,211-215,229-238`.
- **레이트는 코드의 가정이며 실측 검증은 하지 않았다.** PPG 버퍼 주석은 “32초/1600개”지만 실제 생성 인자는 10초×50Hz=500개다. ACC 분석기 내부에는 사용되지 않는 50Hz/9.81 상수가 남아 있으므로 문서보다 실행 경로를 우선해야 한다. 근거: `H/src/services/StreamProcessor.ts:99-101`; `H/src/utils/signal/ACCSignalProcessor.ts:8-9,47-85,133-146`.
- EEG/ACC는 공통 처리 플래그, PPG는 별도 플래그가 켜져 있으면 **raw callback 이전에 return**한다. 부하 상황에서 원데이터도 누락될 가능성은 **추정**이며 실제 손실률은 미측정이다. 근거: `H/src/services/StreamProcessor.ts:400-427,458-481,516-540`.
- MB2 파서는 장치 tick/32768 정규화, EEG 4ms·PPG 20ms 샘플 보간, ACC 33.333ms 연속성 및 큰 갭 재동기화를 수행한다. HARU 수신 시각 방식으로 되돌리면 안 된다. 근거: `M/frontend/src/lib/eeg/blePacketParser.ts:7-8,69-102,134-156,184-226`.

## 3. 처리 알고리즘과 MB2.0 차이

### 3.1 EEG

1. 최근 5초/1250샘플 버퍼, 최소 500샘플부터 분석. 60Hz notch → 1–45Hz bandpass → 초기 250샘플 제거. 진폭/주파수 SQI를 결합하고 채널별 15% 이상을 유효로 판단한다. 근거: `H/src/services/StreamProcessor.ts:99,430-435`; `H/src/utils/signal/EEGSignalProcessor.ts:124-125,173-210`.
2. 양 채널 동시 양호 샘플이 100개 초과면 각 채널 품질 마스크로 샘플을 추려 최소 길이에 맞춘다. 아니면 전체 필터 신호를 사용한다. **추정:** 불연속 샘플을 압축한 배열에 고정 250Hz 분석을 적용하므로 원래 시간 간격과 스펙트럼의 대응이 왜곡될 수 있다. 근거: `H/src/utils/signal/EEGSignalProcessor.ts:221-240`.
3. 1–45Hz 정수 bin, Morlet 7 cycles, 최대 1000샘플, 보정 `PSD_CALIB=0.00739181390669613 × corr(f) × rawPower`. PSD는 µV²/Hz, 밴드 적분은 µV². delta 1–4, theta 4–8, alpha 8–13, beta 13–30, gamma 30–45Hz. 근거: `H/src/utils/signal/EEGSignalProcessor.ts:33-63,78-86,255-265,775-807`.
4. Fp1/Fp2 밴드 파워는 SQI 가중 기하평균. raw 지수는 아래와 같다. 근거: `H/src/utils/signal/EEGSignalProcessor.ts:325-393`.

| 지표 | HARU raw 수식·단위 |
|---|---|
| 집중 `focusIndex` | β/(α+θ+ε), 무차원 |
| 이완 `relaxationIndex` | α/(α+β+ε), 무차원 |
| 정서안정 `emotionalStability` | (α+θ)/(γ+ε), 무차원 |
| 스트레스 | (β+γ)/(α+θ+ε) |
| 인지부하 | 두 채널의 θ+α+β+γ 평균, µV² |
| 전체 활동도 | 두 채널 5밴드 합 평균, µV² |
| FAA | ln(Fp2 α)−ln(Fp1 α), 양 채널 유효할 때만, 아니면 null |
| 좌우 균형 | (Fp1 α−Fp2 α)/(Fp1 α+Fp2 α), −1~1 |

raw 지수와 화면 점수는 별개다. HARU는 대부분 ln 변환 후 median/MAD 기반 표준화와 sigmoid로 0–100을 만들고 FAA는 0 기준 Gaussian 형태를 사용한다. MB2에도 HARU SDD-042 이식 주석과 같은 점수화 분기가 있다. 근거: `H/src/utils/eegSigmoidScore.ts:1-7,78-85,104-132`; `M/frontend/src/lib/eeg/eegSigmoidScore.ts:1-2,103-131`.

**“감정균형” 이름만으로 FAA/좌우 균형/정서안정을 혼용하면 안 된다.** MB2 클래스 화면은 `emotional_stability`를 점수화하고 HRV는 `sdnn`을 사용한다. `AnalysisMetricsService.emotionalBalance`는 별도로 α/(α+β)×100이어서 다른 값이다. 근거: `M/frontend/src/pages/sessions/ClassPlayerPage.tsx:415-428`; `M/frontend/src/lib/eeg/AnalysisMetricsService.ts:157-168,346-349`.

HARU의 SQI≥80 조건은 이동평균 큐 입력 조건이며 raw 또는 전체 metric callback의 저장 차단 조건이 아니다. 업로드 `signal_quality`는 입력에 없으면 80으로 대체한다. **추정:** 현재 metrics 생성 객체에 signalQuality가 없어 저장 SQI가 실제 품질과 달라질 수 있다. 근거: `H/src/services/AnalysisMetricsService.ts:234-263,265-296`; `H/src/services/DataCollector.ts:179`.

### 3.2 PPG 심박·HRV

- 10초/500샘플 버퍼, 50샘플부터 처리. DC 제거→1–5Hz bandpass 후 IR로 심박 계산. 3점 평활화·정규화 후 0.5초 지역 창/60% 임계값/최소 0.4초 피크 간격. RR은 샘플 인덱스 차×20ms이므로 파서의 동일 timestamp와 별개로 계산된다. 근거: `H/src/services/StreamProcessor.ts:100,487-489`; `H/src/utils/signal/PPGSignalProcessor.ts:188-210,303-314,595-675,863-870`.
- 심박용 RR 300–1500ms 및 IQR 1.5배 이상치 제거→최근 RR에 선형 가중한 60000/RR 평균→40–200 BPM 검증·반올림. 변동계수>0.5일 때 0.9배 보정도 존재한다. 이는 코드상 휴리스틱이며 임상 정확도를 확인한 것이 아니다. 근거: `H/src/utils/signal/PPGSignalProcessor.ts:873-937`.
- HARU SDD-052 RR 추출은 **filtered IR + 적응형 피크 + IQR**, 추가 범위 300–1200ms. 중복 윈도우는 suffix/prefix 완전 일치로 제거하고, 불일치면 마지막 RR 하나만 반영. 기존 중앙값±25% 이탈을 제외한다. 일정 RR가 반복될 때 완전 일치만으로 실제 새 박동까지 제거할 가능성은 **추정**이며 timestamp/beat ID가 더 명확하다. 근거: `H/src/utils/signal/PPGSignalProcessor.ts:219-230`; `H/src/utils/signal/rrBuffer.ts:23-60`.
- 시간 HRV는 120개 RR 버퍼/최소30개. SDNN=RR 모집단 표준편차(ms), RMSSD=연속 RR 차 제곱 평균의 제곱근(ms), pNN50=50ms 초과 차 비율(%). 주파수 버퍼는 400개로 별도 유지, 4Hz 보간, HF 최소90초·LF 최소150초, s²→ms² 변환. 근거: `H/src/services/AnalysisMetricsService.ts:21-29,81-98,680-745,757-807`.
- `vitals.hrv` 단기 추정치와 RR 버퍼의 SDNN/RMSSD는 같은 값이 아니다. HARU 화면의 HRV는 trend sampler에서 SDNN을 선택한다. 근거: `H/src/services/StreamProcessor.ts:875-885`; `H/src/hooks/use-meditation-trend-buffer.ts:72-76`.

**MB2와 실제 차이:** 이식 주석은 있지만 MB2는 아직 raw IR 전역 피크에서 200–2000ms RR을 만들고 버퍼에 단순 push한다. HARU 최신 SDD-052 방식과 다르다. MB2는 별도로 시간영역 60 RR 창, BPM EMA 0.3, 호흡 60초 게이트·5회 중앙값 필터가 있다. “HARU를 이식했다”를 최신 HARU와 동치로 해석하면 안 된다. 근거: `M/frontend/src/lib/eeg/PPGSignalProcessor.ts:219-230`; `M/frontend/src/lib/eeg/AnalysisMetricsService.ts:71-80,354-361,373-383`.

### 3.3 호흡수와 호흡 안정은 별개

| 경로 | 실제 처리 | 저장과의 관계 |
|---|---|---|
| HARU 화면 호흡수 | RR 300–2000ms 필터, 최소30개/최근120개 → 4Hz 선형 보간·DC 제거 → Welch PSD → 0.1–0.4Hz 최대 피크×60. 피크/대역 중앙값≥1.5, 6–24회/분. EMA 0.25, ±30% 점프는 3회 연속 후 재설정 | hook에서 1초마다 별도 계산. PPG feature 필드에는 없음 |
| HARU 호흡 안정 | 0.04–0.15Hz 피크 주변 파워 집중도 0–100 | 호흡수(회/분)가 아님 |
| HARU PPG 처리기 지표 | `respiratoryRate:0` 등 미구현 placeholder | 이 필드를 저장해도 화면 호흡수가 되지 않음 |
| MB2 호흡수 | RR 합≥60초, 4Hz 재샘플/Welch, 0.15–0.4Hz 최대 피크×60, 최근5회 중앙값 | feature의 `respiratory_rate`로 전달. 범위 검사는 6–40이지만 탐색 대역상 실제 후보는 9–24회/분 |

근거: `H/src/utils/breathingRate.ts:18-46,57-95,125-153`; `H/src/utils/breathingStability.ts:1-6,54-128`; `H/src/hooks/use-meditation-trend-buffer.ts:69-97`; `H/src/services/StreamProcessor.ts:897-907`; `H/src/services/DataCollector.ts:188-206`; `M/frontend/src/lib/eeg/AnalysisMetricsService.ts:429-486`; `M/frontend/src/hooks/useBand.ts:314-320`.

**결측 함정:** HARU stabilizer 주석은 null 반환이라고 적지만 실제로 null/비정상 입력이면 이전값을 반환한다. MB2 클래스 화면도 BPM/호흡 null을 이전값으로 hold한다. 따라서 수신된 feature와 표시된 값은 달라질 수 있다. 저장 시 `measured_at`, `displayed_at`, `held/stale` 여부가 필요하다는 **제안**이다. 근거: `H/src/utils/breathingRate.ts:117-130`; `M/frontend/src/pages/sessions/ClassPlayerPage.tsx:429-432`.

### 3.4 ACC 및 서버 재계산

ACC는 `max(0,sqrt(x²+y²+z²)−1)×100`으로 움직임을 만들고 평균/표준편차/최댓값/합계, 휴지·앉기·걷기·뛰기 분류 및 자세를 계산한다. lowpass와 품질 평가 호출은 비활성화되어 filteredData는 빈 배열, signalQuality는 0이다. `totalMovement`는 dt 없는 합계이므로 시간 적분의 물리량으로 취급하면 안 된다. 근거: `H/src/utils/signal/ACCSignalProcessor.ts:47-85,133-150,173-186,199-218`.

별도 Node `feature-worker`에도 신호별 프로세서와 세션 버퍼가 있다. 메모리 Map, 30분 TTL, 1250/500/150 용량이다. EEG worker threshold는100인데 앱은500이므로 상수·주석부터 이미 다르다. worker 존재만으로 브라우저와 결과가 같거나 서버 저장의 정본이라고 판정하지 않는다. 근거: `H/feature-worker/src/session-manager.ts:1-4,69-88,99-115,126-141,187-192`; `H/src/services/StreamProcessor.ts:433`.

## 4. 원데이터·feature·지표 저장

### 4.1 로컬

- IndexedDB `linkband_sessions` v1, `sessions`와 `metadata` object store. 세션 값은 `metadata,eegData,ppgData,accData,systemLogs`다. 세션 raw는 메모리에 전량 누적하고 5초마다 전체 세션 객체를 put한다. 서버 업로드 큐의 영속화와는 별개다. 근거: `H/src/services/SessionManager.ts:111-175,215-221,452-486,1039-1056,1091-1122`.
- 로컬 저장 재시도는 최대3회, 실패 사이 1초·2초 대기. 1000샘플 stream flush는 파일 기록이 아니라 임시 배열 비우기다. `StreamingStorageService`는 스텁이며 `addProcessedData`도 no-op이다. **원데이터와 모든 중간 feature/지표가 로컬에 함께 저장된다고 볼 수 없다.** 근거: `H/src/services/SessionManager.ts:304-317,490-522,531-536`; `H/src/services/StreamingStorageService.ts:1-21`.
- **추정:** 장시간 세션은 메모리의 원본 배열, DataCollector raw 배열, 5초마다 전체 객체 직렬화가 겹쳐 메모리·I/O 부하가 커질 수 있다. IndexedDB 용량 부족/탭 종료 시 보존량은 실측하지 않았다. 근거: `H/src/services/SessionManager.ts:452-486,1091-1122`; `H/src/services/DataCollector.ts:222-225`.

### 4.2 서버 feature와 DB 스키마

`AnalysisMetricsService → DataCollector` 콜백을 5초 배치로 `/eeg/sessions/{id}/features`에 보낸다. `second_offset`은 분석 입력 샘플 시각이 아니라 **콜백 시점 Date.now−세션 시작**을 floor한 값이다. 콜백마다 append하고 DB 충돌은 무시하므로 “각 초의 평균”을 보장하지 않는다. 근거: `H/src/services/AnalysisMetricsService.ts:294-296,415-416`; `H/src/services/DataCollector.ts:151-217,228-250`; `H/backend/app/services/session.py:83-104`.

| 테이블/레이어 | 저장 필드·키 | 보존하지 못하는 주요 정보 | 근거 |
|---|---|---|---|
| `sessions` | id PK, user_id(default guest), session_type/content, device_id/name, start/end, duration, sampling_rate(default250), 신호별 샘플 수, avg_sqi/leadoff_pct | 신호별 샘플레이트·단위·알고리즘 버전 필드 없음 | H/backend/app/models/session.py:15-33 |
| `eeg_features` | PK(session_id,second_offset), timestamp(tz), total_power, hemispheric_balance, focus/relaxation/stress/cognitive_load/emotional_stability/attention_level/meditation_level, 5밴드, signal_quality | 전체 PSD bin, 채널별 파워/SQI, filtered waveform, FAA 및 화면 점수 이력은 이 테이블에 없음 | H/backend/app/models/features.py:12-38 |
| `ppg_features` | 같은 복합PK, timestamp, bpm, rmssd, sdnn, pnn50/pnn20, sdsd, avnn, lf/hf/ratio, stress_index, spo2, hr_max/min | RR/beat 시각, 호흡수, 표시 EMA 상태 없음 | H/backend/app/models/features.py:41-64 |
| `acc_features` | 같은 복합PK, timestamp, activity_state,intensity,stability,avg_movement,max_movement | 전체 자세/품질/filtered 데이터 및 시간창 없음 | H/backend/app/models/features.py:67-81 |
| `application_data` | 세션 종료 집계·점수·품질·PPG 평균 및 feature_version | 세션 집계는 초별 화면값 대체 불가 | H/backend/app/services/session.py:107-115,181-228 |

위 feature의 수치 열은 nullable float, activity_state는 문자열, 세션 FK는 cascade다. timestamp는 입력 epoch ms를 UTC datetime으로 변환한다. 같은 초 재전송은 `on_conflict_do_nothing`으로 첫 저장값을 유지한다. 단순 append 전체를 보관하는 feature 스트림이 아니라 **초별 첫 도착 레코드**에 가까운 계약이다. 근거: `H/backend/app/models/features.py:12-81`; `H/backend/app/services/session.py:83-104`.

### 4.3 서버 raw·청크·재시도·오프라인

| 단계 | 실제 동작 | 함정/제한 | 근거 |
|---|---|---|---|
| 세션 시작 | POST 실패도 warning 후 메모리 세션 유지 | 생성 실패를 나중에 재생하는 영속 작업은 해당 코드에서 확인되지 않음 | H/src/services/DataCollector.ts:70-93 |
| feature 업로드 | 5초 배치, 보낼 배열을 비운 뒤 전송. 실패 시 최대5번 복원·2/4/8/16/32초 재시도 | 6번째 실패는 payload 복원 안 함. 주기 타이머와 재시도 간 직렬화 가드도 이 함수에는 없음 | H/src/services/DataCollector.ts:36-48,228-267 |
| raw 수집 | 활성 세션에서 각 raw 저장 옵션이 켜진 신호만 메모리 배열에 누적 | 업로드용 IndexedDB outbox 구현 없음. 로컬 세션 DB와 자동 동기화되지 않음 | H/src/services/DataCollector.ts:44-48,222-225,293-300; H/src/services/SessionManager.ts:452-486 |
| raw 전송 | 종료 시 신호별 전체 배열 JSON→UTF-8 ArrayBuffer→presigned PUT | 주기별 불변 청크/sequence/체크섬/재개 프로토콜 아님 | H/src/services/DataCollector.ts:98-113,270-300 |
| 성공 판정 | PUT `fetch`의 HTTP status 미검사, 예외 catch도 내부에서 종료. 이후 raw 배열 비움 | **추정:** HTTP 실패 및 네트워크 실패 때 서버 미보존 상태로 로컬 업로드 버퍼가 사라질 수 있음 | H/src/services/DataCollector.ts:282-300 |
| S3 key | `sessions/{session_id}/{type}.parquet`, URL 만료300초 | 내용은 JSON인데 이름은 Parquet. 반복 업로드 시 동일 key라 덮어쓰기 가능성(추정) | H/backend/app/services/s3.py:37-56; H/src/services/DataCollector.ts:293-300 |
| 종료 | SessionManager가 DataCollector 종료를 await하지 않음 | **추정:** 탭 종료 직전 완료 보장 불가 | H/src/services/SessionManager.ts:435-444 |

주석에는 IndexedDB 오프라인 큐가 있지만 실행 구현은 메모리 버퍼다. “오프라인 로컬 세션 저장”과 “온라인 복귀 후 서버 전달 보장”을 구분해야 한다. 근거: `H/src/services/DataCollector.ts:8,44-48,228-300`; `H/src/services/SessionManager.ts:1091-1122`.

### 4.4 보관·아카이브

90일 지난 세션 feature를 pandas/pyarrow로 **실제 Snappy Parquet**로 만들어 `features/year={cutoff연}/month={cutoff월}/{session_id}/{table}.parquet`에 업로드하고 DB feature를 삭제하는 worker 코드가 있다. raw 업로드의 JSON/확장자 불일치와는 다른 경로다. 실행·성공 여부는 미확인이다. 근거: `H/backend/app/workers/archive_worker.py:27-100`.

현재 관리자 raw 조회는 `sessions/{id}/` prefix이고 archive는 `features/`이므로 같은 다운로드 목록에 포함되지 않는다. **제안:** SDD-243은 DB와 archive 양쪽을 연결하는 manifest를 사용해야 한다. 근거: `H/backend/app/services/s3.py:64-71`; `H/backend/app/workers/archive_worker.py:79`.

## 5. 다운로드·내보내기

### 5.1 로컬 CSV/ZIP

`SessionManager.exportToCSV`는 eeg/ppg/acc/system 유형을 지원한다. `downloadAllAsZip`은 JSZip Blob을 선택 폴더 또는 기본 `<a download>`로 저장한다. **메서드 존재는 확인했지만 src 검색에서 외부 UI 호출을 찾지 못했으므로 사용자 화면에서 현재 사용 가능하다고 단정하지 않는다.** 근거: `H/src/services/SessionManager.ts:628-650,740-808`.

| 파일 | 내용/정확한 raw CSV 컬럼 | 주의 |
|---|---|---|
| `session_info.txt`, `metadata.json` | 세션 설명과 metadata JSON | 전체 raw/지표를 대체하지 않음 |
| `raw-data/eeg_raw_data.csv` | `timestamp,fp1,fp2` | epoch ms, µV. 기기/시작 ISO/250Hz 설명 행. lead-off/SQI는 빠짐 |
| `raw-data/ppg_raw_data.csv` | `timestamp,red,ir` | epoch ms, 디지털 카운트 |
| `raw-data/acc_raw_data.csv` | `timestamp,x,y,z` | epoch ms, g. 내부 magnitude는 내보내지 않음 |
| `system_logs.csv` | 로그 파일 경로가 ZIP에 포함될 수 있음 | 현재/저장 세션의 데이터 존재에 따라 달라짐 |
| `analysis-metrics/eeg-analysis-metrics.csv` | 아래 분석 헤더 | **데이터 행 없음** |
| `analysis-metrics/ppg-analysis-metrics.csv` | 아래 분석 헤더 | **데이터 행 없음** |
| `analysis-metrics/acc-analysis-metrics.csv` | 아래 분석 헤더 | **데이터 행 없음** |

근거: `H/src/services/SessionManager.ts:740-765,814-820,892-916,1153-1192`.

분석 CSV의 헤더는 다음과 같다. 원본 헤더 자체를 명시하며 실제 저장된 지표가 있다는 뜻은 아니다. 근거: `H/src/services/SessionManager.ts:895-916`.

- EEG: `timestamp,total_power,emotional_balance,attention,cognitive_load,focus_index,relaxation_index,stress_index,hemispheric_balance,emotional_stability,attention_level,meditation_level` 및 timestamp를 제외한 동일 순서의 `ma_` 컬럼.
- PPG: `timestamp,bpm,sdnn,rmssd,pnn50,lf_power,hf_power,lf_hf_ratio,stress_index,spo2` 및 timestamp를 제외한 동일 순서의 `ma_` 컬럼.
- ACC: `timestamp,activity_state,activity_level,stability,avg_movement,std_movement,max_movement,tilt_angle,balance` 및 `ma_activity_level,ma_stability,ma_avg_movement,ma_std_movement,ma_max_movement,ma_tilt_angle,ma_balance`.

빈 raw fallback은 정상 raw와 **다른 스키마**다. EEG는 `ch1..ch8,battery,temperature,accelerometer_*,gyroscope_*`, PPG는 `ppg_red,ppg_ir,ppg_green,ambient_light,temperature`, ACC는 magnitude까지 넣는다. 빈 데이터 여부에 따라 컬럼이 달라지는 패턴은 가져오면 안 된다. 근거: `H/src/services/SessionManager.ts:874-883,1153-1192`.

로컬 다운로드는 IndexedDB/메모리에 보유한 데이터를 사용하는 코드이며 서버 역할/기관 ACL 검사를 거치지 않는다. 폴더 선택 권한과 서버 데이터 접근 권한은 별개다. 근거: `H/src/services/SessionManager.ts:628-650,729-808`.

### 5.2 서버 조회/다운로드 및 권한

| 경로 | 형식·권한 | 판정·한계 | 근거 |
|---|---|---|---|
| 관리자 raw 목록 | S3 object별 presigned GET, 만료60초. admin router 전체 `require_admin` 적용 | 사용자가 URL을 가진 동안 직접 다운로드. 실제 배포 ACL은 미실행 | H/backend/app/routers/admin.py:482-493; H/backend/app/services/s3.py:64-101; H/backend/app/main.py:120; H/backend/app/auth/admin.py:72-94 |
| 관리자 raw JSON | Parquet를 pandas로 읽어 `session_id,data_type,row_count,data` JSON. UI 다운로드 파일은 응답의 `data` 배열만 저장 | DataCollector JSON 업로드 파일은 `pd.read_parquet`와 비호환. 반환 실패/422 경로 존재 | H/backend/app/routers/admin.py:496-515; H/backend/app/services/s3.py:104-127; H/src/services/api/admin-api.ts:952-968 |
| 관리자 raw 직접 링크 | UI가 `{type}.parquet` 이름으로 GET URL 사용 | 다운로드 파일의 확장자가 실제 직렬화 형식을 보증하지 않음 | H/src/pages/admin/admin-session-detail-page.tsx:292-293 |
| feature 조회 | `/eeg/analytics/sessions/{id}/features?type=eeg|ppg|acc&start_sec=&end_sec=` JSON | 라우트/등록에 인증·소유권 검사 없음. **실제 외부 노출은 프록시·배포 설정 미조회로 미확인** | H/backend/app/routers/analytics.py:40-54; H/backend/app/main.py:118 |
| raw 업로드 URL | API key와 session 존재 검사 | 사용자/기관별 소유권 확인은 이 핸들러에서 확인되지 않음 | H/backend/app/routers/sessions.py:298-305 |

DataCollector HTTP helper는 Content-Type만 보내고, 세션 API는 `verify_api_key`를 요구한다. **추정:** 키를 요구하는 환경에서 별도 주입이 없다면 401로 저장이 막힐 수 있다. .env·키·배포 프록시를 읽지 않았으므로 현재 장애라고 단정하지 않는다. 근거: `H/src/services/DataCollector.ts:305-324`; `H/backend/app/routers/sessions.py:262-265,298-300`.

확인한 서버 다운로드 경로에는 raw+feature+화면6지표를 합친 통합 CSV/ZIP 제공이 없다. 앞의 로컬 ZIP, 서버 raw, feature JSON API, feature archive를 **서로 다른 경로**로 취급해야 한다. 근거: `H/src/services/SessionManager.ts:740-765`; `H/backend/app/routers/admin.py:482-515`; `H/backend/app/routers/analytics.py:40-54`; `H/backend/app/workers/archive_worker.py:79-85`.

## 6. MB2.0 적용 제안 — 구현 전 계약에 넣을 사항

아래는 **제안**이며 이번 조사에서 구현하지 않았다. MB2 현재 raw encoder는 EEG 두 채널 float32 LE/250Hz/µV/1초 청크이고, feature payload에는 이미 SDNN/RMSSD/BPM/호흡/motion이 있다. 이를 출발점으로 삼고 HARU 저장기를 통째로 복제하지 않는 편이 타당하다. 근거: `M/frontend/src/lib/session-live/raw-encoder.ts:1-30`; `M/frontend/src/hooks/useBand.ts:295-322`.

| 우선순위 | 제안 | 조사에서 드러난 이유 |
|---|---|---|
| P0 | **raw / feature / 화면값을 세 계층으로 저장.** 파싱 raw, 분석 창의 feature, 실제 표시값+quality/stale/held/null 상태를 각각 식별 | HARU 화면 호흡 별도 계산·미저장, MB2 화면 hold. §3.3·§4.2 |
| P0 | 신호별 manifest: EEG250Hz µV Fp1/Fp2, PPG50Hz count red/ir, ACC30Hz g xyz. schema/algorithm/model version, 장치 시각·수신 시각·sample index·lead-off·갭 포함 | HARU 장치 timestamp 누락·raw 변환·단일 sampling_rate. §2·§4.2 |
| P0 | 수신 즉시 durable outbox에 raw를 보존하고 분석 부하와 분리. 불변 chunk ID/sequence·sample_count·byte_count·checksum → 서버 검증 ACK 후 outbox 완료 처리 | raw callback 전 drop, 메모리 전량 업로드·실패 후 비움. §2·§4.3 |
| P0 | 세션 종료는 모든 청크 ACK와 manifest 확정 상태로 구분. 오프라인/탭 재시작/중복/순서역전/부분 실패를 복구 | HARU session 생성 실패 재생·영속 업로드 큐 부재. §4.3 |
| P0 | 서버 인가를 raw·feature·archive·내보내기 모두 동일하게 적용. 사용자·기관·세션 범위 검증 후 짧은 다운로드 URL 발급 | analytics 라우트 가드 부재와 API key/소유권 차이. §5.2 |
| P1 | HRV를 명시적으로 `sdnn_ms`, `rmssd_ms`, RR 창/실제 경과시간/중복 처리 버전으로 기록. beat timestamp 기반 중복 제거 검토 | HARU/MB2 RR 검출·누적·창 차이, `vitals.hrv` 혼재. §3.2 |
| P1 | `focus_raw/score`, `relaxation_raw/score`, `emotional_stability_raw/score`를 분리. FAA·emotionalBalance를 이름만으로 대체하지 않음. 점수 재현용 모델 ID/파라미터 고정 | raw 지수·sigmoid·화면 선택이 별개. §3.1 |
| P1 | `.parquet`면 실제 Parquet 인코딩/읽기 왕복 검증. 전송은 현 MB2 바이너리 확장 또는 명시적 JSON 계약 중 선택하고 MIME·확장자·schema 일치 | HARU JSON→`.parquet` 불일치. §4.3·§5.2 |
| P1 | SDD-243 ZIP은 manifest+신호별 raw CSV/Parquet+feature CSV+6지표 CSV. 빈 파일도 고정 컬럼, 결측과 0 구분, 시간대·단위 명시. archive 포함 완전성 표시 | 헤더 전용 분석 CSV·빈 raw 스키마 불일치·archive 분리. §5 |

**6대 지표 저장 계약 초안(제안):** `timestamp`, `participant_id`, `focus`, `relaxation`, `emotional_stability`, `heart_rate_bpm`, `respiratory_rate_bpm`(명칭은 breaths/min임을 명시), `hrv_sdnn_ms`, 각 지표 `source_window_id`, `quality`, `status`, `measured_at`, `displayed_at`, `algorithm_version`, `normalization_model_id`. 호흡 컬럼은 혼동을 줄이려면 `respiratory_rate_breaths_per_min`을 권장한다. 보고서에는 기존 원칙대로 점수 종합 환원 없이 서사·변화량을 사용하고, 저장 계약은 재현을 위한 원값/표시값 기록으로 한정한다.

### 구현 전 확인할 수용 조건(미실행)

- 합성 신호를 넣어 EEG/PPG/ACC 수신 샘플 수와 다운로드 샘플 수·순서·시각·단위가 일치하는지 검증.
- 통신 끊김·HTTP 4xx/5xx·presign 만료·앱 재시작·종료 도중 실패에도 누락 없이 재개되는지 검증.
- 같은 청크 재전송은 중복 없이, 같은 초 여러 feature는 정의한 집계/선택 정책대로 처리되는지 검증.
- HRV 워밍업·호흡 미산출·lead-off·신호 갭의 null/0/hold 의미와 화면·저장·다운로드가 일치하는지 검증.
- raw 파일을 실제 parser로 열고, 빈 세션/부분 세션/장기 세션/archived 세션의 고정 스키마와 manifest 완전성을 검증.
- 다른 사용자/기관의 raw·feature·archive 조회와 다운로드 URL 발급을 차단하는지 검증.

이 조건들은 본 조사에서 실행하지 않았다. 코드를 근거로 한 구조·불일치 확인과 장치/서버/다운로드 실동작 증명은 구분해야 한다.

## 7. 조사 산출물 검증

- 저장·다운로드 부분은 별도 읽기 전용 검증자가 재검토했고, raw 저장 옵션 조건과 다운로드 JSON 배열 설명을 보완했다.
- 문서 내 소스 참조의 파일 존재 및 행 범위를 스크립트로 검사했다. 소스 동작 검증이나 운영 검증을 대신하지 않는다.
- 참고 저장소 두 곳의 작업 트리는 조사 후에도 clean이며, MB2 추적 파일 diff는 없다. 산출 문서는 이 파일 하나다.
