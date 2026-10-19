# SDD-218 Summary — 클래스 리포트 관리와 회원 변화 추이

- 상태: Stage ⑥ Summary — Brian 최종 리뷰 대기
- 작성일: 2026-10-20
- 브랜치: `sdd/218-class-structure-phase5` (커밋 7개, 35파일 +5,794 / −9)
- 베이스: SDD-217 `6ea5fec2` **위에 리베이스**. 217 develop 머지 후 develop 으로 재리베이스 필요.

---

## 1. 무엇을 만들었나

| 요구 | 결과 |
|---|---|
| R1 클래스 리포트 운영 | 조치 우선 요약 + 상태 필터 + 회차 펼침 건별 선택. 상태 6종 구분 |
| R2 일괄 작업 신뢰성 | 접수(202) → 권한 재검사 → 건별 처리 3단계. 멱등·부분 실패·재시도 |
| R3 승인 주체·감사 | `can_approve_report` — 진행 지도사 + 현재 주강사 대행. 실제 승인자 기록 |
| R4 회원 변화 추이 | 회차 내부 전반→후반 방향 + 숫자 델타. 미측정 5종 구분 |
| R5 지도사 집계 | 출석 요약 + 익명 방향 분포. 3명 미만 비노출 |
| R6 기존 데이터·호환 | 기존 식별·FK·단건 API 불변. `change` 는 가산만 |

### 확정된 결정 6건
D-36(진행 강사 + 주강사 대행) · D-37(공통 분리만, 동작 변경 0) · D-43(추이는 회원 전용) ·
P5-01(방향 + 숫자 델타 병기) · P5-02(202 + state 4종) · P5-03(시안 승인)

---

## 2. 테스트 결과 (실측)

| 스위트 | 결과 |
|---|---|
| 백엔드 SQLite 전체 | **3,195 통과** / 12 skip / 0 실패 |
| 백엔드 PG 전체 (새 DB) | **414 통과** / 21 deselect / 0 실패 |
| 프론트 신규 | **18 통과** |
| 프론트 빌드 | 통과 (tsc 타입 체크 포함) |
| 218 신규 테스트 | 백엔드 94 + PG 6 + 프론트 18 = **118개** |

### verify.md 항목별

| 영역 | 상태 |
|---|---|
| A 승인 권한 (A1~A10) | 전항목 통과 |
| B 멱등·부분 실패 (B1~B14) | B14 제외 통과. **B14 미측정** (§5) |
| C 기존 계약 회귀 (C1~C7) | 전항목 통과 |
| D 자동 승인 분리 (D1~D4) | 전항목 통과 |
| E 회원 추이 (E1~E15) | E8·E14 제외 통과. **E8 부분 미측정** (§5) |
| F 집계·보호 (F1~F8) | 전항목 통과 |
| G 프론트 (G1~G7) | G5 제외 통과. **G5 미측정** (§5) |
| H 통합 여정 (H1~H7) | **전항목 미측정** (§5) |
| I 범위 이탈 (I1~I6) | 전항목 통과 |

**출시 차단 7개는 전부 통과**: A2 · A10 · B5 · B9 · E1 · E2 · F2

### 수치 실측 (verify 요구)
- **B12** 50건 접수: **11.5ms** (아키텍처 규칙 200ms 이내)
- **B13** 50건 접수 쿼리: **18회** (대상 수에 비례하지 않음 — N+1 없음)
- Alembic: 리비전 91개, **head 1개** `e036a0000058`
- down/up 스모크: down 시 테이블 0개 → up 시 2개 복원

---

## 3. 구현 중 발견하고 고친 것

### 3.1 접수 경로 N+1 (자체 발견)
최초 구현은 대상마다 세션·참여자를 따로 조회했다. HTTP 측정에서 776ms 가 나와
프로파일한 결과 접수 자체는 35ms, 나머지는 TestClient 가 BackgroundTask 까지
동기로 돌린 시간이었다. 그럼에도 조회가 대상 수에 비례했으므로 일괄 로드로 바꾸고
주강사 판정을 클래스당 1회만 하도록 고쳤다. → 11.5ms / 18쿼리.

측정 방식도 함께 고쳤다. HTTP 왕복 시간은 운영에서 응답 이후에 일어날 일을
포함하므로, 접수 경로만 따로 재고 쿼리 수를 함께 남긴다.

### 3.2 상태 칩 2종이 색각 이상에서 겹침 (테스트가 발견)
`partial` 과 `empty` 가 같은 (모서리, 테두리) 조합이었다. 색을 못 보면 구분되지 않는다.
`empty` 를 `rounded-sm` 으로 분리해 6종이 모두 고유 형태를 갖게 했다.
G2 테스트가 조합의 유일성을 검사하므로 앞으로도 겹치면 깨진다.

### 3.3 dev 초기화 범위 누락 (전체 회귀가 발견)
새 테이블 2개가 `dev_data_reset` 범위 분류에 없어 `test_sdd214_reset_guards` 가 실패했다.
classes/reports FK 에 종속되므로 DELETE 범위에 넣었다.

### 3.4 SDD-216 동시성 계약 변경 (사용자 결정 A)
`test_approval_and_correction_freeze_approved_owner` 가 "승인과 귀속 정정 중 정확히
하나만 성공" 을 단정했는데, D-36 적용 후 둘 다 성공했다. 217 기준에서 재현해
**D-36 이 원인임을 확인**하고 사용자에게 선택지를 올려 **A(D-36 우선)** 를 받았다.

테스트를 갱신하되 지켜야 할 것은 남겼다.
- 걷어낸 전제: `승인자 == 진행자`
- 유지한 규칙: **승인 후에는 귀속을 바꿀 수 없다**(정정 409)
- 추가한 검증: 정정이 먼저면 대행 승인이 성공하고 `approved_by_user_id` 는 실제 승인자
- 5회 반복 실행으로 양쪽 순서를 모두 확인

### 3.5 깨지기 쉬운 단정 2건 완화
- 테이블 수 하드코딩 86 → 88
- 217 테스트의 `head == 'e036a0000057'` → `>= 'e036a0000057'`
  (SDD 가 늘 때마다 깨지던 구조라 범위 비교로 바꿨다)

---

## 4. 설계 판단 2건 (사용자 승인)

**① `approve_report` 권한 판정을 세션 종류로 분기**
단건 승인에도 D-36 을 적용해야 시안의 "이 건만 승인" 이 주강사에게 동작한다.
클래스 회차(`class_id` 있음)만 `can_approve_report` 를 타고,
**상담 세션은 기존 `_can_edit_report` 경로 그대로** 두어 완전 불변이다.

**② "동의 철회" 를 참여자 override 로 정의**
`ClassMember` 에 리포트 동의 필드가 없다. 209/217 계약상 회차별 override 는
참여자에 있으므로 `report_consent_override=True AND report_included=False` 를 철회로 본다.
override 없이 기본 제외인 경우는 `consent_withdrawn` 이 아니라 `not_target` 이다 —
애초에 대상이 아니었던 것과 철회한 것은 다르다.

---

## 5. 하지 않은 것 · 미측정 (정직하게)

### 미측정으로 남은 verify 항목
| ID | 왜 |
|---|---|
| **H1~H7** 통합 여정 | 실제 앱 서버·브라우저를 띄운 수동/E2E 여정을 돌리지 않았다. 로컬에 dev 서버·Redis·Celery 를 세우지 않았다 |
| **G5** 4뷰포트 | 컴포넌트 단위 테스트만 했다. 실제 렌더링 뷰포트 측정은 미실행 (시안 HTML 단계에서는 24조합 측정 통과했으나 **React 구현본은 별개**) |
| **B14** 메일 예약 실패 | 브로커 장애를 주입하지 않았다. 코드 경로는 있으나 실행 검증 없음 |
| **E8** 데이터 유실 구분 | 판정 분기는 구현·단위 검증했으나, 실제 유실 데이터 표본으로는 확인하지 않았다 |
| **H7** SDD-212 큐 간섭 | 대량 작업 시 기존 리포트 큐와의 상호작용 미측정 |

### 범위에서 제외 (계획대로)
- 과거 자료 **백필 실행** — 설계만. 운영 백필은 별도 승인 건
- 상담 Phase 6·7, 새 리포트 유형, 개인 장기 기준선, 새 AI 엔진
- 점수·순위·강사 비교·`eeg.score` 추이 사용
- `_can_edit_report` 편집 권한 확대, org_admin 열람 확대

### 알려진 한계
- 일괄 처리는 **FastAPI BackgroundTask** 로 돌린다. Celery 태스크(BE-9)는 만들지 않았다.
  단일 프로세스에서는 동작하나, 다중 워커·프로세스 재시작 시 중단된 작업을
  이어받는 장치가 없다. 건별 멱등과 `(job_id, report_id)` 유니크가 있어 **중복 처리는
  일어나지 않지만**, `pending` 으로 남은 건을 자동 재개하지는 않는다(수동 retry 필요).
  운영 규모가 커지면 Celery 이관이 필요하다.
- `useSessionReportRows` 는 회차 수만큼 리포트 목록을 호출한다. 회차가 많은 클래스에서
  요청이 늘어난다. 서버 쪽 일괄 조회 경로를 두는 편이 낫다.
- 프론트 전체 스위트에 **기존 실패 8파일 15건**이 있다. 218 변경 전에도 동일하게
  실패함을 stash 로 확인했다(DashboardPage 폰트, 브라우저 `.cjs` 스위트 등). 218 과 무관.

---

## 6. 다음 단계

1. **217 을 develop 에 머지** → 218 을 develop 으로 재리베이스 → `check-alembic-heads.py` 재확인
2. 미측정 항목 중 **H1~H3, G5** 는 dev 배포 후 실제 화면에서 확인
3. PR 생성 시 전체 CI 가 머지 게이트
4. R1 화면을 클래스 상세 리포트 탭에 연결하는 라우팅은 아직 붙이지 않았다 —
   컴포넌트는 완성됐고 `class-team-reports.tsx` 교체 지점만 남았다

---

## 7. 파일 목록

**백엔드 신규**: `models/class_report_job.py` · `services/class_report_job_service.py` ·
`services/class_report_trend_service.py` · `api/v1/class_reports.py` ·
`schemas/class_report_job.py` · `alembic/versions/e036a0000058_sdd218_report_jobs.py`

**백엔드 수정**: `services/report_service.py`(승인 판정·자동 승인 분기) ·
`services/dev_data_reset.py` · `models/__init__.py` · `api/v1/__init__.py`

**프론트 신규**: `lib/api/class-reports.ts` · `components/class/structure/` 아래
`class-report-manage.tsx` · `class-report-job.tsx` · `member-class-trend.tsx` ·
`class-session-summary.tsx` · `report-status.ts`

**테스트 신규**: `test_sdd218_report_approval_authority.py` · `test_sdd218_report_job.py` ·
`test_sdd218_report_job_api.py` · `test_sdd218_trend.py` · `test_sdd218_auto_approve_split.py` ·
`tests/pg/test_sdd218_schema.py` · `frontend/tests/sdd218-report-ui.test.tsx`

**디자인**: `designs/class-structure-phase5/phase5-report-trend.html` (승인된 시안)
