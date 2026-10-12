"""SDD-073 가입 신청(signup_applications) + Organization.kind/owner_user_id."""
from alembic import op
import sqlalchemy as sa

revision = 'e036a0000008'
down_revision = 'e036a0000007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'signup_applications',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('application_type', sa.String(length=30), nullable=False),
        sa.Column('organization_name', sa.String(length=200), nullable=False),
        sa.Column('contact_name', sa.String(length=100), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('phone', sa.String(length=20), nullable=True),
        sa.Column('inquiry', sa.Text(), nullable=True),
        sa.Column('specialties', sa.String(length=300), nullable=True),
        sa.Column('status', sa.String(length=20), server_default='submitted', nullable=False),
        sa.Column('reviewed_by', sa.UUID(), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('review_note', sa.Text(), nullable=True),
        sa.Column('organization_id', sa.UUID(), nullable=True),
        sa.Column('user_id', sa.UUID(), nullable=True),
        sa.Column('notify_status', sa.String(length=20), server_default='pending', nullable=False),
        sa.Column('notified_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('consented_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint(
            "application_type IN ('organization','individual_counselor')",
            name='ck_signup_application_type',
        ),
        sa.CheckConstraint(
            "status IN ('submitted','reviewing','approved','rejected','withdrawn')",
            name='ck_signup_application_status',
        ),
        sa.ForeignKeyConstraint(['reviewed_by'], ['users.id']),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id']),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_signup_applications_application_type', 'signup_applications', ['application_type'])
    op.create_index('ix_signup_applications_status', 'signup_applications', ['status'])
    op.create_index('ix_signup_applications_email', 'signup_applications', ['email'])

    op.add_column(
        'organizations',
        sa.Column('kind', sa.String(length=20), server_default='institution', nullable=False),
    )
    op.add_column('organizations', sa.Column('owner_user_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'fk_organizations_owner_user_id', 'organizations', 'users', ['owner_user_id'], ['id']
    )


def downgrade() -> None:
    op.drop_constraint('fk_organizations_owner_user_id', 'organizations', type_='foreignkey')
    op.drop_column('organizations', 'owner_user_id')
    op.drop_column('organizations', 'kind')
    op.drop_index('ix_signup_applications_email', table_name='signup_applications')
    op.drop_index('ix_signup_applications_status', table_name='signup_applications')
    op.drop_index('ix_signup_applications_application_type', table_name='signup_applications')
    op.drop_table('signup_applications')
