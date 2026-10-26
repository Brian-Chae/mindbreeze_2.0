# FIX — SDNN 과대 · 심박변이 차트 평탄화 — summary

## 원인
- `frontend/src/lib/eeg/PPGSignalProcessor.ts:239`(수정 전) · `packages/measurement-core/src/dsp/ppg.rs` `analyze`: RR 피크를 밴드패스 전 **원시 IR**에서 검출 → 호흡·기저선 드리프트로 박동 누락(RR≈1780ms)·가짜 피크(RR 300~540ms) 혼입 → SDNN 3배+ 과대.
- 하루명상 SDD-052(bbe8e44)의 필터드 IR 검출 + 중앙값 ±25% RR 필터가 MB(웹 TS·Rust)에 미반영. (슬라이딩 윈도우 중복 누적은 MB SDD-244 T10 시각 커서로 이미 해결.)
- `NarrativeSections.tsx` BODY_SCALE hrv=[0,200] 고정 + clamp → 200 초과 값이 상단에 붙어 직선.

## 수정
- TS: 피크 검출 입력을 필터드 IR로 교체(`PPGSignalProcessor.ts`), `AnalysisMetricsService.updateRRIntervalBuffer`에 중앙값 ±25% 필터(버퍼<5면 윈도우 자체 기준, 버퍼 5개 도달 시 소급 정리). 제외된 박동도 시각 커서는 전진(재유입 방지).
- Rust: `ppg.rs`(필터드 IR 피크), `hrv.rs`(동일 필터) — TS 와 패리티.
- 차트: `resolveBodyScale` — 범위 밖 값이면 표시 범위를 실제 min/max까지 확장(몸 지표 3개 공통), clamp 제거.
- 골든: `gen_gf04.py` 에 동일 규칙 반영 후 gf04 cases·ppg_degenerate·oracle(biquad/legacy_fallback) 기대값 재생성. 변경 근거: 의도된 동작 변경(RR 경계 케이스 200/2000ms 단독 이상치가 중앙값 필터에 제외, noise RR 열 변화).

## 검증(합성 PPG, 참 SDNN 42.8ms, 드리프트+호흡 포함)
| | SDNN | 비정상 RR(<500/>1300) |
|---|---|---|
| 수정 전 | 333.6ms | 18/63 |
| 수정 후 | 41.8ms | 0/37 |

- vitest 전체: 17 fail/8파일 = 기준선과 동일, 신규 실패 0. tsc -b 통과.
- cargo test(measurement-core) 전부 통과(골든 오라클 패리티 포함).
- ⚠️ `./gradlew testDevDebugUnitTest` 미실행: 워크트리에 cap sync 산출물(`capacitor-cordova-android-plugins/cordova.variables.gradle`)이 없어 구성 단계 실패(변경과 무관). Rust 코어 변경의 Android 반영 확인은 sync 가능한 환경에서 필요.

## 영향·남은 위험
- 이미 저장된 리포트(과대 SDNN, 예: 세션 feb073e9)는 재계산하지 않음 — 과거 HRV 값은 과대 그대로, 신규 측정부터 정상화.
- 중앙값 ±25% 필터는 실제 큰 부정맥·급격한 심박 변화 구간의 RR 을 제외할 수 있음(하루명상과 동일 정책).
- 실기기 PPG 로 정상 범위(30~100ms) 확인은 별도 필요.
