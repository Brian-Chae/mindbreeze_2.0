# [SDD-114] — Summary

## 구현 결과

| 항목 | 변경 |
|---|---|
| 시간축 | `_build_eeg_content` timeline `t`를 `window_index`(≈10Hz 카운터) → `device_timestamp_ms` 상대 초로 교체. null이면 `t=None`(프론트 결측 스킵) |
| 감정안정도 | timeline에 `emotional_stability`(0-100 정규화) 추가. 프론트 `100 - stress` 역산 프록시 제거 |
| 정규화 | `eeg_metrics.py`에 `normalize_focus/relaxation/stress/emotional_stability` 추가 (기존 `score_*` + 코호트 상수 재사용). 프론트 `toDisplayScale` 반쪽 정규화 제거 |

## 검증

- `pytest -k report`: **138 passed / 10 skipped**
- `pytest tests/test_sdd088_open_flow.py`: **17 passed** (시간축 `t == [0.0..4.0]` 상대 초 검증)
- `npx tsc -b --noEmit`: **0 errors**
- `npm run build`: **성공**
- 런타임(세션 `05fbf8f7`): 시간축 최대 **186.5s = 3.11분** (기존 30.2분), 마음 지표 4종 모두 **0-100** 정규화 확인
  - 집중도 0.65~86.2 → 0~100 / 이완도 0.008~0.457 → 0~100 / 스트레스 0.71~4853 → 0~97 / 감정안정도 0.0002~24.8 → 0~100

## 디버깅

- `test_sdd088` 픽스처가 `device_timestamp_ms`를 설정하지 않아 `t=None` → 테스트 갱신(`device_timestamp_ms=1000+i*1000` 주입).

## 커밋

- `373968f5` feat(sdd-114): 리포트 타임라인 데이터 정합 — 시간축 device_timestamp_ms·감정안정도 실제값·마음지표 0-100 정규화
