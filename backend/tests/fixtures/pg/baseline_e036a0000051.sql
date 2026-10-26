-- SDD-211 P2: dev DB(PostgreSQL 16.14) 스키마 전용 덤프. alembic head e036a0000051. 데이터 행 없음.
-- 생성: pg_dump --schema-only --no-owner --no-privileges --no-comments (원격 dev, 읽기 전용) + restrict 토큰 줄 제거 + alembic_version 한 행.


-- Dumped from database version 16.14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: agent_briefing_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_briefing_logs (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    kind character varying(20) NOT NULL,
    briefing_date date NOT NULL,
    message_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_checkin_enablements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_checkin_enablements (
    id uuid NOT NULL,
    counselor_id uuid NOT NULL,
    client_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: agent_checkin_prefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_checkin_prefs (
    id uuid NOT NULL,
    client_id uuid NOT NULL,
    paused boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: agent_checkins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_checkins (
    id uuid NOT NULL,
    client_id uuid NOT NULL,
    counselor_id uuid NOT NULL,
    trigger character varying(20) DEFAULT 'no_response'::character varying NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    turn_count integer DEFAULT 0 NOT NULL,
    summary text,
    mood_direction character varying(10)
);


--
-- Name: agent_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_conversations (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    channel character varying(20) DEFAULT 'client'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone
);


--
-- Name: agent_counselor_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_counselor_settings (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    morning_enabled boolean DEFAULT true NOT NULL,
    morning_time character varying(5) DEFAULT '08:00'::character varying NOT NULL,
    evening_enabled boolean DEFAULT true NOT NULL,
    evening_time character varying(5) DEFAULT '21:00'::character varying NOT NULL,
    skip_no_session_days boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: agent_delivery_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_delivery_logs (
    id uuid NOT NULL,
    kind character varying(30) NOT NULL,
    ref_id uuid NOT NULL,
    offset_min integer DEFAULT 0 NOT NULL,
    user_id uuid NOT NULL,
    payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_memory_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_memory_items (
    id uuid NOT NULL,
    client_id uuid NOT NULL,
    category character varying(20) NOT NULL,
    key character varying(80) NOT NULL,
    value text NOT NULL,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: agent_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_messages (
    id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    sender character varying(10) NOT NULL,
    kind character varying(30) DEFAULT 'free'::character varying NOT NULL,
    content text NOT NULL,
    cta jsonb DEFAULT '[]'::jsonb NOT NULL,
    ref_type character varying(20),
    ref_id uuid,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_profile_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_profile_items (
    id uuid NOT NULL,
    client_id uuid NOT NULL,
    counselor_id uuid NOT NULL,
    category character varying(20) NOT NULL,
    text text NOT NULL,
    status character varying(20) DEFAULT 'ai_estimate'::character varying NOT NULL,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: agent_relay_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_relay_events (
    id uuid NOT NULL,
    kind character varying(30) NOT NULL,
    source_user_id uuid NOT NULL,
    target_user_id uuid,
    session_id uuid,
    payload jsonb NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    handled_at timestamp with time zone
);


--
-- Name: agent_risk_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_risk_signals (
    id uuid NOT NULL,
    client_id uuid NOT NULL,
    counselor_id uuid NOT NULL,
    message_id uuid,
    level character varying(10) NOT NULL,
    excerpt text NOT NULL,
    status character varying(20) DEFAULT 'open'::character varying NOT NULL,
    handled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: alembic_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alembic_version (
    version_num character varying(32) NOT NULL
);


--
-- Name: audio_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audio_chunks (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    chunk_index integer NOT NULL,
    file_path character varying(500) NOT NULL,
    size_bytes integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: careers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.careers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role character varying(100),
    organization character varying(200),
    started_at date,
    ended_at date,
    is_current boolean DEFAULT false,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: chat_message_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_message_reads (
    message_id uuid NOT NULL,
    user_id uuid NOT NULL,
    read_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id uuid NOT NULL,
    room_id uuid NOT NULL,
    sender_id uuid,
    type character varying(20) NOT NULL,
    content text,
    file_url character varying(500),
    event_type character varying(40),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_by jsonb,
    recipient_count integer DEFAULT 0
);


--
-- Name: chat_room_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_room_participants (
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_rooms (
    id uuid NOT NULL,
    session_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    room_type character varying(20) DEFAULT 'session'::character varying NOT NULL,
    host_id uuid,
    name character varying(120),
    display_name character varying(120)
);


--
-- Name: client_counselor_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_counselor_links (
    id uuid NOT NULL,
    client_id uuid NOT NULL,
    counselor_id uuid NOT NULL,
    status character varying(20) NOT NULL,
    matched_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    memo text
);


--
-- Name: client_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_invites (
    id uuid NOT NULL,
    counselor_id uuid NOT NULL,
    email character varying(255) NOT NULL,
    token character varying(64) NOT NULL,
    status character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: client_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_profiles (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    gender character varying(20),
    birth_date date,
    concerns character varying[] NOT NULL,
    interests character varying[] NOT NULL,
    profile_image_url character varying(500),
    bio text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: consents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consents (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    type character varying(20) NOT NULL,
    version character varying(20) NOT NULL,
    agreed boolean NOT NULL,
    agreed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: counselor_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.counselor_profiles (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    counselor_code character varying(6) NOT NULL,
    gender character varying(20),
    birth_date date,
    years_of_experience integer,
    specialties character varying[] NOT NULL,
    affiliation_type character varying(50),
    profile_image_url character varying(500),
    bio text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    postal_code character varying(20),
    address_line1 character varying(300),
    address_line2 character varying(200),
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credentials (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    type character varying(20) NOT NULL,
    s3_key character varying(500) NOT NULL,
    file_name character varying(255),
    ai_verdict jsonb,
    status character varying(20) NOT NULL,
    expires_at date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: data_export_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_export_audits (
    id uuid NOT NULL,
    export_id uuid,
    user_id uuid NOT NULL,
    role character varying(20) NOT NULL,
    session_id uuid NOT NULL,
    participant_id uuid NOT NULL,
    purpose text NOT NULL,
    policy_version character varying(50) NOT NULL,
    event character varying(40) NOT NULL,
    result character varying(60) NOT NULL,
    size_bytes bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: data_export_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_export_jobs (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    requester_role character varying(20) NOT NULL,
    session_id uuid NOT NULL,
    participant_id uuid NOT NULL,
    include jsonb NOT NULL,
    purpose text NOT NULL,
    idempotency_key character varying(128),
    request_hash character varying(64) NOT NULL,
    status character varying(30) NOT NULL,
    schema_version character varying(30) NOT NULL,
    consent_policy_version character varying(50) NOT NULL,
    consent_eeg boolean NOT NULL,
    snapshot_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    object_key character varying(500),
    size_bytes bigint,
    checksum character varying(64),
    completed_count integer NOT NULL,
    warnings jsonb NOT NULL,
    error_code character varying(60),
    CONSTRAINT ck_data_export_status CHECK (((status)::text = ANY ((ARRAY['queued'::character varying, 'preparing'::character varying, 'ready'::character varying, 'ready_with_warnings'::character varying, 'failed'::character varying, 'expired'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: device_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token character varying(512) NOT NULL,
    platform character varying(10) NOT NULL,
    app_version character varying(50),
    device_label character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone,
    revoked_at timestamp with time zone,
    p256dh character varying(255),
    auth character varying(64)
);


--
-- Name: eeg_feature_windows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eeg_feature_windows (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    user_id uuid,
    window_index integer NOT NULL,
    quality character varying(10) DEFAULT 'valid'::character varying NOT NULL,
    focus_index double precision,
    cognitive_load double precision,
    relaxation_index double precision,
    stress_index double precision,
    emotional_stability double precision,
    total_neural_activity double precision,
    faa double precision,
    hemispheric_balance double precision,
    created_at timestamp with time zone DEFAULT now(),
    participant_id uuid,
    device_timestamp_ms double precision,
    delta_power double precision,
    theta_power double precision,
    alpha_power double precision,
    beta_power double precision,
    gamma_power double precision,
    total_power double precision,
    meditation_level double precision,
    attention_level double precision,
    signal_quality double precision,
    play_group_id character varying(64),
    sdnn double precision,
    rmssd double precision,
    lf_power double precision,
    hf_power double precision,
    lf_hf_ratio double precision,
    heart_rate double precision,
    motion double precision,
    respiratory_rate double precision
);


--
-- Name: eeg_raw_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eeg_raw_chunks (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    participant_id uuid,
    user_id uuid,
    stream_id character varying(128) DEFAULT 'default'::character varying NOT NULL,
    chunk_index integer NOT NULL,
    start_ms double precision,
    end_ms double precision,
    sample_rate integer DEFAULT 250 NOT NULL,
    channel_count integer DEFAULT 2 NOT NULL,
    unit character varying(20) DEFAULT 'uV'::character varying NOT NULL,
    schema_version character varying(20) DEFAULT '1.0'::character varying NOT NULL,
    checksum character varying(128),
    size_bytes integer,
    object_key character varying(500) NOT NULL,
    upload_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    uploaded_at timestamp with time zone
);


--
-- Name: eeg_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eeg_records (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    user_id uuid,
    s3_key character varying(500) NOT NULL,
    duration_sec integer,
    sample_rate integer NOT NULL,
    analysis_result jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    participant_id uuid,
    play_group_id character varying(64),
    file_count integer DEFAULT 0 NOT NULL
);


--
-- Name: narrative_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.narrative_cache (
    signature character varying(6) NOT NULL,
    narrative jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source character varying(8) DEFAULT 'llm'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: normalization_baselines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.normalization_baselines (
    id integer NOT NULL,
    user_id character varying NOT NULL,
    device_id character varying,
    pipeline_version character varying,
    gender character varying,
    birth_date character varying,
    closed json NOT NULL,
    open json NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT false NOT NULL
);


--
-- Name: normalization_baselines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.normalization_baselines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: normalization_baselines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.normalization_baselines_id_seq OWNED BY public.normalization_baselines.id;


--
-- Name: normalization_models; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.normalization_models (
    id integer NOT NULL,
    version integer NOT NULL,
    n_samples integer NOT NULL,
    params json NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT false NOT NULL
);


--
-- Name: normalization_models_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.normalization_models_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: normalization_models_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.normalization_models_id_seq OWNED BY public.normalization_models.id;


--
-- Name: notification_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_outbox (
    id uuid NOT NULL,
    notification_id uuid,
    user_id uuid NOT NULL,
    channel character varying(10) NOT NULL,
    recipient character varying(500),
    payload jsonb NOT NULL,
    status character varying(20) NOT NULL,
    attempts integer NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    type character varying(30) NOT NULL,
    title character varying(200) NOT NULL,
    body text,
    is_read boolean NOT NULL,
    extra jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone
);


--
-- Name: onboarding_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_progress (
    user_id uuid NOT NULL,
    current_step integer NOT NULL,
    completed boolean NOT NULL,
    completed_at timestamp with time zone,
    steps jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: org_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_documents (
    id uuid NOT NULL,
    org_id uuid NOT NULL,
    type character varying(40) NOT NULL,
    s3_key character varying(500) NOT NULL,
    file_name character varying(255),
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    ai_verdict jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: org_join_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_join_requests (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    org_id uuid NOT NULL,
    status character varying(20) NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid NOT NULL,
    name character varying(200) NOT NULL,
    ceo_name character varying(100),
    biz_number character varying(10),
    address character varying(300),
    phone character varying(20),
    verified boolean NOT NULL,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_code character varying(6),
    primary_admin_id uuid,
    kind character varying(20) DEFAULT 'institution'::character varying NOT NULL,
    owner_user_id uuid,
    deactivated_at timestamp with time zone,
    deactivated_by uuid,
    deactivation_reason text,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: original_deletion_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.original_deletion_audits (
    id uuid NOT NULL,
    actor_id uuid NOT NULL,
    target_type character varying(20) NOT NULL,
    target_id uuid NOT NULL,
    reason text NOT NULL,
    scopes jsonb DEFAULT '[]'::jsonb NOT NULL,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: password_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_history (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    password_hash character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pipeline_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipeline_outbox (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    has_recording boolean DEFAULT false NOT NULL,
    needs_video_merge boolean DEFAULT false NOT NULL,
    needs_report boolean DEFAULT false NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: qualifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qualifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    issuer character varying(100),
    issued_at date,
    expires_at date,
    credential_number character varying(100),
    credential_url character varying(500),
    is_verified boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    id uuid NOT NULL,
    jti character varying(64) NOT NULL,
    user_id uuid NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    replaced_by character varying(64),
    user_agent character varying(255),
    ip_address character varying(45)
);


--
-- Name: report_choice_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_choice_events (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    participant_id uuid NOT NULL,
    previous_included boolean NOT NULL,
    new_included boolean NOT NULL,
    actor_kind character varying(20) NOT NULL,
    actor_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    user_id uuid,
    type character varying(20) NOT NULL,
    content jsonb NOT NULL,
    pdf_url character varying(500),
    sent_at timestamp with time zone,
    is_read boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status character varying(30) DEFAULT 'pending_analysis'::character varying NOT NULL,
    data_credibility character varying(20),
    participant_id uuid,
    generation_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    generation_started_at timestamp with time zone,
    generation_error character varying(50)
);


--
-- Name: research_consent_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_consent_events (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    participant_id uuid NOT NULL,
    event_type character varying(20) NOT NULL,
    previous_consented boolean NOT NULL,
    new_consented boolean NOT NULL,
    notice_version character varying(20),
    actor_kind character varying(20) DEFAULT 'self'::character varying NOT NULL,
    actor_user_id uuid,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: research_consents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_consents (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    participant_id uuid NOT NULL,
    consented boolean DEFAULT false NOT NULL,
    notice_version character varying(20),
    consented_at timestamp with time zone,
    withdrawn_at timestamp with time zone,
    research_subject_id character varying(64),
    key_version integer,
    birth_year_month character varying(7),
    gender character varying(20),
    export_state character varying(30) DEFAULT 'not_applicable'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    hold_alerted_at timestamp with time zone
);


--
-- Name: research_export_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_export_batches (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    status character varying(15) DEFAULT 'building'::character varying NOT NULL,
    key_version integer,
    prefix character varying(200),
    manifest_sha256 character varying(64),
    total_bytes integer DEFAULT 0 NOT NULL,
    file_count integer DEFAULT 0 NOT NULL,
    attempt integer DEFAULT 1 NOT NULL,
    last_error text,
    alerted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    uploaded_at timestamp with time zone,
    acked_at timestamp with time zone
);


--
-- Name: research_export_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_export_items (
    id uuid NOT NULL,
    batch_id uuid NOT NULL,
    consent_id uuid NOT NULL,
    research_subject_id character varying(64) NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    content_sha256 character varying(64) NOT NULL,
    rows jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: research_withdrawal_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_withdrawal_requests (
    id uuid NOT NULL,
    research_subject_id character varying(64) NOT NULL,
    key_version integer NOT NULL,
    requested_by uuid NOT NULL,
    reason text NOT NULL,
    affected_count integer DEFAULT 0 NOT NULL,
    spark_confirmed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: retention_sweep_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retention_sweep_runs (
    id uuid NOT NULL,
    mode character varying(10) NOT NULL,
    trigger character varying(10) DEFAULT 'manual'::character varying NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    status character varying(10) DEFAULT 'running'::character varying NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    report jsonb DEFAULT '{}'::jsonb NOT NULL,
    error text
);


--
-- Name: session_email_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_email_invites (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    created_by uuid,
    email character varying(320),
    email_norm character varying(320),
    status character varying(20) DEFAULT 'queued'::character varying NOT NULL,
    last_error character varying(100),
    request_count integer DEFAULT 0 NOT NULL,
    queued_at timestamp with time zone,
    requested_at timestamp with time zone,
    pii_scrubbed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: session_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_participants (
    session_id uuid NOT NULL,
    user_id uuid,
    band_connected boolean NOT NULL,
    consent_audio boolean NOT NULL,
    consent_eeg boolean NOT NULL,
    is_waitlisted boolean DEFAULT false NOT NULL,
    waitlist_position integer,
    linkband_device_id character varying,
    webrtc_peer_id character varying,
    id uuid NOT NULL,
    guest_name character varying(100),
    joined_at timestamp with time zone DEFAULT now(),
    band_battery integer,
    report_email character varying(320),
    report_email_status character varying(20),
    report_email_sent_at timestamp with time zone,
    gender character varying(20),
    birth_date date,
    raise_hand boolean DEFAULT false NOT NULL,
    speaking boolean DEFAULT false NOT NULL,
    removed_at timestamp with time zone,
    report_included boolean DEFAULT false NOT NULL,
    report_notice_ack_at timestamp with time zone,
    report_notice_version character varying(20),
    entry_ver integer DEFAULT 0 NOT NULL,
    waitlist_cancelled_at timestamp with time zone,
    pii_scrubbed_at timestamp with time zone,
    entered_at timestamp with time zone
);


--
-- Name: session_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_records (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    transcript text,
    ai_summary jsonb NOT NULL,
    counselor_notes text,
    markers jsonb NOT NULL,
    is_edited boolean NOT NULL,
    edit_history jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status character varying(20) NOT NULL,
    audio_s3_key character varying(500),
    recording_started_at timestamp with time zone,
    recording_ended_at timestamp with time zone,
    video_status character varying(20) DEFAULT 'idle'::character varying NOT NULL,
    video_s3_key character varying(500),
    video_recording_started_at timestamp with time zone,
    video_recording_ended_at timestamp with time zone,
    subjective_state jsonb,
    video_expected_chunks integer
);


--
-- Name: session_reminder_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_reminder_logs (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    user_id uuid,
    offset_min integer NOT NULL,
    channel character varying(10) NOT NULL,
    status character varying(20) DEFAULT 'sent'::character varying NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid NOT NULL,
    type character varying(20) NOT NULL,
    status character varying(20) NOT NULL,
    host_id uuid NOT NULL,
    scheduled_at timestamp with time zone,
    duration_min integer NOT NULL,
    title character varying(200),
    notes text,
    max_participants integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    custom_type_name character varying(30),
    location_type character varying(20) DEFAULT 'offline'::character varying NOT NULL,
    participant_mode character varying(20) DEFAULT 'one_on_one'::character varying NOT NULL,
    linkband_mode character varying(20) DEFAULT 'none'::character varying NOT NULL,
    webrtc_room_id uuid,
    sfu_enabled boolean DEFAULT false NOT NULL,
    access_code character varying(6),
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    state_version integer DEFAULT 0 NOT NULL,
    run_id uuid,
    organization_id uuid,
    organization_attribution_known boolean DEFAULT false NOT NULL,
    opened_at timestamp with time zone,
    record_audio boolean DEFAULT true NOT NULL,
    record_video boolean DEFAULT true NOT NULL,
    chat_enabled boolean DEFAULT false NOT NULL,
    is_template boolean DEFAULT false NOT NULL,
    reminder_offsets jsonb DEFAULT '[]'::jsonb NOT NULL,
    location_address character varying(300),
    hidden_at timestamp with time zone,
    legacy_access_code character varying(6)
);


--
-- Name: signup_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signup_applications (
    id uuid NOT NULL,
    application_type character varying(30) NOT NULL,
    organization_name character varying(200) NOT NULL,
    contact_name character varying(100) NOT NULL,
    email character varying(255) NOT NULL,
    phone character varying(20),
    inquiry text,
    specialties character varying(300),
    status character varying(20) DEFAULT 'submitted'::character varying NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    review_note text,
    organization_id uuid,
    user_id uuid,
    notify_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    notified_at timestamp with time zone,
    consented_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_signup_application_status CHECK (((status)::text = ANY ((ARRAY['submitted'::character varying, 'reviewing'::character varying, 'approved'::character varying, 'rejected'::character varying, 'withdrawn'::character varying])::text[]))),
    CONSTRAINT ck_signup_application_type CHECK (((application_type)::text = ANY ((ARRAY['organization'::character varying, 'individual_counselor'::character varying])::text[])))
);


--
-- Name: user_org_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_org_memberships (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    org_id uuid NOT NULL,
    role character varying(20) DEFAULT 'counselor'::character varying NOT NULL,
    status character varying(20) DEFAULT 'invited'::character varying NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    invited_at timestamp with time zone,
    invite_expires_at timestamp with time zone,
    joined_at timestamp with time zone,
    left_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    name character varying(100) NOT NULL,
    role character varying(20) NOT NULL,
    phone character varying(20),
    profile_image character varying(500),
    bio text,
    verified_tier character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    notification_preferences jsonb,
    auth_provider character varying(20) DEFAULT 'email'::character varying,
    invited_at timestamp with time zone,
    invite_expires_at timestamp with time zone,
    auto_approve_report boolean DEFAULT false NOT NULL
);


--
-- Name: verification_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verification_audits (
    id uuid NOT NULL,
    credential_id uuid,
    admin_id uuid,
    action character varying(30) NOT NULL,
    reason text,
    extra jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    target_type character varying(30),
    target_id uuid
);


--
-- Name: video_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.video_chunks (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    chunk_index integer NOT NULL,
    file_path character varying(500) NOT NULL,
    size_bytes integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: normalization_baselines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.normalization_baselines ALTER COLUMN id SET DEFAULT nextval('public.normalization_baselines_id_seq'::regclass);


--
-- Name: normalization_models id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.normalization_models ALTER COLUMN id SET DEFAULT nextval('public.normalization_models_id_seq'::regclass);


--
-- Name: agent_briefing_logs agent_briefing_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_briefing_logs
    ADD CONSTRAINT agent_briefing_logs_pkey PRIMARY KEY (id);


--
-- Name: agent_checkin_enablements agent_checkin_enablements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_checkin_enablements
    ADD CONSTRAINT agent_checkin_enablements_pkey PRIMARY KEY (id);


--
-- Name: agent_checkin_prefs agent_checkin_prefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_checkin_prefs
    ADD CONSTRAINT agent_checkin_prefs_pkey PRIMARY KEY (id);


--
-- Name: agent_checkins agent_checkins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_checkins
    ADD CONSTRAINT agent_checkins_pkey PRIMARY KEY (id);


--
-- Name: agent_conversations agent_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_conversations
    ADD CONSTRAINT agent_conversations_pkey PRIMARY KEY (id);


--
-- Name: agent_counselor_settings agent_counselor_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_counselor_settings
    ADD CONSTRAINT agent_counselor_settings_pkey PRIMARY KEY (id);


--
-- Name: agent_delivery_logs agent_delivery_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_delivery_logs
    ADD CONSTRAINT agent_delivery_logs_pkey PRIMARY KEY (id);


--
-- Name: agent_memory_items agent_memory_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_memory_items
    ADD CONSTRAINT agent_memory_items_pkey PRIMARY KEY (id);


--
-- Name: agent_messages agent_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_pkey PRIMARY KEY (id);


--
-- Name: agent_profile_items agent_profile_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_profile_items
    ADD CONSTRAINT agent_profile_items_pkey PRIMARY KEY (id);


--
-- Name: agent_relay_events agent_relay_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_relay_events
    ADD CONSTRAINT agent_relay_events_pkey PRIMARY KEY (id);


--
-- Name: agent_risk_signals agent_risk_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_risk_signals
    ADD CONSTRAINT agent_risk_signals_pkey PRIMARY KEY (id);


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: audio_chunks audio_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_chunks
    ADD CONSTRAINT audio_chunks_pkey PRIMARY KEY (id);


--
-- Name: careers careers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.careers
    ADD CONSTRAINT careers_pkey PRIMARY KEY (id);


--
-- Name: chat_message_reads chat_message_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_reads
    ADD CONSTRAINT chat_message_reads_pkey PRIMARY KEY (message_id, user_id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: chat_room_participants chat_room_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_room_participants
    ADD CONSTRAINT chat_room_participants_pkey PRIMARY KEY (room_id, user_id);


--
-- Name: chat_rooms chat_rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT chat_rooms_pkey PRIMARY KEY (id);


--
-- Name: chat_rooms chat_rooms_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT chat_rooms_session_id_key UNIQUE (session_id);


--
-- Name: client_counselor_links client_counselor_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_counselor_links
    ADD CONSTRAINT client_counselor_links_pkey PRIMARY KEY (id);


--
-- Name: client_invites client_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_invites
    ADD CONSTRAINT client_invites_pkey PRIMARY KEY (id);


--
-- Name: client_profiles client_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_profiles
    ADD CONSTRAINT client_profiles_pkey PRIMARY KEY (id);


--
-- Name: consents consents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consents
    ADD CONSTRAINT consents_pkey PRIMARY KEY (id);


--
-- Name: counselor_profiles counselor_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counselor_profiles
    ADD CONSTRAINT counselor_profiles_pkey PRIMARY KEY (id);


--
-- Name: credentials credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credentials
    ADD CONSTRAINT credentials_pkey PRIMARY KEY (id);


--
-- Name: data_export_audits data_export_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_export_audits
    ADD CONSTRAINT data_export_audits_pkey PRIMARY KEY (id);


--
-- Name: data_export_jobs data_export_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_export_jobs
    ADD CONSTRAINT data_export_jobs_pkey PRIMARY KEY (id);


--
-- Name: device_tokens device_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_pkey PRIMARY KEY (id);


--
-- Name: eeg_feature_windows eeg_feature_windows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eeg_feature_windows
    ADD CONSTRAINT eeg_feature_windows_pkey PRIMARY KEY (id);


--
-- Name: eeg_raw_chunks eeg_raw_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eeg_raw_chunks
    ADD CONSTRAINT eeg_raw_chunks_pkey PRIMARY KEY (id);


--
-- Name: eeg_records eeg_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eeg_records
    ADD CONSTRAINT eeg_records_pkey PRIMARY KEY (id);


--
-- Name: narrative_cache narrative_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.narrative_cache
    ADD CONSTRAINT narrative_cache_pkey PRIMARY KEY (signature);


--
-- Name: normalization_baselines normalization_baselines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.normalization_baselines
    ADD CONSTRAINT normalization_baselines_pkey PRIMARY KEY (id);


--
-- Name: normalization_models normalization_models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.normalization_models
    ADD CONSTRAINT normalization_models_pkey PRIMARY KEY (id);


--
-- Name: notification_outbox notification_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_outbox
    ADD CONSTRAINT notification_outbox_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: onboarding_progress onboarding_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_progress
    ADD CONSTRAINT onboarding_progress_pkey PRIMARY KEY (user_id);


--
-- Name: org_documents org_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_documents
    ADD CONSTRAINT org_documents_pkey PRIMARY KEY (id);


--
-- Name: org_join_requests org_join_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_join_requests
    ADD CONSTRAINT org_join_requests_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_biz_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_biz_number_key UNIQUE (biz_number);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: original_deletion_audits original_deletion_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.original_deletion_audits
    ADD CONSTRAINT original_deletion_audits_pkey PRIMARY KEY (id);


--
-- Name: password_history password_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_history
    ADD CONSTRAINT password_history_pkey PRIMARY KEY (id);


--
-- Name: pipeline_outbox pipeline_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_outbox
    ADD CONSTRAINT pipeline_outbox_pkey PRIMARY KEY (id);


--
-- Name: qualifications qualifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qualifications
    ADD CONSTRAINT qualifications_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: report_choice_events report_choice_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_choice_events
    ADD CONSTRAINT report_choice_events_pkey PRIMARY KEY (id);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: research_consent_events research_consent_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_consent_events
    ADD CONSTRAINT research_consent_events_pkey PRIMARY KEY (id);


--
-- Name: research_consents research_consents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_consents
    ADD CONSTRAINT research_consents_pkey PRIMARY KEY (id);


--
-- Name: research_export_batches research_export_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_export_batches
    ADD CONSTRAINT research_export_batches_pkey PRIMARY KEY (id);


--
-- Name: research_export_items research_export_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_export_items
    ADD CONSTRAINT research_export_items_pkey PRIMARY KEY (id);


--
-- Name: research_withdrawal_requests research_withdrawal_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_withdrawal_requests
    ADD CONSTRAINT research_withdrawal_requests_pkey PRIMARY KEY (id);


--
-- Name: retention_sweep_runs retention_sweep_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_sweep_runs
    ADD CONSTRAINT retention_sweep_runs_pkey PRIMARY KEY (id);


--
-- Name: session_email_invites session_email_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_email_invites
    ADD CONSTRAINT session_email_invites_pkey PRIMARY KEY (id);


--
-- Name: session_participants session_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_participants
    ADD CONSTRAINT session_participants_pkey PRIMARY KEY (id);


--
-- Name: session_records session_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_records
    ADD CONSTRAINT session_records_pkey PRIMARY KEY (id);


--
-- Name: session_records session_records_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_records
    ADD CONSTRAINT session_records_session_id_key UNIQUE (session_id);


--
-- Name: session_reminder_logs session_reminder_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_reminder_logs
    ADD CONSTRAINT session_reminder_logs_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: signup_applications signup_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signup_applications
    ADD CONSTRAINT signup_applications_pkey PRIMARY KEY (id);


--
-- Name: agent_briefing_logs uq_agent_briefing_log; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_briefing_logs
    ADD CONSTRAINT uq_agent_briefing_log UNIQUE (user_id, kind, briefing_date);


--
-- Name: agent_checkin_enablements uq_agent_checkin_enablement_pair; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_checkin_enablements
    ADD CONSTRAINT uq_agent_checkin_enablement_pair UNIQUE (counselor_id, client_id);


--
-- Name: agent_checkin_prefs uq_agent_checkin_prefs_client; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_checkin_prefs
    ADD CONSTRAINT uq_agent_checkin_prefs_client UNIQUE (client_id);


--
-- Name: agent_conversations uq_agent_conversation_user_channel; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_conversations
    ADD CONSTRAINT uq_agent_conversation_user_channel UNIQUE (user_id, channel);


--
-- Name: agent_counselor_settings uq_agent_counselor_settings_user; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_counselor_settings
    ADD CONSTRAINT uq_agent_counselor_settings_user UNIQUE (user_id);


--
-- Name: agent_delivery_logs uq_agent_delivery_log; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_delivery_logs
    ADD CONSTRAINT uq_agent_delivery_log UNIQUE (kind, ref_id, offset_min, user_id);


--
-- Name: agent_memory_items uq_agent_memory_item_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_memory_items
    ADD CONSTRAINT uq_agent_memory_item_key UNIQUE (client_id, category, key);


--
-- Name: audio_chunks uq_audio_chunk_session_idx; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_chunks
    ADD CONSTRAINT uq_audio_chunk_session_idx UNIQUE (session_id, chunk_index);


--
-- Name: client_counselor_links uq_client_counselor; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_counselor_links
    ADD CONSTRAINT uq_client_counselor UNIQUE (client_id, counselor_id);


--
-- Name: consents uq_consent_user_type_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consents
    ADD CONSTRAINT uq_consent_user_type_version UNIQUE (user_id, type, version);


--
-- Name: data_export_jobs uq_data_export_idempotency; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_export_jobs
    ADD CONSTRAINT uq_data_export_idempotency UNIQUE (user_id, idempotency_key);


--
-- Name: device_tokens uq_device_tokens_token; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT uq_device_tokens_token UNIQUE (token);


--
-- Name: eeg_feature_windows uq_eeg_feature_window; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eeg_feature_windows
    ADD CONSTRAINT uq_eeg_feature_window UNIQUE (session_id, participant_id, play_group_id, window_index);


--
-- Name: eeg_raw_chunks uq_eeg_raw_chunk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eeg_raw_chunks
    ADD CONSTRAINT uq_eeg_raw_chunk UNIQUE (session_id, participant_id, stream_id, chunk_index);


--
-- Name: pipeline_outbox uq_pipeline_outbox_session; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_outbox
    ADD CONSTRAINT uq_pipeline_outbox_session UNIQUE (session_id);


--
-- Name: research_consents uq_research_consents_participant; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_consents
    ADD CONSTRAINT uq_research_consents_participant UNIQUE (participant_id);


--
-- Name: research_export_items uq_research_export_item; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_export_items
    ADD CONSTRAINT uq_research_export_item UNIQUE (batch_id, consent_id);


--
-- Name: session_email_invites uq_session_email_invite; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_email_invites
    ADD CONSTRAINT uq_session_email_invite UNIQUE (session_id, email_norm);


--
-- Name: session_participants uq_session_participant_user; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_participants
    ADD CONSTRAINT uq_session_participant_user UNIQUE (session_id, user_id);


--
-- Name: session_reminder_logs uq_session_reminder_delivery; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_reminder_logs
    ADD CONSTRAINT uq_session_reminder_delivery UNIQUE (session_id, offset_min, user_id, channel);


--
-- Name: video_chunks uq_video_chunk_session_idx; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_chunks
    ADD CONSTRAINT uq_video_chunk_session_idx UNIQUE (session_id, chunk_index);


--
-- Name: user_org_memberships user_org_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_org_memberships
    ADD CONSTRAINT user_org_memberships_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: verification_audits verification_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_audits
    ADD CONSTRAINT verification_audits_pkey PRIMARY KEY (id);


--
-- Name: video_chunks video_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_chunks
    ADD CONSTRAINT video_chunks_pkey PRIMARY KEY (id);


--
-- Name: ix_agent_briefing_logs_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_briefing_logs_user_id ON public.agent_briefing_logs USING btree (user_id);


--
-- Name: ix_agent_checkin_enablements_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_checkin_enablements_client ON public.agent_checkin_enablements USING btree (client_id, enabled);


--
-- Name: ix_agent_checkin_enablements_counselor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_checkin_enablements_counselor_id ON public.agent_checkin_enablements USING btree (counselor_id);


--
-- Name: ix_agent_checkins_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_checkins_client_id ON public.agent_checkins USING btree (client_id);


--
-- Name: ix_agent_checkins_client_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_checkins_client_started ON public.agent_checkins USING btree (client_id, started_at);


--
-- Name: ix_agent_checkins_counselor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_checkins_counselor_id ON public.agent_checkins USING btree (counselor_id);


--
-- Name: ix_agent_checkins_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_checkins_open ON public.agent_checkins USING btree (client_id, closed_at);


--
-- Name: ix_agent_conversations_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_conversations_user_id ON public.agent_conversations USING btree (user_id);


--
-- Name: ix_agent_delivery_logs_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_delivery_logs_ref ON public.agent_delivery_logs USING btree (ref_id, kind);


--
-- Name: ix_agent_delivery_logs_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_delivery_logs_user_id ON public.agent_delivery_logs USING btree (user_id);


--
-- Name: ix_agent_memory_items_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_memory_items_client ON public.agent_memory_items USING btree (client_id);


--
-- Name: ix_agent_messages_conversation_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_messages_conversation_created ON public.agent_messages USING btree (conversation_id, created_at);


--
-- Name: ix_agent_messages_conversation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_messages_conversation_id ON public.agent_messages USING btree (conversation_id);


--
-- Name: ix_agent_messages_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_messages_created_at ON public.agent_messages USING btree (created_at);


--
-- Name: ix_agent_profile_items_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_profile_items_client_id ON public.agent_profile_items USING btree (client_id);


--
-- Name: ix_agent_profile_items_counselor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_profile_items_counselor_id ON public.agent_profile_items USING btree (counselor_id);


--
-- Name: ix_agent_profile_items_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_profile_items_owner ON public.agent_profile_items USING btree (counselor_id, client_id, category);


--
-- Name: ix_agent_relay_events_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_relay_events_session_id ON public.agent_relay_events USING btree (session_id);


--
-- Name: ix_agent_relay_events_source_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_relay_events_source_user_id ON public.agent_relay_events USING btree (source_user_id);


--
-- Name: ix_agent_relay_events_target_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_relay_events_target_created ON public.agent_relay_events USING btree (target_user_id, created_at);


--
-- Name: ix_agent_relay_events_target_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_relay_events_target_user_id ON public.agent_relay_events USING btree (target_user_id);


--
-- Name: ix_agent_risk_signals_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_risk_signals_client_id ON public.agent_risk_signals USING btree (client_id);


--
-- Name: ix_agent_risk_signals_client_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_risk_signals_client_level ON public.agent_risk_signals USING btree (client_id, level, created_at);


--
-- Name: ix_agent_risk_signals_counselor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_risk_signals_counselor_id ON public.agent_risk_signals USING btree (counselor_id);


--
-- Name: ix_agent_risk_signals_owner_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agent_risk_signals_owner_created ON public.agent_risk_signals USING btree (counselor_id, created_at);


--
-- Name: ix_chat_message_reads_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_chat_message_reads_user_id ON public.chat_message_reads USING btree (user_id, message_id);


--
-- Name: ix_chat_messages_room_id_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_chat_messages_room_id_created_at ON public.chat_messages USING btree (room_id, created_at DESC);


--
-- Name: ix_client_counselor_links_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_client_counselor_links_client_id ON public.client_counselor_links USING btree (client_id);


--
-- Name: ix_client_counselor_links_counselor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_client_counselor_links_counselor_id ON public.client_counselor_links USING btree (counselor_id);


--
-- Name: ix_client_invites_counselor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_client_invites_counselor_id ON public.client_invites USING btree (counselor_id);


--
-- Name: ix_client_invites_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_client_invites_token ON public.client_invites USING btree (token);


--
-- Name: ix_client_profiles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_client_profiles_user_id ON public.client_profiles USING btree (user_id);


--
-- Name: ix_consents_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_consents_user_id ON public.consents USING btree (user_id);


--
-- Name: ix_counselor_profiles_counselor_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_counselor_profiles_counselor_code ON public.counselor_profiles USING btree (counselor_code);


--
-- Name: ix_counselor_profiles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_counselor_profiles_user_id ON public.counselor_profiles USING btree (user_id);


--
-- Name: ix_credentials_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_credentials_user_id ON public.credentials USING btree (user_id);


--
-- Name: ix_data_export_audits_export_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_data_export_audits_export_id ON public.data_export_audits USING btree (export_id);


--
-- Name: ix_data_export_jobs_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_data_export_jobs_expires_at ON public.data_export_jobs USING btree (expires_at);


--
-- Name: ix_data_export_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_data_export_jobs_status ON public.data_export_jobs USING btree (status);


--
-- Name: ix_data_export_jobs_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_data_export_jobs_user_id ON public.data_export_jobs USING btree (user_id);


--
-- Name: ix_device_tokens_user_revoked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_device_tokens_user_revoked ON public.device_tokens USING btree (user_id, revoked_at);


--
-- Name: ix_eeg_feature_window_batch_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_eeg_feature_window_batch_key ON public.eeg_feature_windows USING btree (session_id, participant_id, window_index);


--
-- Name: ix_eeg_feature_window_participant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_eeg_feature_window_participant_created ON public.eeg_feature_windows USING btree (session_id, participant_id, created_at);


--
-- Name: ix_eeg_feature_windows_participant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_eeg_feature_windows_participant_id ON public.eeg_feature_windows USING btree (participant_id);


--
-- Name: ix_eeg_feature_windows_play_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_eeg_feature_windows_play_group_id ON public.eeg_feature_windows USING btree (play_group_id);


--
-- Name: ix_eeg_feature_windows_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_eeg_feature_windows_session_id ON public.eeg_feature_windows USING btree (session_id);


--
-- Name: ix_eeg_raw_chunk_batch_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_eeg_raw_chunk_batch_key ON public.eeg_raw_chunks USING btree (session_id, participant_id, chunk_index);


--
-- Name: ix_eeg_raw_chunks_participant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_eeg_raw_chunks_participant_id ON public.eeg_raw_chunks USING btree (participant_id);


--
-- Name: ix_eeg_raw_chunks_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_eeg_raw_chunks_session_id ON public.eeg_raw_chunks USING btree (session_id);


--
-- Name: ix_eeg_records_participant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_eeg_records_participant_id ON public.eeg_records USING btree (participant_id);


--
-- Name: ix_eeg_records_play_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_eeg_records_play_group_id ON public.eeg_records USING btree (play_group_id);


--
-- Name: ix_notification_outbox_status_channel_available; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_notification_outbox_status_channel_available ON public.notification_outbox USING btree (status, channel, available_at);


--
-- Name: ix_notifications_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_notifications_user_id ON public.notifications USING btree (user_id);


--
-- Name: ix_org_documents_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_org_documents_org_id ON public.org_documents USING btree (org_id);


--
-- Name: ix_org_documents_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_org_documents_status ON public.org_documents USING btree (status);


--
-- Name: ix_org_join_requests_org_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_org_join_requests_org_created ON public.org_join_requests USING btree (org_id, created_at);


--
-- Name: ix_org_join_requests_user_org_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_org_join_requests_user_org_status ON public.org_join_requests USING btree (user_id, org_id, status);


--
-- Name: ix_organizations_org_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_organizations_org_code ON public.organizations USING btree (org_code);


--
-- Name: ix_original_deletion_audits_actor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_original_deletion_audits_actor_id ON public.original_deletion_audits USING btree (actor_id);


--
-- Name: ix_original_deletion_audits_target_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_original_deletion_audits_target_id ON public.original_deletion_audits USING btree (target_id);


--
-- Name: ix_password_history_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_password_history_user_id ON public.password_history USING btree (user_id);


--
-- Name: ix_pipeline_outbox_status_available; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_pipeline_outbox_status_available ON public.pipeline_outbox USING btree (status, available_at);


--
-- Name: ix_refresh_tokens_jti; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_refresh_tokens_jti ON public.refresh_tokens USING btree (jti);


--
-- Name: ix_refresh_tokens_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_refresh_tokens_user_id ON public.refresh_tokens USING btree (user_id);


--
-- Name: ix_report_choice_events_participant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_report_choice_events_participant_id ON public.report_choice_events USING btree (participant_id);


--
-- Name: ix_report_choice_events_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_report_choice_events_session_id ON public.report_choice_events USING btree (session_id);


--
-- Name: ix_reports_participant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_reports_participant_id ON public.reports USING btree (participant_id);


--
-- Name: ix_reports_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_reports_user_id ON public.reports USING btree (user_id);


--
-- Name: ix_research_consent_events_participant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_research_consent_events_participant_id ON public.research_consent_events USING btree (participant_id);


--
-- Name: ix_research_consent_events_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_research_consent_events_session_id ON public.research_consent_events USING btree (session_id);


--
-- Name: ix_research_consents_research_subject_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_research_consents_research_subject_id ON public.research_consents USING btree (research_subject_id);


--
-- Name: ix_research_consents_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_research_consents_session_id ON public.research_consents USING btree (session_id);


--
-- Name: ix_research_export_batches_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_research_export_batches_session_id ON public.research_export_batches USING btree (session_id);


--
-- Name: ix_research_export_items_batch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_research_export_items_batch_id ON public.research_export_items USING btree (batch_id);


--
-- Name: ix_research_export_items_consent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_research_export_items_consent_id ON public.research_export_items USING btree (consent_id);


--
-- Name: ix_research_export_items_research_subject_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_research_export_items_research_subject_id ON public.research_export_items USING btree (research_subject_id);


--
-- Name: ix_research_withdrawal_requests_requested_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_research_withdrawal_requests_requested_by ON public.research_withdrawal_requests USING btree (requested_by);


--
-- Name: ix_research_withdrawal_requests_research_subject_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_research_withdrawal_requests_research_subject_id ON public.research_withdrawal_requests USING btree (research_subject_id);


--
-- Name: ix_session_email_invites_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_session_email_invites_session_id ON public.session_email_invites USING btree (session_id);


--
-- Name: ix_session_participants_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_session_participants_session_id ON public.session_participants USING btree (session_id);


--
-- Name: ix_session_participants_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_session_participants_user_id ON public.session_participants USING btree (user_id);


--
-- Name: ix_session_reminder_logs_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_session_reminder_logs_session_id ON public.session_reminder_logs USING btree (session_id);


--
-- Name: ix_session_reminder_logs_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_session_reminder_logs_user_id ON public.session_reminder_logs USING btree (user_id);


--
-- Name: ix_sessions_access_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sessions_access_code ON public.sessions USING btree (access_code);


--
-- Name: ix_sessions_host_is_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sessions_host_is_template ON public.sessions USING btree (host_id, is_template);


--
-- Name: ix_sessions_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sessions_organization_id ON public.sessions USING btree (organization_id);


--
-- Name: ix_sessions_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sessions_run_id ON public.sessions USING btree (run_id);


--
-- Name: ix_signup_applications_application_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_signup_applications_application_type ON public.signup_applications USING btree (application_type);


--
-- Name: ix_signup_applications_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_signup_applications_email ON public.signup_applications USING btree (email);


--
-- Name: ix_signup_applications_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_signup_applications_status ON public.signup_applications USING btree (status);


--
-- Name: ix_user_org_memberships_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_user_org_memberships_org_id ON public.user_org_memberships USING btree (org_id);


--
-- Name: ix_user_org_memberships_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_user_org_memberships_user_id ON public.user_org_memberships USING btree (user_id);


--
-- Name: ix_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_users_email ON public.users USING btree (email);


--
-- Name: uq_eeg_feature_window_null_pg; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_eeg_feature_window_null_pg ON public.eeg_feature_windows USING btree (session_id, participant_id, window_index) WHERE (play_group_id IS NULL);


--
-- Name: uq_membership_primary_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_membership_primary_active ON public.user_org_memberships USING btree (user_id) WHERE (is_primary AND ((status)::text = 'active'::text));


--
-- Name: uq_membership_user_org_alive; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_membership_user_org_alive ON public.user_org_memberships USING btree (user_id, org_id) WHERE ((status)::text <> 'left'::text);


--
-- Name: uq_normalization_baselines_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_normalization_baselines_active ON public.normalization_baselines USING btree (is_active) WHERE (is_active = true);


--
-- Name: uq_normalization_models_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_normalization_models_active ON public.normalization_models USING btree (is_active) WHERE (is_active = true);


--
-- Name: uq_org_join_request_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_org_join_request_pending ON public.org_join_requests USING btree (user_id, org_id) WHERE ((status)::text = 'pending'::text);


--
-- Name: uq_report_session_participant_type; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_report_session_participant_type ON public.reports USING btree (session_id, participant_id, type) WHERE (participant_id IS NOT NULL);


--
-- Name: uq_report_session_type; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_report_session_type ON public.reports USING btree (session_id, type) WHERE (participant_id IS NULL);


--
-- Name: uq_sessions_active_access_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_sessions_active_access_code ON public.sessions USING btree (access_code) WHERE ((access_code IS NOT NULL) AND (is_template = false) AND (hidden_at IS NULL) AND ((status)::text <> ALL ((ARRAY['completed'::character varying, 'cancelled'::character varying])::text[])));


--
-- Name: agent_briefing_logs agent_briefing_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_briefing_logs
    ADD CONSTRAINT agent_briefing_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: agent_checkin_enablements agent_checkin_enablements_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_checkin_enablements
    ADD CONSTRAINT agent_checkin_enablements_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.users(id);


--
-- Name: agent_checkin_enablements agent_checkin_enablements_counselor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_checkin_enablements
    ADD CONSTRAINT agent_checkin_enablements_counselor_id_fkey FOREIGN KEY (counselor_id) REFERENCES public.users(id);


--
-- Name: agent_checkin_prefs agent_checkin_prefs_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_checkin_prefs
    ADD CONSTRAINT agent_checkin_prefs_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.users(id);


--
-- Name: agent_checkins agent_checkins_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_checkins
    ADD CONSTRAINT agent_checkins_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.users(id);


--
-- Name: agent_checkins agent_checkins_counselor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_checkins
    ADD CONSTRAINT agent_checkins_counselor_id_fkey FOREIGN KEY (counselor_id) REFERENCES public.users(id);


--
-- Name: agent_conversations agent_conversations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_conversations
    ADD CONSTRAINT agent_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: agent_counselor_settings agent_counselor_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_counselor_settings
    ADD CONSTRAINT agent_counselor_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: agent_delivery_logs agent_delivery_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_delivery_logs
    ADD CONSTRAINT agent_delivery_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: agent_memory_items agent_memory_items_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_memory_items
    ADD CONSTRAINT agent_memory_items_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.users(id);


--
-- Name: agent_messages agent_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.agent_conversations(id) ON DELETE CASCADE;


--
-- Name: agent_profile_items agent_profile_items_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_profile_items
    ADD CONSTRAINT agent_profile_items_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.users(id);


--
-- Name: agent_profile_items agent_profile_items_counselor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_profile_items
    ADD CONSTRAINT agent_profile_items_counselor_id_fkey FOREIGN KEY (counselor_id) REFERENCES public.users(id);


--
-- Name: agent_relay_events agent_relay_events_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_relay_events
    ADD CONSTRAINT agent_relay_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: agent_relay_events agent_relay_events_source_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_relay_events
    ADD CONSTRAINT agent_relay_events_source_user_id_fkey FOREIGN KEY (source_user_id) REFERENCES public.users(id);


--
-- Name: agent_relay_events agent_relay_events_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_relay_events
    ADD CONSTRAINT agent_relay_events_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id);


--
-- Name: agent_risk_signals agent_risk_signals_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_risk_signals
    ADD CONSTRAINT agent_risk_signals_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.users(id);


--
-- Name: agent_risk_signals agent_risk_signals_counselor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_risk_signals
    ADD CONSTRAINT agent_risk_signals_counselor_id_fkey FOREIGN KEY (counselor_id) REFERENCES public.users(id);


--
-- Name: agent_risk_signals agent_risk_signals_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_risk_signals
    ADD CONSTRAINT agent_risk_signals_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.agent_messages(id) ON DELETE SET NULL;


--
-- Name: audio_chunks audio_chunks_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_chunks
    ADD CONSTRAINT audio_chunks_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: careers careers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.careers
    ADD CONSTRAINT careers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chat_message_reads chat_message_reads_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_reads
    ADD CONSTRAINT chat_message_reads_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.chat_messages(id) ON DELETE CASCADE;


--
-- Name: chat_message_reads chat_message_reads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_reads
    ADD CONSTRAINT chat_message_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: chat_messages chat_messages_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id);


--
-- Name: chat_room_participants chat_room_participants_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_room_participants
    ADD CONSTRAINT chat_room_participants_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;


--
-- Name: chat_room_participants chat_room_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_room_participants
    ADD CONSTRAINT chat_room_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chat_rooms chat_rooms_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT chat_rooms_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: client_counselor_links client_counselor_links_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_counselor_links
    ADD CONSTRAINT client_counselor_links_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.users(id);


--
-- Name: client_counselor_links client_counselor_links_counselor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_counselor_links
    ADD CONSTRAINT client_counselor_links_counselor_id_fkey FOREIGN KEY (counselor_id) REFERENCES public.users(id);


--
-- Name: client_invites client_invites_counselor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_invites
    ADD CONSTRAINT client_invites_counselor_id_fkey FOREIGN KEY (counselor_id) REFERENCES public.users(id);


--
-- Name: client_profiles client_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_profiles
    ADD CONSTRAINT client_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: consents consents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consents
    ADD CONSTRAINT consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: counselor_profiles counselor_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counselor_profiles
    ADD CONSTRAINT counselor_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: credentials credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credentials
    ADD CONSTRAINT credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: data_export_jobs data_export_jobs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_export_jobs
    ADD CONSTRAINT data_export_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: device_tokens device_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: eeg_feature_windows eeg_feature_windows_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eeg_feature_windows
    ADD CONSTRAINT eeg_feature_windows_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: eeg_feature_windows eeg_feature_windows_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eeg_feature_windows
    ADD CONSTRAINT eeg_feature_windows_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: eeg_raw_chunks eeg_raw_chunks_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eeg_raw_chunks
    ADD CONSTRAINT eeg_raw_chunks_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.session_participants(id) ON DELETE CASCADE;


--
-- Name: eeg_raw_chunks eeg_raw_chunks_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eeg_raw_chunks
    ADD CONSTRAINT eeg_raw_chunks_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: eeg_raw_chunks eeg_raw_chunks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eeg_raw_chunks
    ADD CONSTRAINT eeg_raw_chunks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: eeg_records eeg_records_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eeg_records
    ADD CONSTRAINT eeg_records_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id);


--
-- Name: eeg_records eeg_records_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eeg_records
    ADD CONSTRAINT eeg_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: chat_rooms fk_chat_rooms_host_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT fk_chat_rooms_host_id FOREIGN KEY (host_id) REFERENCES public.users(id);


--
-- Name: eeg_feature_windows fk_eeg_feature_windows_participant_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eeg_feature_windows
    ADD CONSTRAINT fk_eeg_feature_windows_participant_id FOREIGN KEY (participant_id) REFERENCES public.session_participants(id) ON DELETE CASCADE;


--
-- Name: eeg_records fk_eeg_records_participant_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eeg_records
    ADD CONSTRAINT fk_eeg_records_participant_id FOREIGN KEY (participant_id) REFERENCES public.session_participants(id) ON DELETE CASCADE;


--
-- Name: organizations fk_organizations_deactivated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT fk_organizations_deactivated_by FOREIGN KEY (deactivated_by) REFERENCES public.users(id);


--
-- Name: organizations fk_organizations_owner_user_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT fk_organizations_owner_user_id FOREIGN KEY (owner_user_id) REFERENCES public.users(id);


--
-- Name: organizations fk_organizations_primary_admin_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT fk_organizations_primary_admin_id FOREIGN KEY (primary_admin_id) REFERENCES public.users(id);


--
-- Name: reports fk_reports_participant_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT fk_reports_participant_id FOREIGN KEY (participant_id) REFERENCES public.session_participants(id) ON DELETE CASCADE;


--
-- Name: sessions fk_sessions_organization_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT fk_sessions_organization_id FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: notification_outbox notification_outbox_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_outbox
    ADD CONSTRAINT notification_outbox_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id);


--
-- Name: notification_outbox notification_outbox_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_outbox
    ADD CONSTRAINT notification_outbox_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: onboarding_progress onboarding_progress_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_progress
    ADD CONSTRAINT onboarding_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: org_documents org_documents_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_documents
    ADD CONSTRAINT org_documents_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: org_join_requests org_join_requests_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_join_requests
    ADD CONSTRAINT org_join_requests_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: org_join_requests org_join_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_join_requests
    ADD CONSTRAINT org_join_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: password_history password_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_history
    ADD CONSTRAINT password_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: pipeline_outbox pipeline_outbox_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_outbox
    ADD CONSTRAINT pipeline_outbox_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: qualifications qualifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qualifications
    ADD CONSTRAINT qualifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: reports reports_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id);


--
-- Name: reports reports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: session_email_invites session_email_invites_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_email_invites
    ADD CONSTRAINT session_email_invites_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: session_participants session_participants_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_participants
    ADD CONSTRAINT session_participants_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: session_participants session_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_participants
    ADD CONSTRAINT session_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: session_records session_records_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_records
    ADD CONSTRAINT session_records_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id);


--
-- Name: session_reminder_logs session_reminder_logs_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_reminder_logs
    ADD CONSTRAINT session_reminder_logs_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: session_reminder_logs session_reminder_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_reminder_logs
    ADD CONSTRAINT session_reminder_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: sessions sessions_host_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_host_id_fkey FOREIGN KEY (host_id) REFERENCES public.users(id);


--
-- Name: signup_applications signup_applications_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signup_applications
    ADD CONSTRAINT signup_applications_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: signup_applications signup_applications_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signup_applications
    ADD CONSTRAINT signup_applications_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: signup_applications signup_applications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signup_applications
    ADD CONSTRAINT signup_applications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: user_org_memberships user_org_memberships_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_org_memberships
    ADD CONSTRAINT user_org_memberships_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: user_org_memberships user_org_memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_org_memberships
    ADD CONSTRAINT user_org_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: users users_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: verification_audits verification_audits_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_audits
    ADD CONSTRAINT verification_audits_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.users(id);


--
-- Name: verification_audits verification_audits_credential_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_audits
    ADD CONSTRAINT verification_audits_credential_id_fkey FOREIGN KEY (credential_id) REFERENCES public.credentials(id);


--
-- Name: video_chunks video_chunks_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_chunks
    ADD CONSTRAINT video_chunks_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--



-- alembic_version (dev 의 현재 head 한 행)
INSERT INTO public.alembic_version (version_num) VALUES ('e036a0000051');
