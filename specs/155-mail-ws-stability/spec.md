# SDD-155 — 메일·WS·안정성 (6건)

## 배경

기능 오류 전수조사 하(하) 17건 중 백엔드 메일·WS·안정성 6건.

## 대상

| # | ID | 이슈 |
|---|---|---|
| 1 | FUNC-06 | 리포트 메일 재발송 시 상태·시각 미갱신 |
| 2 | FUNC-07 | 리마인더 HTML 본문 미사용(평문만) |
| 3 | WS-NO-DATA-GUARD | record/chat 핸들러 data null 방어 없음 |
| 4 | VIDEO-UUID-500 | 영상 API UUID 무가드 변환(500) |
| 5 | EXPORT-AUDIT-USER-NPE | 내보내기 감사 사용자 부재 시 500 |
| 6 | EEG-DROWSY-GUARD | 졸음 플래그 가드 복붙 오류 |

## 변경

1. 재발송 성공 시 report_email_status='sent', sent_at=now.
2. send_email_notification에 body_html 파라미터 추가·전달.
3. 핸들러 첫 줄 `data = data if isinstance(data, dict) else {}`.
4. video.py UUID 변환 → _to_uuid 재사용(400).
5. download_url 사용자 None 체크 + requester_role 폴백.
6. 졸음 가드 cognitiveLoad p75 포함(존재 시), focusIndex p75 제거.

## 검증

- 백엔드 1062 passed (+신규 7)
