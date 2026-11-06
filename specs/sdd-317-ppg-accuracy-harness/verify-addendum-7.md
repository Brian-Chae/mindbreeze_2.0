# SDD-317 verify addendum 7 (baseline-c0.md 최종 산출 전 고정)

공개 사실: dev 시험 실행(run1)의 BIDMC 박동 F1 하위 기록을 본 뒤 작성한다(선택 편향 가능성 공개). 게이트는 **ECG 검출기 출력과 데이터셋 제공 모니터 HR(Numerics, ECG 유래)** 만 쓰고 코어 출력은 쓰지 않는다. 전 기록 행은 항상 유지한다.

## A7-1. BIDMC ECG 참 박동 신뢰 게이트
- `HR_det = 60·(검출 R 개수)/기록길이(s)`, `HR_mon = 해당 기록 Numerics.csv 의 HR 열 중앙값`.
- `|HR_det − HR_mon| / HR_mon ≤ 0.10` 이면 `ecg_truth_reliable=true`, 아니면 false(ECG 검출기가 R 을 놓쳤거나 과검출).
- false 기록은 박동 F1·PPI·HR·SDNN·RMSSD 의 "신뢰 기록만" 행에서 제외, 전 기록 행에는 포함. 호흡 층은 영향 없음.
- MIMIC PERform 은 Numerics 가 없어 이 게이트를 적용하지 못한다 → 전 기록만 보고하고 한계로 명시.

## A7-2. 해석 규칙
- 신뢰 게이트를 통과했는데 박동 F1 이 낮은 기록(예: ECG=모니터 HR 인데 PPG 독립 피크가 절반)은 **코어·PPG 형태 문제 후보**로 목록화하되 원인 확정은 하지 않는다("확인 못 함").
