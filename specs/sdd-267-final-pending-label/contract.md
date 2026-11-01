# SDD-267 — API 계약 (BE, FE 정본)

가산만. SDD-264/265 기존 필드 이름·의미·권한·정렬 불변. 판정(`state`)은 바뀌지 않으며 점수·보증 값은 없다.

## 1. 가산 필드
| 위치 | 필드 | 타입 | 의미 |
|---|---|---|---|
| 상세 `participants[].progress` | `final_pending` | bool(항상 존재) | 아래 §2 조건 충족 |
| 상세·목록 `progress.participants` (회차 합계, 목록 최상위 포함) | `final_pending` | int(항상 존재) | 해당 참여자 수. 다른 state 와 겹치는 부분집합(`counted` 합 불변식에 포함 안 됨) |
| 목록 `items[].progress.participants` | `final_pending` | int | 회차별 |
| 회원 `GET /upload-status/me/sessions` `items[]` | `final_pending` | bool | 본인 |

## 2. 조건(전부 AND, 서버 계산)
1. 회차 `completed`, `ended_at` 존재, 종료 후 ≥ 180초(`FINAL_PENDING_AFTER_END_SEC`)
2. 기대량 4구성요소(feature, eeg, ppg, acc) 전부 보고됨, 각각 `received ≥ expected`
3. 마지막 수신 후 ≥ 120초(`STALL_SEC`; 수신 기록 없으면 `first_reported_at` 기준)
4. `final=false`
- 수집 제외·기대량 미보고·`raw_failed>0` 이면 false. 종료 30분 후 `state=expected_unknown` 이어도 1~4 충족 시 true.
- `state` 는 변경 없음: 보통 `in_progress`(또는 30분 후 `expected_unknown`). 전송 % 는 99% 상한 그대로.

## 3. FE 사용 규칙
- `final_pending=true` 참여자: "확인할 사람" 이 아니라 정상 접힘 그룹의 "최종 확인 대기". 회차 막대 옆 칩은 `progress.participants.final_pending > 0`.
- 회차 전원이 final_pending 이거나 나머지가 all_received/not_collected 일 때 안내 한 줄 노출은 FE 판단(`final_pending === counted − all_received − not_collected`).

## 4. 캐시·ETag
- 상세: ETag 지문에 "종료 후 180초 경과" 불리언 추가(기존 30초 버킷 유지). 목록·회원: payload 해시라 자동 반영.
- 목록 회차 캐시 TTL(종료 30분 내 10초) 만큼 경계 반영이 늦을 수 있다.
