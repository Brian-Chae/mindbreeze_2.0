# verify A2·A10
- A2: feature_hash 없는 행 → KeyError 없음, missing_hash_rows 집계, 재정산 시 키 멱등 / 있는 행은 기존 동작.
- A10: RMSSD 전부 0 → rmssd·sdnn·lf_hf 결측, HR 유지 / 일부 0만 → 그 창만 제외 / 공백 분 0 보간 없음 / 구간 값 없으면 compute_change None / 58창 회원 → poor_signal·not_worn 축약.
