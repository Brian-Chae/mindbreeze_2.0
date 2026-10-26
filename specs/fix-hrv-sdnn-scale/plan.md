# FIX — SDNN 과대(3배) 및 심박변이 리포트 차트 평탄화 — plan

## 증상
- 리포트 심박변이 그래프가 평평한 직선(상단 고정). dev 리포트 SDNN 중앙값 ~300ms(정상 안정시 30~100ms).
- 차트 BODY_SCALE hrv=[0,200] 고정 + clamp → 200 초과 값이 전부 상단에 붙음.

## 원인 분석
1. `frontend/src/lib/eeg/PPGSignalProcessor.ts:239` — HRV용 RR 피크를 `detectPeaksForHRV(irData)`(밴드패스 전 원시 IR, DC 제거만)에서 검출.
   호흡·기저선 드리프트(<1Hz)가 남아 있어 (a) 박동 누락 → RR≈2배(1760~1800ms), (b) 가짜 피크 → RR 300~540ms 가 섞임. 이상치가 SDNN 을 3~10배 부풀림.
   합성 신호(60~72bpm, 드리프트+호흡 성분) 재현: RR 버퍼에 1780ms 6건, 300~560ms 15건, SDNN 312ms.
2. 하루명상 SDD-052(haru_band_app bbe8e44)는 피크를 필터드 IR 로 교체하고 RR 이상치(중앙값 ±25%)를 제외했는데 MB 는 미반영.
   (슬라이딩 윈도우 RR 중복 누적 문제는 MB 가 SDD-244 T10 의 박동 시각 커서로 이미 해결.)
3. Rust 코어 `packages/measurement-core/src/dsp/ppg.rs:analyze` 도 `ir`(원시) 로 `peaks_refractory` — TS 와 동일 결함(패리티 유지 위해 같이 수정).
4. 차트: `frontend/src/components/reports/NarrativeSections.tsx` BODY_SCALE 고정 + clamp.

## 수정
- TS/Rust: RR 피크 검출 입력을 필터드 IR(1~5Hz 밴드패스)로 교체. 피크 시각(rr_end_ts)은 같은 인덱스의 샘플 시각.
- TS/Rust: RR 버퍼 적재 전 아티팩트 제거(버퍼 중앙값 ±25%, 버퍼 ≥5 일 때) — 하루명상 filterArtifactRr 동일.
- 차트: 고정 스케일 밖 값이 오면 clamp 하지 않고 표시 범위를 실제 min/max 까지 확장(몸 지표 3개 공통).
- 이미 저장된 리포트는 재계산하지 않는다(영향만 summary 기록).

## Task
1. RED: 합성 PPG(알려진 RR 열) → SDNN 검증 테스트, 차트 스케일 테스트.
2. GREEN: TS 수정 → Rust 수정 → 차트 수정.
3. 패리티/골든 확인(cargo test, vitest 전체 기준선 17 fail/8파일).
4. summary.md.
