-- SDD-211 P2(준비): 스키마 덤프 복원 직후 넣는 합성 시드. 사람이 쓴 가짜 행만 둔다(실데이터 0).
-- 이메일은 @example.com, 이름은 '테스트', UUID 는 gen_random_uuid() 로 생성한다(리터럴 UUID 없음).
-- 목적: 데이터가 있는 상태에서 `alembic upgrade head` 가 도는지 확인한다. 현재 head 에서는 no-op 이지만
--       Phase 1 의 M1 이후 델타가 얹히면서 의미가 생긴다.
-- 의존: 덤프 스키마가 head(e036a0000051) 이상. NOT NULL 컬럼이 늘면 이 파일을 함께 갱신한다.
\set ON_ERROR_STOP on

DO $$
DECLARE
    org_id uuid := gen_random_uuid();
    host_id uuid := gen_random_uuid();
    member_id uuid := gen_random_uuid();
    open_id uuid := gen_random_uuid();
    done_id uuid := gen_random_uuid();
    tpl_id uuid := gen_random_uuid();
BEGIN
    INSERT INTO organizations (id, name, verified) VALUES (org_id, '테스트 센터', false);

    INSERT INTO users (id, email, password_hash, name, role, verified_tier, org_id)
    VALUES (host_id, 'seed-host@example.com', 'x', '테스트 상담사', 'counselor', 'email', org_id),
           (member_id, 'seed-member@example.com', 'x', '테스트 회원', 'client', 'email', NULL);

    -- 활성 코드 중복 방지 부분 유니크(uq_sessions_active_access_code)를 건드리는 조합:
    -- 같은 4자리 코드를 활성 1건 + 종료 1건 + 템플릿 1건이 공유한다(조건에서 빠지는 행은 허용).
    INSERT INTO sessions (id, type, status, host_id, duration_min, max_participants, access_code, is_template)
    VALUES (open_id, 'meditation', 'open', host_id, 30, 10, '4821', false),
           (done_id, 'meditation', 'completed', host_id, 30, 10, '4821', false),
           (tpl_id, 'meditation', 'scheduled', host_id, 30, 10, '4821', true);

    INSERT INTO session_participants (id, session_id, user_id, band_connected, consent_audio, consent_eeg)
    VALUES (gen_random_uuid(), open_id, member_id, false, false, false);
END
$$;
