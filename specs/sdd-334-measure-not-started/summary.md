# SDD-334 Summary

## 구현
- 서버: `get_live_metrics` 행에 `measure_not_started`(bool)·`measure_not_started_since` 추가. 순수 함수 `compute_measure_not_started`, 상수 90초. 기존 테이블만 사용(마이그레이션 0), 필드 추가만.
- 판정: 회차 in_progress · 입장함 · max(입장, 회차 시작) + 90초 초과 · feature·raw 청크 모두 0건 · `eeg_collection_consented is not False`. 데이터가 들어오면 즉시 해제, 측정 중 끊김은 기존 "연결 끊김".
- 코치 웹: "이상 M명" 포함, 카드 "측정 시작 안 됨 · N분째" + "앱에서 밴드 다시 연결을 눌러 주세요". 실시간 지표(last_eeg_at) 수신 시 서버 폴링 전에도 즉시 해제. 점수·등급 없음.
- 포함 문서: `docs/ppg-clock-reset-1123/`(PPG 시각 역행·P05 측정 미시작 원인 조사, 브랜치 docs/ppg-clock-reset-rca 커밋 5214ce62 내용).

## 테스트
- 백엔드 `backend/tests/test_measure_not_started.py`(경계 89/90/91초, 해제, 미착용 제외, 끊김 구분, 입장 전·비진행 제외, REST 필드) — 로컬 Python 환경 없음 → CI.
- 프런트 `frontend/tests/sdd334-measure-not-started.test.ts` 7건 + 기존 호스트 모델 테스트 통과, tsc 0 오류.

## 남은 것
운영 배포는 대표 확인 후 감독이 진행.
