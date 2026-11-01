# SDD-267 — 종료 후 최종 확인 대기 보조 표기(final 미수신 완화)

- 상태: Stage ① Spec
- 브랜치: `sdd/267-final-pending-label`
- 작성일: 2026-11-01
- 근거: SDD-266 impl-notes §4 완화안 1번, 대표 결정(11/1)

## 1. 문제
폰이 기대량 `final=true` 를 서버에 못 보내면(앱 강제종료·네트워크 단절 등 SDD-266 이후 잔여 경로) 서버는 모두 받았어도 영원히 `in_progress`(전송 % 99% 상한)에 머문다. 코치는 "아직 오는 중인지, 폰 확인만 남았는지" 구분할 수 없다.

## 2. 결정(D1~D4)
- D1. **판정은 바꾸지 않는다.** `progress.state`(`all_received` 포함)·percent·`status` 는 불변. 보조 불리언 `final_pending` 만 가산한다. 점수·보증·"완료" 단정 없음.
- D2. 참여자별 `progress.final_pending = true` 조건(전부 AND):
  1. 회차 `completed` 이고 `ended_at` 이 있으며 종료 후 `FINAL_PENDING_AFTER_END_SEC`(=180초, N=3분) 이상 경과
  2. 기대량이 전 구성요소(feature + eeg/ppg/acc) 보고됨, 각각 `received >= expected`
  3. 마지막 수신 후 `STALL_SEC`(=120초) 이상 변화 없음(없으면 `first_reported_at` 기준, 기존 `_stalled` 재사용)
  4. `final=false`
  - 수집 제외(`not_collected`)·기대량 미보고·`raw_failed>0` 은 해당 없음. 30분 유예가 지나 `expected_unknown` 으로 바뀐 경우에도 1~4 를 만족하면 표기한다(원인이 바로 그 상황).
- D3. 회차 합계 `progress.participants.final_pending`(인원 수) 가산 — 상세·목록(items[]·최상위)이 같은 `aggregate()/merge()` 를 쓴다. 회원 목록 항목에 `final_pending` 불리언 가산. `counted` 등 기존 인원 수 의미 불변(final_pending 은 다른 state 와 겹치는 부분집합).
- D4. ETag: 상세는 기존 30초 버킷 규칙 + 종료 후 N분 경과 불리언 추가. 목록은 payload 해시라 자동 반영.

## 3. 범위 밖
알림·메일 발송, 상태 승격(옵션 2), 폰 앱 변경, 서버 `final` 자동 확정. 계약 변경은 가산만(SDD-264/265 필드 이름·의미 불변).

## 4. 완료 기준
verify.md V-P01~ 전부 통과, SDD-261~266 BE 회귀 0.
