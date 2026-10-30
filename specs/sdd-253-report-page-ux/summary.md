# SDD-253 — Summary (Stage ⑥)

회원 행 디자인은 대표 확정 **A안(상태 하나 크게 + 행 끝 단일 주 버튼)**. 기준 시안: `~/.hermes/share/mb-sdd253-20261028/items/A/`.

## What Was Built

| 영역 | File | 내용 |
|---|---|---|
| DB | `backend/alembic/versions/a253b0c1d2e3_sdd253_report_approval_delivery.py` | `reports` 에 nullable 7컬럼(승인자 성명·역할·경로, 발송 상태·시도 시각·횟수·실패코드). head `e036a0245001` → `a253b0c1d2e3` 단일. 다운그레이드 작성, backfill 없음 |
| 모델/스키마 | `models/record.py`, `schemas/report.py` | 컬럼 + 응답 가산 필드(`approved_*`, `approval_source`, `delivery_*`, `capabilities`) |
| 권한(D3) | `report_service.can_approve_report` | 허용 기관·귀속 확인된 명상 클래스의 활성 기관관리자 승인 허용. 코멘트 편집(`_can_edit_report`)은 확대 안 함 |
| 감사 | `report_service.approve_report` | 최초 승인 시 승인자 스냅샷 1회 기록, 재승인·재발송으로 덮어쓰지 않음. 자동 승인은 `approval_source=auto` |
| 발송 상태(D4) | `report_service._enqueue_client_email_on_approval`, `report_email_service` | pending / not_requested / unavailable / failed(예약 실패) / sent / failed(워커 결과). `sent_at` 의미 불변 |
| API | `api/v1/reports.py` | `POST /{id}/approve-and-send`, `POST /{id}/retry-delivery`, `GET /hierarchy` (모두 신규 경로) |
| 계층 조회(D1·D6) | `report_hierarchy_service.py` | 클래스 > 회차(담당) > 회원 > 문서, 회차 단위 페이지, 검색·탭·상담사·활동·기간, 성명·성별·만 나이(생년월일 미포함) |
| FE 목록 | `ReportHierarchyList.tsx`, `ReportsDesktopPage.tsx`, `report-ops-labels.ts` | 상단 '검토가 필요한 회원용 N건 + 검토 시작', 한 줄 필터, 탭 3종, A안 행, 회차 헤더의 '상담사용 · 회차 공통' 보조 버튼, 운영 설정·샘플은 '더 보기' |
| FE 분할 검토(D2) | `ReportReviewPane.tsx`, `ReportApprovalStatus.tsx`, `ReportDetailView.tsx` | 목록 옆 분할 검토, '승인하고 발송' 단일 CTA, 승인자·시각·발송 상태, 실패 시 '다시 발송', 기관관리자도 CTA(서버 capability 기준) |
| FE 회원(D6) | `ClientReportListPage.tsx`, `PastReportsCompare.tsx` | NEW → '아직 읽지 않음'(데스크톱 표), '지난 리포트와 함께 보기'(같은 상담사·활동의 승인된 본인 기록, 수치 비교 없음) |
| 모바일 | `ReportListPage.tsx` | 기존 카드 목록·전체화면 상세 코드 경로 그대로(`LegacyReportListPage`), `useIsDesktop`(≥768px)로만 분기 |

## Test Results

- 백엔드 신규 `test_sdd253_report_ops.py` **37건 PASS** (TS1~TS8: 권한·감사·발송·다시 발송·호환/누출·계층·정책 유지·마이그레이션)
- 백엔드 전체: **3,776 passed / 514 skipped / 1 failed** — 실패 1건 `test_sdd218_report_job_api::test_b12_b13`(접수 200ms 타이밍). 단독 재실행 PASS, 변경 전 코드도 PASS → 부하 영향 플레이크로 분류
- 프론트 vitest: 변경 전 기준선 **8파일 17건 실패**(agent-counselor-page, chat-message-deeplink, org-counselor-management-browser, org-management-browser, report-modal-pdf, report-server-pdf, sdd220-native-release, sdd234-a-mobile-home) → 변경 후 **동일 8파일 17건**, 신규 실패 0, 통과 3,548 → 3,561(+신규 17). 이후 신규 4건 추가(past-reports) 포함 관련 3파일 34건 PASS
- `tsc -b --noEmit` 0 오류 / eslint 오류 0 / `vite build` 성공
- Tailwind 신규 임의값 클래스(`grid-cols-[...]`, `w-[140px]`, `bg-[#FAE9DE]` 등 12종) 빌드 CSS 생성 확인
- Playwright(API 모킹) 1440·1200·390 캡처 → 직접 열람: 가로 넘침 0, 세로 글자 0, 잘림 0, '승인하고 발송' 버튼 뷰포트 안(895~939px/1000px), 모바일은 기존 카드 목록

## Debugging Journey

- 승인 버튼이 분할 패널 하단 밖으로 밀림 → 패널 높이를 `calc(100vh-168px)` 로 고정, 본문만 스크롤.
- 1200px 분할 패널(≈500px)에서 서사 본문의 3열 단계·사이드 목차가 글자를 세로로 쪼갬 → `.report-review-pane` 하위에서만 한 열로 접는 CSS(기존 모달·공개 열람 영향 없음).
- 탭 숫자가 탭 선택에 따라 변함 → 요약 집계를 탭과 무관하게(검색 조건만 반영) 계산, 회귀 테스트 추가.
- 기존 테스트 충돌 14건: 응답 키 집합 고정 테스트(sdd211) 3건 → 회원 경로는 키는 존재·값 null 로 유지하고 allowlist 에 분류 추가 / 기관관리자 승인 403 단언 2건 → 대표 결정 D3 반영해 갱신(플랫폼 관리자·타 기관은 403 유지) / `approve_report` 스파이 시그니처 → `source` 인자 대신 ContextVar 로 승인 경로 구분.
- StaticPool 테스트 DB 에서 미커밋 사용자 행이 첫 요청 후 롤백 → 픽스처에서 commit.

## Notes for Reviewer

- **앱 호환**: 기존 엔드포인트의 필드 제거·의미 변경 없음(가산만). 회원·토큰 경로 응답에는 운영 필드 키는 있되 값은 항상 null, capability 도 null. 구 앱의 `/approve` 도 감사·발송 상태를 기록하고, 메일 예약은 승인 시 한 곳에서만 1회 → `approve-and-send` 와 이중 예약 없음(테스트).
- **발송 성공 의미**: 메일 제공자 인계 기준. 수신함 도착·열람이 아님(화면에도 명시).
- **시도 이력 테이블은 만들지 않음**: 횟수·마지막 시각·사유 코드만 저장(재발송 이력 테이블은 후속). 별도 outbox 도 만들지 않고 기존 `report_email_task`(수신자별 `report_email_sent_at` 멱등)를 재사용.
- **미검증**: 실제 계정 권한·서버·DB·메일 실발송(Celery email_app worker)·운영 배포. 모든 테스트는 메일 모킹/DB 테스트용.
- **미구현(후속)**: 생성 실패 대상의 '다시 생성'(안전한 재생성 계약 없음), 회원 지난 리포트의 수치 비교, 회차 단위 일괄 처리.
- 앱(Capacitor) 재빌드: **불필요** — 서버 API 가산 변경 + 웹 번들 변경이며 네이티브 코드 변경 없음(웹 번들을 앱에 내장하는 방식이면 다음 앱 빌드 때 반영).
