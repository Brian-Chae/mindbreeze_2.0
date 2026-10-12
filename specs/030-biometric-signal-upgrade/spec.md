# SDD-030 — 생체신호 처리 고도화 (신호처리 로직 개발 · 클라이언트 처리)

> haru_band_app 정밀 분석 기반. mindbreeze 2.0의 생체신호(EEG·PPG·ACC) 처리·전달·리포트를
> haru_band_app 수준(가장 최신·완성도 높음)으로 끌어올린다.
> **신호처리(지표 계산)는 클라이언트(웹/웹뷰 JS)에서 처리한다.** (haru_band_app simulator 모드와 동일)
> 본 SDD는 신호처리 로직(호흡수 등) 개발에 해당. FeatureWorker 서버는 후순위(SDD-031).
> 전체 로드맵은 `roadmap.md` 참고.

## 1. 배경·목표

mindbreeze 2.0은 LINK BAND에서 EEG(뇌파)·PPG(맥파)·ACC(가속도)를 수신하지만, 처리 시스템이
haru_band_app 대비 부실하고 지표 정확도·내용이 떨어진다. 목표는:

1. **몸 지표** — BPM(심박수), HRV(심박변이도), 호흡수(respiratory rate)를 실시간 산출
2. **마음 지표** — 집중도, 이완도, 스트레스 (기존 EEG 지표) 고도화
3. **실시간 전달** — 사용자(내담자)와 상담사 화면에 몸·마음 지표를 실시간 표시
4. **리포트 상세화** — 세션 리포트에 몸·마음 지표를 더 상세히 담음

## 2. haru_band_app 분석 결과 (정밀)

### 2.1 신호 수신 (BLE)
- Web Bluetooth, namePrefix `LXB`, 서비스 UUID: EEG(df7b5d95)/PPG(1cc50ec0)/ACC(75c276c3)/Battery(180f)
- EEG: 250Hz Fp1/Fp2, 24bit signed → μV
- PPG: red/ir (맥파) / ACC: x/y/z (움직임)

### 2.2 몸 지표 (PPG·ACC 기반)
| 지표 | 계산 | 상태 |
|------|------|------|
| **BPM(심박수)** | IR 피크 검출 → RR interval → 가중평균 → 스무딩(40~200 검증, 10% 감쇠) | haru ✅ / MB ✅ |
| **HRV SDNN/RMSSD** | RR interval 시간영역 분석 (AnalysisMetricsService 3000개 버퍼) | haru ✅ / MB ✅ (P0 이식) |
| **HRV LF/HF** | PSD 주파수영역 (0.04~0.15 / 0.15~0.4Hz, ms² 변환, 무효값 이전값 유지) | haru ✅ / MB ✅ (P0 이식) |
| **호흡수(respiratory rate)** | — | haru ❌ / MB ❌(스텁 0) |

### 2.3 마음 지표 (EEG 기반)
| 지표 | 계산식 | 상태 |
|------|--------|------|
| 집중도(focus) | beta/(alpha+theta) | ✅ |
| 이완도(relaxation) | alpha/(alpha+beta) | ✅ |
| 스트레스(stress) | (beta+gamma)/(alpha+theta) | ✅ |
| + 인지부하/정서안정/총신경활동/FAA/반구균형 | metrics.py 7지표 | ✅ (SDD-022 포팅) |

### 2.4 정규화·품질
- 백분위 정규화 상수 `normalization_constants.json` (코드 하드코딩 없음, 버전 추적)
- 세션 품질 게이트: insufficient/invalid/degraded/valid (usable windows + reliability)
- null 보존 (0 치환 금지), 졸음 플래그(drowsiness_flag), 종합 점수(가중평균)

## 3. mindbreeze 2.0 현재 상태 + Gap

### 3.1 이미 보유 (haru와 정합)
- BLE UUID/패킷 파싱 (동일)
- BPM/HRV 계산 (프론트 AnalysisMetricsService)
- 마음 지표 7종 + 정규화 JSON + 품질 게이트 (metrics.py 포팅)
- EEGFeatureWindow에 HRV/움직임 저장 (SDD-036)

### 3.2 Gap (핵심 — 미구현/미전달)
| # | Gap | 심각도 | 비고 |
|---|-----|--------|------|
| G1 | **호흡수 미구현** | 🔴 높음 | 프론트 스텁(respiratoryRate=0). PPG RSA(호흡성 심박변동) 또는 ACC에서 추출 필요 |
| G2 | **몸 지표 실시간 미전달** | 🔴 높음 | BPM/HRV는 프론트 AnalysisMetricsService에서 계산되지만, 1초 feature 업로드(`metricsToFeature`)와 WS `/session-live` payload에 몸 지표가 포함되지 않아 실시간 전달이 안 됨(마음 지표 relaxation_index 등만 전달) |
| G3 | **리포트 몸 지표 부족** | 🟡 중간 | HRV/움직임 요약은 있으나 호흡수·BPM 추이·몸/마음 통합 시각화 부족 |
| G4 | 지표 정확도 검증 | 🟡 중간 | BPM/HRV가 실측 대비 검증되지 않음 |

## 4. 아키텍처 (목표 데이터 흐름)

```
LINK BAND (BLE)
  ├─ EEG 250Hz ──→ EEGSignalProcessor ──→ 마음 지표(집중/이완/스트레스 + 7지표)
  ├─ PPG ──→ PPGSignalProcessor ──→ BPM + HRV(SDNN/RMSSD/LF/HF) + 호흡수(신규)
  └─ ACC ──→ ACCSignalProcessor ──→ 움직임(motion)
         ↓
   AnalysisMetricsService (지표 통합·버퍼·품질)
         ↓
   1초 feature (몸+마음 통합) → WS /session-live emit
         ↓
   백엔드 저장(EEGFeatureWindow 확장) + broadcast
         ↓
   실시간: 사용자(GuestMeditationPanel) + 상담사(SessionLivePage)
   리포트: 몸·마음 통합 상세 리포트
```

## 5. 구현 계획 (Phase)

### Phase 1 — 호흡수 산출 (신규)
**알고리즘 (PPG RSA — 1순위, Respiratory Sinus Arrhythmia)**
1. PPG IR 신호 → 피크 검출 → RR interval 시계열 (BPM 계산에서 이미 산출)
2. RR interval 시계열을 4Hz로 재샘플링 (불규칙 간격 → 균일 간격)
3. 0.12~0.4Hz 대역통과 필터 (호흡 주파수 대역)
4. FFT → 지배 주파수 검출
5. 호흡수 = 지배 주파수 × 60 (breaths/min)

**품질 검증**
- 생리 범위 6~40 bpm 밖은 null 처리 (0 치환 금지 원칙 유지)
- ACC motion 높을 때 신뢰도 하락 → 품질 플래그(움직임 아티팩트 게이트)

**대안(ACC 기반)**: ACC z축 저주파(0.12~0.4Hz) 피크 검출 — 움직임에 취약해 보조로만 사용

### Phase 2 — 몸 지표 실시간 전달
**1초 feature 확장**: `heart_rate`, `respiratory_rate`, `sdnn`, `rmssd`, `lf_power`, `hf_power`, `lf_hf_ratio` (heart_rate/HRV는 이미 EegFeatureItem에 존재, respiratory_rate만 추가)

**WS payload**: `/session-live`의 `eeg_feature` 이벤트에 위 몸 지표 필드 추가 (현재 마음 지표만 전달됨)

**프론트 표시**
- 사용자(GuestMeditationPanel): 명상 화면 하단에 BPM·호흡수·HRV 몸 지표 패널
- 상담사(SessionLivePage): 테이블 컬럼에 BPM·호흡수 추가 (3초 평균·스로틀)

### Phase 3 — 리포트 상세화
**몸 지표 요약**: BPM 평균/최소/최대, 호흡수 평균, HRV(SDNN/RMSSD/LF/HF) 평균 + 추이 그래프
**통합 리포트**: 마음(집중/이완/스트레스 추이) + 몸(BPM/HRV/호흡수 추이) + 움직임
**시각화**: 몸 지표는 꺾은선 추이 + 세션 요약 카드(평균/최소/최대), 마음 지표는 기존 바차트/추이 유지
**스키마**: `ReportResponse`에 `respiratory_rate_mean` 등 추가

### 데이터 모델 변경
- `EEGFeatureWindow`: `respiratory_rate`(float nullable) 컬럼 추가 (heart_rate/HRV는 이미 있음)
- alembic 마이그레이션
- `schemas/eeg.py`: `HRVMotionSummary`에 `respiratory_rate` 추가

## 6. 리스크·고려사항
- 호흡수 정확도: PPG RSA는 움직임 아티팩트에 취약 → ACC motion과 결합한 품질 게이트 필요
- **개인차 보정**: BPM/HRV/호흡수는 개인 기저값 차이가 큼 → 세션 초기 기준값(베이스라인) 대비 상대 변화 또는 백분위 정규화 필요 (haru_band_app metrics.py의 백분위 정규화 패턴 재사용)
- 실시간 payload 크기: 몸 지표 추가로 1초 feature 크기 증가(경미)
- null 보존: 호흡수 계산 불가 시 null(0 치환 금지) 원칙 유지
- 기존 마음 지표·게이트·테스트 회귀 방지

## 7. 검증 기준
- 호흡수 산출: 생리 범위(6~40) + 정지/호흡 시 변화 관찰 + PPG RSA vs ACC 교차 검증
- 실시간: BPM/HRV/호흡수가 사용자·상담사 화면에 표시 (마음 지표와 동일 경로)
- 리포트: 몸·마음 지표 요약·추이(꺾은선 그래프) 포함
- 회귀: 기존 328 passed + 신규 테스트
