"""SDD-217 멤버십·개인 보강·guest·동의·현재 참여 가산 스키마.

기존 제약과 원본 데이터를 보존한다. 감사 이력의 자동 역삭제는 제공하지 않는다.
"""
from alembic import op

revision = "e036a0000057"
down_revision = "e036a0000056"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""SET LOCAL lock_timeout = '5s'""")
    op.execute("""ALTER TABLE class_members
        ADD COLUMN canonical_member_id uuid,
        ADD COLUMN research_consented boolean NOT NULL DEFAULT false,
        ADD COLUMN research_notice_version varchar(20),
        ADD COLUMN research_selected_at timestamptz,
        ADD COLUMN research_origin_id uuid,
        ADD COLUMN reminder_opt_in boolean NOT NULL DEFAULT false,
        ADD CONSTRAINT uq_class_members_class_id_kind UNIQUE (class_id, id, kind),
        ADD CONSTRAINT fk_class_members_canonical_guest FOREIGN KEY (class_id, canonical_member_id, kind)
            REFERENCES class_members(class_id, id, kind) ON DELETE RESTRICT,
        ADD CONSTRAINT ck_class_members_canonical_guest CHECK
            (canonical_member_id IS NULL OR (canonical_member_id <> id AND kind = 'guest'))""")
    op.execute("""CREATE INDEX ix_class_members_canonical_member_id ON class_members(canonical_member_id)""")
    op.execute("""ALTER TABLE sessions ADD COLUMN participation_version bigint NOT NULL DEFAULT 0""")
    op.execute("""ALTER TABLE session_participants
        ADD COLUMN checkin_state varchar(20),
        ADD COLUMN checkin_at timestamptz,
        ADD COLUMN presence_seen_at timestamptz,
        ADD COLUMN report_consent_override boolean NOT NULL DEFAULT false,
        ADD COLUMN research_consent_override boolean NOT NULL DEFAULT false,
        ADD COLUMN research_origin_id uuid,
        ADD COLUMN superseded_by_participant_id uuid,
        ADD CONSTRAINT uq_session_participants_session_id UNIQUE (session_id, id),
        ADD CONSTRAINT fk_session_participants_superseded FOREIGN KEY (session_id, superseded_by_participant_id)
            REFERENCES session_participants(session_id, id) ON DELETE RESTRICT,
        ADD CONSTRAINT ck_session_participants_superseded_not_self CHECK
            (superseded_by_participant_id IS NULL OR superseded_by_participant_id <> id),
        ADD CONSTRAINT ck_session_participants_checkin_state CHECK
            (checkin_state IS NULL OR checkin_state IN ('completed', 'not_completed', 'unknown'))""")
    op.execute("""CREATE INDEX ix_session_participants_superseded_by_participant_id ON session_participants(superseded_by_participant_id)""")
    # 056 이전에는 회차별 선택과 기본값 사본을 구별하는 표시가 없었다.
    # ResearchConsent·선택 이력·거절·철회 및 증빙 없는 행까지 원값을 보수적으로 보존한다.
    # 신규 행의 DEFAULT false는 유지하며 가입 연구 동의/원선택 ID를 추정하지 않는다.
    op.execute("""UPDATE session_participants
        SET report_consent_override = true, research_consent_override = true""")
    op.execute("""ALTER TABLE research_consents ADD COLUMN origin_id uuid""")
    op.execute("""UPDATE session_participants AS p SET checkin_state = 'completed'
        WHERE EXISTS (SELECT 1 FROM session_records AS r WHERE r.session_id = p.session_id
            AND jsonb_typeof(r.subjective_state -> 'participants' -> p.id::text -> 'before') = 'object')""")
    op.execute("""CREATE TABLE class_attendance_events (
        id UUID NOT NULL,
        class_id UUID NOT NULL,
        session_id UUID NOT NULL,
        participant_id UUID NOT NULL,
        member_id UUID NOT NULL,
        old_status VARCHAR(20),
        new_status VARCHAR(20) NOT NULL,
        actor_kind VARCHAR(20) NOT NULL,
        actor_user_id UUID,
        reason TEXT,
        operation_key VARCHAR(100) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
        PRIMARY KEY (id),
        CONSTRAINT ck_class_attendance_events_old CHECK (old_status IS NULL OR old_status IN ('expected','attended','absent','excused','withdrawn')),
        CONSTRAINT ck_class_attendance_events_new CHECK (new_status IN ('expected','attended','absent','excused','withdrawn'))
)""")
    op.execute("""CREATE INDEX ix_class_attendance_events_class_id ON class_attendance_events (class_id)""")
    op.execute("""CREATE INDEX ix_class_attendance_events_member_id ON class_attendance_events (member_id)""")
    op.execute("""CREATE INDEX ix_class_attendance_events_participant_id ON class_attendance_events (participant_id)""")
    op.execute("""CREATE INDEX ix_class_attendance_events_session_id ON class_attendance_events (session_id)""")
    op.execute("""CREATE TABLE class_makeup_assignments (
        id UUID NOT NULL,
        class_id UUID NOT NULL,
        member_id UUID NOT NULL,
        source_participant_id UUID NOT NULL,
        source_session_id UUID NOT NULL,
        target_participant_id UUID NOT NULL,
        target_session_id UUID NOT NULL,
        status VARCHAR(20) DEFAULT 'reserved' NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
        cancelled_at TIMESTAMP WITH TIME ZONE,
        completed_at TIMESTAMP WITH TIME ZONE,
        PRIMARY KEY (id),
        CONSTRAINT ck_class_makeup_assignments_status CHECK (status IN ('reserved','cancelled','completed')),
        CONSTRAINT ck_class_makeup_assignments_distinct CHECK (source_session_id <> target_session_id AND source_participant_id <> target_participant_id),
        CONSTRAINT fk_class_makeup_source_pair FOREIGN KEY(source_session_id, source_participant_id) REFERENCES session_participants (session_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_class_makeup_target_pair FOREIGN KEY(target_session_id, target_participant_id) REFERENCES session_participants (session_id, id) ON DELETE RESTRICT,
        FOREIGN KEY(class_id) REFERENCES classes (id) ON DELETE RESTRICT,
        FOREIGN KEY(member_id) REFERENCES class_members (id) ON DELETE RESTRICT,
        FOREIGN KEY(source_session_id) REFERENCES sessions (id) ON DELETE RESTRICT,
        FOREIGN KEY(target_session_id) REFERENCES sessions (id) ON DELETE RESTRICT
)""")
    op.execute("""CREATE INDEX ix_class_makeup_assignments_class_id ON class_makeup_assignments (class_id)""")
    op.execute("""CREATE INDEX ix_class_makeup_assignments_member_id ON class_makeup_assignments (member_id)""")
    op.execute("""CREATE INDEX ix_class_makeup_assignments_target_session_id ON class_makeup_assignments (target_session_id)""")
    op.execute("""CREATE UNIQUE INDEX uq_class_makeup_assignments_active_source ON class_makeup_assignments (source_participant_id) WHERE status IN ('reserved','completed')""")
    op.execute("""CREATE TABLE class_guest_credentials (
        id UUID NOT NULL,
        class_id UUID NOT NULL,
        member_id UUID NOT NULL,
        scope VARCHAR(10) NOT NULL,
        entry_ver INTEGER DEFAULT '0' NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        last_used_at TIMESTAMP WITH TIME ZONE,
        revoked_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
        PRIMARY KEY (id),
        CONSTRAINT ck_class_guest_credentials_scope CHECK (scope IN ('activity','read')),
        CONSTRAINT ck_class_guest_credentials_entry_ver CHECK (entry_ver >= 0),
        FOREIGN KEY(class_id) REFERENCES classes (id) ON DELETE RESTRICT,
        FOREIGN KEY(member_id) REFERENCES class_members (id) ON DELETE RESTRICT
)""")
    op.execute("""CREATE INDEX ix_class_guest_credentials_class_id ON class_guest_credentials (class_id)""")
    op.execute("""CREATE INDEX ix_class_guest_credentials_expires_at ON class_guest_credentials (expires_at)""")
    op.execute("""CREATE INDEX ix_class_guest_credentials_member_id ON class_guest_credentials (member_id)""")
    op.execute("""CREATE TABLE class_guest_recoveries (
        id UUID NOT NULL,
        class_id UUID NOT NULL,
        member_id UUID NOT NULL,
        token_hash VARCHAR(64) NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        consumed_at TIMESTAMP WITH TIME ZONE,
        issued_by UUID NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
        PRIMARY KEY (id),
        FOREIGN KEY(class_id) REFERENCES classes (id) ON DELETE RESTRICT,
        FOREIGN KEY(member_id) REFERENCES class_members (id) ON DELETE RESTRICT,
        UNIQUE (token_hash),
        FOREIGN KEY(issued_by) REFERENCES users (id) ON DELETE RESTRICT
)""")
    op.execute("""CREATE INDEX ix_class_guest_recoveries_class_id ON class_guest_recoveries (class_id)""")
    op.execute("""CREATE INDEX ix_class_guest_recoveries_expires_at ON class_guest_recoveries (expires_at)""")
    op.execute("""CREATE INDEX ix_class_guest_recoveries_member_id ON class_guest_recoveries (member_id)""")
    op.execute("""CREATE TABLE class_guest_merges (
        id UUID NOT NULL,
        class_id UUID NOT NULL,
        source_member_id UUID NOT NULL,
        target_member_id UUID NOT NULL,
        actor_user_id UUID NOT NULL,
        reason TEXT NOT NULL,
        preview_fingerprint VARCHAR(64) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
        PRIMARY KEY (id),
        CONSTRAINT ck_class_guest_merges_distinct CHECK (source_member_id <> target_member_id),
        UNIQUE (source_member_id)
)""")
    op.execute("""CREATE INDEX ix_class_guest_merges_class_id ON class_guest_merges (class_id)""")
    op.execute("""CREATE INDEX ix_class_guest_merges_target_member_id ON class_guest_merges (target_member_id)""")
    op.execute("""CREATE TABLE class_member_operations (
        id UUID NOT NULL,
        member_id UUID NOT NULL,
        operation_key VARCHAR(100) NOT NULL,
        request_hash VARCHAR(64) NOT NULL,
        result JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
        PRIMARY KEY (id),
        CONSTRAINT uq_class_member_operations_member_key UNIQUE (member_id, operation_key),
        FOREIGN KEY(member_id) REFERENCES class_members (id) ON DELETE RESTRICT
)""")
    op.execute("""CREATE TABLE class_guest_join_operations (
        id UUID NOT NULL,
        class_id UUID NOT NULL,
        operation_key VARCHAR(100) NOT NULL,
        request_hash VARCHAR(64) NOT NULL,
        member_id UUID NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
        PRIMARY KEY (id),
        CONSTRAINT uq_class_guest_join_operations_class_key UNIQUE (class_id, operation_key),
        FOREIGN KEY(class_id) REFERENCES classes (id) ON DELETE RESTRICT,
        FOREIGN KEY(member_id) REFERENCES class_members (id) ON DELETE RESTRICT
)""")
    op.execute("""CREATE TABLE class_member_consent_events (
        id UUID NOT NULL,
        class_id UUID NOT NULL,
        member_id UUID NOT NULL,
        choice VARCHAR(10) NOT NULL,
        value BOOLEAN NOT NULL,
        notice_version VARCHAR(20),
        selected_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
        origin_id UUID NOT NULL,
        actor_user_id UUID,
        operation_key VARCHAR(100) NOT NULL,
        PRIMARY KEY (id),
        CONSTRAINT ck_class_member_consent_events_choice CHECK (choice IN ('report','research','reminder'))
)""")
    op.execute("""CREATE INDEX ix_class_member_consent_events_class_id ON class_member_consent_events (class_id)""")
    op.execute("""CREATE INDEX ix_class_member_consent_events_member_id ON class_member_consent_events (member_id)""")
    op.execute("""CREATE TABLE session_presence_leases (
        id VARCHAR(200) NOT NULL,
        session_id UUID NOT NULL,
        participant_id UUID NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
        PRIMARY KEY (id),
        CONSTRAINT uq_session_presence_leases_session_socket UNIQUE (session_id, id),
        CONSTRAINT fk_session_presence_lease_pair FOREIGN KEY(session_id, participant_id) REFERENCES session_participants (session_id, id) ON DELETE RESTRICT,
        FOREIGN KEY(session_id) REFERENCES sessions (id) ON DELETE RESTRICT
)""")
    op.execute("""CREATE INDEX ix_session_presence_leases_expires_at ON session_presence_leases (expires_at)""")
    op.execute("""CREATE INDEX ix_session_presence_leases_participant_expiry ON session_presence_leases (participant_id, expires_at)""")
    op.execute("""CREATE INDEX ix_session_presence_leases_session_id ON session_presence_leases (session_id)""")
    op.execute("""CREATE FUNCTION sdd217_forbid_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'class audit history is append-only' USING ERRCODE = '55000'; END;
    $$""")
    op.execute("""CREATE TRIGGER trg_class_attendance_events_append_only
        BEFORE UPDATE OR DELETE ON class_attendance_events
        FOR EACH ROW EXECUTE FUNCTION sdd217_forbid_audit_mutation()""")
    op.execute("""CREATE TRIGGER trg_class_guest_merges_append_only
        BEFORE UPDATE OR DELETE ON class_guest_merges
        FOR EACH ROW EXECUTE FUNCTION sdd217_forbid_audit_mutation()""")
    op.execute("""CREATE TRIGGER trg_class_member_consent_events_append_only
        BEFORE UPDATE OR DELETE ON class_member_consent_events
        FOR EACH ROW EXECUTE FUNCTION sdd217_forbid_audit_mutation()""")


def downgrade():
    raise RuntimeError(
        "SDD-217 멤버십·감사 이력은 자동 삭제하지 않습니다. 이전 앱과 기능 스위치로 복구하세요."
    )
