"""SDD-243 데이터 센터 정책·서버 인가(B01).

모든 데이터센터 API(집계·목록·시계열·preview·작업·감사)가 같은 범위 규칙을 쓰도록 이 모듈이 단일 출처다.
- 플랫폼(platform_admin): 전역. 기관(org_admin): active 소속 기관 **하나**(요청마다 선택)의 귀속 확인된 명상 회차만.
- 프론트 capabilities·`User.org_id`·요청 본문의 org/세션 ID 는 인가 증명이 아니다. 매 호출 DB 에서 재검사한다.
- 범위 밖 대상은 존재 여부를 숨기려 항상 같은 404(`not_found`)로 응답한다. 역할·목적 위반만 403.
"""
import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Query, Session as DBSession

from app.config import settings
from app.models.class_program import Class
from app.models.organization import Organization
from app.models.session import Session, SessionParticipant
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership
from app.schemas.data_center import Capabilities, DataCenterContext, OrgRef, PolicyLimits
from app.schemas.data_export import DataCenterExportRequest
from app.services.client_overview_service import admin_org_ids

PLATFORM_TABS = ['overview', 'subjects', 'classes', 'consents', 'retention', 'standard', 'jobs', 'audits']
ORG_TABS = ['overview', 'subjects', 'classes', 'jobs', 'audits']


def deny(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={'code': code, 'message': message})


def not_found() -> HTTPException:
    # 범위 밖·없는 ID 를 구별하지 못하게 메시지까지 동일하게 유지한다.
    return deny(404, 'not_found', '대상을 찾을 수 없습니다')


@dataclass(frozen=True)
class DataCenterPolicy:
    """잠정 권장안(D1~D3)을 설정에서 읽은 불변 정책. 값이 바뀌면 policy_hash 가 달라진다."""
    policy_version: str
    default_identity: str
    identified_operations_only: bool
    require_reason: bool
    require_audit: bool
    reason_min_length: int
    reason_max_length: int
    reauth_ttl_seconds: int
    artifact_ttl_seconds: int
    url_ttl_seconds: int
    preview_ttl_seconds: int
    max_active_jobs_per_actor: int
    org_identified_operations_enabled: bool
    member_facilitator_max_sessions: int
    part_max_bytes: int

    @classmethod
    def from_settings(cls) -> 'DataCenterPolicy':
        s = settings
        return cls(
            policy_version=s.data_center_policy_version, default_identity=s.data_center_default_identity,
            identified_operations_only=s.data_center_identified_operations_only,
            require_reason=s.data_center_require_reason, require_audit=s.data_center_require_audit,
            reason_min_length=s.data_center_reason_min_length, reason_max_length=s.data_center_reason_max_length,
            reauth_ttl_seconds=s.data_center_reauth_ttl_seconds,
            artifact_ttl_seconds=s.data_center_artifact_ttl_seconds, url_ttl_seconds=s.data_center_url_ttl_seconds,
            preview_ttl_seconds=s.data_center_preview_ttl_seconds,
            max_active_jobs_per_actor=s.data_center_max_active_jobs_per_actor,
            org_identified_operations_enabled=s.data_center_org_identified_operations_enabled,
            member_facilitator_max_sessions=s.data_center_member_facilitator_max_sessions,
            part_max_bytes=s.data_center_part_max_bytes,
        )

    @property
    def policy_hash(self) -> str:
        return hashlib.sha256(json.dumps(asdict(self), sort_keys=True).encode()).hexdigest()

    def limits(self) -> PolicyLimits:
        return PolicyLimits(
            policy_version=self.policy_version, policy_hash=self.policy_hash,
            default_identity=self.default_identity, require_reason=self.require_reason,  # type: ignore[arg-type]
            reason_min_length=self.reason_min_length, reason_max_length=self.reason_max_length,
            reauth_ttl_seconds=self.reauth_ttl_seconds, artifact_ttl_seconds=self.artifact_ttl_seconds,
            url_ttl_seconds=self.url_ttl_seconds, preview_ttl_seconds=self.preview_ttl_seconds,
            max_active_jobs_per_actor=self.max_active_jobs_per_actor,
            member_facilitator_max_sessions=self.member_facilitator_max_sessions, part_max_bytes=self.part_max_bytes,
        )


@dataclass(frozen=True)
class ResolvedContext:
    """서버가 검증한 호출 문맥. 이후 모든 쿼리는 이 객체의 범위를 강제한다."""
    actor_id: UUID
    role: str
    scope_org_id: UUID | None
    scope_org_name: str | None
    allowed_orgs: tuple[tuple[UUID, str], ...]
    policy: DataCenterPolicy

    @property
    def is_platform(self) -> bool:
        return self.role == 'platform_admin'

    def capabilities(self, enabled: bool = True) -> Capabilities:
        if not enabled or (not self.is_platform and not self.allowed_orgs):
            return Capabilities(enabled=enabled, tabs=[], can_research=False, can_export_identified=False,
                                can_reveal_contact=False, can_view_platform_audits=False)
        if self.is_platform:
            return Capabilities(enabled=True, tabs=PLATFORM_TABS, can_research=True, can_export_identified=True,
                                can_reveal_contact=True, can_view_platform_audits=True)
        return Capabilities(enabled=True, tabs=ORG_TABS, can_research=False,
                            can_export_identified=self.policy.org_identified_operations_enabled,
                            can_reveal_contact=True, can_view_platform_audits=False)

    def to_schema(self, enabled: bool = True) -> DataCenterContext:
        orgs = [OrgRef(id=oid, name=name) for oid, name in self.allowed_orgs]
        current = OrgRef(id=self.scope_org_id, name=self.scope_org_name or '') if self.scope_org_id else None
        default = self.scope_org_id if self.scope_org_id else (orgs[0].id if len(orgs) == 1 else None)
        if current is None and default is not None:
            current = orgs[0]
        return DataCenterContext(role=self.role, actor_id=self.actor_id, current_org=current,  # type: ignore[arg-type]
                                 allowed_orgs=orgs, default_org_id=default, capabilities=self.capabilities(enabled),
                                 limits=self.policy.limits())


# ── 컨텍스트 ────────────────────────────────────────────────────────────

def _actor(db: DBSession, actor_id: UUID) -> User:
    user = db.query(User).populate_existing().filter(User.id == actor_id).first()
    if user is None or user.status != 'active':
        raise deny(403, 'actor_forbidden', '활성 계정만 접근할 수 있습니다')
    if user.role not in ('platform_admin', 'org_admin'):
        raise deny(403, 'role_forbidden', '데이터 센터 접근 권한이 없습니다')
    return user


def _org_names(db: DBSession, org_ids: list[UUID]) -> tuple[tuple[UUID, str], ...]:
    if not org_ids:
        return ()
    rows = db.query(Organization.id, Organization.name).filter(Organization.id.in_(org_ids)).order_by(
        Organization.name, Organization.id).all()
    return tuple((oid, name) for oid, name in rows)


def resolve_context(db: DBSession, actor_id: UUID, scope_org_id: UUID | None = None, *,
                    require_enabled: bool = True) -> ResolvedContext:
    """actor·역할·기관을 DB 로 재검증한다. 다기관 관리자는 기관을 하나 선택해야 한다."""
    policy = DataCenterPolicy.from_settings()
    user = _actor(db, actor_id)
    if require_enabled and not settings.data_center_enabled:
        raise deny(403, 'data_center_disabled', '데이터 센터가 비활성 상태입니다')
    if user.role == 'platform_admin':
        if scope_org_id is None:
            return ResolvedContext(user.id, user.role, None, None, (), policy)
        org = db.query(Organization).filter(Organization.id == scope_org_id, Organization.kind != 'individual',
                                            Organization.deactivated_at.is_(None)).first()
        if org is None:
            raise not_found()
        return ResolvedContext(user.id, user.role, org.id, org.name, (), policy)
    orgs = _org_names(db, admin_org_ids(db, user.id))
    allowed = {oid for oid, _ in orgs}
    if scope_org_id is not None:
        if scope_org_id not in allowed:
            raise not_found()
        chosen = scope_org_id
    elif len(orgs) == 1:
        chosen = orgs[0][0]
    elif not orgs:
        raise deny(403, 'no_admin_org', '관리 중인 기관이 없습니다')
    else:
        raise deny(400, 'org_selection_required', '기관을 선택해 주세요')
    name = next(n for oid, n in orgs if oid == chosen)
    return ResolvedContext(user.id, user.role, chosen, name, orgs, policy)


def list_contexts(db: DBSession, actor_id: UUID) -> DataCenterContext:
    """#31 — 비활성 상태에서도 응답해 FE 가 비활성 안내를 보여 줄 수 있게 한다(데이터는 없음)."""
    policy = DataCenterPolicy.from_settings()
    user = _actor(db, actor_id)
    enabled = bool(settings.data_center_enabled)
    if user.role == 'platform_admin':
        return ResolvedContext(user.id, user.role, None, None, (), policy).to_schema(enabled)
    orgs = _org_names(db, admin_org_ids(db, user.id))
    only = orgs[0] if len(orgs) == 1 else None
    return ResolvedContext(user.id, user.role, only[0] if only else None, only[1] if only else None,
                           orgs, policy).to_schema(enabled)


def require_platform(context: ResolvedContext) -> None:
    if not context.is_platform:
        raise deny(403, 'platform_only', '플랫폼 관리자 전용 기능입니다')


def normalize_reason(reason: str, policy: DataCenterPolicy) -> str:
    value = (reason or '').strip()
    if not policy.require_reason and not value:
        return ''
    if not policy.reason_min_length <= len(value) <= policy.reason_max_length:
        raise deny(422, 'reason_invalid', f'사유는 {policy.reason_min_length}~{policy.reason_max_length}자로 입력해 주세요')
    return value


def cache_key(context: ResolvedContext, target: str, range_key: str, schema: str) -> str:
    """캐시·재사용 키 = actor+role+scope_org+target+range+schema+policy_version."""
    raw = '|'.join([str(context.actor_id), context.role, str(context.scope_org_id), target, range_key, schema,
                    context.policy.policy_version])
    return hashlib.sha256(raw.encode()).hexdigest()


# ── 범위 쿼리 ───────────────────────────────────────────────────────────

def scoped_sessions(db: DBSession, context: ResolvedContext) -> Query:
    """호출자가 볼 수 있는 회차(Session) 쿼리. 모든 목록·집계·시계열·반출이 여기서 출발한다.

    기관: 회차와 (있다면) 클래스 모두 선택 기관에 귀속이 **확인**돼야 한다(상충·불명이면 제외).
    개인상담소·상담 세션·템플릿은 두 역할 모두 제외한다(상담 기록 본문 반출 금지 원칙의 범위 분리).
    """
    query = db.query(Session).filter(Session.is_template.is_(False), Session.type == 'meditation')
    if context.scope_org_id is None:
        return query
    org = context.scope_org_id
    return query.outerjoin(Class, Class.id == Session.class_id).filter(
        Session.organization_id == org,
        Session.organization_attribution_known.is_(True),
        or_(Session.class_id.is_(None),
            and_(Class.organization_id == org, Class.organization_attribution_known.is_(True),
                 Class.status != 'draft')),
    )


def scoped_participants(db: DBSession, context: ResolvedContext) -> Query:
    """범위 안 회차의 실제 참여자(퇴장·대기 취소·대기열 제외)."""
    scoped = scoped_sessions(db, context).with_entities(Session.id).statement
    return db.query(SessionParticipant).filter(
        SessionParticipant.session_id.in_(scoped),
        SessionParticipant.removed_at.is_(None),
        SessionParticipant.waitlist_cancelled_at.is_(None),
        SessionParticipant.is_waitlisted.is_(False),
    )


def session_in_scope(db: DBSession, context: ResolvedContext, session_id: UUID) -> Session:
    session = scoped_sessions(db, context).filter(Session.id == session_id).first()
    if session is None:
        raise not_found()
    return session


def class_in_scope(db: DBSession, context: ResolvedContext, class_id: UUID) -> Class:
    query = db.query(Class).filter(Class.id == class_id)
    if context.scope_org_id is not None:
        query = query.filter(Class.organization_id == context.scope_org_id,
                             Class.organization_attribution_known.is_(True), Class.status != 'draft')
    cls = query.first()
    if cls is None:
        raise not_found()
    return cls


def _active_facilitator_member(db: DBSession, org_id: UUID, user_id: UUID) -> bool:
    return db.query(UserOrgMembership.id).join(User, User.id == UserOrgMembership.user_id).filter(
        UserOrgMembership.org_id == org_id, UserOrgMembership.user_id == user_id,
        UserOrgMembership.role.in_(('counselor', 'org_admin')), UserOrgMembership.status == 'active',
        User.status == 'active').first() is not None


# ── 목적·식별·선택 인가 ─────────────────────────────────────────────────

def authorize_purpose(context: ResolvedContext, purpose: str, identity: str) -> None:
    policy = context.policy
    if purpose == 'research':
        if not context.is_platform:
            raise deny(403, 'research_forbidden', '연구 목적 반출은 플랫폼 관리자만 요청할 수 있습니다')
        if identity != 'pseudonymized':
            raise deny(403, 'identity_forbidden', '연구 목적은 가명 데이터만 허용됩니다')
        return
    if identity == 'identified':
        if policy.identified_operations_only and purpose != 'operations':
            raise deny(403, 'identity_forbidden', '식별 포함은 운영 목적에서만 허용됩니다')
        if not context.is_platform and not policy.org_identified_operations_enabled:
            raise deny(403, 'identity_forbidden', '기관의 식별 포함 운영 다운로드는 현재 허용되지 않습니다')


@dataclass(frozen=True)
class AuthorizedSelection:
    context: ResolvedContext
    scope: str
    target_id: UUID
    session_id: UUID | None
    participant_ids: tuple[UUID, ...] | None
    purpose: str
    identity: str


def authorize_selection(db: DBSession, context: ResolvedContext, request: DataCenterExportRequest, purpose: str,
                        identity: str) -> AuthorizedSelection:
    """대상 선택을 서버 범위로 검증한다. 범위 밖 ID 는 모두 404."""
    authorize_purpose(context, purpose, identity)
    scope, target = request.scope, request.target_id
    session_id = request.session_id
    participant_ids: tuple[UUID, ...] | None = tuple(request.participant_ids) if request.participant_ids else None
    if scope == 'participant':
        part = scoped_participants(db, context).filter(SessionParticipant.id == target).first()
        if part is None or (session_id is not None and part.session_id != session_id):
            raise not_found()
        session_id, participant_ids = part.session_id, (part.id,)
    elif scope == 'session':
        session_in_scope(db, context, target)
        session_id = target
        if participant_ids is not None:
            found = scoped_participants(db, context).filter(SessionParticipant.session_id == target,
                                                            SessionParticipant.id.in_(participant_ids)).count()
            if found != len(set(participant_ids)):
                raise not_found()
    elif scope == 'class':
        class_in_scope(db, context, target)
    elif scope == 'member':
        exists = scoped_participants(db, context).filter(SessionParticipant.user_id == target).first()
        if exists is None:
            raise not_found()
    elif scope == 'facilitator':
        user = db.get(User, target)
        if user is None:
            raise not_found()
        if context.scope_org_id is not None and not _active_facilitator_member(db, context.scope_org_id, target):
            raise not_found()
    return AuthorizedSelection(context, scope, target, session_id, participant_ids, purpose, identity)


def selection_sessions(db: DBSession, selection: AuthorizedSelection) -> Query:
    """선택 대상 회차 쿼리(시작시각+ID 오름차순). 범위 필터는 항상 scoped_sessions 와 교집합."""
    query = scoped_sessions(db, selection.context)
    if selection.scope in ('participant', 'session'):
        query = query.filter(Session.id == selection.session_id)
    elif selection.scope == 'class':
        query = query.filter(Session.class_id == selection.target_id)
    elif selection.scope == 'member':
        mine = db.query(SessionParticipant.session_id).filter(
            SessionParticipant.user_id == selection.target_id, SessionParticipant.removed_at.is_(None),
            SessionParticipant.waitlist_cancelled_at.is_(None), SessionParticipant.is_waitlisted.is_(False))
        query = query.filter(Session.id.in_(mine.statement))
    elif selection.scope == 'facilitator':
        query = query.filter(Session.host_id == selection.target_id)
    return query.order_by(func.coalesce(Session.started_at, Session.scheduled_at), Session.id)


def aware(value):
    """SQLite 가 돌려주는 tz 없는 시각을 UTC 로 간주한다."""
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value
