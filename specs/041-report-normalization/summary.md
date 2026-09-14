# SDD-041 구현 요약

## 구현

- `backend/app/services/normalization_score.py`: 프론트 `eegSigmoidScore.ts`의 11종 raw 변환, 방향형 sigmoid, FAA 편차형 및 JavaScript 반올림 이식.
- `compute_session_metrics`: 반올림 전 세션 평균/중앙값으로 표준 모델 점수 산출, 지표별 params 누락/무효 시 기존 코호트 계산 유지.
- 품질 게이트, null, 기존 가중치 및 raw feature 저장을 보존.
- 리포트 content.eeg의 `normalization_source` 및 `normalization_version` 보존.

## 계약 상세

- 표준 모델 적용 대상은 기존 리포트 7지표이며 모듈 자체는 11종 지표를 지원한다.
- focusIndex, cognitiveLoad, relaxationIndex, totalNeuralActivity, faa는 평균, stressIndex와 emotionalStability는 중앙값을 사용한다.
- 기존 `focus_index_stability_score`와 `cognitive_load_stability_score`는 표준 모델 적용 시 해당 raw 평균의 sigmoid 점수다. 코호트 fallback은 기존 SD 기반 계산이며 연속 구간 품질 게이트는 양쪽 모두 유지한다.
- 실제 한 개 이상 점수에 표준 모델을 적용하면 source=`standard_model`, version=모델 버전 문자열이다. 일부 지표 fallback이 함께 존재할 수 있다.
- 적용된 표준 점수가 없으면 source=`cohort`, version=기존 상수 버전이다. 미측정은 기존 `{status: not_measured}` 최소 계약을 유지한다.
- 표준 모델의 params.s는 이미 계산된 sigma이므로 MAD_TO_SIGMA를 다시 곱하지 않는다.

## 현재 검증

- 프론트 원본을 임시 디렉토리에서 TypeScript 컴파일 후 Node로 실행하고 Python과 직접 비교: 231/231 입력 일치.
- 신규 순수 계산 테스트 35 passed.
- 기존 전체 회귀: 350 passed, 1 skipped. 기존 deprecation 및 미대기 coroutine 경고 확인.
- 활성 모델 DB 연결 및 최종 전체 테스트는 진행 중.

## 확인 중인 사항

브리프의 async session 지시와 달리 현재 core/database.py, 리포트 생성, 표준 모델 API는 모두 동기 SQLAlchemy Session이다. 기존 동기 세션 재사용 승인을 코디네이터에게 요청했으며 답변 대기 중이다.
