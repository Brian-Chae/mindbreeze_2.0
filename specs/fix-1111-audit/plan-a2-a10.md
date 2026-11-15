# plan A2·A10 (워커 2)
## A2 원인
웹 생산 경로(feature-v1 파일 행)는 `feature_hash`를 넣지 않는다. 정산 `plan_participant`가 `r["feature_hash"]`를 직접 읽어 KeyError(운영 79회).
수정: `row_feature_hash()` — 있으면 원본, 없으면 정규화 JSON sha256 계산(has_original=False). 해시 없는 행은 DB 해시 비교 없이 키 멱등(already_in_db)으로만 처리, `missing_hash_rows`로 집계. 파일 내 해시 충돌 판정은 원본 해시가 있는 행만.
## A10 수정
1. 측정 유효 분 < 10(58창 등) → 착용이어도 전 지표 `poor_signal` 결측 + band_status=not_worn 축약판.
2. RMSSD 0 이하 값은 결측, RMSSD가 전부 0이면 RMSSD·SDNN·LF/HF 전체 결측(`person_minutes_from_windows`).
3. 히어로 전후 쌍은 구간 값 없으면 `compute_change`가 None → 기존 규칙 유지(테스트로 확인). clock_reset 공백 분은 결측, 보간·0 채움 없음(테스트).
