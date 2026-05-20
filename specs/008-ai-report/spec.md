# F8 — AI 리포트 (MVP1: F8.1·F8.2·F8.3)

## 현재 상태
- `Report` 모델 존재함 (record.py): id, session_id, user_id, type, content(JSONB), pdf_url, sent_at, is_read
- API / 서비스 / 프론트엔드 없음 — 신규 개발

## 구현 범위

### 백엔드
1. **Report 스키마** (`app/schemas/report.py`): ReportCreate, ReportResponse, ReportUpdate, ReportApprovalRequest
2. **Report 서비스** (`app/services/report_service.py`):
   - `generate_report(session_id, type)` — SessionRecord.ai_summary 기반으로 리포트 content 생성 (AI 템플릿)
   - counselor용: 세션 요약 + 마커 + 상담사 메모 + (선택)EEG 분석
   - client용: 개인화 톤, 자가 인사이트 카드, (선택)뇌파 요약
3. **Report API** (`app/api/v1/reports.py`):
   - `POST /reports/generate/{session_id}` — 리포트 생성 (Celery 태스크)
   - `GET /reports` — 목록 ( counselor: 내 세션, client: 내 리포트)
   - `GET /reports/{id}` — 상세
   - `PUT /reports/{id}` — 수정 (counselor 전용)
   - `POST /reports/{id}/approve` — 승인 → F10 알림으로 이메일 전송 트리거
4. **Celery 태스크** (`app/tasks/report_task.py`): AI 리포트 생성 + 실패 시 폴백
5. **Alembic 마이그레이션**: reports 테이블 확인 (존재하면 건너뛰기)
6. **pytest**: 6+ 테스트

### 프론트엔드
1. **API 클라이언트** (`lib/api/reports.ts`): listReports, getReport, generateReport, approveReport
2. **ReportListPage** (`pages/reports/ReportListPage.tsx`): AppShell + UI Kit 카드 목록 (세션명, 날짜, 상태 뱃지)
3. **ReportDetailPage** (`pages/reports/ReportDetailPage.tsx`): AppShell + UI Kit Cover.jsx/Charts.jsx 스타일
   - 커버: 보라색 그라데이션, 점수, 세션명, 날짜 (UI Kit Cover.jsx 참고)
   - 요약 섹션: AI 요약 + 마커 하이라이트
   - (선택) 뇌파 차트: Recharts 라인차트 (UI Kit Charts.jsx 참고)
   - 승인 버튼: mb-btn (상담사 전용)
4. **App.tsx**: `/reports`, `/reports/:id` 라우트 추가
5. **디자인**: 보라색 #5F0080 기반 UI Kit, AppShell 사이드바

## 주의
- Report type: "counselor" / "client" 구분
- counselor만 승인·편집 가능
- 승인 시 F10 알림 이벤트 발생 (이메일 전송은 별도 SDD)
- AI 리포트 생성은 SessionRecord.ai_summary JSONB를 템플릿에 매핑
- `cd frontend && npm run build` + `cd backend && pytest` 검증
