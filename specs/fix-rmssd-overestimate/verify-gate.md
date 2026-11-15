# verify-gate — 재산출 도구 착용·맥박 게이트 (구현 전 작성, 11/16)

## Rust (`cargo test --example recompute_ppg_hrv`)
- V1 착용 맥박(DC 142만, 교류 80, 72bpm 합성) → 충분한 시간 후 RMSSD 값 출력.
- V2 책상 잡음(DC 30만~90만, 교류 1~3, 맥박 없음) → 모든 틱 빈 값.
- V3 미착용(DC 6천) → 모든 틱 빈 값, 링·HRV 리셋.
- V4 전환(착용 → 미착용 → 착용) → 미착용 구간 빈 값, 복귀 후 링 재충전 뒤 값 재개.
- V5 맥박 품질 판정 단위: 교류 SD 5.9 → 탈락 / 6.0 → 통과, 유효 RR 비율 49% → 탈락 / 50% → 통과.
- V6 착용 상태머신이 라이브 `WearState`와 같은 상수·같은 전환점(150샘플 유지).

## Python (`backend/tests/test_fix_hrv_recompute.py` 추가)
- V7 게이트 통과 틱 비율 < 10% 참가자 → plan None 아닌 빈 계획, `participants_gated_out` +1, 윈도우 미변경.
- V8 새 값 null 창은 기존 값 유지(현행) — 회귀 확인.
- V9 `Stats.report()`에 `participants_gated_out` 포함.
- V10 엔진 틱에 `gated`(맥박 게이트 통과 여부)가 없으면 값 존재 여부로 판단 — 호환.

## 회귀
- 기존 `cargo test` 전부(골든·패리티), 기존 `test_fix_hrv_recompute.py` 전부.
