# [SDD-124] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: 그룹 평균 이벤트 계약 — 6지표 절대 mean
1. 3명 이상 착용자가 각자 최근 윈도우를 가진 세션에서 `compute_group_average()` 호출.
2. payload의 `metrics`가 focus_index/relaxation_index/emotional_stability/heart_rate/respiratory_rate/sdnn 6키를 갖고 각 `mean`이 유한값인지 확인.
- **Expected:** 6지표 각각 `mean`이 null이 아닌 수치(원시 스케일: 마음 0~1, 몸 절대값).

### TS2: 표본 부족 게이트
1. 착용자 0~2명 세션에서 호출.
- **Expected:** `sample_status == "insufficient"`, `metrics`의 `mean`이 전부 null.

### TS3: 익명성 — 개인 식별자·점수 부재
1. payload 전체를 검사.
- **Expected:** participant_id/user_id/개인 점수/순위/display_name 필드가 존재하지 않는다. `wearer_count`·집계 평균만 존재.

### TS4: 브로드캐스트 룸 타깃
1. `broadcast_group_average()`가 emit하는 room 확인.
- **Expected:** `_room_all`(호스트+전체 참가자)로 emit. `_room_self`/개인 sid 단독이 아니다.

### TS5: 마음 지표 정규화 일치
1. 프론트 `normalizeGroupAverage`에 raw `relaxation_index: 0.31` 입력.
2. 자기값 `scoreIndices({relaxationIndex: 0.31})`와 동일한 결과인지 확인.
- **Expected:** 그룹 평균 표시값 == 동일 raw에 대한 자기 점수 정규화 결과(단일 함수 사용).

### TS6: 회원 뷰 2열 레이아웃
1. 밴드 연결 상태로 회원 클래스 진입.
2. 좌 30%(시그널·상담사 영상·함께한 시간) / 우 70%(지표 상단 + 디바이스·raw 하단 3:2) 렌더 확인.
- **Expected:** 2열 그리드, MIND 3+BODY 3 2행, 하단 raw 3파형, 가로 오버플로 없음.

### TS7: raw 파형 실시간 렌더
1. 밴드 연결(또는 mock) 후 EEG/PPG/ACC 파형이 갱신되는지 확인.
- **Expected:** 3개 캔버스가 rAF로 갱신되고 React 리렌더 0(supplier 패턴).

### TS8: 그룹 평균 표본 부족 UI
1. 착용자 2명 이하 → 그룹 평균 마커 확인.
- **Expected:** 다이얼에 "표본 부족" 흐림 표시, 내 값은 정상 표시.

## Edge Cases
- [ ] 착용자 0명 → "표본 없음", raw 파형 빈 캔버스(크래시 없음).
- [ ] 밴드 미연결 → 디바이스 스트립 "미연결" + 연결 버튼, raw 캔버스 비활성.
- [ ] LeadOff(접촉 불량) → 지표·그룹 평균 null 처리, 디바이스 스트립에 접촉 경고.
- [ ] 그룹 평균 이벤트 지연/유실 → 마지막 수신값 유지(폴링 폴백 없음, 다음 이벤트로 복구).
- [ ] 모바일(≤640px) → raw 3파형 단일 컬럼 스택, 지표 2행 유지.
- [ ] 몸 지표 BPM/호흡/HRV null(산출 불가) → 그룹 평균·내 값 모두 "—" 유지(0 치환 금지).

## Security Review
- [ ] 그룹 평균 payload에 개인 식별자/개인 점수/순위 미포함(TS3).
- [ ] MIN_WEARERS(3) 미만이면 평균 산출 금지 — 소수 표본의 평균으로 개인값 역산 방지.
- [ ] 원시 raw 파형은 로컬 BLE 스트림만 표시(타 참가자 raw 미노출 — 기존 호스트룸 브로드캐스트 경계 유지).
- [ ] 신규 이벤트 구독은 기존 `/session-live` 인증(토큰/게스트 skipAuth) 경계 내에서만 동작.
