-- SDD-210 T-1: 컷오버 사전 집계 (읽기 전용 · 개수/바이트 집계만)
-- 실행: psql "$DATABASE_URL_SYNC" -v ON_ERROR_STOP=0 -f cutover-precheck.sql  (deploy/precheck/run-precheck.sh 사용 권장)
-- 원칙: SELECT 만. 이메일·이름·토큰·비밀번호·코드 값 자체를 출력하지 않는다(건수·길이 분포만).
BEGIN READ ONLY;

\echo '== Q1. alembic head'
SELECT version_num FROM alembic_version;

\echo '== Q2. 접속 코드 길이 분포 (sessions.access_code / legacy_access_code) — 값 미출력'
SELECT coalesce(length(access_code)::text, 'NULL') AS access_code_len,
       status, count(*) AS rows
FROM sessions GROUP BY 1, 2 ORDER BY 1, 2;
SELECT count(*) AS legacy_access_code_rows FROM sessions WHERE legacy_access_code IS NOT NULL;

\echo '== Q3. 6자리 코드 + 활성(진행/예정/준비) 세션 수 — 컷오버 영향 대상'
SELECT status, count(*) AS rows
FROM sessions
WHERE length(access_code) = 6 AND status NOT IN ('completed', 'cancelled')
GROUP BY status ORDER BY status;

\echo '== Q4. 진행·예정 세션 (점검 진입 판단)'
SELECT status, count(*) AS rows,
       count(*) FILTER (WHERE scheduled_at BETWEEN now() AND now() + interval '24 hours') AS within_24h,
       count(*) FILTER (WHERE scheduled_at BETWEEN now() AND now() + interval '7 days') AS within_7d
FROM sessions WHERE status NOT IN ('completed', 'cancelled') GROUP BY status ORDER BY status;

\echo '== Q5. notification_outbox 상태/채널별 건수'
SELECT channel, status, count(*) AS rows,
       count(*) FILTER (WHERE available_at <= now()) AS due_now
FROM notification_outbox GROUP BY 1, 2 ORDER BY 1, 2;

\echo '== Q6. pipeline_outbox 상태별 건수'
SELECT status, count(*) AS rows FROM pipeline_outbox GROUP BY 1 ORDER BY 1;

\echo '== Q7. 기기 토큰 (device_tokens) 플랫폼별 — 토큰 값 미출력'
SELECT platform, count(*) AS rows, count(*) FILTER (WHERE revoked_at IS NULL) AS active
FROM device_tokens GROUP BY 1 ORDER BY 1;

\echo '== Q8. refresh_tokens 총/미폐기'
SELECT count(*) AS total, count(*) FILTER (WHERE revoked_at IS NULL) AS not_revoked FROM refresh_tokens;

\echo '== Q9. auth_provider 분포'
SELECT auth_provider, role, count(*) AS rows FROM users GROUP BY 1, 2 ORDER BY 1, 2;

\echo '== Q10. auth_provider=dev 계정을 참조하는 FK 행 수 (users.id 참조 컬럼 전수)'
SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name,
       (xpath('/row/c/text()', query_to_xml(
          format('SELECT count(*) AS c FROM %s WHERE %I IN (SELECT id FROM users WHERE auth_provider = ''dev'')',
                 c.conrelid::regclass, a.attname), false, true, '')))[1]::text::int AS rows_referencing_dev_users
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass AND array_length(c.conkey, 1) = 1
ORDER BY 3 DESC, 1, 2;

\echo '== Q11. S3 키 형식 분류 (relative=버킷/호스트 없는 상대 키, absolute=URL/s3://, has_dev_bucket=dev 버킷명 포함)'
WITH keys AS (
  SELECT 'session_records.audio_s3_key' AS src, audio_s3_key AS k FROM session_records WHERE audio_s3_key IS NOT NULL
  UNION ALL SELECT 'session_records.video_s3_key', video_s3_key FROM session_records WHERE video_s3_key IS NOT NULL
  UNION ALL SELECT 'eeg_records.s3_key', s3_key FROM eeg_records WHERE s3_key IS NOT NULL
  UNION ALL SELECT 'eeg_raw_chunks.object_key', object_key FROM eeg_raw_chunks WHERE object_key IS NOT NULL
  UNION ALL SELECT 'audio_chunks.file_path', file_path FROM audio_chunks WHERE file_path IS NOT NULL
  UNION ALL SELECT 'video_chunks.file_path', file_path FROM video_chunks WHERE file_path IS NOT NULL
  UNION ALL SELECT 'org_documents.s3_key', s3_key FROM org_documents WHERE s3_key IS NOT NULL
  UNION ALL SELECT 'credentials.s3_key', s3_key FROM credentials WHERE s3_key IS NOT NULL
  UNION ALL SELECT 'data_export_jobs.object_key', object_key FROM data_export_jobs WHERE object_key IS NOT NULL
  UNION ALL SELECT 'chat_messages.file_url', file_url FROM chat_messages WHERE file_url IS NOT NULL
)
SELECT src,
       count(*) AS rows,
       count(*) FILTER (WHERE k ~* '^(https?|s3)://') AS absolute,
       count(*) FILTER (WHERE k ILIKE '%mindbreeze-dev%') AS has_dev_bucket,
       count(*) FILTER (WHERE k ILIKE '%dev.mindbreeze%' OR k ILIKE '%dev-api%') AS has_dev_host,
       count(*) FILTER (WHERE k ~ '^/') AS leading_slash,
       count(*) FILTER (WHERE k !~* '^(https?|s3)://' AND k !~ '^/') AS relative
FROM keys GROUP BY src ORDER BY src;

\echo '== Q12. 키 접두사(첫 경로 조각) 분포 — 객체 키 구조 확인용'
SELECT split_part(object_key, '/', 1) AS prefix, count(*) AS rows, coalesce(sum(size_bytes), 0) AS bytes
FROM eeg_raw_chunks GROUP BY 1 ORDER BY 2 DESC LIMIT 10;

\echo '== Q12b. 슬래시 시작 경로(로컬 폴백 의심) 접두사 분포 — 서버 로컬 디스크 데이터 이관 필요 여부'
SELECT 'audio_chunks' AS t, split_part(file_path, '/', 2) || '/' || split_part(file_path, '/', 3) AS prefix, count(*) AS rows FROM audio_chunks WHERE file_path ~ '^/' GROUP BY 2
UNION ALL SELECT 'video_chunks', split_part(file_path, '/', 2) || '/' || split_part(file_path, '/', 3), count(*) FROM video_chunks WHERE file_path ~ '^/' GROUP BY 2
UNION ALL SELECT 'session_records.video', split_part(video_s3_key, '/', 2) || '/' || split_part(video_s3_key, '/', 3), count(*) FROM session_records WHERE video_s3_key ~ '^/' GROUP BY 2
UNION ALL SELECT 'video_chunks(relative)', split_part(file_path, '/', 1), count(*) FROM video_chunks WHERE file_path !~ '^/' GROUP BY 2
ORDER BY 1, 3 DESC;

\echo '== Q13. 업로드 상태별 청크 건수·바이트'
SELECT 'eeg_raw_chunks' AS t, upload_status, count(*) AS rows, coalesce(sum(size_bytes), 0) AS bytes FROM eeg_raw_chunks GROUP BY 2 ORDER BY 2;

\echo '== Q14. 테이블별 행 수 (컷오버 전후 정합 비교 기준, public 스키마 전 테이블)'
SELECT relname AS table_name,
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', relname), false, true, '')))[1]::text::bigint AS rows
FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace ORDER BY relname;

\echo '== Q15. DB 크기'
SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size;

ROLLBACK;
