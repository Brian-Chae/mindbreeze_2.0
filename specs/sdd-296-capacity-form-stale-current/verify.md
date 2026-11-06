# SDD-296 verify (구현 전)

| # | 시나리오 | 기대 |
|---|---|---|
| V1 | current=10, 20 입력·제출 성공, 부모가 current=20 으로 rerender | 오류 알림 없음, 성공 안내 표시, 입력값 21 |
| V2 | V1 직후 30 입력·제출 | 호출 성공(capacity=30), 오류 없음 |
| V3 | 외부에서 current 가 10→20 으로 바뀜(다른 기기 등) | 입력값이 21 로 재동기화, 오류 없음 |
| V4 | 사용자가 편집 중(예: 35 입력)에 current 변경 없음 | 입력 보존 |
| V5 | current=10 에서 10 입력 | 제출 불가, 문구에 "같은 값은 변경 없음" 포함 |
| V6 | HostSettingsSheet: capacity=10, joined=1 | '현재 정원 10명', '현재 입장 1명', 폼 current=10 |
| V7 | 기존 capacity-increase*.test, sdd289* 시험 전부 통과 | 유지 |
| V8 | tsc -b | 0 오류 |
