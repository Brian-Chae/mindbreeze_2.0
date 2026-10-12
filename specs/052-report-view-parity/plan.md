# SDD-052 Plan — 리포트 이메일 열람 페이지 정합

## 워커: BE(codex) + FE(cursor) 병렬

### BE (codex)
- T1. report_view 토큰 검증 + content JSON 반환 API
- T2. 메일 링크를 프론트 /report-view?token= 형태로 변경 (report_email_base_url 프론트 복원)

### FE (cursor)
- T1. /report-view?token= 토큰 열람 라우트 (로그인 없이)
- T2. 기존 NarrativeSections + 커버 재사용 렌더링

## 완료 기준
- 메일 링크 → 프론트 열람 페이지 → 상담사 페이지와 동일 서사형 렌더링
- BE pytest, FE build 0 error
