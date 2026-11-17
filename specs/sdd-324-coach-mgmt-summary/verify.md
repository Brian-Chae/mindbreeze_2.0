# SDD-324 verify (구현 전 QA 체크리스트 — BE)

| # | 시나리오 | 기대 |
|---|---|---|
| V1 | 코치 /clients/summary | 연결 회원만 집계, 타 코치 회원 제외, total = /clients total |
| V2 | active_7d ⊆ active_30d | 경계(7일 직전/직후) 정확 |
| V3 | week_attended | KST 월요일 00:00 직전 참여 제외, 직후 포함, 결석(absent) 제외, 같은 회원 2회 참여는 1명 |
| V4 | inactive_14d / never_attended | 연결 10일 된 무활동 회원 제외, 20일 무활동 포함 + never_attended, 20일·최근 5일 전 참여 제외, 20일·30일 전 참여는 inactive이나 never 아님 |
| V5 | report_unread_members | completed·미열람 회원용 리포트 보유 회원만, pending_review·열람 완료·코치용 제외, 회원 중복 1 |
| V6 | band_worn / attended | 최근 30일 참여 중 유효 EEG 기록 있는 수 / 참여 수, 둘 다 건수, 비율 필드 없음 |
| V7 | /clients?filter= | 4종 목록이 summary 수와 일치, 잘못된 값 422, 회원(client) 403 |
| V8 | 기관관리자 | 기관 범위 회원 집계 포함 |
| V9 | /reports/summary | needs_review·failed_delivery·total_members가 hierarchy 무필터 summary와 일치 |
| V10 | generation_failed 전역 | tab=needs_review·q 검색에도 값 불변 |
| V11 | created_today | KST 자정 경계(전날 23:59 제외, 당일 00:00 포함), 코치용 제외 |
| V12 | member_unread | completed·미열람·실회원만, 게스트(user_id 없음)·pending 제외 |
| V13 | avg_review_hours | 최근 30일 수동 승인만, 30일 밖·auto·미승인 제외, 소수1자리, 표본0이면 null, review_sample 일치 |
| V14 | hierarchy tab=generation_failed/created_today/member_unread | 해당 문서 보유 회원만 노출, 기존 tab 불변, 잘못된 값 422 |
| V15 | 읽음 버그 | 호스트 코치가 회원용 리포트 GET → is_read 불변, 회원 본인 GET → true, 코치용 리포트 호스트 GET → true 유지 |
| V16 | 쿼리 수 | 회원/리포트 수를 늘려도 요약 쿼리 수 증가 없음 |
| V17 | 금지 표현 | 응답 키에 score/grade/ratio/overall 없음 |
