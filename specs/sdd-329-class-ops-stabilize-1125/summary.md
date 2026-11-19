# SDD-329 요약 — 수업 운영 안정화 (11/25 수업 전)

## 구현 결과
| 항목 | 내용 | 커밋 |
|---|---|---|
| A | 수업 종료 `/end` 멱등: completed 재호출은 잠금 없이 200, 잠금·CAS 경합은 상태 재조회 | 44302758 |
| B | 리포트 저장 시 최신 승인 상태 재확인(행 잠금)·동시 생성 Redis 락·역행 차단 로그 | 12df38bd |
| C | raw presign 403 거절 사유 구조화 로그 + 반복 거절 60초 단축(403 유지, 429 변경 없음) | ef3cf85d |
| D | 미측정 회원 그룹 기반 리포트 | (이 커밋) |

## D — 미측정 회원 그룹 기반 리포트
- 대상: 입장했고 리포트 반영 대상인데 본인 측정이 없는 회원(`band_status=not_worn`). 미입장·제외 회원은 리포트 행 자체가 없어 그대로 비노출.
- 스키마: `MemberReport.group_story`(선택). `not_worn` 리포트에만 허용. 측정 리포트는 필드가 없어 기존과 동일(회귀 불변).
- 서사(`member_report_group_story.py`): 규칙·문장 틀만 사용, AI 호출 없음. 첫머리 "그룹 기록", "회원님의 측정 기록은 아니지만, 이번 수업에서 우리는 이런 과정을 함께 경험했어요."
- 그래프: 그룹 유효 인원 n≥10(MIN_GROUP_N)일 때만 심박(1분 동안 뛴 횟수)·이완도·집중도의 매분 가운데 값. n<10이면 그래프·숫자·방향 문장 없이 서사만(`chart_hidden_reason=min_n`). 개인 값·ID 없음.
- 구간: 그룹 실제 측정 범위 기준 비례 분할(SDD-327 방식 재사용).
- 책 PDF: `group_story` 쪽 추가(종합 소견 다음), 목차·쪽번호 반영. 종합 소견 쪽은 본인 수치용 표·해석을 생략.
- 문구 변경: 미착용 히어로·종합 소견·다음 걸음 문장, 공유 fixture(백/프런트 `member-report-not-worn.json`) 갱신.
- 금지어·`ms`·'불규칙' 0, 점수·등급 없음, 문의 "담당 클래스 코치" 유지.

## 자동 승인 처리
- 원인: SDD-237 `_skip_auto_approve_no_data` 가 명상 회차에서 측정 자료(`eeg.status` 없음/`not_measured`)가 없는 회원 리포트를 자동 승인에서 제외 → 미측정자가 `pending_review` 에 멈춤.
- 처리: `content.member_report.group_story` 가 있으면 제외하지 않고 다른 리포트와 같은 자동 승인·메일 흐름을 탄다. `eeg.excluded`(리포트 반영 제외) 는 기존대로 대상 아님. 자동 승인은 기존처럼 상담사 `auto_approve_report` 설정이 켜진 경우에만 동작하고 메일은 기존 승인 훅·동의 규칙 그대로다(새 발송 경로 없음).
- 한계: 이미 만들어져 `member_report` 가 없는 기존 미측정 리포트는 재생성 전까지 계속 대기. 운영 기존 건 복구는 범위 밖.

## 테스트
- 신규 `tests/test_sdd329_group_story.py` 6건(n≥10 그래프/n<10 서사만/측정자 불변/AI·네트워크 차단/책 HTML/자동 승인 예외).
- `pytest -k "report or member_report or session or live or presign or eeg_raw"` + 전체 스위트 5636 통과·6 실패 — sdd246 5건은 병렬 DB 간섭(단독 37건 통과), 나머지 1건은 허용된 test_sdd070_pdf_metrics.
- PNG 샘플: `~/.hermes/share/sdd329-shots/group-story-n10-*.png`(n≥10), `group-story-n4-*.png`(n<10).

## 후속 메모
- v2(SDD-328, PR #321) 머지 후 같은 분기를 v2 빌더에도 반영.
- 프런트 웹 화면(`frontend/src/lib/member-report/types.ts`)은 `group_story`·`PageKey` 미반영 — 앱 화면 노출이 필요하면 후속.
- 렌더 샘플 스크립트 `tests/_render_group_story_sample.py` 는 수동용(언더스코어 접두로 자동 수집 제외).
