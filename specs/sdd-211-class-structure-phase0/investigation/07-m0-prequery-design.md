# 07 — M0 사전 조회 설계 (분포 조회 · 102 vs 134 · 수동 RDS 스냅샷)

> SDD-211 Phase 0 항목 7. 조사일 2026-10-18. **읽기 전용 조사 + 설계 문서.** DB·서버·AWS 에 접속하지 않았고(psql/ssh/SSM/aws 호출 0건), 코드·git 변경 없음. 이 문서의 SQL·AWS CLI 는 전부 **템플릿이며 미실행**이다. 실행은 구현 단계(Brian 승인 후).
> ROOT=`/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0`. 경로 접두 `backend/app/models/` 는 `m/` 로 줄여 적는다 (예: `m/session.py:43`).
> 표기: 근거는 `파일:줄`, 확인 못 한 것은 `미확인`, 선택이 필요한 것은 `결정 M0-D#` (§7 에 모음).

---

## 0. 요약

| 항목 | 결론 | 근거 |
|---|---|---|
| R7/R10 초안 SQL 의 테이블·컬럼 | **존재하지 않는 컬럼은 없다.** 단 ① 활성 참여자 정의가 R7 D-2/D-4 와 R10 Q2/Q4/Q5 에서 **서로 다름** ② R7 D-2/D-4/D-5/D-6 은 `WITH` 로 시작해 기존 러너(`baseline-snapshot.py:30`)의 "SELECT 로 시작" 가드에서 **거부됨** ③ R7 §4.1·§7.2·§8 의 `class_id`·`counseling_relationship_id`·`session_migration_map` 등은 head `e036a0000051` 에 **없음**(M1 이후) → M0 에서 쓰면 안 됨 ④ D-3/Q3 의 `custom_type_name` 은 호스트 자유 입력(≤30자) — "개인정보 아님"(R10 Q3 주석)은 근거 없음 | §1.2 |
| 기준선 102 가 센 것 | dev DB, `sessions` 테이블, `is_template = false`, 상태 전부(숨김 개념 없음 — `hidden_at` 은 head 42 에서 도입), head `e036a0000041`, 2026-10-17 오후, 원시 SQL(ORM 필터 무관) | `baseline-snapshot.sql:6-10`, `baseline.md:46,53,63` |
| SDD-210 134 | 질의 원문·템플릿/숨김 포함 여부가 **문서에 기록되지 않음**. 상태 분해 105/19/3/1/6, head `e036a0000051`, 같은 날 | `sdd-210/plan.md:25,93`, `spec.md:16` |
| 102→134 원인 | **증명되지 않음(`미확인`).** 가장 유력한 가설 = "측정 시점 차 + 그 사이 SDD-209 배포·E2E 가 만든 잔여 클래스(삭제 API 가 B1 이후 '숨김'으로 보존 전환)". 템플릿 포함은 최대 1건만 설명 | §3 |
| 실행 경로 | dev 는 **SSM 미등록**(관리 인스턴스 0대) → 문서화된 경로는 SSH(선례). RDS 는 퍼블릭 아님·5432 는 자기 SG 만 → 서버에서만 접속 가능. 자격은 서버 `.env.dev` 의 `DATABASE_URL` | `sdd-210/plan.md:32,47,48`, `baseline.md:46`, `baseline-snapshot.py:4-7` |
| 스냅샷 | 인스턴스 `mindbreeze-dev`, 프로파일 `looxid-las`, 리전 `ap-northeast-1`. **dev 스냅샷은 전부 비암호화**(개인·생체 데이터 포함) → 보관 기간·접근 제한 필요. 선례 이름 `mindbreeze-dev-pre-envsplit-20261010` | `sdd-210/plan.md:48`, `sdd-210/spec.md:24`, `sdd-197/summary.md:12`, `기획.md:611` |

---

## 1. (A) 분포 조회 설계

### 1.1 공통 규칙

**범위 정의 S**: `sessions` 중 `is_template = false`, **숨김(`hidden_at IS NOT NULL`) 포함**, 모든 상태. 이유: 백필은 숨김 세션도 이전한다(R7 §4.7, `R7:255`)이고, 원시 SQL 은 ORM 전역 필터(`backend/app/core/database.py:15-47`)를 타지 않는다.

**활성 참여자 정의 ACT** (R7 §4.1 / D-2 와 동일 — 이후 모든 질의가 이 한 가지만 사용):
`p.removed_at IS NULL AND p.waitlist_cancelled_at IS NULL AND p.is_waitlisted = false AND p.user_id IS DISTINCT FROM s.host_id`
(컬럼: `m/session.py:150,160,142,125`, 호스트 `:49`.)

**읽기 전용 강제 (3중)**

1. 연결 수준: 러너가 `connect_args={"options": "-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=2000"}` 로 접속(서버 측 DB 변경 없음).
2. 트랜잭션 수준: 전체를 한 트랜잭션으로 — `BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;` → `SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='2s'; SET LOCAL idle_in_transaction_session_timeout='120s';` → 질의들 → **`ROLLBACK`**(COMMIT 아님). REPEATABLE READ 로 모든 질의가 **같은 시점의 스냅샷**을 본다 — §3 의 "단일 감독 패스"에 필수(질의 사이에 E2E/사용자가 행을 추가해도 숫자가 일관). 기준선 러너는 `SET TRANSACTION READ ONLY` 만 사용(`baseline-snapshot.py:35`).
3. 문장 수준: 러너가 각 문장을 `^select\b` 로 검증(`baseline-snapshot.py:30` 선례) + 금지어 정규식(`insert|update|delete|alter|drop|create|truncate|grant|revoke|copy|call|do|vacuum|analyze|lock|pg_read_file|lo_|dblink|set\s+(?!local)`)에 걸리면 즉시 중단. **이 문서의 모든 질의는 `WITH` 를 쓰지 않고 `SELECT` 로 시작**하도록 서브쿼리로 재작성했다(기존 러너 가드 통과).
   - 러너 한계(`baseline-snapshot.py:26-28`): 주석을 `--[^\n]*` 로 지우고 `;` 로 문장을 쪼갠다 → **SQL 문자열 리터럴에 `--`·`;` 금지**. `%` 는 이스케이프 문제를 피하려고 `LIKE` 대신 `left(...)=` 를 썼다.
   - 구현 단계에서 `backend/scripts/` 가 아닌 `specs/sdd-211-class-structure-phase0/` 에 `m0-prequery.sql`(질의) + `m0-prequery.py`(위 3중 강제를 넣은 얇은 러너, `baseline-snapshot.py` 복제)를 둔다(선례: `specs/sdd-209-class-flow-redesign/baseline-snapshot.{sql,py}`). 서버 DB 계정은 앱 계정이라 쓰기 권한이 있으므로(읽기 전용 롤 신설은 DB 변경 → M0 범위 밖) 1)~3) 이 유일한 방어선이다.

**출력 규칙**: 첫 열 `qid`(질의 ID). 바깥 SELECT 목록에는 **리터럴·범주형 컬럼(type, participant_mode, status, role, auth_provider)·불리언·구간(bucket)·집계만**. 원시 `id`/`host_id`/`user_id`/`organization_id`/`member_id` 는 서브쿼리 안에서만 사용하고 바깥으로 내보내지 않는다.

### 1.2 R7/R10 초안 ↔ 모델 검증

| 초안 | 사용 컬럼 | 모델 근거 | 판정 |
|---|---|---|---|
| R7 D-1 | `sessions.type/participant_mode/is_template/hidden_at/status` | `m/session.py:43,79,94,104,45` | 존재 ✓ |
| R7 D-2 | `session_participants.removed_at/waitlist_cancelled_at/is_waitlisted/user_id/id`, `sessions.host_id` | `m/session.py:150,160,142,125,123,49` | 존재 ✓ / **`WITH` 시작 → 기존 러너 거부**(`baseline-snapshot.py:30`) |
| R7 D-3, R10 Q3 | `sessions.custom_type_name` | `m/session.py:44` (String(30)) | 존재 ✓ / **자유 입력**: 마법사 입력란(`frontend/src/components/class/flow/host/wizard-steps.tsx:56` placeholder "클래스 유형 이름 (예: 감정 코칭)"), 서버 검증은 길이 30 과 `custom` 일 때 필수뿐(`backend/app/schemas/session.py:21,59-60,78`). R10 Q3 의 "개인정보 아님" 단정은 코드로 뒷받침되지 않음 → §1.4 |
| R7 D-4/D-5/D-6 | `client_counselor_links.client_id/counselor_id/status`, `sessions.organization_id` | `m/client_counselor_link.py:18,19,20`, `m/session.py:52` | 존재 ✓ / `WITH` 시작 → 거부. **정의 문제**: D-4 는 `ACT` 를 쓰지만 "활성 참여자 정확히 1명" 조건이 없어, 2명 이상 상담(→ 클래스, 규칙 C3)의 (호스트, 회원) 쌍까지 센다 → §1.3 A5 에서 `n_active=1 AND n_member=1` 로 교정 |
| R7 D-7 | `users.status`, `sessions.host_id` | `m/user.py:106` | ✓ |
| R7 D-8 | `access_code`, `hidden_at` | `m/session.py:62,104` | ✓ (값 비조회, `length()` 만) |
| R7 D-9 | `notifications.extra`(JSONB), `agent_messages.ref_type`, `agent_delivery_logs`, `session_email_invites` | `m/notification.py:27`, `m/agent.py:79,136`, `m/session_email_invite.py:22` | ✓ |
| R7 D-10~D-12 | `status IN ('open','in_progress')`, `scheduled_at`, `is_template`, `host_id` | `backend/app/schemas/session.py:14`, `m/session.py:58` | ✓ |
| R10 Q1 | `max_participants` | `m/session.py:72` | ✓ / 생성 스키마 기본값이 10 이라(`backend/app/schemas/session.py:28`) `max_participants > 1` 은 거의 항상 참 — 구분력 약함(R7 §4.1 도 정원 판정 금지: `R7:189`) |
| R10 Q2 | 서브쿼리 `removed_at IS NULL` 만 | — | 존재 ✓ / **정의 불일치**: 호스트 제외·대기자 제외·대기 취소 제외가 빠져 R7 `ACT` 와 다른 숫자가 나옴 → §1.3 A3 로 대체 |
| R10 Q4/Q5 | `host_id`, `user_id`, `link` 컬럼 | 위와 동일 | 존재 ✓ / **정의 불일치**: Q4 는 호스트 자신·제거·대기 행을 포함, Q5 는 `removed_at` 등 필터 없음 → A5/A6 로 대체 |
| R7 §4.1·§7.2·§8 | `sessions.class_id`, `counseling_relationship_id`, `seq`, `session_migration_map`, `classes`, `class_instructors`, `counseling_relationships` | `grep -rn "class_instructors\|session_migration_map\|counseling_relationships" backend/app backend/alembic` → **0건** | **head `e036a0000051` 에 없음** (M1 신설 예정). M0 질의에 사용 금지. R7 V1~V19 는 M2 이후 검증용 |
| baseline Q1~Q11 | `audio_chunks/video_chunks` (`file_path`, `size_bytes`, `created_at`), `eeg_raw_chunks`(`upload_status`, `uploaded_at`), `session_records`(`transcript`, `ai_summary`, `video_s3_key`, `audio_s3_key`, `status`), `eeg_feature_windows.participant_id`, `eeg_records.file_count`, `reports`(`type/status/content/sent_at`), `narrative_cache.source`, `alembic_version` | `m/record.py:58-59,79-80,166,170,172,111,19-21,26,31,215-216,218,234`, `m/eeg_feature.py:65`, `m/narrative_cache.py:18`, `m/session.py:132` | 존재 ✓ (2026-10-17 에 실제 실행되어 결과 확보 — `baseline.md:46`) |

alembic 확인: R7 이 쓰는 컬럼의 도입 리비전 — `hidden_at`·`removed_at` = `e036a0000042`, `waitlist_cancelled_at` = `e036a0000046`, `entered_at` = `e036a0000051`, `pii_scrubbed_at` = `e036a0000048/49`, `custom_type_name`·`participant_mode` = `0f5a7c2b9e14`, `is_template` = `e036a0000018`, `legacy_access_code` = `e036a0000044` (각 `backend/alembic/versions/` grep). 정적 계산상 head 는 `e036a0000051` 단일(리비전 선언 84개 파일 파싱, 비-head 아님 확인).

### 1.3 질의 (구체 SQL — 문법 미검증, 미실행)

**매크로 `<A>`** — 세션 1건당 활성 참여자 요약. 구현 파일(`m0-prequery.sql`)에서는 매크로 없이 **그대로 전개**하고 리뷰어는 전개본을 본다.

```sql
SELECT s.id, s.type, s.participant_mode, s.host_id, s.organization_id, s.max_participants, s.custom_type_name,
       count(p.id) FILTER (WHERE p.removed_at IS NULL AND p.waitlist_cancelled_at IS NULL
                             AND p.is_waitlisted = false AND p.user_id IS DISTINCT FROM s.host_id) AS n_active,
       count(p.id) FILTER (WHERE p.removed_at IS NULL AND p.waitlist_cancelled_at IS NULL
                             AND p.is_waitlisted = false AND p.user_id IS NOT NULL
                             AND p.user_id IS DISTINCT FROM s.host_id) AS n_member,
       count(p.id) FILTER (WHERE p.removed_at IS NULL AND p.waitlist_cancelled_at IS NULL
                             AND p.is_waitlisted = false AND p.user_id IS NULL) AS n_guest,
       count(p.id) FILTER (WHERE p.user_id IS DISTINCT FROM s.host_id) AS n_nonhost_rows,
       (array_agg(p.user_id) FILTER (WHERE p.removed_at IS NULL AND p.waitlist_cancelled_at IS NULL
                             AND p.is_waitlisted = false AND p.user_id IS NOT NULL
                             AND p.user_id IS DISTINCT FROM s.host_id))[1] AS member_id
FROM sessions s LEFT JOIN session_participants p ON p.session_id = s.id
WHERE s.is_template = false
GROUP BY s.id
```
(`GROUP BY s.id` 는 PK 함수 종속이라 나머지 `s.*` 열을 허용. `member_id` 는 `n_member=1` 일 때만 사용하므로 순서 무관.)

**A1 — 유형 × 참여 방식 × 템플릿 × 숨김 × 상태 (R7 D-1 그대로, 검증 완료)**
```sql
SELECT 'A1' AS qid, type, participant_mode, is_template, (hidden_at IS NOT NULL) AS hidden, status, count(*) AS sessions
FROM sessions GROUP BY 2,3,4,5,6 ORDER BY 2,3,4,5,6
```
→ 템플릿·숨김·삭제(숨김) 건수의 1차 근거이자 §3 판별 행렬.

**A2 — 유형 × 참여 방식 × 활성 참여자 구간(0, 1, ≥2) × 단일 참여자 종류 (R7 D-2 재작성)**
```sql
SELECT 'A2' AS qid, a.type, a.participant_mode,
       LEAST(a.n_active, 2) AS active_bucket,                                    -- 0 / 1 / 2(=2명 이상)
       CASE WHEN a.n_active = 1 THEN CASE WHEN a.n_member = 1 THEN 'member' ELSE 'guest' END ELSE '-' END AS single_kind,
       (a.n_active = 0 AND a.n_nonhost_rows > 0) AS zero_active_but_rows_exist,  -- 제거/대기자만 있는 세션(R7 §11 #6 미확인 해소)
       count(*) AS sessions
FROM ( <A> ) a
GROUP BY 2,3,4,5,6 ORDER BY 2,3,4,5,6
```
→ 분류 규칙 C1/C2/C3/R1/R2/R3 별 예상 건수(R7 §4.1 표)의 직접 근거. `single_kind='guest'` = R2 후보(비회원 상담 세션 수).

**A3 — 집단형 상담 후보 (clinical·hypnosis + group) — D-55 재확인 트리거 (R10 Q2 대체)**
```sql
SELECT 'A3' AS qid, a.type, a.participant_mode, LEAST(a.n_active, 2) AS active_bucket,
       CASE WHEN a.max_participants IS NULL THEN 'null' WHEN a.max_participants <= 1 THEN '<=1'
            WHEN a.max_participants < 10 THEN '2-9' ELSE '>=10' END AS capacity_bucket,
       count(*) AS sessions
FROM ( <A> ) a
WHERE a.type IN ('clinical','hypnosis')
GROUP BY 2,3,4,5 ORDER BY 2,3,4,5
```
판독: `participant_mode='group' AND active_bucket<=1` 건수 = R7(참여자 수만 판정)과 R10(group 이면 클래스)이 **갈리는 세션 수**(`결정-필요.md:104` D-55 의 확정 조건). `participant_mode='one_on_one' AND active_bucket=2` = 규칙 C3 대상.

**A4 — `custom` 유형 (자유 라벨 안전 취급: §1.4 결정 M0-D2)**
```sql
-- A4a 규모 (라벨 비출력)
SELECT 'A4a' AS qid, a.participant_mode, LEAST(a.n_active, 2) AS active_bucket,
       count(*) AS sessions, count(DISTINCT lower(btrim(a.custom_type_name))) AS distinct_labels
FROM ( <A> ) a WHERE a.type = 'custom' GROUP BY 2,3 ORDER BY 2,3

-- A4b 키워드 초안 분류 건수 (D-56 의 키워드를 서버 안에서만 적용, 라벨 비출력)
SELECT 'A4b' AS qid,
       CASE WHEN coalesce(a.custom_type_name ~* '(명상|마음챙김|호흡|요가|MBSR)', false)
             AND coalesce(a.custom_type_name ~* '(상담|치료|코칭|심리|면담)', false) THEN 'conflict'
            WHEN coalesce(a.custom_type_name ~* '(명상|마음챙김|호흡|요가|MBSR)', false) THEN 'kw_meditation'
            WHEN coalesce(a.custom_type_name ~* '(상담|치료|코칭|심리|면담)', false) THEN 'kw_counseling'
            ELSE 'kw_none' END AS kw_class,
       a.participant_mode, LEAST(a.n_active, 2) AS active_bucket, count(*) AS sessions
FROM ( <A> ) a WHERE a.type = 'custom' GROUP BY 2,3,4 ORDER BY 2,3,4

-- A4c 라벨 빈도의 분포 (라벨 비출력: "한 번만 쓰인 라벨이 몇 개" 형태)
SELECT 'A4c' AS qid, x.n AS sessions_per_label, count(*) AS labels
FROM (SELECT lower(btrim(custom_type_name)) AS lbl, count(*) AS n
      FROM sessions WHERE type = 'custom' AND is_template = false GROUP BY 1) x
GROUP BY 2 ORDER BY 2

-- A4d [감독 하 2단계, 기본 비실행] 라벨 원문 상위 N (k 이상만, 화면 출력 전용, 파일/저장소 기록 금지)
SELECT 'A4d' AS qid, lower(btrim(custom_type_name)) AS label, count(*) AS sessions
FROM sessions WHERE type = 'custom' AND is_template = false
GROUP BY 2 HAVING count(*) >= 3 ORDER BY 3 DESC LIMIT 20
```
(`custom_type_name` 은 A4a 의 `count(DISTINCT …)`, A4b 의 정규식 술어, A4c 의 서브쿼리 그룹 키로만 쓰이고 **바깥으로 출력되지 않는다**. A4d 만 예외이며 §1.4.)

**A5 — 관계 묶기 후보 (상담사, 회원) 쌍 (R7 D-4/D-5/D-6 + R10 Q4 대체; 규칙 R1 과 같은 모집단)**

쌍 모집단 `<P>` = `<A>` 에서 `a.type IN ('clinical','hypnosis') AND a.n_active = 1 AND a.n_member = 1` 인 세션을 `(host_id, member_id)` 로 묶은 것:
```sql
SELECT a.host_id, a.member_id, count(*) AS n_sessions,
       count(DISTINCT a.organization_id) AS n_orgs, bool_or(a.organization_id IS NULL) AS has_null_org
FROM ( <A> ) a
WHERE a.type IN ('clinical','hypnosis') AND a.n_active = 1 AND a.n_member = 1
GROUP BY a.host_id, a.member_id
```
```sql
-- A5a 쌍별 세션 수 히스토그램 (R7 D-4)
SELECT 'A5a' AS qid,
       CASE WHEN pr.n_sessions <= 5 THEN pr.n_sessions::text WHEN pr.n_sessions <= 10 THEN '6-10' ELSE '11+' END AS sessions_per_pair,
       count(*) AS pairs, sum(pr.n_sessions) AS sessions
FROM ( <P> ) pr GROUP BY 2 ORDER BY min(pr.n_sessions)

-- A5b 쌍·상담사·회원 수, 기관 혼재 (R7 D-6)
SELECT 'A5b' AS qid, count(*) AS pairs, count(DISTINCT pr.host_id) AS counselors, count(DISTINCT pr.member_id) AS members,
       sum(pr.n_sessions) AS sessions, count(*) FILTER (WHERE pr.n_orgs > 1) AS mixed_org_pairs,
       count(*) FILTER (WHERE pr.has_null_org) AS pairs_with_null_org_session
FROM ( <P> ) pr

-- A5c 쌍의 client_counselor_links 보유/상태 (R7 D-5, R10 Q4)
SELECT 'A5c' AS qid, coalesce(l.status, '(no link)') AS link_status, count(*) AS pairs
FROM ( <P> ) pr
LEFT JOIN client_counselor_links l ON l.client_id = pr.member_id AND l.counselor_id = pr.host_id
GROUP BY 2 ORDER BY 2
```
변형 **A5a'/A5b'**: `<P>` 의 WHERE 를 `(a.type IN ('clinical','hypnosis') OR (a.type = 'custom' AND a.participant_mode <> 'group')) AND a.n_active = 1 AND a.n_member = 1` 로 바꿔 `custom`(규칙 7)을 더한 상한 추정을 함께 낸다. 결정 D-57(a) 은 "회원 쌍 묶기" 확정이므로(`결정-필요.md:147`) 이 히스토그램은 **묶기 효과의 크기** 보고용이다.

**A6 — 비회원 상담 참여자 (R10 Q5 대체)**
```sql
SELECT 'A6' AS qid, s.type,
       count(p.id) FILTER (WHERE p.user_id IS NULL) AS guest_rows_all,
       count(p.id) FILTER (WHERE p.user_id IS NULL AND p.removed_at IS NULL AND p.waitlist_cancelled_at IS NULL
                             AND p.is_waitlisted = false) AS guest_rows_active,
       count(DISTINCT s.id) FILTER (WHERE p.user_id IS NULL AND p.removed_at IS NULL AND p.waitlist_cancelled_at IS NULL
                             AND p.is_waitlisted = false) AS sessions_with_active_guest,
       count(p.id) FILTER (WHERE p.user_id IS NULL AND p.removed_at IS NULL AND p.waitlist_cancelled_at IS NULL
                             AND p.is_waitlisted = false AND p.pii_scrubbed_at IS NOT NULL) AS active_guest_pii_scrubbed,
       count(p.id) FILTER (WHERE p.user_id IS NULL AND p.removed_at IS NULL AND p.waitlist_cancelled_at IS NULL
                             AND p.is_waitlisted = false AND p.report_email IS NOT NULL) AS active_guest_has_report_email
FROM sessions s JOIN session_participants p ON p.session_id = s.id
WHERE s.is_template = false GROUP BY 2 ORDER BY 2
```
(`pii_scrubbed_at`/`report_email` 은 **존재 여부(IS NOT NULL)만** — 값 비조회. `baseline-snapshot.sql:17` 의 `count(report_email)` 선례.) 단일 비회원 상담 세션(R2) 수는 A2 의 `single_kind='guest'`. `active_guest_pii_scrubbed` 는 R7 §4.3 "스크럽된 행은 `pii_scrubbed_at` 도 복사" 대상 크기.

**A7 — 숨김·템플릿·삭제·제거 건수**
```sql
-- A7a 참여자 보존 전환 플래그 (R7 V6 의 이전 전 값)
SELECT 'A7a' AS qid, (user_id IS NULL) AS is_guest, is_waitlisted, (removed_at IS NOT NULL) AS removed,
       (waitlist_cancelled_at IS NOT NULL) AS wl_cancelled, count(*) AS participants
FROM session_participants GROUP BY 2,3,4,5 ORDER BY 2,3,4,5

-- A7b 호스트 계정 상태 × 세션 상태 (R7 D-7)
SELECT 'A7b' AS qid, u.status AS host_status, s.status AS session_status, count(*) AS sessions
FROM sessions s JOIN users u ON u.id = s.host_id WHERE s.is_template = false GROUP BY 2,3 ORDER BY 2,3

-- A7c 하드 삭제 흔적 (메타데이터만; 통계 리셋 이후 누적)
SELECT 'A7c' AS qid, relname, n_tup_ins, n_tup_upd, n_tup_del, n_live_tup, n_dead_tup
FROM pg_stat_user_tables WHERE relname IN ('sessions','session_participants','session_records','reports') ORDER BY relname

SELECT 'A7d' AS qid, stats_reset FROM pg_stat_database WHERE datname = current_database()
```
"삭제"의 의미: 현행 일반 삭제는 `hidden_at` 기록(숨김)이고(`backend/app/services/session_service.py:896-919`), 하드 삭제는 B1 이전 `db.delete(s)` 경로뿐(`git show fc5fd50b^:…/session_service.py:817-832`) → **A1 의 hidden 열 = 삭제된 것으로 보이는 세션 수**, 하드 삭제는 DB 에 흔적이 없어 A7c(`n_tup_del`)로만 추정(통계 리셋·재시작으로 유실될 수 있음 `미확인`).

**A8 — 기관별 세션 수 (기관명·ID 비출력, 순위로만)**
```sql
SELECT 'A8' AS qid, row_number() OVER (ORDER BY o.n_sessions DESC) AS org_rank, (o.organization_id IS NULL) AS no_org,
       o.n_sessions, o.n_meditation, o.n_clinical_hypnosis, o.n_custom, o.n_hosts, o.attribution_all_known
FROM (SELECT s.organization_id, count(*) AS n_sessions,
             count(*) FILTER (WHERE s.type = 'meditation') AS n_meditation,
             count(*) FILTER (WHERE s.type IN ('clinical','hypnosis')) AS n_clinical_hypnosis,
             count(*) FILTER (WHERE s.type = 'custom') AS n_custom,
             count(DISTINCT s.host_id) AS n_hosts,
             bool_and(s.organization_attribution_known) AS attribution_all_known
      FROM sessions s WHERE s.is_template = false GROUP BY s.organization_id) o
ORDER BY org_rank
```
(`organizations.name`·`org_code`·`biz_number` 등은 조회하지 않는다 — `m/organization.py:17,19,21-24`. 바깥 SELECT 에 `organization_id` 없음.)

**A9 — R7 §3.2 나머지 (원문 그대로 사용, 컬럼 검증 완료)**: D-8(코드 길이 × 상태 × 숨김 — `length(access_code)` 만), D-9(딥링크 영속 행 수 4개 스칼라), D-10(`status IN ('open','in_progress')`), D-11(`scheduled_at IS NULL` 개수), D-12(템플릿 수·보유 호스트 수). 모두 `SELECT` 로 시작하므로 가드 통과. 각 앞에 `'A9-D8' AS qid` 식 리터럴 열만 추가.

**C 계열 (기준선 재현·102 vs 134 판별)** 은 §3.3 에 있다. **B0 (메타)**:
```sql
SELECT 'B0' AS qid, now() AS db_now, current_setting('TimeZone') AS db_timezone,
       (SELECT version_num FROM alembic_version) AS alembic_head
```
(`db_timezone` 은 baseline Q1 의 `created_at::date`(`baseline-snapshot.sql:9`)가 어느 시간대로 잘렸는지 `미확인`을 해소한다. `alembic_version` 단일 행이면 head 단일.)

### 1.4 금지 컬럼 체크리스트 (바깥 출력·`ORDER BY`·`GROUP BY` 키로 노출 금지)

| 테이블 | 금지(값 조회 불가) | 허용되는 사용 형태 |
|---|---|---|
| `sessions` | `title`, `notes`, `access_code`·`legacy_access_code`(값), `location_address`, `webrtc_room_id`, `custom_type_name`(A4d 외), 모든 ID(`id`,`host_id`,`organization_id`,`run_id`) | `length(access_code)`, `left(title,4)='E2E-'` 같은 **고정 리터럴 불리언 술어**, `count(DISTINCT lower(btrim(custom_type_name)))`, 서브쿼리 내부 ID |
| `session_participants` | `guest_name`, `gender`, `birth_date`, `report_email`, `linkband_device_id`, `webrtc_peer_id`, 모든 ID(`id`,`user_id`,`session_id`) | `IS [NOT] NULL`·`count(col)` 존재 여부, `user_id IS NULL` 비회원 판정 |
| `users` | `email`, `name`, `phone`, `bio`, `profile_image`, `password_hash`, `notification_preferences`, `org_id`, `id` | `role`, `status`, `auth_provider`(범주형) |
| `organizations` | `name`, `ceo_name`, `biz_number`, `address`, `phone`, `id` | `org_code = 'E2E001'` **한 가지 고정 리터럴 술어**(E2E 시드 기관: `backend/scripts/e2e_seed.py:31`)만 |
| `client_counselor_links` | `memo`(상담사 비공개 메모, `m/client_counselor_link.py:24`), ID | `status` |
| `session_records` / `reports` | `transcript`, `counselor_notes`, `ai_summary`, `markers`, `content` | `length()`/`pg_column_size()`/`count` (baseline Q6·Q8 선례) |
| `notifications` / `agent_messages` / `session_email_invites` | `title`, `body`, `extra` 전체, `content`, `cta`, `email`, `email_norm` | `extra->>'target_type' = 'session'` 술어와 `count` 만 |
| 공통 | 원시 UUID, 생성·수정 시각의 **행 단위 출력** | `date`/`hour` 버킷 집계 |

### 1.5 `custom_type_name` 취급 — 결정 M0-D2 (Brian)

- 사실: 호스트 자유 입력 ≤30자. 사람 이름·기관명이 들어갈 수 있다. 저장소는 **공개**(`sdd-210/plan.md:22,297,318`)이므로 원문이 보고서에 들어가면 곧 공개다.
- **기본안(권장)**: 1단계 = A4a·A4b·A4c 만 실행·보고(라벨 비출력). D-56 이 필요로 하는 것 — "키워드 규칙이 몇 건을 커버하고 몇 건이 conflict/none 인가" — 은 A4b 가 답한다. 2단계 A4d 는 **A4b 의 `conflict`+`kw_none` 이 규칙 확정에 필요할 때만**, Brian 이 지켜보는 상태에서 `k=3` 이상 라벨만 화면 출력, 파일·저장소·Linear 기록 금지, Brian 이 라벨별 지정표(D-56 옵션)를 직접 주는 경로로 사용. 보고서에는 "상위 라벨 N종 검토함, 개인명 의심 M건 제외" 같은 **메타 문장**만.
- 대안 ① A4d 를 아예 하지 않고 호스트 확인 질문(D-56 "분류 확인 필요 목록")으로 대체. ② A4d 결과를 Linear 비공개 코멘트에 라벨 그대로 기재(공개 저장소 밖) — 권장하지 않음.
- 소량 셀: 라벨 수가 적으면(`distinct_labels` 가 작음) 개별 라벨이 식별 가능 → A4c 의 `sessions_per_label=1` 행은 "1회 사용 라벨 N종" 으로만 보고.

### 1.6 소량 셀(small-cell) 억제 — 결정 M0-D1 (Brian)

- 규모: 실사용 계정 약 15, 기관 6, 세션 100대 (`sdd-210/spec.md:16`, `plan.md:92-93`). 사람·기관 단위 분해(A5·A6·A7b·A8·C3b)는 셀이 1~2 건이 되기 쉽다.
- **기본안**: ① 서버 원본 출력(전 셀 수치)은 **Brian 에게만**(Linear 비공개 코멘트 또는 채팅) 전달. ② **저장소에 커밋하는 보고서**(`m0-report.md`)는 사람/기관 단위 셀(A5·A6·A7b·A8·C3b)에서 **`< 3` 은 `<3` 으로 표기**하고 합계 행은 억제하지 않는다. ③ 세션 단위 집계(A1~A3·A4a~c·A9·C 계열)는 기준선 선례(`baseline.md:53`, 진행 중 1건 등 공개)대로 그대로 기재.
- 대안: 전부 억제 없이 커밋(선례와 같은 수준이지만 기관 순위 표는 재식별 위험) / 전부 비공개(저장소엔 "Brian 보고 완료" 한 줄).

### 1.7 실행 전 리뷰어 체크리스트 (모두 통과해야 서버로 복사)

- [ ] R0 로컬/CI 의 **빈 PostgreSQL**(`alembic upgrade head` 적용본, 실데이터 없음)에서 모든 질의를 `EXPLAIN`(또는 `LIMIT 0` 실행)으로 **컬럼·문법 검증**했다. (실데이터 복원본을 CI/GitHub Actions 에 올리지 않는다 — 공개 저장소·비암호화 스냅샷.)
- [ ] R1 각 문장이 `SELECT` 로 시작, 문장 구분 `;` 외 세미콜론·`--` 없음(문자열 리터럴 포함).
- [ ] R2 금지어(§1.1-3) grep 0건. `SET` 은 러너가 넣는 `SET LOCAL` 3개뿐.
- [ ] R3 바깥 SELECT 목록 검사: ID 열·이름·이메일·제목·메모·코드 값 없음(§1.4 표와 1:1 대조).
- [ ] R4 금지 컬럼이 나오는 모든 위치가 "허용되는 사용 형태" 표에 해당(술어/존재 여부/길이/`COUNT`).
- [ ] R5 각 질의의 이론상 최대 행 수 ≤ 100, 비집계 목록은 `LIMIT` 존재(A4d 만).
- [ ] R6 A4d 는 기본 제외 목록에 있고, 실행 시 Brian 입회 기록이 있다(M0-D2).
- [ ] R7 `m0-prequery.sql` 의 sha256 를 리뷰 기록에 남기고, 서버에 복사한 파일의 sha256 와 일치함을 확인했다.
- [ ] R8 dev 배포(`deploy-dev.yml`)·E2E 스모크가 실행 중이 아니다(`gh run list` 읽기, 동시 실행 그룹 `deploy-dev.yml:20`).
- [ ] R9 출력 파일 저장 위치·권한(0600)·삭제 계획이 정해져 있다(§2.3).
- [ ] R10 리뷰어(작성자와 다른 사람 또는 다른 에이전트)·일시 기록.

---

## 2. (B) 실행 절차

### 2.1 접속 경로 — 문서로 확인된 사실

| 사실 | 근거 |
|---|---|
| dev EC2 `i-00fd62ca8876bec8f`, 퍼블릭 IP `18.183.86.88`(**탄력 IP 아님** → 재시작 시 변경 가능) | `sdd-210/plan.md:25,28` |
| SSM agent 는 설치·실행 중이나 인스턴스 프로필이 없어 **SSM 미등록**(관리 인스턴스 0대) → **dev 에서 SSM Session Manager 는 현재 불가** | `sdd-210/plan.md:32` |
| SG `mindbreeze-dev-sg`: 22 전체 개방, **5432 는 자기 SG 만**. RDS 는 이 SG 를 사용, **퍼블릭 아님** → RDS 는 EC2 에서만 닿는다(로컬 PC 직접 접속·SG 개방·터널 불필요/금지) | `sdd-210/plan.md:47,48` |
| 기준선 선례: 로컬에서 두 파일을 dev EC2 에 **임시 복사 → 서버 `.env.dev` 의 DB 주소를 환경변수로 읽어 실행 → 임시 파일 삭제** (SSH `ubuntu@18.183.86.88`) | `baseline.md:46` |
| 서버 경로·실행 형태: `cd /home/ubuntu/mindbreeze/backend; export DATABASE_URL=$(grep -E '^DATABASE_URL=' ./.env.dev …); venv/bin/python baseline-snapshot.py …` | `baseline-snapshot.py:4-7`, 배포 경로 `deploy-dev.yml:115` |
| 자격 위치: 서버 `backend/.env.dev` 의 `DATABASE_URL`(및 `DATABASE_URL_SYNC`) — 키 이름만 문서화, 값은 어디에도 없음 | `sdd-210/plan.md:38` |
| SSH 키 위치: 구 문서는 `~/.ssh/mindbreeze/mindbreeze-dev-key.pem` 또는 EC2 Instance Connect(`specs/014-architecture-simplification/summary.md:71`), 현행 배포는 GitHub secret `EC2_SSH_KEY`·`EC2_DEV_HOST`(`deploy-dev.yml:97,109`) | **현재 Brian 로컬 키 경로는 `미확인`** |
| `psql` 클라이언트의 서버 설치 여부 | `미확인` → 기준선처럼 Python(`sqlalchemy`)러너 사용 |
| prod 는 SSM Session Manager·Parameter Store(`/mindbreeze/prod/*` → `/etc/mindbreeze/prod.env` 0600) 계획 — 컷오버 후 M2 apply 는 SSM 경유 | `sdd-210/spec.md:31`, `plan.md:135,137`, `결정-필요.md:114` |

**결정 M0-D3 (Brian)**: dev M0 조회를 선례대로 **SSH** 로 할지, 먼저 dev 에 인스턴스 프로필을 붙여 SSM 으로 할지. 후자는 AWS 리소스 변경(SDD-210 범위)이라 M0 에 묶지 않는 것을 기본값으로 한다. SSM 으로 바뀌면 같은 러너를 `aws ssm start-session`/`send-command` 로 감싸기만 하면 되고 SQL·절차는 불변.

### 2.2 절차 (구현 단계, Brian 승인 후)

1. **사전**: §1.7 리뷰어 체크리스트 통과. `gh run list --workflow deploy-dev.yml --limit 3` 로 진행 중 배포 없음 확인(`E2E` 스모크도 포함, `deploy-dev.yml:306-310`). 스냅샷(§4)이 **먼저** 만들어졌는지 확인 — 조회 자체는 읽기 전용이지만 M0 게이트 순서(스냅샷 → 기준선 → 분포)를 지킨다(`R7:275`).
2. **복사**: `m0-prequery.sql`·`m0-prequery.py`·(기준선 재실행용) `baseline-snapshot.sql` 을 서버 `~/m0/` 로 임시 복사(`umask 077`).
3. **실행**: 서버 `backend/` 에서 `export DATABASE_URL=$(grep -E '^DATABASE_URL=' ./.env.dev | head -1 | cut -d= -f2-)` (**`set -x` 금지, 값 출력 금지**) → `venv/bin/python ~/m0/m0-prequery.py ~/m0/m0-prequery.sql > ~/m0/out-YYYYMMDD-HHMM.txt`. 러너는 실행 첫머리에 `B0`(시각·TZ·head)를 출력한다.
4. **기준선 재실행**: 같은 단일 트랜잭션에서 `baseline-snapshot.sql` Q1~Q11(`baseline-snapshot.sql:6-71`)을 `C6` 로 포함 — 기준선 대비 증분을 같은 시점 값으로 비교(R7 §5 M0 ②, `R7:275`).
5. **회수**: 출력 파일을 `scp` 로 로컬에 가져오고 **서버의 `~/m0/` 전체 삭제**(선례: `baseline.md:46`). 출력은 건수·구간뿐이어야 한다(리뷰어 R3 가 사후에도 출력 grep: 이메일 패턴·UUID 패턴 0건 확인).
6. **재실행 규칙**: 같은 SQL 을 **M2 apply 직전**에 한 번 더(dev 에 E2E 가 계속 행을 추가하므로 — §3 — 이전 건수 대조 기준을 갱신). 두 번째 결과는 M2 dry-run 기록에 첨부.

### 2.3 산출물 저장·보고

| 산출물 | 위치 | 내용 | 커밋 |
|---|---|---|---|
| 질의·러너 | `specs/sdd-211-class-structure-phase0/m0-prequery.{sql,py}` (제안 이름) | 리뷰 통과본, sha256 | 예 (비밀·값 없음. 고정 리터럴은 `E2E001`, `E2E-` 뿐 — 둘 다 공개 저장소의 `e2e_seed.py`·E2E 스크립트에 이미 있음) |
| 원본 출력 | 서버 임시 → Brian 에게 전달 후 삭제 | 전 셀 수치 | **아니오** |
| 보고서 | `specs/sdd-211-class-structure-phase0/m0-report.md` (제안 이름) | §1.6 억제 규칙 적용 수치, 해석, D-55/56/57 영향, 102 vs 134 판정, 스냅샷 ID, `alembic` head | 예 |
| Linear | SDD-211 코멘트 | 보고서 전문(`CLAUDE.md` "각 Stage 완료 시 Linear 코멘트에 문서 전문") + 원본 수치(비공개) | — |

**누가 Brian 에게 보고하나**: 구현 단계의 실행 워커(Claude Code)가 보고서 + Linear 코멘트 + 채팅 요약을 올린다. 질의 실행 자체는 Brian 의 명시적 go 가 있어야 한다(`브리프` "DB 조회 실행 금지"는 이 설계 단계에만 해당하며 구현 단계에서 해제).

**"Phase 0 완료 기준: 분포 조회 결과 Brian 보고"의 수락 조건** (`기획.md:436`) — 모두 충족 시 이 항목 완료:
1. `A1~A9` 전부 + `B0`·`C` 계열의 결과가 **단일 REPEATABLE READ 트랜잭션** 한 번의 패스에서 나왔다(질의 간 시점 일치).
2. 보고서에 질의 ID 별 표, 실행 일시(`db_now`)와 `db_timezone`, `alembic_head = e036a0000051` 단일.
3. 기본 규칙 영향 요약: (a) A3 의 "R7/R10 이 갈리는 세션 수", (b) A2 의 규칙 코드별 예상 건수(C1/C2/C3/R1/R2/R3), (c) A4b 커버리지, (d) A5 묶기 효과·기관 혼재, (e) A6 비회원 상담 규모 — 그리고 **D-55/D-56/D-57 의 확정 기본값을 바꿀 필요가 있는지** 예/아니오.
4. §3 의 102 vs 134 판정: "원인 확인됨(증거 질의 ID 명시)" 또는 "미확인 + 남은 불확실성".
5. 스냅샷 ID·상태(`available`)·암호화 여부 기록(§4).
6. Brian 의 수령 확인(Linear 코멘트 또는 채팅 "확인")을 SDD-211 `summary.md` 에 한 줄로 기록.
- **구분**: 이 "보고"는 Phase 0 완료 기준이다. 분류 규칙 **승인**은 별개의 Phase 1 진입 게이트(`기획.md:577`, `결정-필요.md:12`)이며 보고만으로 승인된 것이 아니다.

---

## 3. (C) 기준선 102 vs SDD-210 134

### 3.1 각 숫자가 센 것 (문서로 확인된 범위)

| | 기준선 102 | SDD-210 134 |
|---|---|---|
| 출처 | `baseline.md:53`, 질의 `baseline-snapshot.sql:7-10` | `sdd-210/spec.md:16`, `plan.md:93`, `verify.md:132` |
| 테이블 | `sessions` (이 시점 `classes` 테이블 없음: §1.2) | "세션" — 테이블 명시 없음(같은 `sessions` 로 추정, 근거 `verify.md:132` 가 "sessions(134)" 를 테이블 행수 목록에 둠) |
| 필터 | `WHERE is_template = false`, 상태 전부, **숨김 필터 없음**(그때 `hidden_at` 컬럼 자체가 없음 — `e036a0000042` 이전) | **기록 없음** (`is_template`·숨김 포함 여부 `미확인`) |
| 합계 검산 | 91+6+1+2+2 = 102 | 105+19+3+1+6 = 134 |
| 상태 분해 | completed 91 · cancelled 6 · in_progress 1 · ready 2 · scheduled 2 | 완료 105 · 취소 6 · 진행 1 · 준비 3 · 예정 19 |
| 시점 | 2026-10-17 오후, head `e036a0000041`, 원시 SQL(`sa.text`, `baseline-snapshot.py:37`) | 2026-10-17 `[검증]`, head `e036a0000051`(`plan.md:25`), 질의 수단 `미확인` |
| 보조 수치 | 첫 생성 06-10, 마지막 10-16, 코드 보유 79 | "최근 30일 생성 103" (기준 컬럼 `created_at` 으로 추정, `미확인`) |
| 같은 문서의 다른 행수 | 세션 기록 60 · 리포트 125(63+1+60+1) · EEG 윈도우 46,106 · 음성 청크 1,405 · 영상 2,277 · EEG raw 1,550 (`baseline.md:56-61`) | 세션 기록 74 · 리포트 146 · EEG 윈도우 46,131 · 영상 2,277 · 음성 1,405 · EEG raw 1,550 (`plan.md:94-95`) |

시각 선후: 기준선 커밋 `02cdd4af` 13:28 KST, SDD-209 B1(삭제=숨김) 커밋 `fc5fd50b` 13:40 KST, SDD-209 dev 배포·스모크 통과 문서 `e6fabba9` 21:33, SDD-210 문서 커밋 `1fc7217a` 22:55 (`git log` 읽기).

### 3.2 가설 순위 (원인은 증명되지 않음 — `미확인`)

| 순위 | 가설 | 근거 | 반증/한계 |
|---|---|---|---|
| **1** | **시점 차 + 그 사이 dev 에 쌓인 E2E 잔여 클래스** (특히 B1 이후 삭제 API 가 하드 삭제 대신 '숨김' 보존으로 바뀌어 raw 집계에만 잡힘) | ① 기준선은 head 41, SDD-210 은 head 51 — 같은 날 사이에 SDD-209 마이그레이션 10개와 다수 dev 배포(`git log`). ② `deploy-dev.yml:306-310` 이 배포마다 E2E(스모크·여정·전수조사)를 실행(`e2e-smoke.yml`), 이 스크립트들이 클래스를 만들고 끝에 `DELETE /sessions/{id}` 호출(`frontend/e2e/journeys.mjs:23,37,79,87`, `full-journey.mjs:366-369`). ③ B1 이전 DELETE = 행 삭제(`git show fc5fd50b^:…session_service.py:817-832`), 이후 = `hidden_at` 기록(`session_service.py:896-919`) → 숨김 행이 raw 집계에 누적. ④ 삭제 가능 상태는 ready·scheduled·cancelled 뿐, 완료·진행은 409(`session_service.py:893,906`) → 전수조사의 "시작한 클래스"는 삭제되지 못하고 완료로 남음(`full-journey.mjs:369` "e2e_seed cleanup 에 맡김"). ⑤ **상태 증분 벡터가 이 시나리오와 맞음**: scheduled +17(여정이 미래 일시 `scheduled_at` 로 만들고 DELETE → 숨김), completed +14(전수조사 잔여), ready +1, 나머지 0. ⑥ 보조 테이블이 같은 방향으로 증가(세션 기록 +14 = completed +14, 리포트 +21, EEG 윈도우 +25)하는데 청크 3종은 **완전 동일**(1,405/2,277/1,550) → 같은 DB 의 시간 경과로 보이고 E2E 는 미디어 업로드가 없음. ⑦ 산술: 134−103(최근 30일)=31 건이 30일 이전, 기준선 102 에서 30일 이전분이 같다면 최근 30일분은 71 → 증분 32 건 **전부가 최근 생성**(103−71=32). ⑧ SDD-209 요약이 "dev 에 E2E 가 만든 클래스·게스트 참가자 잔여분(**기준선 대비 증가**)"을 직접 기록(`sdd-209/summary.md:40`) | 증분 32 중 E2E 분이 정확히 몇 건인지는 문서에 없음. ⑦ 은 "30일 이전 집합 불변" 가정. 사람 사용자 생성분이 섞였을 수 있음 |
| 2 | **템플릿 포함** (`is_template=true` 행을 센 경우) | 템플릿은 항상 `status='ready'` 로 저장(`session_service.py:487,542`, 생성 시 `_create_template`) | **상태 분해상 최대 1건만 설명**: 준비 3 vs 2(+1) 만 해당, scheduled +17·completed +14 는 템플릿으로 설명 불가. (비템플릿 ready 가 불변이라는 가정) |
| 3 | 숨김 행 포함이 **정의 차**였을 가능성 | — | 기준선 질의도 숨김 필터가 없고(`baseline-snapshot.sql:10`) 그때는 `hidden_at` 자체가 없었다 → 정의 차로는 설명 불가. 단 **가설 1 의 구성 요소**로는 중요(B1 이후 생긴 숨김 행) |
| 4 | **ORM 전역 필터** (`core/database.py:15-47`) | 앱 코드로 세었다면 숨김이 빠짐 | 방향이 반대(필터는 값을 **줄인다**). 기준선은 원시 SQL 이라 필터 무관. SDD-210 이 ORM 으로 셌다면 134 는 숨김 제외값이라 더 큰 실제 행수 존재 |
| 5 | 상태 필터 차이 | — | 양쪽 모두 5개 상태를 나열하고 합이 맞음(`baseline.md:53`, `plan.md:93`) → 설명 불가. 스키마 상태는 6개(`schemas/session.py:14`, `open` 은 양쪽 0) |
| 6 | 하드 삭제·정리(`e2e_seed.py cleanup` 등) | — | 방향이 반대. 가설 1 의 증분을 **가려** 실제 생성량이 32 보다 클 수 있음(A7c 로 점검) |
| 7 | 측정 오류·다른 질의/다른 DB·컬럼 | SDD-210 의 질의 원문이 어느 문서에도 없다(`grep` 134/세션 행 수 3곳뿐: `spec.md:16`, `plan.md:93`, `verify.md:132`) | 배제 불가 — 판별 질의로만 해소 |

### 3.3 판별 질의 (M0 단일 감독 패스에서 함께 실행 — 전부 집계만)

가설 1 의 예측: ① **C2**: `created_at` 이 기준선 시점 이전인 비템플릿 행 수 ≈ 102 (삭제가 없었다면 정확히 일치), 이후 생성분의 상태 분포가 증분 벡터(예정·완료 중심)와 유사. ② **C3**: 증분이 E2E 기관/제목에 집중, 예정 건은 `hidden=true`, 완료 건은 `hidden=false`. ③ **C4**: 최근 30일 `is_template=false` 가 SDD-210 의 103 과 같은 자릿수.

```sql
-- C2 기준선 시점 컷 (DB 시간대가 B0 에 나오므로 UTC·KST 두 컷을 함께 계산) — 102 재현 시도
SELECT 'C2' AS qid,
       (created_at < TIMESTAMPTZ '2026-10-17 00:00:00+00') AS created_before_1017_utc,
       (created_at < TIMESTAMPTZ '2026-10-17 00:00:00+09') AS created_before_1017_kst,
       is_template, (hidden_at IS NOT NULL) AS hidden, status, count(*) AS sessions
FROM sessions GROUP BY 2,3,4,5,6 ORDER BY 2,3,4,5,6

-- C2b 생성일(KST)별 건수 — 2026-10-10 이후 (증분이 10-17 에 몰렸는지)
SELECT 'C2b' AS qid, (created_at AT TIME ZONE 'Asia/Seoul')::date AS created_date_kst, is_template, count(*) AS sessions
FROM sessions WHERE created_at >= TIMESTAMPTZ '2026-10-10 00:00:00+09' GROUP BY 2,3 ORDER BY 2,3

-- C2c 2026-10-17 이후 생성분의 시간대별 건수 (배포·E2E 시각과의 대응)
SELECT 'C2c' AS qid, date_trunc('hour', created_at AT TIME ZONE 'Asia/Seoul') AS hour_kst, count(*) AS sessions
FROM sessions WHERE is_template = false AND created_at >= TIMESTAMPTZ '2026-10-17 00:00:00+09' GROUP BY 2 ORDER BY 2

-- C3 E2E 귀속 판별 (술어만 사용, 이름·제목 비출력)
SELECT 'C3' AS qid,
       coalesce(o.org_code = 'E2E001', false) AS e2e_org,
       coalesce(left(s.title, 4) = 'E2E-', false) AS e2e_title_prefix,
       s.is_template, (s.hidden_at IS NOT NULL) AS hidden, s.status,
       (s.created_at >= TIMESTAMPTZ '2026-10-17 00:00:00+09') AS created_on_or_after_1017_kst,
       count(*) AS sessions
FROM sessions s LEFT JOIN organizations o ON o.id = s.organization_id
GROUP BY 2,3,4,5,6,7 ORDER BY 2,3,4,5,6,7

-- C3b 호스트 범주별 세션 수 (E2E 계정은 role/provider 로는 구분 안 되지만 dev 계정 3개 영향 점검)
SELECT 'C3b' AS qid, u.role, u.auth_provider, (u.status = 'active') AS host_active,
       count(*) AS sessions, count(DISTINCT s.host_id) AS hosts
FROM sessions s JOIN users u ON u.id = s.host_id WHERE s.is_template = false GROUP BY 2,3,4 ORDER BY 2,3,4

-- C4 "최근 30일" 재현 (생성 시각 기준 가정)
SELECT 'C4' AS qid, is_template, (hidden_at IS NOT NULL) AS hidden,
       (created_at >= now() - interval '30 days') AS created_last_30d, count(*) AS sessions
FROM sessions GROUP BY 2,3,4 ORDER BY 2,3,4
```
`A1`(유형×모드×템플릿×숨김×상태) 의 합으로 SDD-210 의 세 가지 해석 — (i) 전부, (ii) 비템플릿, (iii) 비템플릿·비숨김 — 을 즉시 계산해 구조(상태 분포 모양)를 비교한다. `A7c`(하드 삭제 흔적)와 `C6`(= `baseline-snapshot.sql` 전체 재실행, 세션 기록 60→?, 리포트 125→?, 윈도우 46,106→?, 청크 3종 동일 여부)도 같은 패스에서 나온다.

**판독 규칙 (사전 선언 — 결과를 보고 바꾸지 않는다)**
- `C2` 의 "컷 이전 비템플릿" 합이 **102 와 같고** 컷 이후 비템플릿이 현재 총합−102 → 증분은 전부 기준선 이후 생성분(가설 1 의 시점 부분 확정). 102 보다 작으면 삭제/정리가 있었다는 뜻(A7c 와 대조), 크면 컷 정의(시간대·측정 시각) 재검토.
- `C3` 에서 증분 구간의 대부분이 `e2e_org=true` 또는 `e2e_title_prefix=true` → E2E 잔여 확정. `hidden=true & scheduled` 와 `hidden=false & completed` 가 지배적이면 위 ④⑤ 메커니즘까지 확인.
- 그래도 SDD-210 의 134 가 **어떤 질의로 나왔는지**는 이 질의로 알 수 없다 → "SDD-210 수치의 정의는 `미확인`, 같은 기준(전부/비템플릿/비숨김) 3가지를 병기"로 마감하고, 이후 대조 기준은 **A1 의 비템플릿(숨김 포함) 합**으로 고정한다(백필 모집단 = R7 §4.7).
- 현재 시점의 값은 SDD-210 측정 시점보다 더 커졌을 것이므로 숫자 자체의 일치는 요구하지 않는다(구조·증분 메커니즘만 판별).

---

## 4. (D) 수동 RDS 스냅샷 절차

> 아래 CLI 는 **템플릿이며 실행하지 않았다(not executed)**. `<…>` 는 자리표시자.

### 4.1 확인된 사실과 `미확인`

| 항목 | 값 | 근거 |
|---|---|---|
| AWS 계정·리전·프로파일 | 계정 `187768779388`, `ap-northeast-1`, 프로파일 **`looxid-las`** | `sdd-210/spec.md:24`; `sdd-209/investigation/11-r4-code-survey.md:161`("프로파일 `looxid-las`, `ap-northeast-1`"); `sdd-197/summary.md:26`("`looxid-las` 는 계정/프로파일 이름") — 3곳 일치. `.github/`·`docs/개발운영_환경분리_기획.md`·`scripts/` 에는 **프로파일명이 없음** |
| dev RDS 이름 | `mindbreeze-dev` (db.t4g.micro, PG 16.14, 단일 AZ) | `sdd-210/plan.md:48`; 엔드포인트 첫 라벨이 같음 `specs/014-architecture-simplification/summary.md:7` |
| `DBInstanceIdentifier` 로 CLI 에 넣는 문자열 | 위 이름과 같다고 **추정**, CLI 출력으로 직접 기록된 문서는 없음 → **`미확인`**(실행 시 `describe-db-instances` 로 확인) | — |
| 선례 스냅샷 | `mindbreeze-dev-pre-envsplit-20261010` (수동, SDD-197). 생성 CLI 문장은 문서에 없음 → `미확인` | `sdd-197/summary.md:12`, `verify.md:11`(TS8 "스냅샷 `available`") |
| 암호화 | 인스턴스·스냅샷 **전부 비암호화**. 암호화는 "스냅샷 암호화 복사 후 복원"으로만 가능 | `sdd-210/plan.md:48`, `R7:65`, `기획.md:611`(X13) |
| 자동 백업 | 14일, 창 18:26–18:56 UTC, 삭제방지 ON | `sdd-210/plan.md:48` |
| 이미 있는 스냅샷으로 대체 가능한가 | **불가**: `pre-envsplit-20261010` 은 SDD-209 마이그레이션 42~51 이전·사용자 데이터가 달라 M0 기준점이 못 된다 | 10-10 vs head 51 |

### 4.2 이름 규칙·기록

- 형식: `<db-instance>-pre-<목적>-<YYYYMMDD>[-<HHMM>]` — 선례(`…-pre-envsplit-20261010`)를 따른다. RDS 제약: 영문·숫자·하이픈, 영문으로 시작, 연속 하이픈·끝 하이픈 금지, 최대 255자(AWS 일반 규칙, 이 저장소 문서엔 없음).
  - M0: `mindbreeze-dev-pre-classrestructure-m0-YYYYMMDD`
  - M2 직전(백필 apply 전): `mindbreeze-dev-pre-classrestructure-m2-YYYYMMDD`
  - M6 직전: `…-m6-YYYYMMDD` (`기획.md:583`: "M0 같은 스냅샷")
  - prod(후일): `mindbreeze-prod-pre-…` 같은 모양, 암호화 인스턴스이므로 스냅샷도 자동 암호화.
- 태그: `project=mindbreeze`, `env=dev`, `purpose=<목적>`, `sdd=211`, `owner=brian` (SDD-210 이 리소스 식별에 `project=mindbreeze,env=prod` 태그를 쓰는 관례: `plan.md:190`).
- **ID 기록 위치**(스냅샷 ID 는 비밀이 아님): ① `m0-report.md` §스냅샷 표(이름·`SnapshotCreateTime`·`Status`·`Encrypted`·`AllocatedStorage`) ② Linear SDD-211 코멘트 ③ 이후 M2 dry-run 기록·`summary.md`.

### 4.3 템플릿 (not executed)

```bash
# 0) 신원·대상 확인
aws sts get-caller-identity --profile <PROFILE:looxid-las> --region <REGION:ap-northeast-1>
aws rds describe-db-instances --db-instance-identifier <DB_INSTANCE_ID:mindbreeze-dev?> \
  --profile <PROFILE> --region <REGION> \
  --query 'DBInstances[0].[DBInstanceIdentifier,DBInstanceStatus,EngineVersion,StorageEncrypted,DeletionProtection,BackupRetentionPeriod,AllocatedStorage]'

# 1) 생성 (인스턴스 상태가 available 일 때만, 자동 백업 창 18:26-18:56 UTC 은 피한다)
aws rds create-db-snapshot \
  --db-instance-identifier <DB_INSTANCE_ID> \
  --db-snapshot-identifier <SNAPSHOT_ID> \
  --tags Key=project,Value=mindbreeze Key=env,Value=dev Key=purpose,Value=<PURPOSE> Key=sdd,Value=211 Key=owner,Value=<OWNER> \
  --profile <PROFILE> --region <REGION>

# 2) 사용 가능 대기
aws rds wait db-snapshot-available --db-snapshot-identifier <SNAPSHOT_ID> --profile <PROFILE> --region <REGION>

# 3) 검증 (기대: Status=available, PercentProgress=100, SnapshotType=manual, Encrypted=false)
aws rds describe-db-snapshots --db-snapshot-identifier <SNAPSHOT_ID> --profile <PROFILE> --region <REGION> \
  --query 'DBSnapshots[0].[DBSnapshotIdentifier,SnapshotType,Status,PercentProgress,Encrypted,Engine,EngineVersion,AllocatedStorage,SnapshotCreateTime,DBInstanceIdentifier]' --output table

# 4) 기존 수동 스냅샷 목록 (정리·중복 확인)
aws rds describe-db-snapshots --db-instance-identifier <DB_INSTANCE_ID> --snapshot-type manual \
  --profile <PROFILE> --region <REGION> --query 'DBSnapshots[].[DBSnapshotIdentifier,Status,Encrypted,SnapshotCreateTime]' --output table

# 5) [선택, 결정 M0-D5] 암호화 사본 — KMS 키가 준비된 뒤에만 (SDD-210 T-7 에서 생성 예정)
aws rds copy-db-snapshot --source-db-snapshot-identifier <SNAPSHOT_ID> \
  --target-db-snapshot-identifier <SNAPSHOT_ID>-enc --kms-key-id <KMS_KEY_ALIAS_OR_ARN> --copy-tags \
  --profile <PROFILE> --region <REGION>

# 6) [보관 종료 시, Brian 승인 후에만] 삭제
aws rds delete-db-snapshot --db-snapshot-identifier <SNAPSHOT_ID> --profile <PROFILE> --region <REGION>
```
- 실행 주체: **Brian**(IAM 사용자 `brian.chae`, 그룹 `developer` = AdministratorAccess: `sdd-210/plan.md:53`, `spec.md:87`) 또는 Brian 이 **명령 단위로 승인한** 에이전트. 스냅샷 생성은 AWS 리소스·비용(소액)을 만드는 쓰기 작업이다(SDD-210 이 AWS 쓰기 Task 를 verify 승인 후로 둔 관례, `plan.md:173` "AWS 표시는 리소스 생성이므로 verify 승인 후에만").
- 락/다운타임: 스냅샷은 서비스 중단이 필요 없다고 알려져 있으나(AWS 일반 지식) **단일 AZ 는 시작 시 잠깐 I/O 지연 가능** — 이 저장소 문서에는 근거 없음 → `미확인`. 사용자 영향을 줄이려면 `in_progress` 세션이 없는 시각(R7 D-10 = A9-D10)에 실행.
- 복원 리허설: **복제하지 않고 SDD-210 T-17(`plan.md:204`, `verify.md` §4 V-4.1~V-4.8)을 따른다.** 복원은 항상 새 인스턴스이며 비암호화 스냅샷 복원본은 비암호화다(암호화 복사 후 복원이 SDD-210 요건 V-4.1). R7 dry-run B(복원본에서 `alembic upgrade head` + 백필, `R7:352`)도 같은 틀.

### 4.4 암호화 꺼진 스냅샷의 주의 (X13)

- 스냅샷에는 EEG 지표·음성 메타·비회원 이름·생년월일·이메일·상담 기록이 그대로 들어 있다(`baseline.md:54-61`). `.claude/rules/data-privacy.md` 의 "저장 시 암호화" 원칙과 어긋나는 상태가 **M0~M5/M6 보관 기간 내내** 이어진다.
- 완화(기본안): ① 스냅샷 공유 금지(계정 간·퍼블릭 모두 없음 확인: `describe-db-snapshot-attributes`) ② 접근은 AdministratorAccess 사용자뿐임을 인지하고 필요 이상 늘리지 않기 ③ 보관 기간 명시(아래) ④ 삭제 전까지 목록에 남기고 삭제 승인을 SDD-211 `summary.md` 의 체크 항목으로 둔다.
- **보관 기간 — 결정 M0-D5 (Brian)**: 저장소에 정책 없음(선례 스냅샷의 삭제 시점도 `미확인`). 기본안: M0·M2 스냅샷은 **M5 호환 윈도우 종료(≥30일) + Brian 삭제 승인까지**, M6 스냅샷은 M6 안정 확인 후. 수동 스냅샷은 삭제 전까지 남는다(AWS 일반 지식; 자동 백업 14일 보존과 별개, `plan.md:48`).

---

## 5. (E) M0 게이트의 나머지 항목 (`기획.md:577`, `R7:275`)

| # | 항목 | 절차 | 수락 |
|---|---|---|---|
| E1 | 수동 RDS 스냅샷(ID 기록) | §4 | 스냅샷 `available`, ID 가 보고서·Linear 에 기록 |
| E2 | 기준선 쿼리 재실행 | §2.2-4 (`baseline-snapshot.sql` Q1~Q11 을 같은 트랜잭션에서) | 전 11개 결과 확보, 이후 전/후 diff 기준으로 보관(`R7:350`) |
| E3 | 분포 조회 (D-1~D-12, R10 Q1~Q5) | §1.3 A1~A9 (R7/R10 대체본) | §2.3 수락 조건 |
| E4 | **`alembic heads` 단일 확인** | ① 저장소(DB 불필요): `cd backend && venv/bin/alembic heads` 가 1개(`e036a0000051`) — 이번 조사의 정적 파싱도 단일 head ② DB: `B0.alembic_head` = 같은 값. 서버에서 `alembic current` 를 쓰지 않아도 B0 로 충분. 배포 후에는 `deploy-dev.yml:201` 의 `alembic upgrade head` 가 쓰는 head 와 대조. 병렬 브랜치 머지(예: SDD-209 `sdd/209-integrate` 머지들)로 다중 head 가 생길 수 있으므로 **M1 PR 직전에도 재확인** | head 1개, DB = 저장소 |
| E5 | 결정 D-55~D-57 확정 | 이미 Brian "기본값으로" 확정(`결정-필요.md:142-148`: D-55 활성 참여자 ≥2→명상 클래스, D-56 규칙 자동+호스트 확인, D-57 회원 쌍 묶기·보관용 관계·종결 추정 안 함). M0 은 **조회 결과가 그 기본값을 뒤집을 사유가 있는지** 만 판정: D-55 는 A3 의 갈림 건수(`결정-필요.md:104` "건수는 M0 조회 후 확정"), D-56 은 A4b, D-57 은 A5·A2(`zero_active`) | 보고서 §3 표에 예/아니오 |
| E6 | **D-60 (SDD-210 컷오버 선후)** | 이 조사는 DB·일정 정보 없음 → `미확인` 유지. M0 질의와 무관하나 Phase 0 plan 에서 확정(`결정-필요.md:11,148`, `R7:285`) | plan.md 에서 확정 또는 `미확인` 명기 |
| E7 | Brian 승인(분류 규칙) | Phase 1 진입 게이트, M0 보고와 별개(§2.3) | Linear/채팅 승인 기록 |
| E8 | 이전 전/후 비교용 "이전 전" 기록 | R7 V15(세션 컬럼 해시)·V16(FK 13개 테이블+값 보관 6개 행수)·V17(딥링크 dangling)·A9-D9 는 **"이전 전/후 동일"** 검증의 전 값이 필요 → M2 직전 스냅샷과 함께 기록. **V15 는 `title`·`access_code` 를 해시 입력으로 쓰므로**(`R7:636-637`) M0 에서는 실행하지 않고, M2 직전에 입력 컬럼을 비개인 컬럼(`id,host_id,status,scheduled_at,type,participant_mode,max_participants,linkband_mode,hidden_at,organization_id`)으로 줄인 변형으로 실행 여부를 Brian 이 결정 | M2 dry-run 시점 |
| E9 | 실행 시점 조건 | 배포·E2E 비실행 시간, 가능하면 `in_progress` 0(A9-D10). E2E 가 계속 행을 추가하므로(§3) **M2 직전 재실행** | 두 번 실행 결과 비교 |
| E10 | (교차 메모) Phase 0 항목 4 "PG 스모크 — 빈 DB + 스냅샷 복원본" | 스냅샷 복원본은 실데이터(비암호화)이므로 **공개 저장소의 GitHub Actions 에 올리지 않는다** — 복원본 검증은 SDD-210 T-17 리허설 인스턴스(비공개)에서, CI 는 빈 DB 만 | plan.md 에서 반영 |

---

## 6. 확인하지 못한 것 (`미확인`)

1. SDD-210 "134건" 의 질의 원문·템플릿/숨김 포함 여부 (문서에 없음).
2. 102→134 증분 32건의 실제 구성(E2E 몇 건, 사람 몇 건) — C2/C3 로만 확인 가능.
3. baseline Q1 `created_at::date` 의 DB 시간대(`baseline.md:82` 의 UTC 는 서버 OS), RDS 파라미터 `TimeZone` — B0 로 확인.
4. dev EC2 접속용 SSH 키의 현재 위치, 서버의 `psql` 설치 여부, DB 인코딩(한글 정규식 `~*` 동작).
5. `DBInstanceIdentifier` 문자열의 CLI 출력 기록, 선례 스냅샷 생성 CLI·삭제 시점, 단일 AZ 스냅샷 시작 시 I/O 영향.
6. D-60(SDD-210 컷오버 선후) — 일정 정보 없음.
7. 모든 SQL 의 문법·성능 — DB 미접속이라 검증하지 못함(§1.7 R0 로 구현 단계에서 빈 PG 대상 검증).
8. `pg_stat_user_tables` 통계의 리셋 시점(A7d 로 확인) — 하드 삭제 추정의 신뢰도.

## 7. 결정 지점 요약

| ID | 질문 | 기본값 | 담당 |
|---|---|---|---|
| M0-D1 | 저장소에 커밋하는 보고서의 소량 셀 억제 방식·k | 사람/기관 단위 셀만 `<3` 억제, 원본 수치는 Brian 비공개 전달 | Brian |
| M0-D2 | `custom_type_name` 원문(A4d) 노출 여부·방식 | 1단계(A4a~c)만, A4d 는 Brian 입회 하 화면 출력 전용·기록 금지 | Brian |
| M0-D3 | dev 실행 경로: SSH(선례) vs SSM 선등록 | SSH (SSM 등록은 SDD-210 범위) | Brian |
| M0-D4 | `org_code='E2E001'`·`left(title,4)='E2E-'` 고정 리터럴 술어 허용 | 허용(출력은 불리언·집계만) | 기술 기본값 |
| M0-D5 | 스냅샷 보관 기간·암호화 사본 생성 여부·삭제 승인 | M5 종료 + 승인까지, 암호화 사본은 SDD-210 컷오버 전용(M0 에서는 만들지 않음) | Brian |
| M0-D6 | 스냅샷 실행 주체 | Brian 또는 명령 단위로 승인한 에이전트 | Brian |
| M0-D7 | 실행 시점·재실행 | 배포 비실행 시간 + M2 직전 재실행 | 기술 기본값 |
| M0-D8 | 러너 | 신규 얇은 래퍼(`m0-prequery.py`: 3중 읽기 전용 강제, `qid`) | 기술 기본값 |
