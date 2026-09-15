# SDD-052 — 리포트 이메일 열람 페이지를 상담사 페이지와 동일하게

> 메일 "리포트 보기" 링크가 여는 페이지가, 상담사 페이지에서 보는 서사형 리포트(NarrativeSections)와
> 동일한 디자인·내용을 렌더링하도록 개선한다. 백엔드 HTML 재현 대신 프론트 토큰 기반 열람 페이지를 만든다.

## 1. 배경

- 현재 `view_report_email`(백엔드)이 단순 HTML(제목/요약/인사이트/7지표)을 직접 생성 → 상담사 페이지와 다름.
- 상담사 페이지(`/reports/{id}`)는 `NarrativeSections`(커버+사이드바+종합여정→몸→마음→마무리)를 렌더링.
- 메일로 열리는 리포트도 동일한 서사형 디자인이어야 함.

## 2. 구현 범위

### BE (codex)
- report_view 토큰 검증 후 리포트 content(JSON)를 반환하는 API 추가
  - 기존 `_token`/`_decode` 재사용 (report_view 타입)
  - `report.type == "client"` + `status == "completed"` 확인
  - participant.report_email == token.email 확인
  - 반환: `_serialize`와 동일한 content 계약 (content.eeg.narrative, timeline 포함)
- 기존 view_report_email은 하위호환 유지 (또는 제거)

### FE (cursor)
- 로그인 없이 열람 가능한 토큰 기반 라우트 `/report-view?token=...` 추가
- 토큰으로 리포트 데이터 조회 → **기존 `NarrativeSections` + 커버 컴포넌트 재사용** (상담사 페이지와 동일)
- AppShell 없이 독립 풀페이지 (또는 단순 레이아웃)

### 메일 링크 변경
- `report_email_base_url`을 프론트 도메인으로 복원하고, link를 `/report-view?token=...` 형태로 변경

## 3. 주의
- 상담사 페이지와 동일한 NarrativeSections 재사용 (디자인 정합 100%)
- 토큰 만료/무효 처리
- 점수(0~100) 노출 최소화 (서사형 기조 유지)

## 4. 완료 기준
- 메일 링크 → 프론트 열람 페이지 → 상담사 페이지와 동일한 서사형 리포트 렌더링
- BE pytest, FE build 0 error
