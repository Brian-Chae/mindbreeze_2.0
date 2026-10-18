-- SDD-211 M1 — M0 분포 조회 (읽기 전용 집계). 설계: investigation/07-m0-prequery-design.md §1.
-- 규칙: 모든 문장은 SELECT 로 시작(WITH 금지, 서브쿼리 전개). 문자열 리터럴에 세미콜론·하이픈 2개·퍼센트 금지.
-- 출력은 범주형·구간·집계만(ID·이름·이메일·제목·코드 값 금지). 활성 참여자 정의 ACT 는 모든 질의에서 하나로 통일했다.
-- 실행: m0-prequery.py 가 단일 REPEATABLE READ, READ ONLY 트랜잭션에서 위에서 아래로 실행하고 ROLLBACK 한다.
-- A4d(자유 입력 라벨 원문)는 --include-labels 가 있을 때만 실행되며 결과는 공유 가능 출력과 다른 파일에 쓴다.

-- B0 메타: 시각·시간대·마이그레이션 head
SELECT 'B0' AS qid, now() AS db_now, current_setting('TimeZone') AS db_timezone,
       (SELECT version_num FROM alembic_version) AS alembic_head;

-- A1 유형 x 참여 방식 x 템플릿 x 숨김 x 상태
SELECT 'A1' AS qid, type, participant_mode, is_template, (hidden_at IS NOT NULL) AS hidden, status, count(*) AS sessions
FROM sessions GROUP BY 2,3,4,5,6 ORDER BY 2,3,4,5,6;

-- A2 유형 x 참여 방식 x 활성 참여자 구간(0, 1, 2명 이상) x 단일 참여자 종류
SELECT 'A2' AS qid, a.type, a.participant_mode,
       LEAST(a.n_active, 2) AS active_bucket,
       CASE WHEN a.n_active = 1 THEN CASE WHEN a.n_member = 1 THEN 'member' ELSE 'guest' END ELSE '-' END AS single_kind,
       (a.n_active = 0 AND a.n_nonhost_rows > 0) AS zero_active_but_rows_exist,
       count(*) AS sessions
FROM (
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
) a
GROUP BY 2,3,4,5,6 ORDER BY 2,3,4,5,6;

-- A3 집단형 상담 후보(clinical, hypnosis) x 활성 참여자 구간 x 정원 구간 — D-55 재확인 트리거
SELECT 'A3' AS qid, a.type, a.participant_mode, LEAST(a.n_active, 2) AS active_bucket,
       CASE WHEN a.max_participants IS NULL THEN 'null' WHEN a.max_participants <= 1 THEN '<=1'
            WHEN a.max_participants < 10 THEN '2-9' ELSE '>=10' END AS capacity_bucket,
       count(*) AS sessions
FROM (
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
) a
WHERE a.type IN ('clinical','hypnosis')
GROUP BY 2,3,4,5 ORDER BY 2,3,4,5;

-- A4a custom 유형 규모(라벨 비출력)
SELECT 'A4a' AS qid, a.participant_mode, LEAST(a.n_active, 2) AS active_bucket,
       count(*) AS sessions, count(DISTINCT lower(btrim(a.custom_type_name))) AS distinct_labels
FROM (
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
) a WHERE a.type = 'custom' GROUP BY 2,3 ORDER BY 2,3;

-- A4b custom 라벨 키워드 초안 분류 건수(D-56 키워드를 서버 안에서만 적용, 라벨 비출력)
SELECT 'A4b' AS qid,
       CASE WHEN coalesce(a.custom_type_name ~* '(명상|마음챙김|호흡|요가|MBSR)', false)
             AND coalesce(a.custom_type_name ~* '(상담|치료|코칭|심리|면담)', false) THEN 'conflict'
            WHEN coalesce(a.custom_type_name ~* '(명상|마음챙김|호흡|요가|MBSR)', false) THEN 'kw_meditation'
            WHEN coalesce(a.custom_type_name ~* '(상담|치료|코칭|심리|면담)', false) THEN 'kw_counseling'
            ELSE 'kw_none' END AS kw_class,
       a.participant_mode, LEAST(a.n_active, 2) AS active_bucket, count(*) AS sessions
FROM (
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
) a WHERE a.type = 'custom' GROUP BY 2,3,4 ORDER BY 2,3,4;

-- A4c 라벨 빈도 분포(한 라벨이 몇 번 쓰였는지, 라벨 비출력)
SELECT 'A4c' AS qid, x.n AS sessions_per_label, count(*) AS labels
FROM (SELECT lower(btrim(custom_type_name)) AS lbl, count(*) AS n
      FROM sessions WHERE type = 'custom' AND is_template = false GROUP BY 1) x
GROUP BY 2 ORDER BY 2;

-- A4d [U6: platform_admin 역할 보유자 요청 시에만, --include-labels] 라벨 원문 상위 100 — 별도 파일 출력, 커밋·Linear 금지
SELECT 'A4d' AS qid, lower(btrim(custom_type_name)) AS label, count(*) AS sessions
FROM sessions WHERE type = 'custom' AND is_template = false
GROUP BY 2 ORDER BY 3 DESC, 2 LIMIT 100;

-- A5a 상담(clinical, hypnosis) 쌍별 세션 수 히스토그램 — 묶기 효과
SELECT 'A5a' AS qid,
       CASE WHEN pr.n_sessions <= 5 THEN pr.n_sessions::text WHEN pr.n_sessions <= 10 THEN '6-10' ELSE '11+' END AS sessions_per_pair,
       count(*) AS pairs, sum(pr.n_sessions) AS sessions
FROM (
SELECT a.host_id, a.member_id, count(*) AS n_sessions,
              count(DISTINCT a.organization_id) AS n_orgs, bool_or(a.organization_id IS NULL) AS has_null_org
       FROM (
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
       ) a
       WHERE a.type IN ('clinical','hypnosis') AND a.n_active = 1 AND a.n_member = 1
       GROUP BY a.host_id, a.member_id
) pr GROUP BY 2 ORDER BY min(pr.n_sessions);

-- A5b 쌍·상담사·회원 수, 기관 혼재
SELECT 'A5b' AS qid, count(*) AS pairs, count(DISTINCT pr.host_id) AS counselors, count(DISTINCT pr.member_id) AS members,
       sum(pr.n_sessions) AS sessions, count(*) FILTER (WHERE pr.n_orgs > 1) AS mixed_org_pairs,
       count(*) FILTER (WHERE pr.has_null_org) AS pairs_with_null_org_session
FROM (
SELECT a.host_id, a.member_id, count(*) AS n_sessions,
              count(DISTINCT a.organization_id) AS n_orgs, bool_or(a.organization_id IS NULL) AS has_null_org
       FROM (
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
       ) a
       WHERE a.type IN ('clinical','hypnosis') AND a.n_active = 1 AND a.n_member = 1
       GROUP BY a.host_id, a.member_id
) pr;

-- A5c 쌍의 client_counselor_links 보유/상태
SELECT 'A5c' AS qid, coalesce(l.status, '(no link)') AS link_status, count(*) AS pairs
FROM (
SELECT a.host_id, a.member_id, count(*) AS n_sessions,
              count(DISTINCT a.organization_id) AS n_orgs, bool_or(a.organization_id IS NULL) AS has_null_org
       FROM (
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
       ) a
       WHERE a.type IN ('clinical','hypnosis') AND a.n_active = 1 AND a.n_member = 1
       GROUP BY a.host_id, a.member_id
) pr
LEFT JOIN client_counselor_links l ON l.client_id = pr.member_id AND l.counselor_id = pr.host_id
GROUP BY 2 ORDER BY 2;

-- A5a-custom 변형: custom(비집단) 포함 상한 추정 — 쌍별 세션 수 히스토그램
SELECT 'A5a-custom' AS qid,
       CASE WHEN pr.n_sessions <= 5 THEN pr.n_sessions::text WHEN pr.n_sessions <= 10 THEN '6-10' ELSE '11+' END AS sessions_per_pair,
       count(*) AS pairs, sum(pr.n_sessions) AS sessions
FROM (
SELECT a.host_id, a.member_id, count(*) AS n_sessions,
              count(DISTINCT a.organization_id) AS n_orgs, bool_or(a.organization_id IS NULL) AS has_null_org
       FROM (
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
       ) a
       WHERE (a.type IN ('clinical','hypnosis') OR (a.type = 'custom' AND a.participant_mode <> 'group')) AND a.n_active = 1 AND a.n_member = 1
       GROUP BY a.host_id, a.member_id
) pr GROUP BY 2 ORDER BY min(pr.n_sessions);

-- A5b-custom 변형: custom(비집단) 포함 상한 추정 — 쌍·기관 혼재
SELECT 'A5b-custom' AS qid, count(*) AS pairs, count(DISTINCT pr.host_id) AS counselors, count(DISTINCT pr.member_id) AS members,
       sum(pr.n_sessions) AS sessions, count(*) FILTER (WHERE pr.n_orgs > 1) AS mixed_org_pairs,
       count(*) FILTER (WHERE pr.has_null_org) AS pairs_with_null_org_session
FROM (
SELECT a.host_id, a.member_id, count(*) AS n_sessions,
              count(DISTINCT a.organization_id) AS n_orgs, bool_or(a.organization_id IS NULL) AS has_null_org
       FROM (
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
       ) a
       WHERE (a.type IN ('clinical','hypnosis') OR (a.type = 'custom' AND a.participant_mode <> 'group')) AND a.n_active = 1 AND a.n_member = 1
       GROUP BY a.host_id, a.member_id
) pr;

-- A6 비회원 상담 참여자(유형별) — 값 비조회, 존재 여부와 개수만
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
WHERE s.is_template = false GROUP BY 2 ORDER BY 2;

-- A7a 참여자 보존 전환 플래그(회원 여부, 대기, 제거, 대기 취소)
SELECT 'A7a' AS qid, (user_id IS NULL) AS is_guest, is_waitlisted, (removed_at IS NOT NULL) AS removed,
       (waitlist_cancelled_at IS NOT NULL) AS wl_cancelled, count(*) AS participants
FROM session_participants GROUP BY 2,3,4,5 ORDER BY 2,3,4,5;

-- A7b 호스트 계정 상태 x 세션 상태
SELECT 'A7b' AS qid, u.status AS host_status, s.status AS session_status, count(*) AS sessions
FROM sessions s JOIN users u ON u.id = s.host_id WHERE s.is_template = false GROUP BY 2,3 ORDER BY 2,3;

-- A7c 하드 삭제 흔적(통계 메타데이터만, 통계 리셋 이후 누적)
SELECT 'A7c' AS qid, relname, n_tup_ins, n_tup_upd, n_tup_del, n_live_tup, n_dead_tup
FROM pg_stat_user_tables WHERE relname IN ('sessions','session_participants','session_records','reports') ORDER BY relname;

-- A7d 통계 리셋 시각(A7c 해석용)
SELECT 'A7d' AS qid, stats_reset FROM pg_stat_database WHERE datname = current_database();

-- A8 기관별 세션 수(기관명·ID 비출력, 순위로만)
SELECT 'A8' AS qid, row_number() OVER (ORDER BY o.n_sessions DESC) AS org_rank, (o.organization_id IS NULL) AS no_org,
       o.n_sessions, o.n_meditation, o.n_clinical_hypnosis, o.n_custom, o.n_hosts, o.attribution_all_known
FROM (SELECT s.organization_id, count(*) AS n_sessions,
             count(*) FILTER (WHERE s.type = 'meditation') AS n_meditation,
             count(*) FILTER (WHERE s.type IN ('clinical','hypnosis')) AS n_clinical_hypnosis,
             count(*) FILTER (WHERE s.type = 'custom') AS n_custom,
             count(DISTINCT s.host_id) AS n_hosts,
             bool_and(s.organization_attribution_known) AS attribution_all_known
      FROM sessions s WHERE s.is_template = false GROUP BY s.organization_id) o
ORDER BY org_rank LIMIT 100;

-- A9-D8 코드 현황(값 비조회): 길이 x 상태 x 숨김
SELECT 'A9-D8' AS qid, length(access_code) AS len, status, (hidden_at IS NOT NULL) AS hidden, count(*) AS sessions
FROM sessions WHERE access_code IS NOT NULL AND is_template = false GROUP BY 2,3,4 ORDER BY 2,3,4;

-- A9-D9 딥링크가 세션 id 를 가리키는 영속 행 수
SELECT 'A9-D9' AS qid,
       (SELECT count(*) FROM notifications WHERE extra->>'target_type' = 'session') AS notif_session_links,
       (SELECT count(*) FROM agent_messages WHERE ref_type = 'session') AS agent_session_refs,
       (SELECT count(*) FROM agent_delivery_logs) AS agent_delivery_logs,
       (SELECT count(*) FROM session_email_invites) AS email_invites;

-- A9-D10 열린/진행 중 세션(백필 락 시간·사용자 영향)
SELECT 'A9-D10' AS qid, status, count(*) AS sessions
FROM sessions WHERE status IN ('open','in_progress') AND is_template = false GROUP BY 2 ORDER BY 2;

-- A9-D11 정렬 키 결손(scheduled_at 없음 = 즉석 클래스)
SELECT 'A9-D11' AS qid, count(*) FILTER (WHERE scheduled_at IS NULL) AS no_schedule, count(*) AS total
FROM sessions WHERE is_template = false;

-- A9-D12 템플릿 수와 보유 호스트 수
SELECT 'A9-D12' AS qid, count(*) AS templates, count(DISTINCT host_id) AS template_hosts
FROM sessions WHERE is_template = true;

-- A10 호스트 role x 템플릿 — role=client 호스트 세션 유무(역할 가드 영향)
SELECT 'A10' AS qid, u.role, s.is_template, count(*) AS sessions, count(DISTINCT s.host_id) AS hosts
FROM sessions s JOIN users u ON u.id = s.host_id GROUP BY 2,3 ORDER BY 2,3;

-- A11 회원 리포트 상태 x 읽음 — R6-X1 영향 규모(이메일·내용 비조회)
SELECT 'A11' AS qid, status, is_read, count(*) AS reports
FROM reports WHERE type = 'client' AND user_id IS NOT NULL GROUP BY 2,3 ORDER BY 2,3;

-- A11b 리포트 자동 승인 설정 분포(상담사·기관 관리자 계정 수, 계정 단위 표 아님)
SELECT 'A11b' AS qid, role, auto_approve_report, count(*) AS users
FROM users WHERE role IN ('counselor','org_admin') GROUP BY 2,3 ORDER BY 2,3;

-- C2 기준선 시점 컷: 컷 이전 비템플릿 합이 102 와 같은지(UTC·KST 두 컷)
SELECT 'C2' AS qid,
       (created_at < TIMESTAMPTZ '2026-10-17 00:00:00+00') AS created_before_1017_utc,
       (created_at < TIMESTAMPTZ '2026-10-17 00:00:00+09') AS created_before_1017_kst,
       is_template, (hidden_at IS NOT NULL) AS hidden, status, count(*) AS sessions
FROM sessions GROUP BY 2,3,4,5,6 ORDER BY 2,3,4,5,6;

-- C2b 생성일(KST)별 건수 — 2026-10-10 이상 2026-10-24 미만(행 수 고정)
SELECT 'C2b' AS qid, (created_at AT TIME ZONE 'Asia/Seoul')::date AS created_date_kst, is_template, count(*) AS sessions
FROM sessions WHERE created_at >= TIMESTAMPTZ '2026-10-10 00:00:00+09' AND created_at < TIMESTAMPTZ '2026-10-24 00:00:00+09' GROUP BY 2,3 ORDER BY 2,3;

-- C2c 2026-10-17 이상 2026-10-19 미만 생성분의 시간대별 건수 (배포·E2E 시각과의 대응, 행 수 고정)
SELECT 'C2c' AS qid, date_trunc('hour', created_at AT TIME ZONE 'Asia/Seoul') AS hour_kst, count(*) AS sessions
FROM sessions WHERE is_template = false AND created_at >= TIMESTAMPTZ '2026-10-17 00:00:00+09' AND created_at < TIMESTAMPTZ '2026-10-19 00:00:00+09' GROUP BY 2 ORDER BY 2;

-- C3 E2E 귀속 판별 (고정 리터럴 술어만 사용, 이름·제목 비출력)
SELECT 'C3' AS qid,
       coalesce(o.org_code = 'E2E001', false) AS e2e_org,
       coalesce(left(s.title, 4) = 'E2E-', false) AS e2e_title_prefix,
       s.is_template, (s.hidden_at IS NOT NULL) AS hidden, s.status,
       (s.created_at >= TIMESTAMPTZ '2026-10-17 00:00:00+09') AS created_on_or_after_1017_kst,
       count(*) AS sessions
FROM sessions s LEFT JOIN organizations o ON o.id = s.organization_id
GROUP BY 2,3,4,5,6,7 ORDER BY 2,3,4,5,6,7;

-- C3b 호스트 범주별 세션 수(role, 인증 방식, 활성 여부)
SELECT 'C3b' AS qid, u.role, u.auth_provider, (u.status = 'active') AS host_active,
       count(*) AS sessions, count(DISTINCT s.host_id) AS hosts
FROM sessions s JOIN users u ON u.id = s.host_id WHERE s.is_template = false GROUP BY 2,3,4 ORDER BY 2,3,4;

-- C4 최근 30일 재현 (생성 시각 기준 가정)
SELECT 'C4' AS qid, is_template, (hidden_at IS NOT NULL) AS hidden,
       (created_at >= now() - interval '30 days') AS created_last_30d, count(*) AS sessions
FROM sessions GROUP BY 2,3,4 ORDER BY 2,3,4;

-- C6-Q1 기준선: 클래스 상태별 개수 / 코드 보유 개수(값 비조회)
SELECT 'C6-Q1' AS qid, status, count(*) AS sessions,
       count(access_code) AS with_code,
       min(created_at)::date AS first_created, max(created_at)::date AS last_created
FROM sessions WHERE is_template = false GROUP BY status ORDER BY status;

-- C6-Q2 기준선: 참여자 회원/비회원, 대기, 개인정보 보유 개수(값 없음)
SELECT 'C6-Q2' AS qid, (user_id IS NULL) AS is_guest, is_waitlisted,
       count(*) AS participants,
       count(guest_name) AS has_name, count(gender) AS has_gender,
       count(birth_date) AS has_birth, count(report_email) AS has_report_email,
       sum(consent_eeg::int) AS consent_eeg_true, sum(consent_audio::int) AS consent_audio_true
FROM session_participants GROUP BY 2, 3 ORDER BY 2, 3;

-- C6-Q3 기준선: 음성 청크 개수·바이트·90일 경과분
SELECT 'C6-Q3' AS qid, count(*) AS chunks, coalesce(sum(size_bytes),0) AS bytes,
       count(*) FILTER (WHERE created_at < now() - interval '90 days') AS older_90d_chunks,
       coalesce(sum(size_bytes) FILTER (WHERE created_at < now() - interval '90 days'),0) AS older_90d_bytes,
       count(*) FILTER (WHERE left(file_path, 1) = '/') AS local_path_chunks,
       min(created_at)::date AS oldest, max(created_at)::date AS newest
FROM audio_chunks;

-- C6-Q4 기준선: 영상 청크
SELECT 'C6-Q4' AS qid, count(*) AS chunks, coalesce(sum(size_bytes),0) AS bytes,
       count(*) FILTER (WHERE created_at < now() - interval '90 days') AS older_90d_chunks,
       count(*) FILTER (WHERE left(file_path, 1) = '/') AS local_path_chunks,
       min(created_at)::date AS oldest, max(created_at)::date AS newest
FROM video_chunks;

-- C6-Q5 기준선: EEG raw 청크 상태별 개수·바이트
SELECT 'C6-Q5' AS qid, upload_status, count(*) AS chunks, coalesce(sum(size_bytes),0) AS bytes,
       count(*) FILTER (WHERE coalesce(uploaded_at, created_at) < now() - interval '90 days') AS older_90d_chunks,
       min(created_at)::date AS oldest, max(created_at)::date AS newest
FROM eeg_raw_chunks GROUP BY upload_status ORDER BY upload_status;

-- C6-Q6 기준선: 세션 기록(병합 영상 키 보유 수, 전사문 보유 수·글자 수, 요약 JSON 바이트)
SELECT 'C6-Q6' AS qid, count(*) AS records,
       count(video_s3_key) AS with_merged_video,
       count(audio_s3_key) AS with_merged_audio,
       count(*) FILTER (WHERE transcript IS NOT NULL AND length(transcript) > 0) AS with_transcript,
       coalesce(sum(length(transcript)),0) AS transcript_chars,
       coalesce(sum(pg_column_size(ai_summary)),0) AS ai_summary_bytes,
       count(*) FILTER (WHERE status = 'manual') AS manual_records
FROM session_records;

-- C6-Q7 기준선: EEG 지표 윈도우·EEG 레코드
SELECT 'C6-Q7' AS qid, (SELECT count(*) FROM eeg_feature_windows) AS feature_windows,
       (SELECT count(DISTINCT participant_id) FROM eeg_feature_windows) AS feature_participants,
       (SELECT count(*) FROM eeg_records) AS eeg_records,
       (SELECT coalesce(sum(file_count),0) FROM eeg_records) AS eeg_record_file_count;

-- C6-Q8 기준선: 리포트 유형·상태별 개수, content JSON 바이트
SELECT 'C6-Q8' AS qid, type, status, count(*) AS reports,
       coalesce(sum(pg_column_size(content)),0) AS content_bytes,
       count(*) FILTER (WHERE sent_at IS NOT NULL) AS sent
FROM reports GROUP BY 2, 3 ORDER BY 2, 3;

-- C6-Q9 기준선: 비회원 리포트 메일 상태(값 없음)
SELECT 'C6-Q9' AS qid, report_email_status, count(*) AS participants FROM session_participants
WHERE report_email IS NOT NULL GROUP BY 2 ORDER BY 2;

-- C6-Q10 기준선: 서사 캐시(패턴 시그니처, 개인 데이터 없음)
SELECT 'C6-Q10' AS qid, source, count(*) AS entries FROM narrative_cache GROUP BY 2 ORDER BY 2;

-- C6-Q11 기준선: 마이그레이션 head (단일 head 확인)
SELECT 'C6-Q11' AS qid, version_num FROM alembic_version;
