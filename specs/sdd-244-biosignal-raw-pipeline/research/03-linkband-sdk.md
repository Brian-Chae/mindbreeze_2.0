# SDD-244 조사 03 — LINK BAND SDK 생체신호·지표·기록 포맷

작성일: 2026-10-24. 범위: 로컬 소스 정적 조사. 코드 수정·커밋·푸시·배포·서버 실행·DB 접근·환경변수 파일 열람·실데이터 열람·메일·삭제 없이 이 문서만 작성했다. 장치 수신, 펌웨어, 파일 다운로드 실행은 검증하지 않았다. 이하 **확인**은 소스에서 확인한 동작이며, 설계안은 **제안**, 불확실한 해석은 **추정**으로 표시한다.

## 0. 결론과 근거 읽는 법

**공통 SDK 포맷 하나가 이미 완성되어 있다고 볼 수 없다.** 웹은 raw CSV/ZIP 경로가 있으나 분석 지표 ZIP은 헤더만 생성한다. Python은 raw/processed를 저장하나 웹과 알고리즘이 다르다. 독립 Android/iOS SDK는 수신·기록 중심이며 30종 분석 구현을 확인하지 못했다. 호흡수는 웹의 미구현 0 값이다. 따라서 MB2.0은 원신호, 계산 feature, 화면 표시값을 구별하여 보관하고, SDK별 명시적 변환 프로필로 다운로드해야 한다.

| 핵심 | 확인 결과 | 근거 |
|---|---|---|
| 웹 raw | EEG 250Hz/Fp1·Fp2/µV, PPG 50Hz/red·IR/count, ACC 30Hz/XYZ/g | `W/src/utils/blePacketParser.ts:6-7,68-101,133-157,183-231` |
| 30종 | EEG 11 + PPG 14 + ACC 5 필드. alias 포함, 호흡 미포함 | `W/src/types/processed-data.ts:24-101` |
| 6대 지표 | 집중·이완 원비율, emotionalBalance 0~100, BPM·RMSSD 계산. respiratoryRate=0 미구현 | `W/src/utils/EEGSignalProcessor.ts:225-254`; `W/src/services/AnalysisMetricsService.ts:405-425,623-714`; `W/src/utils/StreamProcessor.ts:718-747` |
| 웹 feature 기록 | addProcessedData는 no-op, 세션 객체에 processed 배열 없음, ZIP 지표 CSV는 헤더만 | `W/src/utils/SessionManager.ts:214-220,501-503,781-788,859-883` |
| 네이티브 차이 | ACC 기본25Hz·축당1바이트 사용, Android CSV ms/iOS CSV s | `A/SensorConfiguration.kt:30-33`; `A/SensorDataParser.kt:180-197`; `I/SensorDataParser.swift:209-241`; `A/SensorDataRecorder.kt:139`; `I/DataRecorder.swift:249-251` |
| Python 차이 | EEG dB 대역 평균끼리 비율 계산, PPG HeartPy·최대60초 분석 | `P/python_core/app/core/signal_processing.py:284-310,323-346,389-426` |

### 경로 별칭

모든 `별칭/파일:행`은 다음 절대 경로 아래의 실제 파일을 가리킨다. 행 범위는 조사 시점 작업트리 기준이다.

| 별칭 | 절대 경로 | HEAD 참고 |
|---|---|---|
| W | `/Volumes/Looxid SSD/looxid/repository/link-band-sdk-web` | `766e8702` |
| P | `/Volumes/Looxid SSD/looxid/repository/link_band_sdk` | `29e201a` |
| A | `/Volumes/Looxid SSD/looxid/repository/SDK-Android/src/main/java/com/looxidlabs/sdkandroid` | 저장소 `a789656` |
| I | `/Volumes/Looxid SSD/looxid/repository/SDK-iOS/Sources/BluetoothKit` | 저장소 `5603a66` |
| D | `/Volumes/Looxid SSD/looxid/repository/linkband-docs` | `fb412fb` |
| M | `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd244` | 대상 워크트리 |

W/P에는 기존 변경·미추적/삭제 상태가 있다. 복원하지 않았으며 HEAD 전체와 동일한 상태라고 가정하지 않는다. 공식 웹사이트의 analytics-indices URL은 열기 실패하여 외부 페이지를 근거로 사용하지 않았다. 대신 로컬 공식 문서 D와 실행 소스를 대조했다. D의 플랫폼 표는 전 플랫폼 analytics 지원을 표기하지만, 조사한 네이티브 구현과 일치하지 않는다(`D/sdk/platform-matrix.mdx:19-27`).

## 1. BLE 프로토콜

### 1.1 GATT

| 센서 | Service UUID | Characteristic UUID |
|---|---|---|
| EEG | `df7b5d95-3afe-00a1-084c-b50895ef4f95` | notify `00ab4d15-66b4-0d8a-824f-8d6f8966c6e5`, write `0065cacb-9e52-21bf-a849-99a80d83830e` |
| PPG | `1cc50ec0-6967-9d84-a243-c2267f924d1f` | `6c739642-23ba-818b-2045-bfe8970263f6` |
| ACC | `75c276c3-8f97-20bc-a143-b354244886d4` | `d3d46a35-4394-e9aa-5a43-e7921120aaed` |
| Battery | 표준 `180F` | 표준 `2A19` |

근거: `A/BleManager.kt:28-41`; `I/Models.swift:493-523`. Android는 선택 센서 시작 때 battery notify를 켜며 EEG에 `start`/`stop` 문자열을 write한다(`A/BleManager.kt:720-725,753-781`).

### 1.2 웹 파서 기준 패킷

N은 패킷에서 복원한 샘플 수이며, 패킷 길이는 고정값이 아니라 `floor((length-4)/sampleBytes)`로 계산한다.

| 신호 | 헤더 4B | 반복 샘플 구조 | 채널/속도 | 복원 단위 |
|---|---|---|---|---|
| EEG | uint32 LE tick | leadOff 1B + ch1 3B BE + ch2 3B BE | Fp1/Fp2, 250Hz, Δt=4ms | signed24 → `raw×4.033/12/(2^23−1)×10^6` µV |
| PPG | uint32 **BE** tick | red 3B BE + ir 3B BE | 2채널, 50Hz, Δt=20ms | unsigned24 ADC count, 보정 없음 |
| ACC | uint32 LE tick | x/y/z 각 signed16 LE | 3축, 30Hz, Δt=33.333ms | `raw×2/32768` g |
| Battery | 별도 tick 없음 | 첫 uint8 | 1값 | level; 코드 자체 0~100 clamp 없음 |

근거: `W/src/utils/blePacketParser.ts:61-109,126-157,174-231,255-258`. Fp1/Fp2 이름 매핑은 `W/src/utils/StreamProcessor.ts:260-270`, 전극 위치 문서는 `D/sdk/data-spec.mdx:17-22`.

EEG leadOff byte의 bit0=ch1, bit2=ch2를 각각 보존한다. native는 byte>0 하나의 Bool로 축약한다(`W/src/utils/blePacketParser.ts:83-85`; `A/SensorDataParser.kt:89-103`; `I/SensorDataParser.swift:81-108`). 웹의 raw CSV는 이 비트 및 ADC 정수 원본을 출력하지 않는다(`W/src/utils/SessionManager.ts:1120-1135`). 즉 SDK의 “raw”는 BLE 패킷 원문과 동일하지 않다.

### 1.3 시간축과 배터리

- 웹: tick/32768 → 기기 초 → ms. 동기화기는 최초 호스트 `Date.now()`를 anchor로 기기 경과 시간을 더한다. 이는 기본식이며 ACC는 동기화기 내부 추가 보정도 거친다(`W/src/utils/TimestampSynchronizer.ts:206-219`). UTC 절대시각을 기기에서 받은 것이 아니다(`W/src/utils/blePacketParser.ts:68-72`; `W/src/utils/TimestampSynchronizer.ts:109-112,168-169`).
- 웹 패킷 base는 **마지막 샘플 시각**으로 취급하며 `t_i=base+(i−N+1)×Δt`. ACC는 이전 마지막 시각+N×Δt로 이어 가고 기기시각 간격이 기대값 3배를 넘으면 다시 동기화한다(`W/src/utils/blePacketParser.ts:100-101,155,191-206,225`).
- arrivalTime, deviceTimestampSec, numSamples, sensorType는 청크 메타에 있으나 raw CSV에는 들어가지 않는다(`W/src/utils/blePacketParser.ts:9-14,114-120`; `W/src/utils/SessionManager.ts:1120-1159`). 재접속·유실 재구성에 필요한 정보가 다운로드 단계에서 소실된다.
- 문서는 배터리 60초 주기를 명시한다. 웹 콜백은 값이 바뀔 때만 host timestamp로 발행하므로 “60초마다 저장 행 생성”과 같지 않다(`D/sdk/data-spec.mdx:36-39`; `W/src/utils/bluetoothService.ts:732-751`).
- native timestamp는 `tick/32768`를 Date에 직접 넣으며, Android는 첫 패킷 이후 연속 간격 합성, iOS는 매 패킷 헤더+내부 순방향 간격이다. host epoch 동기화 근거가 없다(`A/SensorDataParser.kt:77-82,106-110,133-155`; `I/SensorDataParser.swift:65-67,109-115,147-175`).
- **추정/미확정:** 헤더가 실제 펌웨어에서 첫/마지막 샘플 중 무엇인지, PPG endian 차이의 원인이 펌웨어 버전인지 구현 오류인지, 장시간 tick wrap 처리의 정확성은 이번 정적 조사로 확정할 수 없다. 웹과 native 해석이 충돌하므로 패킷 원문 보존 및 펌웨어별 합성 fixture 검증이 필요하다.

### 1.4 네이티브의 호환 위험

| 항목 | 확인된 구현 차이 | 근거 |
|---|---|---|
| 예상 패킷 크기 | EEG179B=4+25×7, PPG172B=4+28×6, ACC184B=4+30×6. 실제 길이로 샘플 수 계산 | `A/SensorConfiguration.kt:17-33`; `A/SensorDataParser.kt:127-131`; `I/SensorDataParser.swift:205-206` |
| ACC 속도 | native 기본25Hz=40ms, 웹30Hz | `A/SensorConfiguration.kt:30-33`; `I/Models.swift:450-471`; `W/src/utils/blePacketParser.ts:7` |
| ACC 값 | native는 각 축 두 바이트 중 offset+1/+3/+5만 사용. Android signed Byte→Short, iOS UInt8→Int16. g 환산 없음 | `A/SensorDataParser.kt:187-197`; `I/SensorDataParser.swift:226-241` |
| PPG endian | native 헤더 LE, 웹 BE | `A/SensorDataParser.kt:133`; `I/SensorDataParser.swift:147-148`; `W/src/utils/blePacketParser.ts:133-135` |
| PPG 부호 | Android payload의 Byte→Int에 unsigned mask 없음. 동일 `00 00 FF`를 -1로 해석할 수 있음; iOS UInt8 조합은255 | `A/SensorDataParser.kt:144-145`; `I/SensorDataParser.swift:129,163-164` |
| ACC mode | raw/motion. motion은 계수0.1 중력 저역통과 추정을 빼고 정수화한 값을 recorder에 전달 | `A/BleManager.kt:556-574,625-654`; `I/BluetoothKit.swift:1009-1036,1358-1365` |

이 표는 코드의 산술 의미를 비교한 결과이며 실측 장치의 오류 발생을 증명한 것은 아니다. native 손실형 ACC 파일에서 원래16bit 신호를 역복원할 수 있다고 약속해서는 안 된다.

## 2. 처리 체인과 30종 지표

### 2.1 웹 데이터 흐름

`BLE → blePacketParser → StreamProcessor → raw buffer/SessionManager`와 `신호 처리기 → processed store → AnalysisMetricsService → 분석 이벤트`로 나뉜다. raw 콜백은 SessionManager에 전달되며 processed store 업데이트는 별도다(`W/src/utils/bluetoothService.ts:667-725`; `W/src/utils/StreamProcessor.ts:200-213,260-285`; `W/src/services/SystemControlService.ts:153-176`). 계산되거나 UI에 표시된다고 세션에 영속화되는 것은 아니다(`W/src/utils/SessionManager.ts:214-220,501-503`).

| 처리 | 실제 창·전처리·시간 | 근거 |
|---|---|---|
| EEG | 5초=1250샘플 버퍼, 500샘플부터 분석. 60Hz notch→1~45Hz bandpass→앞250샘플 제거; 가득 찬 버퍼의 남은 구간4초. SQI 조건으로 샘플 추출 후 Morlet | `W/src/utils/StreamProcessor.ts:94,284-285`; `W/src/utils/EEGSignalProcessor.ts:135-196` |
| EEG 대역 | δ[0.5,4), θ[4,8), α[8,13), β[13,30), γ[30,50). 계산 주파수는1~45Hz이므로 지원 범위와 교집합. bin 파워 합, 상대파워 정규화 아님 | `W/src/utils/EEGSignalProcessor.ts:23-27,153-196,825-838` |
| EEG 품질 | 양 채널 SQI≥15 공통 샘플>100일 때 양호 샘플을 추출해 길이를 맞춤. 불충족 때 전체 신호 사용. feature 시각은 계산 시점 Date.now | `W/src/utils/EEGSignalProcessor.ts:153-196,298-308` |
| PPG | 생성 인자는10초×50Hz=500샘플. 500개일 때 앞100개 제외해8초 분석. 필터 IR→피크→RR→가중HR | `W/src/utils/StreamProcessor.ts:95`; `W/src/utils/PPGSignalProcessor.ts:178-184,593-620` |
| HRV | 원시IR 별도 피크 경로→RR300~1200ms→최대120 RR append. 최소30개부터 계산. 중복 RR 제거/개별 beat timestamp 없음 | `W/src/utils/PPGSignalProcessor.ts:218-227`; `W/src/services/AnalysisMetricsService.ts:562-613` |
| ACC | 5초×30Hz=150샘플. 움직임 크기 `max(0,|a|−1g)×100` 기반 통계 | `W/src/utils/StreamProcessor.ts:96`; `W/src/utils/ACCSignalProcessor.ts:133-183` |
| 이동평균 | EEG/PPG는 SQI≥80 고품질 업데이트를 큐에 저장, 최대120개. 벽시계120초가 아님 | `W/src/services/AnalysisMetricsService.ts:28-29,165-188,236-239,458-463` |

**추정:** 중첩 창에서 추출한 RR 목록을 중복 제거 없이 반복 append하므로 같은 beat가 여러 번 포함될 가능성이 있다. “120RR=2분 측정”으로 해석할 근거가 없다. 저장할 때 실제 window 시작/끝, 품질, freshness를 별도로 보존해야 한다.

### 2.2 30종 필드 정의

기준 계약은 `W/src/types/processed-data.ts:24-101`. timestamp·movingAverageValues는 개수에서 제외한다. α/β/θ/γ/δ는 기본적으로 ch1 파워이며 L/R은 각 채널 α. 분모가 유효하지 않은 경우 0 등의 fallback이 있으므로 0과 정상 측정 최솟값을 구별해야 한다.

| # | 분류·필드 | 코드상 정의·스케일 | 근거 |
|---|---|---|---|
| 1 | EEG totalPower | δ+θ+α+β+γ | `W/src/utils/EEGSignalProcessor.ts:225` |
| 2 | EEG emotionalBalance | `100×(α+θ)/(α+θ+β+γ)`, [0,100] | `W/src/services/AnalysisMetricsService.ts:405-425` |
| 3 | EEG attention | attentionLevel의 alias → focusIndex | `W/src/services/AnalysisMetricsService.ts:140-149`; `W/src/utils/StreamProcessor.ts:628-629` |
| 4 | EEG cognitiveLoad | θ/α, 원비율 | `W/src/utils/EEGSignalProcessor.ts:251-252` |
| 5 | EEG focusIndex | β/(α+θ), 원비율 | `W/src/utils/EEGSignalProcessor.ts:228-229` |
| 6 | EEG relaxationIndex | α/(α+β), 원비율 | `W/src/utils/EEGSignalProcessor.ts:230-231` |
| 7 | EEG stressIndex | (β+γ)/(α+θ), 원비율 | `W/src/utils/EEGSignalProcessor.ts:232-233` |
| 8 | EEG hemisphericBalance | (L−R)/(L+R), [-1,1]; 극소분모 별도 처리 | `W/src/utils/EEGSignalProcessor.ts:235-249` |
| 9 | EEG emotionalStability | (α+θ)/γ, 원비율 | `W/src/utils/EEGSignalProcessor.ts:253-254` |
| 10 | EEG attentionLevel | focusIndex alias | `W/src/utils/StreamProcessor.ts:628` |
| 11 | EEG meditationLevel | relaxationIndex alias | `W/src/utils/StreamProcessor.ts:629` |
| 12 | PPG bpm | RR별60000/RR의 최근순 선형가중 평균, 정수반올림 | `W/src/utils/PPGSignalProcessor.ts:892-935` |
| 13 | PPG sdnn | RR 모표준편차, ms | `W/src/services/AnalysisMetricsService.ts:623-685` |
| 14 | PPG rmssd | 연속 RR 차 제곱평균의 제곱근, ms | `W/src/services/AnalysisMetricsService.ts:623-685` |
| 15 | PPG pnn50 | 100×count(|ΔRR|>50)/(N−1), % | `W/src/services/AnalysisMetricsService.ts:623-685` |
| 16 | PPG lfPower | RR PSD 0.04~0.15Hz 적분, 기본 ms² 변환 | `W/src/services/AnalysisMetricsService.ts:742-789` |
| 17 | PPG hfPower | 0.15~0.4Hz 적분, 기본 ms². 예외 보정 있음 | `W/src/services/AnalysisMetricsService.ts:783-798` |
| 18 | PPG lfHfRatio | LF/HF | `W/src/services/AnalysisMetricsService.ts:801-804` |
| 19 | PPG stressIndex | SDNN·RMSSD·심박 기준 가중합, [0,1] | `W/src/services/AnalysisMetricsService.ts:700-714` |
| 20 | PPG spo2 | red/IR AC/DC 비율의 구간별 추정, [85,100] 반올림 | `W/src/utils/PPGSignalProcessor.ts:990-1053` |
| 21 | PPG avnn | RR 평균, ms | `W/src/services/AnalysisMetricsService.ts:623-685` |
| 22 | PPG pnn20 | 100×count(|ΔRR|>20)/(N−1), % | `W/src/services/AnalysisMetricsService.ts:623-685` |
| 23 | PPG sdsd | 연속 RR 차의 모표준편차, ms | `W/src/services/AnalysisMetricsService.ts:623-685` |
| 24 | PPG hrMax | 최근 최대120개의 유효 BPM 업데이트(40<bpm<200)의 최대 | `W/src/services/AnalysisMetricsService.ts:32-35,728-732,1211-1218` |
| 25 | PPG hrMin | 위 버퍼의 최소 | `W/src/services/AnalysisMetricsService.ts:32-35,728-732,1211-1218` |
| 26 | ACC activityState | stationary/sitting/walking/running | `W/src/utils/ACCSignalProcessor.ts:225-235` |
| 27 | ACC intensity | 평균 움직임 m≤5:4m; ≤15:20+4(m−5); 나머지60+min(40,2(m−15)); 최종 정수 반올림 | `W/src/utils/ACCSignalProcessor.ts:213-218,244-247` |
| 28 | ACC stability | round(max(0,100−50×(varX+varY+varZ))) | `W/src/utils/ACCSignalProcessor.ts:275-288` |
| 29 | ACC avgMovement | `max(0,sqrt(x²+y²+z²)−1)×100` 평균 | `W/src/utils/ACCSignalProcessor.ts:133-146,176-183` |
| 30 | ACC maxMovement | 위 움직임 최대 | `W/src/utils/ACCSignalProcessor.ts:133-146,176-183` |

이는 **30개의 필드**이지 독립적으로 검증된 30개 생리 측정량이라는 뜻이 아니다. EEG stressIndex와 PPG stressIndex도 이름은 같지만 공식·범위가 다르다.

PPG 세부 주의:

- HR 경로 RR은 피크 간격×20ms, 300~1500ms 필터 및 IQR 제거. HR 40~200 밖이면0, RR 변동계수>0.5이면 HR×0.9 보정(`W/src/utils/PPGSignalProcessor.ts:864-935`). 문서의 `60000/meanRR`와 같지 않다(`D/sdk/analytics-indices.mdx:38`).
- HRV 서비스는 들어온 RR의200~2000ms를 수용하고 최근120개를 유지한다. 초기 30개 전에는 실제 HRV 갱신이 시작되지 않는다(`W/src/services/AnalysisMetricsService.ts:562-613`). `PPGSignalProcessor.calculateAdvancedHRV` 자체는0 반환이며, 서비스 계산 결과와 기본 store의0 필드를 구분해야 한다(`W/src/utils/PPGSignalProcessor.ts:1183-1212`; `W/src/utils/StreamProcessor.ts:724-735`; `W/src/services/AnalysisMetricsService.ts:242-257`).
- LF/HF는4Hz 보간→Welch/Hamming, 창64~256·50% overlap. RR 유효율/안정성75% 미만 또는 무효 결과에서 이전값 유지. HF<1·LF>10이면0.12~0.5Hz 적분×100을 비교하는 예외가 있어 기본×1e6 단위 변환과 다르다(`W/src/services/AnalysisMetricsService.ts:742-809,899-939`). 단순한 표준 LF/HF와 수치 동등성을 보장할 수 없다.
- PPG stress 식은 `0.4 clamp((100−SDNN)/70)+0.4 clamp((50−RMSSD)/30)+0.2 clamp(|60000/AVNN−80|/40)`이며 clamp 범위0~1이다(`W/src/services/AnalysisMetricsService.ts:700-714`).
- SpO2는 R=(redAC/redDC)/(irAC/irDC)의 구간별 경험식이다. R<0.5→100, <0.7→104−17R, <1→112−25R, <2→120−35R, 그 외max(70,100−15R); 채널 변동성에 따른95 방향 보정 뒤85~100 clamp한다(`W/src/utils/PPGSignalProcessor.ts:990-1053`). 이 문서는 임상 정확성을 평가하지 않는다.
- ACC state는 평균/최대 각각3/10 미만 stationary,8/20 미만 sitting,20/40 미만 walking, 나머지 running이다. D의200/600/1000 임계값과 일치하지 않는다(`W/src/utils/ACCSignalProcessor.ts:225-235`; `D/sdk/analytics-indices.mdx:47-51`).

### 2.3 MB2.0 6대 표시값과 연결할 때

| 표시 | SDK 후보 | 저장 시 구분할 것 |
|---|---|---|
| 집중 | focusIndex β/(α+θ) | raw ratio vs 표시 정규화값; attention alias 중복 |
| 이완 | relaxationIndex α/(α+β) | ratio vs 표시값; meditation alias 중복 |
| 감정균형 | emotionalBalance 0~100 | hemisphericBalance/FAA/emotionalStability와 혼동 금지 |
| BPM | bpm/heartRate | processor 추정치 vs MA/화면 반올림값 |
| 호흡 | respiratoryRate | 현재 웹0 placeholder. 실제0회/분으로 저장하면 안 됨 |
| HRV | rmssd 또는 vitals.hrv | SDNN·RMSSD 중 선택과 ms 명시. 하나의 불명확한 hrv 컬럼 금지 |

근거: 위30종 표, `W/src/utils/StreamProcessor.ts:718-747`의 `rmssd=result.vitals.hrv` 및 호흡 미구현. **이 표는 SDK 후보 매핑이며 MB2.0 화면의 최종 바인딩을 확정한 것은 아니다.** MB의 정규화 유틸리티에는 집중 백분위·이완 사다리꼴·FAA 기반 균형 함수가 별도로 존재한다(`M/frontend/src/lib/eeg/eegScore.ts:28-33,51-83`). 이 SDK 조사만으로 실제 화면이 어느 정규화 경로를 사용하는지 확정하지 않는다. 제안: 화면값의 source_metric/transform_version까지 함께 저장한다.

### 2.4 Python 구현은 같은 계산기가 아니다

- EEG는250Hz deque2000=최대8초, 최소500=2초부터0.5초 간격 처리. 선언된 window1000/overlap500과 달리 실제 deque 전체를 읽는다(`P/python_core/app/core/signal_processing.py:24-38,80-91,114-120,192-236`).
- 60Hz notch→1~45Hz Butterworth/filtfilt. SQI는10샘플 단위 |v|<100µV 비율이며 amplitude×1+frequency×0이다. SQI≥0.7 샘플만 채널별 이어 붙여 길이를 맞춘다(`P/python_core/app/core/signal_processing.py:42-69,122-150,243-290`). 샘플 제거 후 원래 시간 간격이 유지되는 처리라고 볼 수 없다.
- MNE Morlet1초 epoch,1~45Hz, n_cycles=f/2 → power → **10log10** → 대역 내 dB 평균. 집중/이완/스트레스 등 비율을 이 dB 평균에 적용한다. 웹의 선형 bin 파워 합과 동일하지 않다(`P/python_core/app/core/signal_processing.py:164-174,284-310,323-346`). 별도0~100 정규화/개인 baseline 없음. 분모≤0 또는 NaN/Inf는0 fallback.
- EEG processed에는 약250점 filtered 파형·SQI도 들어가며 timestamp는 계산시점 `time.time()`이다(`P/python_core/app/core/signal_processing.py:312-317,349-370`).
- PPG는50Hz·최대60초/최소10초,0.5초 간격. **red** 0.5~5Hz bandpass, SQI 조건을 통과한 샘플을 HeartPy에 전달한다. HR·SDNN·RMSSD·SDSD·pNN50 등을 HeartPy 결과에서 추출한다. 내부 공식의 라이브러리 버전 의존성은 미확정(`P/python_core/app/core/signal_processing.py:389-426,457-478`). 웹 HR 경로는IR이므로 채널부터 다르다.
- Python LF/HF는300~1200ms RR≥30개,4Hz 보간·Welch, LF[0.04,0.15)/HF[0.15,0.4), 적분×1e5이다. 웹 기본×1e6과 다르다(`P/python_core/app/core/signal_processing.py:176-190,480-488`).
- 품질 부족/실패 때 이전 정상 HR/HRV를 재사용한다. 호흡수는 반환 dict에 없고 python_core의 해당 이름 검색에서도 구현을 찾지 못했다(`P/python_core/app/core/signal_processing.py:435-455,490-521`).

- Python 패킷 헤더는 EEG/PPG/ACC 모두 LE이고 tick/32768초를 샘플 첫 시각으로 사용해 +i/fs 한다. 웹 PPG BE 및 마지막 샘플 기준과 다르다(`P/python_core/app/core/device.py:622-626,637-654,708-728,775-792`).
- Python ACC는30Hz, XYZ signed16 LE **raw count**를 그대로 반환한다. 웹처럼 g로 환산하지 않는다(`P/python_core/app/core/device.py:44-47,775-798`). 분석은150샘플(30Hz 기준5초), 각 축 np.gradient(시간 간격 미지정) 크기의 평균/표준편차/최대이다. 평균200/600/1000으로 상태를 나누므로 웹의 g 기반 분류와 다르다(`P/python_core/app/core/signal_processing.py:24-29,534-582`). acc 처리 간격0.5초 선언은 있지만 process_acc_data 안에 should_process 호출이 없어 해당 제한은 적용되지 않는다(`P/python_core/app/core/signal_processing.py:33-37,534-604`; `P/python_core/app/core/device.py:817-826`).

## 3. 저장·세션·다운로드 계약

### 3.1 웹: 실제 연결된 SessionManager 경로

| 파일/상태 | 실제 내용 | 근거 |
|---|---|---|
| EEG CSV | `timestamp,fp1,fp2`; 앞에 # 세션/기기/시각/샘플레이트 등 주석. µV | `W/src/utils/SessionManager.ts:1120-1135` |
| PPG CSV | `timestamp,red,ir`; # 주석 | `W/src/utils/SessionManager.ts:1138-1147` |
| ACC CSV | `timestamp,x,y,z`; # 주석 | `W/src/utils/SessionManager.ts:1150-1159` |
| metadata.json | id/name/startTime/endTime/duration/deviceName/deviceId/samplingRate/dataCount/saveOptions/notes 등 | `W/src/utils/SessionManager.ts:184-211,346-362,710-711` |
| 저장 | 메모리 센서 배열→5초마다 IndexedDB 세션 저장. stream flush는 버퍼를 비우는 동작 | `W/src/utils/SessionManager.ts:233-236,423-454,485-489,1058-1089` |
| 파일 분할 | ZIP은 센서별1 CSV.5초/1000샘플 임계값은 시간별 파일 분할 규칙이 아님 | `W/src/utils/SessionManager.ts:235-236,485-489,717-725` |
| processed | 저장메서드 no-op, dataCount processed는0 | `W/src/utils/SessionManager.ts:501-503,1065-1071` |
| 분석 CSV | analysis-metrics에 EEG/PPG/ACC 헤더만 생성. 실제 행 없음 | `W/src/utils/SessionManager.ts:781-788,859-883` |

웹 ZIP 구조(`W/src/utils/SessionManager.ts:702-732`):

```text
<sessionName>_complete_data_<host-ms>.zip
├── session_info.txt
├── metadata.json
├── raw-data/eeg_raw_data.csv
├── raw-data/ppg_raw_data.csv
├── raw-data/acc_raw_data.csv
├── system_logs.csv
└── analysis-metrics/{eeg,ppg,acc}-analysis-metrics.csv
```

데이터가 있는 raw 종류만 넣는 경로와 storageStore fallback 경로가 있다. fallback empty header는 EEG8채널/PPG green 등 실제2채널 CSV와 불일치하므로 표준으로 채택하지 않는다(`W/src/utils/SessionManager.ts:717-725,819-848`). metadata의 samplingRate는250 하나이며 센서별 속도표가 아니다(`W/src/utils/SessionManager.ts:353`).

분석 header는 현재 타입과도 어긋난다. EEG는11개+ma11개, PPG는9개+ma9개만 있어 avnn/pnn20/sdsd/hrMax/hrMin이 빠지고, ACC는 activity_level/std_movement/tilt_angle/balance 등 현행5필드와 다른 이름을 쓴다(`W/src/utils/SessionManager.ts:863-878`; `W/src/types/processed-data.ts:53-101`). **헤더 복사만으로 30종 보존을 충족하지 못한다.**

Data Center는 zip/all일 때 JSZip→디렉터리 파일 또는 Blob 링크로 다운로드한다. 나머지 csv/json/jsonl/binary 선택은 `downloadCSV(sessionId, format)`에 넘기는데 그 인자는 eeg/ppg/acc/system이므로 해당 선택은 지원되지 않는 타입 경로에 진입한다. 반환값도 호출부에서 확인하지 않는다. 이는 정적 연결상 결함이며 클릭 실행 검증은 하지 않았다(`W/src/components/DataCenter.tsx:548-566`; `W/src/utils/SessionManager.ts:595-625,731-775,891-905`).

`DataFormatWriters`의 JSONL/CSV/Binary/EDF 지원 선언을 현재 Data Center의 실동작으로 오해하지 말아야 한다. MultiFormatWriter의 createFileHandle은 dummy이고, CSVWriter는 첫 객체 키를 헤더로 사용하며 nested 값은 toString 처리한다(`W/src/services/DataFormatWriters.ts:74-101,341-383`). EDF 분기는 EEG만 허용한다(`W/src/services/DataFormatWriters.ts:359-365`).

Visualizer는 processed store의 파형/지표 표시를 담당한다. 조사한 Visualizer 및 센서별 하위 컴포넌트에서 별도 다운로드 실행 경로를 확인하지 못했으며 세션 내보내기는 Data Center 경로다(`W/src/components/Visualizer.tsx:5-13,20-25`; `W/src/components/DataCenter.tsx:535-566`).

### 3.2 웹 코드의 Capacitor 앱과 독립 native SDK를 구별

Capacitor MobileShareService는 SessionManager 데이터를 사용한다. csv=EEG만, json=metadata만, zip=raw3종+system+metadata이다. 브라우저 ZIP의 session_info/분석 헤더 파일과도 동일하지 않다(`W/src/services/MobileShareService.ts:61-103`). jsonl→json, all/binary→zip으로 정규화한다(`W/src/components/DataCenter/ExportSessionModal.tsx:173-183,207-217`). Documents 저장 또는 cache 파일 후 OS 공유 시트 경로다(`W/src/services/MobileShareService.ts:134-160,171-204`). 독립 SDK-Android/SDK-iOS recorder와는 별도 구현이다.

### 3.3 독립 Android/iOS recorder

| 항목 | Android | iOS | 근거 |
|---|---|---|---|
| EEG CSV | `timestamp,ch1Raw,ch2Raw,ch1uV,ch2uV,leadOff` | 동일 | `A/SensorDataRecorder.kt:249-268`; `I/DataRecorder.swift:422-427` |
| PPG/ACC CSV | `timestamp,red,ir` / `timestamp,x,y,z` | 동일 | 같은 근거 |
| timestamp CSV | ms | s | `A/SensorDataRecorder.kt:139,167,194`; `I/DataRecorder.swift:249-251` |
| 위치/이름 | Downloads/LinkBand, LinkBand_EEG/PPG/ACC_yyyyMMdd_HHmmss.csv | Documents, eeg_data/ppg_data/accel_data_<날짜>.csv | `A/SensorDataRecorder.kt:67-84,235-268`; `I/DataRecorder.swift:65-67,270-310,413-418` |
| JSON | LinkBand_SensorData_<시각>.json | raw_data_yyyyMMdd_HHmmss.json | 같은 근거 |
| 시간/용량 분할 | 시작 파일 생성, stop 때 닫음; rollover 발견 못함 | 동일 | `A/SensorDataRecorder.kt:55-127,249-315`; `I/DataRecorder.swift:103-139,270-337` |

JSON 키는 `timestamp,eegChannel1,eegChannel2,eegLeadOff,ppgRed,ppgIr,accelX,accelY,accelZ`. EEG channel 값은 µV이며 ADC 정수는 CSV에만 있다(`A/SensorDataRecorder.kt:139-149,277-286`; `I/DataRecorder.swift:173-177,343-352`).

- Android JSON timestamp는 초로 바꾸어 세 센서마다 공통 배열에 append하나 센서 값은 별도 배열에 누적되어 공통 timestamp 배열과 1:1 대응하지 않는다. 하나의 timestamp 배열을 모든 센서에 index로 대응시키면 안 된다(`A/SensorDataRecorder.kt:143-150,171-177,198-205`).
- iOS recordSensorData에는 timestamp 배열 append가 없고 센서값만 쌓여 종료 JSON timestamp는 빈 배열로 남는 경로다(`I/DataRecorder.swift:170-177,190-216,242-266,343-352`).
- 별도 세션 meta/단위/속도/ACC mode 파일을 recorder에서 찾지 못했다. battery는 Android recorder에 대상이 없고 iOS recordBatteryData는 no-op이다(`A/SensorDataRecorder.kt:25-31,249-268`; `I/DataRecorder.swift:225-228`).

### 3.4 Python recorder와 Data Center

세션명은 사용자명+`_YYYYmmdd_HHMMSS` 또는 `session_YYYYmmdd_HHMMSS`. custom export_path 또는 OS별 앱 데이터 경로를 사용한다(`P/python_core/app/data/data_recorder.py:15-36,65-98`).

- raw와 processed는 `{device_id}_eeg_raw`, `_eeg_processed`, `_ppg_raw`, `_ppg_processed` 등 데이터 종류별 버퍼에 전달된다(`P/python_core/app/core/server.py:1435-1450,1570-1584`).
- add_data는 메모리 list에 append하고 stop 때 종류별 한 파일로 저장한다. 시간/용량별 chunk 파일 분할이나 주기 디스크 flush가 아니다(`P/python_core/app/data/data_recorder.py:162-174,223-233`).
- 파일명은 data_type의 ':'/'/'를 '_'로 바꾼 이름+.json 또는.csv. JSON은 dict 배열 그대로. CSV는 모든 샘플 키 합집합을 정렬하고 timestamp를 첫 열로 둔다(`P/python_core/app/data/data_recorder.py:167-174,235-283`).
- raw EEG 키는 timestamp/ch1/ch2/leadoff_ch1/leadoff_ch2, PPG는timestamp/red/ir이다(`P/python_core/app/core/device.py:658-664,730-734`). 따라서 CSV의 EEG 열은 timestamp,ch1,ch2,leadoff_ch1,leadoff_ch2, PPG는 timestamp,ir,red가 된다(키 정렬 코드에 따른 도출). processed는 nested band_powers/파형/지표 등이 포함되며 CSV에서 dict/list를 flatten하지 않아 Python 문자열 표현이 될 수 있다(`P/python_core/app/data/data_recorder.py:258-283`; `P/python_core/app/core/signal_processing.py:349-370,435-455`).
- CSV 실패 시JSON fallback, 실제 경로를 meta에 반영한다(`P/python_core/app/data/data_recorder.py:176-179,288-293`).
- 시작 meta.json은 session_name/start_time/files/status/export_path/data_format, 종료에end_time 및 files의type/filename/path/size/record_count/created_at와stats를 추가한다(`P/python_core/app/data/data_recorder.py:106-117,155-202,384-406`).
- CSV모드 종료는 meta.csv(key,value)를 쓴다. nested dict는 '_' flatten, list는JSON. 시작 때 쓴 meta.json은 종료 CSV 경로에서 갱신되지 않아 초기상태가 남는다(`P/python_core/app/data/data_recorder.py:114-117,197-202,314-351`).
- 세션 export API는 세션 디렉터리 전체 ZIP_DEFLATED→`/exports/{safe_session_name}.zip`. 기존 CSV/JSON을 재변환하는 API라고 보면 안 된다(`P/python_core/app/services/recording_service.py:233-244`; `P/python_core/app/api/router_data_center.py:575-619`; `P/python_core/app/main.py:163,185`). 실제 서버/DB/다운로드는 실행하지 않았다.

## 4. 플랫폼 비교 요약

| 항목 | 웹 TypeScript / Capacitor | Python | 독립 Android | 독립 iOS |
|---|---|---|---|---|
| EEG/PPG Hz | 250/50 | 250/50 | 250/50 | 250/50 |
| ACC 계약 | 30Hz, signed16→g | 30Hz, signed16 raw count | 25Hz 기본, signed 두 번째 byte | 25Hz 고정, unsigned 두 번째 byte |
| EEG 분석 | Morlet 선형파워합, ch1 비율 | Morlet dB평균의 비율 | 분석 구현 발견 못함 | 분석 구현 발견 못함 |
| PPG 주채널 | HR=IR | HR=red | raw만 | raw만 |
| 호흡 | 0 placeholder | 반환 없음 | 계산 없음 | 계산 없음 |
| 시간 | host-anchor ms, 패킷 마지막 기준 | 처리값은 host epoch s | CSV ms, 처음header 후 연속 | CSV s, 매header 기준 |
| raw 기록 | IndexedDB→CSV/ZIP | 종료 시JSON/CSV | 센서별CSV+종료JSON | 센서별CSV+종료JSON |
| feature 기록 | ZIP header만 | processed JSON/CSV | 없음 | 없음 |
| metadata | metadata.json, 단일samplingRate | meta.json 또는meta.csv | 별도 파일 미발견 | 별도 파일 미발견 |

근거는 §1~3의 각 표와 파일:행 참조. native의 analytics 부재는 읽기 가능한 SDK 소스 범위에서의 검색 결과다. iOS 문서주석의 calculateHeartRate/FFT 예시는 구현 증거가 아니다(`I/Models.swift:575,862,869`). D는 전 플랫폼analytics를 지원한다고 기재하므로 문서만으로 실제 API를 약속하면 안 된다(`D/sdk/platform-matrix.mdx:24-26`; `D/sdk/analytics-indices.mdx:60-73`).

## 5. MB2.0 저장·다운로드 호환 제안 — 미구현 설계안

### 5.1 권장: 원본 계약 + SDK별 export profile

**제안:** 서버의 단일 정규 계약을 SDK 파일의 결함에 맞추지 말고, 아래 두 층을 함께 제공한다.

1. **MB2.0 무손실 묶음:** 패킷 원문/센서별 샘플/feature/UI6/품질·시간·버전 메타를 모두 보존한다.
2. **SDK 호환 뷰:** `linkband-web-v1`, `linkband-python-v1`, `linkband-android-csv-v1`, `linkband-ios-csv-v1`처럼 버전을 고정한 변환을 제공한다. 컬럼 모양 호환과 알고리즘 결과 동일성을 구별한다. 각 profile의 시간 단위와 손실 항목을 manifest에 기록한다.

이유: 웹leadOff 미출력, native 시간 단위 차이, Python nested CSV, 웹 지표 헤더 불완전 문제가 있다(§1.2, §3.1~3.4). 기존 SDK 파일을 읽는 역변환에서도 삭제된ADC byte·leadOff·시간은 복원하지 말고 unavailable로 표시한다.

제안 ZIP 구조:

```text
<session-id>_biosignals_v1.zip
├── manifest.json
├── raw-data/eeg_raw_data.csv
├── raw-data/ppg_raw_data.csv
├── raw-data/acc_raw_data.csv
├── raw-data/battery.csv
├── raw-packets/packets.jsonl
├── features/eeg.jsonl
├── features/ppg.jsonl
├── features/acc.jsonl
├── analysis-metrics/eeg-analysis-metrics.csv
├── analysis-metrics/ppg-analysis-metrics.csv
├── analysis-metrics/acc-analysis-metrics.csv
├── display-metrics/ui-six.csv
└── compatibility/<profile>/...
```

raw-data·analysis-metrics 이름은 웹 ZIP과 친숙하게 유지하되 **MB v1 CSV**와 **legacy 호환 CSV**를 같은 스키마라고 표시하지 않는다. UI 다운로드에서 선택 profile을 명시한다. 실제SDK의 빈 지표 파일이나 손실형JSON 버그를 재현하지 않는다.

### 5.2 권장 컬럼·단위

아래는 모두 제안 스키마이며 현재 SDK의 기존 컬럼을 주장하는 것이 아니다.

| 파일 | 제안 컬럼/내용 |
|---|---|
| EEG raw | 공통키 + ch1_raw,ch2_raw,fp1_uv,fp2_uv,leadoff_raw,leadoff_ch1,leadoff_ch2 |
| PPG raw | 공통키 + red,ir; unsigned ADC count |
| ACC raw | 공통키 + x_raw,y_raw,z_raw,x_g,y_g,z_g,acc_mode; firmware 계약 확정 후g변환 |
| 공통키 | stream_id,segment_id,sample_index,packet_seq,packet_sample_index,timestamp_us,device_tick,received_at_us |
| Battery | stream_id,segment_id,received_at_us,level_percent; 관측값 변경 이벤트와 주기보고 구별 |
| features JSONL | window_start_us,window_end_us,computed_at_us,algorithm_id/version,quality,valid_sample_count,raw_features; band power·PSD·RR·filtered 데이터 등 nested 보존 |
| analysis CSV | 30종을 EEG11/PPG14/ACC5로 나누어 고정컬럼, 필요한ma_* 별도. 윈도우/품질/freshness 포함 |
| UI6 CSV | timestamp_us,focus,relaxation,emotional_balance,bpm,respiratory_rate,hrv_rmssd_ms 및 각 값의source_metric/transform_version/quality/freshness 참조 |

- timestamp_us는 UTC host-anchor 마이크로초 정수로 통일하되 **실제 정확도가1µs라는 의미는 아니다.** device_tick/host arrival/sample_index를 함께 보존하고 동기화 알고리즘·오차 추정치를 meta에 둔다. ACC 간격은33333µs 고정 누적 대신 rate의 유리수 및 sample_index로 재구성하는 방식을 제안한다.
- 샘플레이트가 다른 EEG/PPG/ACC를 하나의 넓은CSV로 강제 병합하지 않는다. 센서별 행을 유지하고 window로만 연결한다. 그래야 존재하지 않는샘플을 보간해 raw처럼 저장하지 않는다.
- CSV는 UTF-8, 고정 헤더, RFC4180 quoting, locale 무관 소수점, 누락값은빈칸. JSONL의 누락값은null, NaN/Inf는허용하지 않는다. unavailable/poor/stale/not_implemented를 품질 필드로 구분하며 0으로 대체하지 않는다.
- 호흡은 현재 SDK 기준 `null + not_implemented`; 실제호흡 알고리즘이 승인·구현되면 algorithm version과 window를 새 계약으로 기록한다. HRV는 이름을명시한 RMSSD/SDNN을 함께 저장하고 UI선택값도 별도로 기록한다.
- feature에는 스칼라30종뿐 아니라 재현에 필요한 대역파워·주파수축·RR/peak 위치·품질마스크·filter 설정도 저장한다. 현재SDK가 내보내지 않는 필드는 SDD-244 수집 계약에 추가해야 하며 이번 조사에서 구현하지 않았다.

### 5.3 SDK 호환 변환 규칙

| Profile | 출력 형태 | 변환 및 한계 |
|---|---|---|
| web raw | timestamp,fp1,fp2 / timestamp,red,ir / timestamp,x,y,z | timestamp ms, EEG µV/ACC g. 기존 #주석 허용. 원본 정수·품질·시간 메타는 MB 원본에 남김 |
| Android CSV | timestamp,ch1Raw,ch2Raw,ch1uV,ch2uV,leadOff 등 | timestamp ms. leadOff는 채널 OR로 축약. ACC 기존 1byte 숫자를 g와 혼용하지 말고 legacy profile임을 표시 |
| iOS CSV | Android와 같은 헤더 | timestamp s. 기존 시간축이 host epoch인지 확인하지 못한 import는 기기 상대시각으로 보존하고 임의 UTC 변환 금지 |
| Python | `<device-alias>_<sensor>_raw/processed.json`, meta.json | dict 배열 + 초 단위 timestamp. processed는 JSON 우선; Python 문자열 dict CSV는 표준으로 채택하지 않음 |
| 분석 CSV | 웹의 파일명 유지, 실제 30종 계약으로 확장 | 기존 헤더와 버전 구분. alias는 유지 가능하나 미측정·미구현을 값으로 채우지 않음 |

ACC 25/30Hz, PPG LE/BE 차이는 **CSV 단위 변환만으로 해결되지 않는다.** packet/profile/firmware 식별 후 해석해야 한다. 같은 데이터에 SDK별 알고리즘을 다시 적용한 결과는 algorithm_id가 다른 별도 산출물이다. SDK 호환을 위해 현재 MB 화면값을 SDK 원비율로 덮어쓰지 않는다.

### 5.4 manifest·분할·저장 완료 조건

제안 manifest: schema_version/export_profile/session_id/가명 participant_id/stream_id/device_model/firmware_version/sdk_platform/sdk_version/algorithm_version, 센서별 sample_rate/channels/units/scale/endianness/time_origin, clock anchor/segment/reconnect, 파일별 path/row_count/time_range/bytes/SHA-256, raw·feature·UI coverage, dropped/duplicate/gap counts, completion state.

제안 저장단위: 네트워크·메모리 상황을 고려한 bounded chunk 업로드. `stream_id+segment_id+sensor+chunk_seq`와 해시로 멱등 처리하고 서버 ACK 후 확정한다. 미수신·재시도·세션 종료 미완료를 구분한다. 초기 후보는 신호별 60초 파일 분할(EEG 15,000/PPG 3,000/ACC 1,800행)이며, 이 숫자는 30Hz 계약 기준 산술이고 현재 SDK 규칙이 아니다. 최종 크기는 부하 검증으로 결정한다.

다운로드는 센서별 파일+manifest를 ZIP으로 묶고, 장시간 세션은 part 파일을 유지하거나 명시적인 합치기 옵션을 둔다. 빈 파일이 있다는 이유만으로 저장 완료로 판정하지 않는다. 밴드 미착용은 not_recorded, 신호 품질 미달은 poor, 알고리즘 미구현은 not_implemented로 구분한다.

### 5.5 구현 전에 확정할 기술 계약과 향후 검증

- 펌웨어별 패킷 endian·ACC rate/scale·header anchor를 합성 패킷 fixture로 고정. EEG signed 경계/leadOff bit, PPG `00 00 FF`, ACC `FF` 경계, 패킷 유실·재접속·tick wrap 검증.
- 원본 파서 출력·서버 수신·다운로드 행수/값/해시 대조. 1분 기준 행수는 정상 연속 수신 시에만 EEG 15,000/PPG 3,000/ACC 1,800이며 유실을 채워 완료로 가장하지 않음.
- feature의 window/source/quality와 화면 표시값을 분리 검증. 호흡 0 placeholder와 stale HRV가 실측 정상값으로 export되지 않는지 확인.
- SDK별 고정 CSV fixture round-trip, timestamp ms↔s↔us, 중첩 JSON, 빈 센서, 중복 chunk, 중도 종료, 장시간 메모리 검증.

위 항목은 **앞으로 실행할 검증 제안**이며 이번 조사에서 통과한 테스트가 아니다. 이 문서는 SDD 구현 승인이나 Stage③ verify를 대체하지 않는다.

## 6. 이번 조사 검증 기록

- 네이티브 조사자와 웹 지표 조사자가 작성 문서를 각각 소스와 독립 대조했다. HR max/min 유효값 큐, ACC intensity 반올림, native byte 표현을 보완했다.
- 작성자는 BLE 파서, 웹 저장·내보내기 호출, Python dB 파워 계산, native ACC/PPG 처리와 iOS JSON 기록 경로를 직접 재확인했다.
- 문서의 명시적 파일:행 참조가 존재하고 파일 길이 범위 안인지 별도 읽기 전용 검사했다. 이 검사는 인용 경로·행의 유효성 검사이며 알고리즘의 장치 정확성 검증은 아니다.
- 앱·서버·DB·실제 생체 기록은 실행하거나 열람하지 않았다. 코드 테스트·실장치 테스트·다운로드 실행 결과를 주장하지 않는다.
