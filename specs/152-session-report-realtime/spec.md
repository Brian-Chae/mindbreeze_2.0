# SDD-152 — 세션·리포트·실시간 정합 (9건)

## 배경

기능 오류 전수조사 중(중) 27건 중 백엔드 세션·리포트·실시간 9건.

## 대상

| # | ID | 이슈 |
|---|---|---|
| 1 | FUNC-02 | client 리포트 생성 participant_id 미구분(그룹 오귀속) |
| 2 | FUNC-03 | 클래스 정원 검사·대기열 처리 없음 |
| 3 | FUNC-04 | 리포트 비동기 생성 시 완료 메일 자동 발송 누락 |
| 4 | FUNC-05 | 리마인더 이메일 outbox 커밋 전 큐 적재(유실) |
| 5 | EEG-REPORT-BOUNDARY | EEG 경계 필터 created_at 기준(지연 업로드 누락) |
| 6 | EEG-COUNSELOR-MIX | counselor 리포트 EEG 전체 참여자 혼합 |
| 7 | WS-FEATURE-DUP | EEG WS 저장된 feature 재브로드캐스트 |
| 8 | WS-JOIN-STALE-ROOM | 세션 재-join 시 이전 룸 미이탈 |
| 9 | CHAT-MULTITAB | 채팅 멀티탭 시 먼저 탭 차단 |

## 변경

1. client 리포트 participant_id 필수(미지정 400) + filters 포함.
2. 정원 초과 시 대기열 등록, 여유 시에만 해제.
3. 리포트 생성 완료 시 enqueue_report_email.
4. outbox commit 후 apply_async.
5. device_timestamp_ms 경계 필터(created_at 폴백).
6. counselor도 report.participant_id 전달.
7. is_latest일 때만 broadcast(REST와 동일 가드).
8. 재-join 시 이전 룸 leave.
9. sid→user_id 매핑 추가.

## 검증

- 백엔드 1048 passed (+신규 15건)
