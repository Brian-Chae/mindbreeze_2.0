# SDD-219 이월 항목 처리 결과 (T9~T12)

- 작성 기준: 브랜치 `sdd/219-class-launch-readiness` (4e3438cb), 코드 읽기 분석. 이 문서 외 코드 변경 없음.

## 선결 차단 — SDD-218 미병합

`class-report-manage.tsx`, `class-report-job.tsx`, `lib/api/class-reports.ts`, `report-status.ts` 와 백엔드 일괄 작업 API·마이그레이션(`e036a0000058_sdd218_report_jobs.py`)은 `origin/sdd/218-class-structure-phase5`(733728e2) 에만 있다. 이 브랜치와 `origin/develop` 에는 없다(`git merge-base --is-ancestor` → NOT_MERGED).
프론트 파일만 복사하면 존재하지 않는 서버 API 를 호출하고, 백엔드까지 가져오면 마이그레이션이 따라온다(금지 범위). 그래서 T9·T10 은 218 PR 이 develop 에 병합되어 이 브랜치가 rebase 된 뒤에 진행해야 한다.

## 결과표

| 항목 | 결과 | 근거 | 비고 |
|---|---|---|---|
| T9 리포트 탭 교체 | **보류(218 병합 대기)** | 교체 대상 `class-session-detail.tsx:89` `<ClassTeamReports classId sessionId/>` (읽기 전용 단건 열람). 218 쪽 `ClassReportManage` 는 `class-report-manage.tsx:106` 에 있음 | 병합 후 연결 지점·유의점은 아래 |
| T10 회차별 호출 수 | **분석만, 측정 보류** | 218 `class-report-manage.tsx:382-440` `useSessionReportRows` 가 `sessions.map` 로 `classOperationsApi.reports(classId, session.id)` 를 회차마다 1회 호출 → 20회차 = 목록 호출 20건(병렬). 서버 일괄 조회는 현재 없음(`backend/app/api/v1/classes.py:573` 단건 `/{class_id}/sessions/{session_id}/reports` 만) | 훅이 이 브랜치에 없어 테스트 불가. 신규 구현 금지 지시에 따라 후속 판단만: 임계 초과 여부는 dev 실측(B4)으로 결정 |
| T11 홈 통계 / 센터 관리자 | **후속 분류(T8 와 조율)** | 아래 T11 상세 | 코드 수정 없음 |
| T12 알림·메일 문구 | **후속 분류** | 아래 T12 상세 | 코드 수정 없음 |

## T9 병합 후 연결 시 확인 사항 (218 코드에서 읽은 것)
1. 훅 `useSessionReportRows(classId, sessions)` 의 `sessions` 가 effect 의존성이다. 부모가 렌더마다 새 배열을 넘기면 재호출이 반복되므로 `useMemo` 로 고정해서 넘겨야 한다.
2. 같은 훅에서 `attended: 0`, `absent: 0`, `participant_name: null` 이 하드코딩이고, 회차 조회 실패는 `.catch(() => ({reports: []}))` 로 삼켜 빈 목록으로 보인다. 출석 요약·결석 건 제외(R1 요구)가 실데이터로 채워지는지 병합 후 확인 필요(B1 차단 항목).
3. 권한: 현재 `class-session-detail.tsx:89` 는 `!isHost && (admin || instructor)` 에만 리포트 영역을 보여준다. 관리 화면은 클래스 단위(주강사·센터 관리자)이므로 회차 상세가 아니라 클래스 상세 리포트 탭에 두는 것이 verify B1 문구("클래스 상세 리포트 탭")와 맞다. 회차 상세의 열람 컴포넌트는 유지 여부를 218 병합 후 결정.
4. B3: `pending` 건이 남는 응답이면 "일부 건이 아직 처리되지 않았어요. 잠시 후 '실패·대기 건 다시 시도'를 눌러 주세요" 류의 수동 재시도 문구를 노출(Celery 이관 금지, P8-03).

## T11 상세
- `by_area` 라는 응답 필드는 코드 어디에도 없다(`grep by_area` 0건). 실제 대시보드 API 는 `backend/app/services/dashboard_service.py` 의 `counselor_dashboard`(`:128`)·`org_dashboard`(`:159`) 이고, 항목별 `area`(`:41`: 클래스=`meditation`, 상담=`counseling`)만 내려준다.
- 두 집계(`total_classes`, `in_progress_classes`, `completed_classes`, `total_participants`, `pending_review_count`)는 `Session` 행 단위로 `area` 구분 없이 합산한다(`:137`, `:180`). 즉 상담 세션이 클래스 지표에 섞이고, `total_classes` 는 클래스 수가 아니라 회차(세션) 행 수다. 프론트 `DashboardPage`·`OrgDashboardPage` 는 `area` 를 사용하지 않는다(`frontend/src/lib/api/dashboard.ts:10` 타입 선언만).
- 센터 관리자(C2): `/classes`(`App.tsx:213` `HostClassesPage`, 역할 `org_admin` 허용)에서 클래스 단위 현황을 볼 수 있다. `/dashboard/org` 는 상담사(호스트) 단위 집계이며 클래스 단위 현황은 아니다.
- 분류: **상담 행 혼입(C1)은 출시 필수이나 plan T8 소관**(DashboardPage·OrgDashboardPage 의 `area=counseling` 점검)이라 이 담당에서 수정하지 않음. 필요 조치: 백엔드 집계에 `Session.counseling_relationship_id IS NULL` 필터 또는 프론트 필터. 클래스 단위 센터 대시보드 신설과 `total_classes` 의미 교정은 **후속**.

## T12 상세
- 알림 문구: 클래스 이벤트는 `EVENT_CATALOG` 에서 type=`session` 으로 분류되어(`notification_service.py:78-80`) 알림 카드의 분류 라벨이 `세션`(`frontend/src/lib/notification-format.ts:11`)으로 표시된다. 클래스 전용 이벤트(`class_*`, `session_host_*`) 라벨은 이미 `클래스 …`/`진행자 …` 로 정리돼 있다(`:19-30`).
- 공용 이벤트 `session_updated/cancelled/started/completed/invited` 라벨(`:32-40`)은 클래스 회차와 상담 세션이 함께 쓴다. 상담은 비공개 예정이지만 레거시 단건 세션이 남아 있어 "세션→회차" 일괄 치환은 오표기 위험이 있다 → **후속**.
- 메일: `report_email_service.py:416,427,434`(회원용 리포트 메일 "나를 위한 세션 리포트", "세션 인사이트"), `:363` 기본 요약 "오늘 세션에 …". 클래스 회원에게도 나가지만 오류는 아니고 용어 불일치 수준 → **후속**(메일 템플릿 변경은 발송 영향 확인 필요). 같은 이유로 API 오류 문구 `class_read_service.py:26` "세션을 찾을 수 없습니다"도 후속.
- 사용자에게 명확히 틀린 문구는 발견하지 못해 수정하지 않음.

## 후속 분류 요약

| 구분 | 항목 |
|---|---|
| 출시 필수 (타 담당/선행 필요) | T9 연결(218 병합 후), 대시보드 상담 행 혼입(T8) |
| 후속 | T10 일괄 조회 API(실측 결과에 따름), 클래스 단위 센터 대시보드, `total_classes` 의미 교정, 알림·메일 세션→회차 용어 정리 |
