# SDD-317 verify addendum 3 (결과 산출 전 고정, verify.md 불변)

1. **PPG-DaLiA 박동 참값**: 데이터셋이 제공하는 `rpeaks`(ECG 기반, 700Hz 인덱스)를 그대로 쓴다. verify V4 의 "ECG 파형에서 검출"은 BIDMC·MIMIC 에만 적용(DaLiA 는 원자료 주석이 더 신뢰). DaLiA 호흡 층 없음.
2. **코어 박동 시각 복원 수정**: emission k 의 샘플 인덱스 = (k+1)·50−1 − round((window_end_ts_k − rr_end_ts)/20ms). (addendum-1 A3 의 ts0 방식은 5초마다의 slew 보정(±2ms)이 누적될 수 있어 emission 별 상대 계산으로 대체.)
3. **지연 추정**: 코어 피크마다 직전 R 과의 차(0~1.0초 이내)의 중앙값 = 기록 lag. 이후 코어 피크에서 lag 를 빼고 ±100ms 1:1 매칭.
4. **R-peak 검출기 평가**: MARSH dev 15명 수기 ECG 주석 대비 검출기 F1(±50ms)을 보고(참값 품질 지표). BIDMC·MIMIC 참값은 이 검출기 출력.
5. **HR 비교 대상**: 코어 `heart_rate`(EMA 평활·반올림된 표시값) vs ECG 30초 평균 HR. 코어 null 이면 분모 유지.
6. **SDNN/RMSSD 비교**: 참값 정의 가능 창 중 코어 값 있음 비율을 coverage 로 병기. 상대 편향 = (코어−참)/참.
7. **호흡 채점 시각**: T=L, L+10, … 이며 emission 인덱스 T−1 사용. 기록 길이가 T 에 못 미치면 제외.
