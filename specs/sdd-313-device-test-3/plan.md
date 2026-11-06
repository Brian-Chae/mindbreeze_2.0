# SDD-313 Plan

## 원인 분석
| # | 결과 | 근거 |
|---|---|---|
| 2 | 확정(코드·시험 기준) | `IntegratedEntryConsent.submit` 이 자격이 없을 때(녹음 게이트) 자격만 받고 `setResolvedEntry` 후 return → 서버 선택을 다시 불러온 같은 화면을 한 번 더 보여 주고 사용자가 다시 눌러야 저장. 전체 동의 시험이 이전 시험에서 이를 "재확인"으로 고정해 두었음 |
| 3 | 확정(시험 기준) | `IntegratedEntryConsentView` 의 `fields` 가 잠긴 뇌파 항목(eegLocked)을 제외하고 `all` 을 계산 → 뇌파가 해제된 채 잠기면 나머지만 켜져 있어도 전체 동의가 켜짐 |
| 1 | 미확정(가설) | 아래 참조 |

## 1번 조사 결과
- dev DB 회차 8ce96b60 읽기 전용 확인: iOS(503e4a8d) raw 74청크 전부 uploaded·size>0, feature 산출물 1.12MB.
- 서버 코드(dev 와 md5 동일)로 `load_bytes_by_session`, `participant_metrics`, `_compute_body`(코치 상세), `_summaries`(목록·회원 본인) 를 실제 데이터로 실행 → iOS 4,181,083B / Android 3,080,895B. 0 이 나오는 경로 없음.
- 가설: iOS 는 raw 청크가 종료 직후(14:10:49)에야 한꺼번에 등록·업로드된다(Android 는 14:06:13 부터 점진). 그 전에 iOS 의 기대량 보고에서 raw 기대가 0 이면 "모두 도착"인데 bytes 는 feature 산출물(14:10:48 이후)뿐이라 0KB 로 보일 수 있음. 실시간 중간 보고값은 DB 에 남지 않아 확정 불가.

## 변경 파일
| 파일 | 내용 |
|---|---|
| frontend/src/components/class/flow/member/IntegratedEntryConsent.tsx | 자격 획득 직후 서버 선택을 불러온 뒤 같은 제출을 이어서 저장(저장 로직 `saveWith` 분리). 서버에 켜진 선택을 사용자가 못 본 채 끄게 되는 충돌이면 기존처럼 한 번 더 확인 |
| frontend/src/components/class/flow/member/IntegratedEntryConsentView.tsx | `all`/`indeterminate` 를 보이는 모든 항목에서 파생, 전체 토글은 잠긴 항목 제외 |
| frontend/tests/sdd313-consent-view.test.tsx | 신규 3건 |
| frontend/tests/sdd303-integrated-consent.test.tsx | 재확인 고정 시험 1건을 새 동작으로 교체, 전체 동의 제출 1건 추가 |
