-- SDD-209 T0 — 원본 보유 스냅샷 (읽기 전용 집계: 개수·바이트·날짜 구간만)
-- 개인정보(이름·이메일·생년월일 등)·토큰·비밀번호·코드 값은 SELECT 하지 않는다.
-- 실행: baseline-snapshot.py (READ ONLY 트랜잭션, DATABASE_URL 은 환경변수로만 읽고 출력하지 않음)
-- 배포 전/후에 같은 쿼리를 돌려 결과를 diff 한다(RV1·RV7: 스위프 비활성이면 배포 직후 변동 0).

-- Q1 클래스 상태별 개수 / 코드 보유 개수(값은 조회하지 않음)
SELECT status, count(*) AS sessions,
       count(access_code) AS with_code,
       min(created_at)::date AS first_created, max(created_at)::date AS last_created
FROM sessions WHERE is_template = false GROUP BY status ORDER BY status;

-- Q2 참여자: 회원/비회원, 대기, 개인정보 보유 개수(값 없음)
SELECT (user_id IS NULL) AS is_guest, is_waitlisted,
       count(*) AS participants,
       count(guest_name) AS has_name, count(gender) AS has_gender,
       count(birth_date) AS has_birth, count(report_email) AS has_report_email,
       sum(consent_eeg::int) AS consent_eeg_true, sum(consent_audio::int) AS consent_audio_true
FROM session_participants GROUP BY 1, 2 ORDER BY 1, 2;

-- Q3 음성 청크(로컬 디스크 /var/lib/mindbreeze/audio 참조): 개수·바이트·90일 경과분
SELECT count(*) AS chunks, coalesce(sum(size_bytes),0) AS bytes,
       count(*) FILTER (WHERE created_at < now() - interval '90 days') AS older_90d_chunks,
       coalesce(sum(size_bytes) FILTER (WHERE created_at < now() - interval '90 days'),0) AS older_90d_bytes,
       count(*) FILTER (WHERE file_path LIKE '/%') AS local_path_chunks,
       min(created_at)::date AS oldest, max(created_at)::date AS newest
FROM audio_chunks;

-- Q4 영상 청크(S3 video/ 또는 로컬 폴백)
SELECT count(*) AS chunks, coalesce(sum(size_bytes),0) AS bytes,
       count(*) FILTER (WHERE created_at < now() - interval '90 days') AS older_90d_chunks,
       count(*) FILTER (WHERE file_path LIKE '/%') AS local_path_chunks,
       min(created_at)::date AS oldest, max(created_at)::date AS newest
FROM video_chunks;

-- Q5 EEG raw 청크(S3 eeg-raw/): 상태별 개수·바이트
SELECT upload_status, count(*) AS chunks, coalesce(sum(size_bytes),0) AS bytes,
       count(*) FILTER (WHERE coalesce(uploaded_at, created_at) < now() - interval '90 days') AS older_90d_chunks,
       min(created_at)::date AS oldest, max(created_at)::date AS newest
FROM eeg_raw_chunks GROUP BY upload_status ORDER BY upload_status;

-- Q6 세션 기록: 병합 영상 키 보유 수, 전사문 보유 수·글자 수, 요약 JSON 바이트
SELECT count(*) AS records,
       count(video_s3_key) AS with_merged_video,
       count(audio_s3_key) AS with_merged_audio,
       count(*) FILTER (WHERE transcript IS NOT NULL AND length(transcript) > 0) AS with_transcript,
       coalesce(sum(length(transcript)),0) AS transcript_chars,
       coalesce(sum(pg_column_size(ai_summary)),0) AS ai_summary_bytes,
       count(*) FILTER (WHERE status = 'manual') AS manual_records
FROM session_records;

-- Q7 EEG 지표 윈도우·EEG 레코드
SELECT (SELECT count(*) FROM eeg_feature_windows) AS feature_windows,
       (SELECT count(DISTINCT participant_id) FROM eeg_feature_windows) AS feature_participants,
       (SELECT count(*) FROM eeg_records) AS eeg_records,
       (SELECT coalesce(sum(file_count),0) FROM eeg_records) AS eeg_record_file_count;

-- Q8 리포트: 유형·상태별 개수, content JSON 바이트
SELECT type, status, count(*) AS reports,
       coalesce(sum(pg_column_size(content)),0) AS content_bytes,
       count(*) FILTER (WHERE sent_at IS NOT NULL) AS sent
FROM reports GROUP BY type, status ORDER BY type, status;

-- Q9 비회원 리포트 메일 상태(값 없음)
SELECT report_email_status, count(*) FROM session_participants
WHERE report_email IS NOT NULL GROUP BY 1 ORDER BY 1;

-- Q10 서사 캐시(패턴 시그니처, 개인 데이터 없음)
SELECT source, count(*) FROM narrative_cache GROUP BY source ORDER BY source;

-- Q11 마이그레이션 head (단일 head 확인)
SELECT version_num FROM alembic_version;
