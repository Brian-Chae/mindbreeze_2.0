# SDD-050 — 리포트 메일 재발송

> 리포트 상세 페이지 하단에서, 개별 리포트를 원하는 메일로 재발송한다.
> 기본 메일주소(participant.report_email)가 미리 채워져 있고, 수정 후 재발송 버튼을 누르면
> 수정한 메일로 발송된다.

## 1. 배경

- 리포트 승인 시 client 리포트가 participant.report_email로 자동 발송된다.
- 상담사가 다른 메일로 재발송하고 싶은 경우가 있다 → 수동 재발송 기능 필요.
- 기본값은 저장된 report_email, 수정해서 재발송 가능.

## 2. 구현 범위

### BE (codex)
- `report_service._serialize`(또는 get_report)에 `report_email` 노출 — participant.report_email
- `resend_report_email(report_id, email, db)` 함수:
  - report(type=client + participant_id) 확인
  - report_view 토큰 + link 생성 (기존 `_token` 재사용)
  - `send_report_email(email, link)` → 성공/실패
  - (선택) participant.report_email 갱신
- API: POST `/reports/{report_id}/resend-email` body `{email}` (상담사 전용, host 확인)

### FE (cursor)
- `ReportDetailPage` 하단(액션 아래)에 재발송 섹션
  - 상담사(isCounselor) + client 리포트(type=client)일 때만 표시
  - 이메일 입력 필드(기본값 = report_email) + "재발송" 버튼
  - 재발송 성공/실패 피드백

## 3. 주의
- client 리포트만 메일 대상 (counselor 리포트는 메일 없음)
- host 상담사만 재발송 가능 (기존 승인 권한 패턴)
- 이메일 형식 검증 (간단한 프론트/백 검증)

## 4. 완료 기준
- 재발송 시 수정한 메일로 실제 발송
- BE pytest 통과, FE build 0 error
