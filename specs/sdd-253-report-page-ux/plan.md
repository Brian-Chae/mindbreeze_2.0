# SDD-253 — Plan (Stage ②)

> 기준: spec §3~§6, 디자인 A안. 구현 순서는 BE → FE 목록 → FE 분할 검토 → 회원 화면 → 테스트·캡처.

## 아키텍처 결정

1. **DB(추가형 1개 리비전, down_revision=`e036a0245001`)** — `reports` 에 nullable 컬럼만 추가. 기존 `approved_by_user_id`/`approved_at`(SDD-214) 재사용, `sent_at` 의미 불변.
   - 승인 감사 스냅샷: `approved_by_name`(str200), `approved_by_role`(str20), `approval_source`(str20: `manual`|`auto`, NULL=기존 기록·승인자 미확인)
   - 발송 상태: `delivery_status`(str20: pending|sending|sent|failed|not_requested|unavailable, NULL=기록 없음), `delivery_attempted_at`, `delivery_attempt_count`(int, server_default 0), `delivery_failure_code`(str50)
   - 별도 outbox 테이블은 만들지 않는다: 기존 `report_email_task`(Celery, 수신자별 `report_email_sent_at` 멱등)가 이미 내구 예약 경로다. 이중 예약 방지는 "승인 시 한 곳(`_enqueue_client_email_on_approval`)에서만 예약"으로 유지하고 신규 명령도 이 경로를 재사용한다. 시도 이력은 횟수+마지막 시각·사유 코드로 단순화(실패 이력 테이블은 후속).
   - 기존 기록 backfill 없음. downgrade 는 컬럼 drop.
2. **권한** — `can_approve_report` 에 활성 기관관리자 분기 추가(`admin_can_read_meditation_report` 재사용: 활성 org_admin 멤버십·귀속 확인된 기관의 명상 클래스). `approve_report` 의 두 분기(클래스/비클래스)를 `can_approve_report` 로 통일하되 비클래스 상담은 기존 `_can_edit_report` 의미 유지(org_admin 은 상담 불가). 코멘트 편집·`require_report_host` 는 변경 없음(승인≠편집). 회원·타 기관·비활성은 403.
3. **승인 API 호환** — 기존 `POST /reports/{id}/approve` 응답에 optional 필드만 추가. 내부적으로 감사 스냅샷과 `delivery_status` 를 기록한다(구 앱 승인도 동일 기록).
4. **신규 명령** `POST /reports/{id}/approve-and-send` — `approve_report` 호출(멱등, 재호출 시 감사·발송 덮어쓰기 없음) 후 `delivery_status` 포함 응답. 별도 메일을 한 번 더 예약하지 않는다.
5. **다시 발송** `POST /reports/{id}/retry-delivery` — 권한 `can_approve_report`, 대상은 `delivery_status=failed` 이고 등록 수신 주소가 있는 승인 완료 회원용만. `resend_report_email` 재사용, 시도 수·결과 기록, 승인자·승인 시각 불변.
6. **발송 상태 기록 지점** — 승인 시 예약 성공→`pending`, 주소 없음→`not_requested`, 제외/파기→`unavailable`, 예약 예외→`failed(code=enqueue_failed)`; `deliver_report_email` 결과 `sent`/`failed`(code=send_failed|exception); `resend` 결과 동일. `sent` 는 메일 제공자 인계 기준.
7. **기능 플래그 없는 가산 필드** — `ReportResponse` 에 `approved_at, approved_by_name, approved_by_role, approval_source, delivery_status, delivery_attempted_at, delivery_attempt_count, delivery_failure_code, capabilities` 추가(전부 optional). **스태프 경로(목록·상세)에서만 채운다**(`_serialize(ops=True)`), 회원·토큰 경로에는 절대 싣지 않는다.
8. **계층 읽기 API** `GET /reports/hierarchy` (counselor/org_admin) — 기존 `list_reports` 의 범위 판정(상담사=본인 회차, 기관관리자=허용 기관 명상)을 그대로 재사용한 회차 단위 응답. 필터 `q, tab(all|needs_review|failed), counselor_id, activity, date_from, date_to, page, limit(회차 수, ≤50)`. 필터·집계는 권한 범위 전체 회차의 경량 조회 후 Python 에서 계산하고 회차 단위로 자른다(회원·문서가 페이지 사이로 갈라지지 않음). 응답: `summary{needs_review, failed_delivery, generation_failed, total_sessions}`, `groups[]`(class | solo) > `sessions[]`(일시·담당자·참여/대기 수·`common_report`) > `members[]`(name, gender, age, is_guest, `client_report`, `counselor_report`) . 성명·성별·만 나이만, 생년월일 미포함. 리포트 없는 회차는 `generation_state` 로 표시.
9. **프론트** — 데스크톱(≥768px)만 새 화면. 모바일은 기존 카드 목록 코드 경로 유지.
   - `lib/api/report-hierarchy.ts`(타입·fetch) · `lib/report-ops-labels.ts`(용어·상태 단일 소스) · `components/reports/ReportHierarchyList.tsx`(배너·필터·탭·계층·A안 행) · `ReportReviewPane.tsx`(분할 검토, 기존 `ReportDetailView` 재사용 + 승인하고 발송 영역) · `ReportApprovalStatus.tsx`(승인자·발송 상태·다시 발송).
   - `ReportListPage` 는 데스크톱에서 `ReportHierarchyList`, 모바일은 기존 렌더. `ReportDetailView` 는 `can_approve` capability 로 승인 버튼 노출, 버튼 문구 '승인하고 발송', 발송 상태 표시, 기관관리자 승인 허용.
   - 회원: 목록 용어 `NEW`→'아직 읽지 않음', 데스크톱 4컬럼, 상세 '지난 리포트와 함께 보기'(본인 승인 회원용 목록에서 같은 클래스·이전 회차 서사 나란히, 수치 비교 없음).
10. **금지/유지** — 점수·순위·좋고 나쁨 문구 없음, 자동 승인 기본값·미측정 제외 불변, 실메일 발송 없음(테스트 모킹).

## Files to Change

| Action | File | Description |
|---|---|---|
| Create | `backend/alembic/versions/<rev>_sdd253_report_approval_delivery.py` | 가산 컬럼 8개 |
| Modify | `backend/app/models/record.py` | Report 컬럼 |
| Modify | `backend/app/schemas/report.py` | 응답 가산 필드, Hierarchy 스키마 |
| Modify | `backend/app/services/report_service.py` | can_approve(org_admin), 감사·발송 기록, ops 직렬화, capabilities |
| Create | `backend/app/services/report_hierarchy_service.py` | 계층 조회 |
| Modify | `backend/app/services/report_email_service.py` | 발송 결과 기록, retry |
| Modify | `backend/app/api/v1/reports.py` | hierarchy / approve-and-send / retry-delivery, approve 권한 |
| Create | `backend/tests/test_sdd253_*.py` | 권한·감사·발송·계층·호환 |
| Create/Modify | 프론트 위 9번 파일들 + `tests/sdd253-*.test.tsx` | |

## Tasks

- T1 마이그레이션+모델+단일 head 확인 (10m)
- T2 권한 확장·감사 기록·발송 상태 기록 (20m)
- T3 신규 엔드포인트 approve-and-send / retry-delivery (15m)
- T4 계층 조회 서비스·스키마·엔드포인트 (30m)
- T5 BE 테스트 (25m)
- T6 FE 용어·API 클라이언트·ReportApprovalStatus (15m)
- T7 FE 계층 목록(A안 행, 배너·필터·탭) (35m)
- T8 FE 분할 검토 + 승인하고 발송 (25m)
- T9 FE 회원 목록·상세(지난 리포트) (20m)
- T10 vitest/tsc/eslint/build·Tailwind 클래스 확인·Playwright 캡처 1440/1200/390 (30m)
- T11 summary.md, PR

## Testing Strategy

pytest(신규 + 기존 report 관련 회귀), vitest(기존 실패 기준선 17건/8파일 대비 신규 0), `tsc -b --noEmit`, eslint, 빌드 CSS 클래스 생성 확인, Playwright(API 모킹) 캡처 비교.
