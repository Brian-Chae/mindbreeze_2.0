# SDD-149 — 기관·알림·EEG 정합 (4건)

## 배경

기능 오류 전수조사 상(상) 10건 중 기관·알림·EEG 정합 4건.

## 대상

| # | ID | 이슈 |
|---|---|---|
| 1 | MB2-ORG-01 | 상담사 소속 해제(DELETE)에 마지막 관리자/주담당자 보호 가드 없음 → orphan 기관 |
| 2 | FUNC-01 | 예약 리마인더가 일정 변경·삭제 후에도 발송 |
| 3 | EEG-QUALITY-NULL | 신호품질 null을 'valid'로 승격 → 신뢰도 100% 과대평가 |
| 4 | GROUP-AVG-ANON | 그룹 평균 표본 게이트가 지표별이 아님 → 1명 값이 그룹 평균으로 노출 |

## 변경

1. remove_counselor → change_counselor(role=None) 위임(주담당자·마지막 org_admin·진행/예정 세션·활성 내담자·개인기관 소유자 409).
2. run_reminder 시점/offset 검증(60s 허용) + 결정적 task_id ETA + revoke_session_reminders(옛 task 취소).
3. signal_quality None → 'unknown'(valid 승격 방지).
4. 그룹 평균 지표별 non_null 개수 >= MIN_WEARERS 게이트.

## 검증

- 백엔드 1026 passed (+신규 8건)
