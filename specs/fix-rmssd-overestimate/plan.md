# [FIX] 서비스 RMSSD 과대 산출 — 원인 분석·수정안 (코드 수정 없음, 대표 승인 대기)

- 작성: 2026-11-12 / 브랜치 `fix/rmssd-overestimate-audit` (base develop `b5c417c7`) / 문서만, 푸시 없음
- 결론 한 줄: **서비스는 PPG 박동 시각이 흔들린 채(단방향 IIR 필터 위상 왜곡 + 창 끝 불완전 박동) RR을 만들고, 그 흔들림이 그대로 RMSSD로 읽힌다. 서비스 값(117ms)은 박동 간 지터가 지배하는 값이라 생리적으로 과대이고, 원시 재계산(≈37ms)이 타당하다.** SDNN(79→52ms)·pNN50(63→13%)도 같은 방향으로 과대. 심박(HR)은 영향 없음.

## 1. 배경

내부 검토(`internal-indiv/`)에서 운영 `eeg_feature_windows` RMSSD 중앙값이 원시 PPG 재계산의 약 3.15배(n=46, 117 vs 35ms, ρ=0.56). 심박은 일치(중앙 절대차 1.2회/분).

## 2. 산출 경로 (path:line, develop `b5c417c7` 기준)

| 단계 | 위치 | 내용 |
|---|---|---|
| 버퍼 | `frontend/src/lib/eeg/StreamProcessor.ts:119` | `PPGCircularBuffer(10, 50)` = 10초·500샘플(주석의 "32초·1600"은 틀림). 패킷마다 전체 버퍼를 재처리 (`:379-383`) |
| 앞뒤 2초 트림 | `PPGSignalProcessor.ts:189-198` | 500샘플 이상이면 양끝 100샘플씩 제거 → 실질 분석창 6초 |
| 필터 | `PPGSignalProcessor.ts:319-338` | DC 제거 후 `makeBandpassFilter(1.0, 5.0)` 를 **한 방향(causal)으로 한 번만** 적용 (`applyFilter` 순방향). 군지연이 주파수에 따라 달라 박동 파형·피크 위치가 이동 |
| 피크 | `PPGSignalProcessor.ts:1290-1298`, `:967-1013` | 필터드 IR(`:239`, 10/27 `7297324e` 이후) 평균 제거 → 300ms 불응기 + 최근 8피크 진폭 평균×0.5 적응 임계. **포물선 보간 없음 — 정수 샘플(20ms) 격자** |
| RR | `PPGSignalProcessor.ts:240-247` | `(peaks[i]-peaks[i-1])*20ms`, 200~2000ms 범위만 통과. 닫는 피크 시각을 함께 기록 |
| 중첩 창 중복 제거 | `AnalysisMetricsService.ts:372-399, 400-445` | 이미 받은 시각 이하 박동은 버림(= **처음 검출된 시각이 확정, 이후 더 정확한 재검출은 버려짐**). 버퍼 중앙값 ±25% 게이트(`:411-418`), SDD-316 재시드 |
| 지표 | `AnalysisMetricsService.ts:606-690` | 최근 60 RR, ≥30초분, `RMSSD=√mean(ΔRR²)` (공식 자체는 정상) |
| 저장 | `StreamProcessor.ts:789` → `feature-record.ts:15` → `backend/app/models/eeg_feature.py:103` | `rmssd/sdnn/lf_power/hf_power/lf_hf_ratio` 만 저장 (pNN50은 저장 안 됨) |
| Rust 코어 | `packages/measurement-core/src/dsp/ppg.rs:229-260, 375-396`, `dsp/hrv.rs` (time_domain) | TS와 동일 알고리즘의 포팅(필터드 IR·불응기 피크·RR·±25% 게이트). 단방향 필터·정수 샘플 격자·중첩 창 처리도 동일 |

공식 자체(ms 단위, √mean(ΔIBI²), 단위 혼동 없음)는 정상이다. 문제는 **RR(=피크 시각)의 정밀도**.

## 3. 재현 (워크트리 밖 `~/.hermes/cache/scratch/rmssd-audit/`)

방법: 참여자 53명(회차별 후반 구간)의 원시 PPG(50Hz)를 **서비스 코드 그대로**(`PPGSignalProcessor.processPPGData` → `AnalysisMetricsService.processPPGAnalysisMetrics`, esbuild 번들, `Date.now` 만 시뮬레이션 시각으로 대체) 500샘플 버퍼·1초 간격(및 0.5초 간격)으로 재생. 사람별 중앙값 → 전체 중앙값(n=50, 지표 산출 가능자).

| 단계(코드 상태) | RMSSD 중앙(ms) | SDNN | pNN50(%) | 서비스(DB)와 ρ | 재계산과 ρ |
|---|---|---|---|---|---|
| **현재 develop 코드** (필터드 IR + ±25% 게이트) | **117.2** | 77.5 | 63.6 | **0.994** (비 0.998) | 0.47 |
| 〃 0.5초 간격 재생 | 122.0 (n=26) | 78.4 | – | 0.97 | 0.54 |
| 참고) 10/27 이전: 원시 IR 피크 | 240.9 | 206.5 | 41.3 | 0.22 | 0.57 |
| 참고) 10/27 직후: 필터드 IR, 게이트 전 | 162.6 | 112.3 | 67.8 | 0.79 | 0.68 |
| 현재 코드 + 창 끝 1초 안 피크 제외(T) | 100.8 | 69.4 | 54.2 | 0.94 | 0.46 |
| 현재 코드 + 양방향(영위상에 근접) 필터(F) | 53.9 | 47.0 | 22.9 | 0.36 | 0.65 |
| **F + T** | **36.8** | **37.3** | **14.4** | 0.60 | **0.93** |
| (DB 저장값) | 117.9 | 79.3 | – | – | – |
| (원시 재계산, `data.csv`) | 36.7 | 51.9 | 12.9 | – | – |

- 서비스 DB 값(117.9)과 로컬 재생(117.2)이 순위 상관 0.994로 일치 → **운영 경로가 곧 이 알고리즘이며 재현 성공**(재현 환경 차이: 패킷 도착 간격이 실제 BLE와 다름 → 0.5초 간격에서도 같은 수준으로 확인).
- 갈라지는 지점: 필터 위상 왜곡(−63ms 방향)과 창 끝 박동(−17ms)이 주된 요인. **두 효과는 가산적이지 않고 상호작용**(F+T에서 재계산과 비 1.04, ρ 0.93).
- RR 이상값: 현재 코드 RR의 400ms 미만 비율 0% → 이중 피크(딕로틱 노치)는 이미 제거됨. 남은 문제는 이중 피크가 아니라 **지터**.
- 지터 지표: 서비스는 **RMSSD(117) > SDNN(79)** (비 1.5). 안정 상태 단기 기록에서 RMSSD/SDNN 은 보통 ≤1 (느린 변동 지배). 비가 1을 넘는 것은 박동마다 무작위로 어긋나는 측정 오차 지배의 특징. 재계산은 36.7/51.9 = 0.71로 정상 범위.
- 한계(정직하게): ECG 같은 기준 장치가 없어 "참값"이 아니라 **동일 PPG의 더 정밀한 재계산과의 비교**다. 창 끝 효과의 메커니즘(처음 검출 시각 고정)은 코드 구조와 절제 실험(T)으로 확인했지만 개별 박동 추적까지는 하지 않았다. Rust 코어는 직접 실행하지 않았고(코드 동일성은 읽어서 확인) TS 하네스로 대표했다. LF/HF는 이번에 재현·검증하지 않음.

### 50Hz 양자화 영향 (수치)
박동 시각이 20ms 격자면 시각 오차 ~U(±10ms)(σ≈5.8ms). ΔRR = t_i − 2t_{i−1} + t_{i−2} 의 오차 σ ≈ √(6)×5.8 ≈ **14ms**. 진짜 RMSSD 35ms에 더하면 √(35²+14²)≈37.7ms로 **약 +2~3ms**. 실측: 재계산 박동 시각을 20ms 격자로 반올림하면 36.7 → 39.0ms. 즉 **양자화 자체는 주원인이 아니다**(117ms를 설명 못 함). 단 진짜 RMSSD가 10ms 이하인 사람에게는 하한 오차(≈14ms)가 의미가 있어, 낮은 값에서는 포물선 보간이 있는 편이 낫다.

## 4. 어느 값이 맞는가

- **재계산(≈37ms)이 타당.** 근거: (a) 64회/분대 안정 성인의 단기 RMSSD는 대체로 20~60ms 범위(중앙 ≈40ms 전후; Nunan 2010 등 — *문헌 수치는 기억 기반, 인용 전 원문 확인 필요*), 117ms 중앙은 이를 크게 벗어남. (b) 서비스 RMSSD>SDNN(비 1.5) 와 pNN50 63% (재계산 13%)는 지터 지배 신호. (c) 서비스 알고리즘에서 위상·창 끝 두 가지만 바꿔도 재계산에 수렴(비 1.04, ρ 0.93). (d) 심박은 양쪽 일치 → PPG 신호 자체는 정상.
- PPG(맥파) HRV 와 ECG HRV 차이: 맥파 도달 지연의 변동이 있어 안정 상태에서 RMSSD 가 약간(수 ms~10ms대) 높게 나오는 보고가 있으나, **3배**를 설명하지는 못한다.
- 서비스 값의 **상대 추이**(같은 사람 안에서의 변화)는 어느 정도 정보가 있으나(ρ 0.56 수준), **절대값·사람 간 비교·"정상 범위" 문구에는 부적합**.

## 5. 영향 범위

| 영역 | 위치 | 영향 |
|---|---|---|
| 저장값 | `eeg_feature_windows.rmssd / sdnn / lf_power / hf_power / lf_hf_ratio` (`models/eeg_feature.py:103`) | 과대(RMSSD 약 3배, SDNN 약 1.5배). LF/HF 는 미검증 |
| 롤업 | `services/eeg_rollup_service.py:61-67` (`*_mean`) | 위 값 평균 → 동일 과대 |
| 리포트 타임라인 | `tasks/report_task.py:340`(rmssd), `sdnn` | 상담사·회원 리포트 추이 그래프 |
| 리포트 문구 | `services/report_narrative.py:8`, `report_pdf_narrative.py:149,160`, `lib/report/resolve-narrative.ts:168`, `ui-v2/ui-v2-report-v3-logic.ts:54` | "심박변이"는 **SDNN** 기반(변화량 ±5ms 임계) → SDNN 과대는 절대 수치, 변화량 문구 모두 영향 가능 |
| 실시간 화면 | `class/player/host/host-live-model.ts:60`(SDNN), `MemberClassContainer`, `SessionParticipant*` | 표시값 과대 |
| 데이터센터/내보내기 | `services/data_center_measurement.py:36-39`, `data_center_export.py`, `research_export_service.py` | 외부 제공 CSV/연구 내보내기의 RMSSD·SDNN |
| **영향 없음(확인)** | 이완도·감정안정도·집중도 | EEG 지표(`stress_index = (β+γ)/(α+θ)`, `EEGSignalProcessor.ts:401`)에서 산출. HRV 입력 아님(`eeg_metrics.py` 에 rmssd/sdnn 참조 없음) |
| 별도 | PPG 기반 `ppg.advancedHRV.stressIndex` (`AnalysisMetricsService.ts:626-709`, RMSSD·SDNN 입력) | 과대 입력 → 스트레스 지수 낮게(안정 쪽) 산출. `features` 로만 기록, 이완도 등에는 미반영 |
| 그룹 분석 PDF | `~/.hermes/share/daegu-group-1112/`의 4종(몸돌봄 2회차·마음돌봄·몸돌봄 1·2회차 비교·몸/마음 방식 비교)  — 소스 `body2/build.py:14`, `mind/build.py:14`, `body-vs-mind/gen.py:5`, `body12/data.json` | RMSSD(심박변이) 콜아웃·LF/HF 표에 서비스 값 사용. 브리프의 "7종" 중 공유 폴더에서 확인된 것은 4종 — 나머지 3종은 위치 미확인 |
| 영향 없음 | 심박(HR), 호흡수 | 일치 확인(HR). 호흡수는 이번 범위 아님 |

## 6. 수정안

### 6.1 최소 변경안 (우선순위 순)
1. **양방향(영위상) 필터로 RR 검출 입력만 교체** — `PPGSignalProcessor.ts:319-338` 의 필터를 정방향+역방향 2회 적용(창이 6~10초로 짧으므로 가장자리 패딩 필요). 이 변경 하나가 117→54ms. TS·Rust(`dsp/biquad.rs`) 양쪽 동시 반영(웹·Native 정합, golden oracle 갱신).
2. **창 끝 피크 보류** — 닫는 피크가 분석창 끝 ~1초 이내면 이번 창에선 RR로 확정하지 않고 다음 창에서 확정(`:240-247` 에서 제외하면 중첩 창 중복 제거가 자연히 이어받음). F와 합쳐 36.8ms.
3. **포물선 보간으로 피크 시각 정밀화**(`detectPeaksWithRefractory` 후처리, 소수 샘플 시각을 RR에 반영): 양자화 오차 ±14ms 제거. 낮은 RMSSD 구간에서 의미.
4. (선택) 서비스 정합 확인용으로 RMSSD>SDNN×1.2 같은 **지터 경보**를 품질 플래그로 기록.

변경 범위: `PPGSignalProcessor.ts`(필터·RR 추출) + Rust `ppg.rs/biquad.rs` + golden 픽스처. `AnalysisMetricsService`(게이트·식)는 변경 불필요.

### 6.2 테스트안 (상세는 verify.md)
- 로컬 하네스(원시 PPG 53명)로 수정 전/후 비교: RMSSD 중앙 → 35~40ms, 재계산과 ρ ≥ 0.9, HR 중앙 차 ≤ 1.5회/분 유지, SDNN/RMSSD 비 ≤ 1.
- 합성 신호: 알려진 RMSSD(예: 정현파 변조로 20/40/80ms)를 주입한 PPG 로 편향 ±5ms 이내 확인.
- Rust/TS golden 일치(수치 오차 허용 내), 기존 `sdd244-*`, `sdd314_hrv_gates`, `sdd316_not_worn` 무회귀.

### 6.3 과거 데이터 처리 선택지 (결정: 대표)
| 선택지 | 내용 | 장점 | 단점 |
|---|---|---|---|
| A. 재계산 | v2 원시(S3 `biosignal-raw/…/ppg/`)가 있는 세션에 한해 수정 알고리즘으로 `rmssd/sdnn` 재산출 → 서비스 DB 갱신(운영 쓰기, 별도 승인) 또는 파생 테이블 | 수치 정합, 이미 발송한 리포트와 대조 가능 | 쓰기 승인·검증 필요. 원시 없는 세션은 불가. 기발송 리포트·PDF는 별도 정정 |
| B. 표기만 변경 | 화면·리포트에서 절대 수치 숨기고 변화 방향(서사)만 표기, 기존 데이터 유지 | 즉시 가능, 위험 낮음 | 저장값은 계속 과대. 내보내기 CSV에는 남음 |
| C. 그대로 | 신규 데이터부터 새 알고리즘, 과거는 `algorithm_version` 으로 구분 표기 | 가장 단순 | 과거-신규 혼용 비교 불가 |
| 권장 조합(참고) | 신규=수정 알고리즘 + 버전 필드, 그룹 분석 PDF 4종 수치는 재계산값으로 별도 정정, 과거 DB는 A(원시 있는 세션)·B 병행 | | |

결정 필요 항목: (1) 알고리즘 수정 승인, (2) 과거 데이터 A/B/C, (3) 이미 외부에 나간 그룹 분석 PDF의 RMSSD 정정 여부.

## 7. 재현 자료 (워크트리 밖)
`~/.hermes/cache/scratch/rmssd-audit/`: `harness.ts`(서비스 코드 재생기), `harness{A,C,T,F,FT}.ts`·`var/*.ts`(변형), `cmp3.py`(비교), `rrfilter.py`(RR 게이트·양자화). 원시 PPG 입력(`in_*.json`, `ppg_*.npy`)은 익명 ID만 사용하며 share로 복사하지 않음.
