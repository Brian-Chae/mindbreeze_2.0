"""SDD-230 회원 개요 — 목록 보강·활동 타임라인·리포트/변화 집계 (1단계: 접속 제외).

지켜야 할 경계:
- 모집단은 내(상담사) active ClientCounselorLink 회원이다. 모든 조회가 이 연결로 먼저 제한된다.
- 예외(1-2단계): 기관관리자는 자기가 관리하는 기관의 회원(기관 귀속이 확정된 클래스 멤버·상담관계)도 본다.
  개인상담소·귀속 불명·타 기관 회원은 제외한다(spec §11).
- 활동·리포트는 내가 접근 가능한 세션(호스트/활성 강사/내 상담관계)에서 **해당 회원 참여자 행**만 읽는다.
  같은 세션의 다른 참여자 행·리포트는 조회하지 않는다.
- 예정 일정·리포트 생성/수정은 활동이 아니다. 미측정은 0으로 보간하지 않는다.
- 점수·종합점수·순위·회차 간 비교를 만들지 않는다. 변화는 회차 내부 전반→후반 서사만.
- 개인정보(연락처·생년월일)는 서버에서 마스킹하고, 원문은 reveal 호출에서만 돌려준다.
"""

import base64
import logging
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session as DBSession, aliased

from app.core.ai_features import is_ai_enabled
from app.models.agent import AgentCheckin
from app.models.class_program import Class, ClassInstructor, ClassMember
from app.models.client_counselor_link import ClientCounselorLink
from app.models.client_profile import ClientProfile
from app.models.counseling import CounselingRelationship
from app.models.organization import Organization
from app.models.user_org_membership import UserOrgMembership
from app.models.record import EEGRecord, Report
from app.models.session import Session, SessionParticipant
from app.models.user import User
from app.services import class_report_trend_service

logger = logging.getLogger(__name__)
audit_logger = logging.getLogger("audit.client_contact_reveal")

KST = timezone(timedelta(hours=9))
ACTIVITY_TYPES = ("session", "checkin", "measurement", "ai_checkin")
# 출석하지 않은 상태는 '실제 수행'이 아니다.
_NOT_ATTENDED = ("absent", "excused", "withdrawn", "expected")

REPORT_STATUS_LABELS = {
    "completed": "승인됨",
    "pending_review": "검토 중",
    "pending_analysis": "생성 중",
    "error": "생성 실패",
}
METRIC_LABELS = {"relaxation": "이완", "concentration": "집중", "stress": "긴장"}
DIRECTION_TEXT = {
    "eased": "편안한 쪽으로 이동",
    "tensed": "긴장 쪽으로 이동",
    "steady": "비슷하게 유지",
}


# ───────────────────────── 순수 함수 ─────────────────────────

def mask_phone(phone: str | None) -> str | None:
    """`010-****-1234` 형식 마스킹. 미입력은 None(화면에서 '미입력')."""
    if not phone:
        return None
    digits = "".join(ch for ch in phone if ch.isdigit())
    if not digits:
        return None
    if len(digits) <= 4:
        return "*" * len(digits)
    last4 = digits[-4:]
    head = digits[:3]
    if len(digits) == 11:
        return f"{head}-****-{last4}"
    if len(digits) == 10:
        return f"{head}-***-{last4}"
    return f"{'*' * (len(digits) - 4)}{last4}"


def kst_today(now: datetime | None = None) -> date:
    return (now or datetime.now(timezone.utc)).astimezone(KST).date()


def calc_age(birth: date | None, today: date | None = None) -> int | None:
    """KST 기준 만 나이. 미입력·미래 날짜는 None."""
    if birth is None:
        return None
    today = today or kst_today()
    if birth > today:
        return None
    return today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    dt = _aware(dt)
    return dt.isoformat() if dt else None


def encode_cursor(occurred_at: datetime, type_: str, source_id: str) -> str:
    raw = f"{_aware(occurred_at).isoformat()}|{type_}|{source_id}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def decode_cursor(cursor: str) -> tuple[datetime, str, str]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        at, type_, source_id = raw.split("|", 2)
        return datetime.fromisoformat(at), type_, source_id
    except Exception:
        raise HTTPException(status_code=422, detail="잘못된 cursor 입니다")


def _after_cursor(event: dict, cursor: tuple[datetime, str, str]) -> bool:
    """정렬 (occurred_at desc, type, id) 에서 cursor 보다 뒤인지."""
    c_at, c_type, c_id = cursor
    e_at = event["_at"]
    if e_at != c_at:
        return e_at < c_at
    return (event["type"], event["id"]) > (c_type, c_id)


def summarize_change(change: dict | None) -> dict:
    """compute_change 결과를 서사 + 지표별 변화량으로. 종합값·점수는 만들지 않는다."""
    if not isinstance(change, dict):
        return {"state": "no_data", "summary": "비교 자료 부족", "metrics": []}
    st = change.get("status")
    if st == "not_measured":
        return {"state": "not_measured", "summary": "밴드 미측정 회차 (측정 없음은 나쁜 상태가 아닙니다)", "metrics": []}
    if st != "computed":
        return {"state": "insufficient", "summary": "비교 자료 부족", "metrics": []}
    metrics = []
    parts = []
    for key in class_report_trend_service.TREND_METRICS:
        m = (change.get("metrics") or {}).get(key)
        if not isinstance(m, dict):
            continue
        direction = m.get("direction")
        delta = m.get("delta")
        metrics.append({
            "key": key,
            "label": METRIC_LABELS[key],
            "delta": delta,
            "direction": direction,
        })
        sign = "+" if isinstance(delta, (int, float)) and delta > 0 else ""
        parts.append(f"{METRIC_LABELS[key]} {DIRECTION_TEXT.get(direction, '')} · 전반 대비 {sign}{delta}")
    if not metrics:
        return {"state": "insufficient", "summary": "비교 자료 부족", "metrics": []}
    return {"state": "computed", "summary": " / ".join(parts), "metrics": metrics}


# ───────────────────────── 접근 범위 ─────────────────────────

def _uuid(v) -> UUID:
    return v if isinstance(v, UUID) else UUID(str(v))


def require_active_link(db: DBSession, counselor_id, client_id) -> ClientCounselorLink:
    """active 연결이 없으면 403 (타 상담사·종료 연결·존재하지 않는 회원 모두 동일 응답)."""
    try:
        cid, uid = _uuid(client_id), _uuid(counselor_id)
    except ValueError:
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다")
    link = (
        db.query(ClientCounselorLink)
        .filter(
            ClientCounselorLink.client_id == cid,
            ClientCounselorLink.counselor_id == uid,
            ClientCounselorLink.status == "active",
        )
        .first()
    )
    if link is None:
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다")
    return link


def admin_org_ids(db: DBSession, me) -> list[UUID]:
    """내가 관리하는 일반 기관(active org_admin 소속, 비활성·개인상담소 제외). User.org_id 는 쓰지 않는다."""
    me = _uuid(me)
    user = db.get(User, me)
    if user is None or user.role != "org_admin" or user.status != "active":
        return []
    rows = (
        db.query(UserOrgMembership.org_id)
        .join(Organization, Organization.id == UserOrgMembership.org_id)
        .filter(
            UserOrgMembership.user_id == me,
            UserOrgMembership.role == "org_admin",
            UserOrgMembership.status == "active",
            Organization.deactivated_at.is_(None),
            Organization.kind != "individual",
        )
        .all()
    )
    return [r for (r,) in rows]


def _admin_class_ids(db: DBSession, org_ids: list[UUID]) -> set[UUID]:
    if not org_ids:
        return set()
    rows = (
        db.query(Class.id)
        .filter(
            Class.organization_id.in_(org_ids),
            Class.organization_attribution_known.is_(True),
            Class.status.notin_(("draft", "archived")),
        )
        .all()
    )
    return {c for (c,) in rows}


def org_member_ids(db: DBSession, org_ids: list[UUID]) -> set[UUID]:
    """기관 회원 = 기관 클래스 active 멤버 ∪ 기관 귀속 active 상담관계의 회원(역할 client 만)."""
    if not org_ids:
        return set()
    class_ids = _admin_class_ids(db, org_ids)
    found: set[UUID] = set()
    if class_ids:
        found |= {
            u
            for (u,) in db.query(ClassMember.user_id)
            .filter(
                ClassMember.class_id.in_(class_ids),
                ClassMember.status == "active",
                ClassMember.kind == "member",
                ClassMember.user_id.isnot(None),
            )
            .all()
        }
    found |= {
        u
        for (u,) in db.query(CounselingRelationship.client_user_id)
        .filter(
            CounselingRelationship.organization_id.in_(org_ids),
            CounselingRelationship.organization_attribution_known.is_(True),
            CounselingRelationship.status == "active",
            CounselingRelationship.is_placeholder.is_(False),
            CounselingRelationship.client_user_id.isnot(None),
        )
        .all()
    }
    if not found:
        return found
    clients = {
        u
        for (u,) in db.query(User.id).filter(User.id.in_(found), User.role == "client").all()
    }
    return clients


def org_linked_client_ids(db: DBSession, org_ids: list[UUID]) -> set[UUID]:
    """관리 기관에 active 소속된 상담사와 active 연결(ClientCounselorLink)된 회원(역할 client 만).

    기관 클래스·기관 귀속 상담관계가 없어도 포함한다(SDD-230 1-3단계). 상담사의 개인상담소 회원이 섞여도 허용.
    소속 없음·left/invited·계정 비활성 상담사, 종료된 링크는 제외한다.
    """
    if not org_ids:
        return set()
    counselor = aliased(User)
    rows = (
        db.query(ClientCounselorLink.client_id)
        .join(UserOrgMembership, UserOrgMembership.user_id == ClientCounselorLink.counselor_id)
        .join(counselor, counselor.id == ClientCounselorLink.counselor_id)
        .join(User, User.id == ClientCounselorLink.client_id)
        .filter(
            ClientCounselorLink.status == "active",
            UserOrgMembership.org_id.in_(org_ids),
            UserOrgMembership.status == "active",
            counselor.status == "active",
            User.role == "client",
        )
        .distinct()
        .all()
    )
    return {c for (c,) in rows}


def org_scope_ids(db: DBSession, org_ids: list[UUID]) -> tuple[set[UUID], set[UUID]]:
    """(기관 회원, 상담사 연결로만 포함 가능한 회원 포함 전체). 전체 = 회원 ∪ 상담사 연결."""
    members = org_member_ids(db, org_ids)
    return members, members | org_linked_client_ids(db, org_ids)


def member_type_of(client_id, members: set[UUID]) -> str:
    """회원/비회원 판정 — 기관 클래스·기관 귀속 상담관계 근거가 있으면 member, 아니면 non_member."""
    return "member" if client_id in members else "non_member"


def profile_member_type(db: DBSession, viewer_id, client_id) -> str | None:
    """상세 헤더 배지용. 기관관리자만 값이 있고 상담사는 None."""
    orgs = admin_org_ids(db, viewer_id)
    if not orgs:
        return None
    return member_type_of(_uuid(client_id), org_member_ids(db, orgs))


def require_client_access(db: DBSession, viewer_id, client_id) -> ClientCounselorLink | None:
    """본인 active 연결이 있으면 그 링크, 없으면 기관관리자의 기관 회원일 때 None, 아니면 403."""
    try:
        return require_active_link(db, viewer_id, client_id)
    except HTTPException:
        orgs = admin_org_ids(db, viewer_id)
        if orgs and _uuid(client_id) in org_scope_ids(db, orgs)[1]:
            return None
        raise


def _my_class_ids(db: DBSession, me: UUID) -> set[UUID]:
    owned = {c for (c,) in db.query(Class.id).filter(Class.created_by == me).all()}
    taught = {
        c
        for (c,) in db.query(ClassInstructor.class_id)
        .filter(ClassInstructor.user_id == me, ClassInstructor.status == "active")
        .all()
    }
    return owned | taught


def _accessible_sessions(db: DBSession, me: UUID) -> dict[UUID, Session]:
    class_ids = _my_class_ids(db, me)
    rel_ids = [r for (r,) in db.query(CounselingRelationship.id).filter(CounselingRelationship.counselor_id == me).all()]
    conds = [Session.host_id == me]
    if class_ids:
        conds.append(Session.class_id.in_(class_ids))
    if rel_ids:
        conds.append(Session.counseling_relationship_id.in_(rel_ids))
    rows = db.query(Session).filter(Session.is_template.is_(False), or_(*conds)).all()
    return {s.id: s for s in rows}


def _admin_only_sessions(db: DBSession, me: UUID, base: dict[UUID, Session]) -> dict[UUID, Session]:
    """기관관리자 전용 추가 세션 — 관리 기관 귀속 클래스의 명상 세션(상담 세션 제외)."""
    class_ids = _admin_class_ids(db, admin_org_ids(db, me))
    if not class_ids:
        return {}
    rows = (
        db.query(Session)
        .filter(
            Session.is_template.is_(False),
            Session.type == "meditation",
            Session.class_id.in_(class_ids),
        )
        .all()
    )
    return {s.id: s for s in rows if s.id not in base}


def _participant_rows(db: DBSession, me: UUID, client_ids: list[UUID]):
    """(participant, session) — 내가 접근 가능한 세션 × 대상 회원 본인 행만.

    기관관리자는 관리 기관 명상 클래스 세션이 추가되며, 이 세션(admin_only)의 리포트는 회원용만 읽는다.
    """
    if not client_ids:
        return [], {}, set()
    sessions = _accessible_sessions(db, me)
    extra = _admin_only_sessions(db, me, sessions)
    if extra:
        sessions = {**sessions, **extra}
    if not sessions:
        return [], sessions, set()
    parts = (
        db.query(SessionParticipant)
        .filter(
            SessionParticipant.user_id.in_(client_ids),
            SessionParticipant.session_id.in_(list(sessions.keys())),
            SessionParticipant.removed_at.is_(None),
        )
        .all()
    )
    return parts, sessions, set(extra.keys())


# ───────────────────────── 활동 집계 ─────────────────────────

def _class_titles(db: DBSession, class_ids: set[UUID]) -> dict[UUID, str]:
    if not class_ids:
        return {}
    return {i: (t or "클래스") for i, t in db.query(Class.id, Class.title).filter(Class.id.in_(class_ids)).all()}


def collect_events(db: DBSession, me: UUID, client_ids: list[UUID], *, since: datetime | None = None) -> list[dict]:
    """대상 회원들의 실제 활동 이벤트. 이벤트 dict 의 client_id 로 회원을 구분한다."""
    events: list[dict] = []
    parts, sessions, _ = _participant_rows(db, me, client_ids)
    titles = _class_titles(db, {s.class_id for s in sessions.values() if s.class_id})

    def title_of(s: Session) -> tuple[str, str | None]:
        class_title = titles.get(s.class_id) if s.class_id else None
        return (s.title or class_title or "세션"), class_title

    part_by_id = {p.id: p for p in parts}
    for p in parts:
        s = sessions[p.session_id]
        title, class_title = title_of(s)
        if (
            s.started_at is not None
            and s.status != "cancelled"
            and p.attendance_status not in _NOT_ATTENDED
        ):
            at = _aware(p.entered_at) or _aware(s.started_at)
            events.append({
                "id": str(p.id), "type": "session", "_at": at, "client_id": p.user_id,
                "title": title, "class_title": class_title, "session_id": str(s.id), "note": None,
            })
        if p.checkin_state == "completed" and p.checkin_at is not None:
            events.append({
                "id": str(p.id), "type": "checkin", "_at": _aware(p.checkin_at), "client_id": p.user_id,
                "title": title, "class_title": class_title, "session_id": str(s.id), "note": "수업 전후 체크인",
            })

    if part_by_id:
        eeg_rows = (
            db.query(EEGRecord)
            .filter(EEGRecord.participant_id.in_(list(part_by_id.keys())))
            .all()
        )
        for r in eeg_rows:
            if not ((r.file_count or 0) > 0 or (r.duration_sec or 0) > 0):
                continue  # 유효 측정만. 빈 레코드는 활동 아님
            p = part_by_id[r.participant_id]
            s = sessions[p.session_id]
            title, class_title = title_of(s)
            events.append({
                "id": str(r.id), "type": "measurement", "_at": _aware(r.created_at), "client_id": p.user_id,
                "title": title, "class_title": class_title, "session_id": str(s.id), "note": "밴드 측정 기록",
            })

    # AI 비공개면 쿼리 자체를 하지 않는다(건수·최근 활동 포함 제외).
    if is_ai_enabled() and client_ids:
        rows = (
            db.query(AgentCheckin)
            .filter(
                AgentCheckin.counselor_id == me,
                AgentCheckin.client_id.in_(client_ids),
                AgentCheckin.closed_at.isnot(None),
            )
            .all()
        )
        for c in rows:
            events.append({
                "id": str(c.id), "type": "ai_checkin", "_at": _aware(c.closed_at), "client_id": c.client_id,
                "title": "AI 안부 체크인", "class_title": None, "session_id": None, "note": None,
            })

    events = [e for e in events if e["_at"] is not None]
    if since is not None:
        events = [e for e in events if e["_at"] >= since]
    return events


def _source_label(e: dict) -> str:
    return {"session": "수업·상담 참여", "checkin": "수업 체크인", "measurement": "밴드 측정", "ai_checkin": "AI 안부"}[e["type"]]


def last_activity_map(db: DBSession, me: UUID, client_ids: list[UUID]) -> dict[UUID, dict]:
    """회원별 최근 활동/최근 상담(세션) 시각."""
    out: dict[UUID, dict] = {}
    for e in collect_events(db, me, client_ids):
        cur = out.setdefault(e["client_id"], {"activity": None, "session": None})
        if cur["activity"] is None or e["_at"] > cur["activity"]["_at"]:
            cur["activity"] = e
        if e["type"] == "session" and (cur["session"] is None or e["_at"] > cur["session"]):
            cur["session"] = e["_at"]
    return out


def member_classes(db: DBSession, me: UUID, client_ids: list[UUID]) -> dict[UUID, list[dict]]:
    """회원 → 내가 접근 가능한 클래스(회원 연결만으로 모든 클래스를 노출하지 않는다)."""
    if not client_ids:
        return {}
    mine = _my_class_ids(db, me) | _admin_class_ids(db, admin_org_ids(db, me))
    if not mine:
        return {}
    rows = (
        db.query(ClassMember.user_id, Class.id, Class.title)
        .join(Class, Class.id == ClassMember.class_id)
        .filter(
            ClassMember.user_id.in_(client_ids),
            ClassMember.status == "active",
            ClassMember.class_id.in_(mine),
            Class.status != "archived",
        )
        .all()
    )
    out: dict[UUID, list[dict]] = {}
    for uid, cid, title in rows:
        out.setdefault(uid, []).append({"id": str(cid), "title": title or "클래스"})
    for v in out.values():
        v.sort(key=lambda c: c["title"])
    return out


# ───────────────────────── 목록 ─────────────────────────

def list_clients_overview(
    counselor_id: str,
    q: str | None,
    page: int,
    size: int,
    class_id: str | None,
    active_within_days: int | None,
    db: DBSession,
    counselor_filter_id: str | None = None,
    member_type: str | None = None,
) -> dict:
    me = _uuid(counselor_id)
    orgs = admin_org_ids(db, me)
    own_ids = db.query(ClientCounselorLink.client_id).filter(
        ClientCounselorLink.counselor_id == me, ClientCounselorLink.status == "active"
    )
    org_members, org_ids_set = org_scope_ids(db, orgs) if orgs else (set(), set())
    population = User.id.in_(own_ids)
    if org_ids_set:
        population = or_(population, User.id.in_(org_ids_set))
    query = (
        db.query(User, ClientProfile)
        .outerjoin(ClientProfile, ClientProfile.user_id == User.id)
        .filter(population)
    )
    if q:
        like = f"%{q}%"
        query = query.filter((User.name.ilike(like)) | (User.email.ilike(like)))
    rows = query.order_by(User.name, User.id).all()
    if orgs and member_type in ("member", "non_member"):
        rows = [(u, p) for u, p in rows if member_type_of(u.id, org_members) == member_type]
    ids = [u.id for u, _ in rows]

    # 관리자용 담당 상담사 — 관리 기관에 active 소속인 상담사와의 active 연결만(이름만 노출).
    counselors_by_client: dict[UUID, list[dict]] = {}
    counselor_options: dict[str, str] = {}
    if orgs and ids:
        link_rows = (
            db.query(ClientCounselorLink.client_id, User.id, User.name)
            .join(User, User.id == ClientCounselorLink.counselor_id)
            .join(UserOrgMembership, UserOrgMembership.user_id == User.id)
            .filter(
                ClientCounselorLink.client_id.in_(ids),
                ClientCounselorLink.status == "active",
                UserOrgMembership.org_id.in_(orgs),
                UserOrgMembership.status == "active",
                User.status == "active",
            )
            .distinct()
            .all()
        )
        for cid, uid, name in link_rows:
            counselors_by_client.setdefault(cid, []).append({"id": str(uid), "name": name})
            counselor_options[str(uid)] = name
        for v in counselors_by_client.values():
            v.sort(key=lambda c: c["name"] or "")
        if counselor_filter_id:
            rows = [
                (u, p) for u, p in rows
                if any(c["id"] == counselor_filter_id for c in counselors_by_client.get(u.id, []))
            ]
            ids = [u.id for u, _ in rows]

    classes = member_classes(db, me, ids)
    options: dict[str, str] = {}
    for lst in classes.values():
        for c in lst:
            options[c["id"]] = c["title"]

    if class_id:
        rows = [(u, p) for u, p in rows if any(c["id"] == class_id for c in classes.get(u.id, []))]

    acts = last_activity_map(db, me, [u.id for u, _ in rows])
    if active_within_days:
        since = datetime.now(timezone.utc) - timedelta(days=active_within_days)
        rows = [
            (u, p) for u, p in rows
            if acts.get(u.id, {}).get("activity") and acts[u.id]["activity"]["_at"] >= since
        ]

    total = len(rows)
    page_rows = rows[(page - 1) * size: page * size]
    today = kst_today()
    clients = []
    for user, profile in page_rows:
        a = acts.get(user.id, {})
        act = a.get("activity")
        clients.append({
            "id": str(user.id),
            "name": user.name,
            "email": user.email,
            "concerns": profile.concerns if profile else [],
            "gender": profile.gender if profile else None,
            "age": calc_age(profile.birth_date, today) if profile else None,
            "phone_masked": mask_phone(user.phone),
            "classes": classes.get(user.id, []),
            "counselors": counselors_by_client.get(user.id, []),
            "member_type": member_type_of(user.id, org_members) if orgs else None,
            "last_activity_at": _iso(act["_at"]) if act else None,
            "last_activity_source": _source_label(act) if act else None,
            "last_session_at": _iso(a.get("session")),
        })
    return {
        "clients": clients,
        "total": total,
        "class_options": sorted(
            ({"id": i, "title": t} for i, t in options.items()), key=lambda c: c["title"]
        ),
        "counselor_options": sorted(
            ({"id": i, "name": n} for i, n in counselor_options.items()), key=lambda c: c["name"] or ""
        ),
    }


# ───────────────────────── 상세 보조 ─────────────────────────

def reveal_contact(db: DBSession, counselor_id: str, client_id: str) -> dict:
    """연락처·생년월일 원문 열람. 호출마다 active 연결을 재검사하고 원문 없이 감사 로그를 남긴다."""
    require_client_access(db, counselor_id, client_id)
    user = db.get(User, _uuid(client_id))
    profile = db.query(ClientProfile).filter(ClientProfile.user_id == _uuid(client_id)).first()
    audit_logger.info(
        "reveal fields=phone,birth_date viewer=%s target=%s at=%s",
        counselor_id, client_id, datetime.now(timezone.utc).isoformat(),
    )
    return {
        "phone": user.phone if user else None,
        "birth_date": str(profile.birth_date) if profile and profile.birth_date else None,
    }


def get_activity(
    db: DBSession,
    counselor_id: str,
    client_id: str,
    *,
    days: int,
    types: list[str] | None,
    limit: int,
    cursor: str | None,
) -> dict:
    require_client_access(db, counselor_id, client_id)
    me, cid = _uuid(counselor_id), _uuid(client_id)
    since = datetime.now(timezone.utc) - timedelta(days=days)
    wanted = [t for t in (types or ACTIVITY_TYPES) if t in ACTIVITY_TYPES]
    events = [e for e in collect_events(db, me, [cid], since=since) if e["type"] in wanted]
    events.sort(key=lambda e: (-e["_at"].timestamp(), e["type"], e["id"]))
    if cursor:
        cur = decode_cursor(cursor)
        events = [e for e in events if _after_cursor(e, cur)]
    page = events[:limit]
    next_cursor = (
        encode_cursor(page[-1]["_at"], page[-1]["type"], page[-1]["id"]) if len(events) > limit else None
    )
    items = [
        {
            "id": e["id"], "type": e["type"], "occurred_at": _iso(e["_at"]),
            "title": e["title"], "class_title": e["class_title"],
            "session_id": e["session_id"], "note": e["note"],
        }
        for e in page
    ]
    return {"items": items, "next_cursor": next_cursor, "ai_included": is_ai_enabled()}


def get_reports(db: DBSession, counselor_id: str, client_id: str) -> dict:
    require_client_access(db, counselor_id, client_id)
    me, cid = _uuid(counselor_id), _uuid(client_id)
    parts, sessions, admin_only = _participant_rows(db, me, [cid])
    part_by_id = {p.id: p for p in parts}
    if not part_by_id:
        return {"reports": [], "changes": []}
    rows = (
        db.query(Report)
        .filter(Report.participant_id.in_(list(part_by_id.keys())))
        .order_by(Report.created_at.desc())
        .all()
    )
    reports, changes = [], []
    for r in rows:
        p = part_by_id[r.participant_id]
        s = sessions[p.session_id]
        # 기관관리자 전용 세션은 회원용 리포트만 — 상담사용 리포트는 읽지 않는다.
        if s.id in admin_only and r.type != "client":
            continue
        occurred = _aware(s.started_at) or _aware(s.scheduled_at) or _aware(r.created_at)
        label = REPORT_STATUS_LABELS.get(r.status, "생성 중")
        if r.generation_status == "processing" and r.status != "completed":
            label = "생성 중"
        title = s.title or "세션 리포트"
        reports.append({
            "id": str(r.id), "session_id": str(s.id), "title": title,
            "type": r.type, "type_label": "회원용" if r.type == "client" else "코치용",
            "status": r.status, "status_label": label,
            "occurred_at": _iso(occurred), "created_at": _iso(r.created_at),
        })
        if r.type == "client" and r.status == "completed":
            content = r.content or {}
            existing = (content.get("eeg") or {}).get("change") if isinstance(content.get("eeg"), dict) else None
            change = existing if isinstance(existing, dict) else class_report_trend_service.compute_change(content)
            summ = summarize_change(change)
            changes.append({
                "report_id": str(r.id), "title": title, "occurred_at": _iso(occurred), **summ,
            })
    changes.sort(key=lambda c: c["occurred_at"] or "", reverse=True)
    reports.sort(key=lambda c: c["occurred_at"] or "", reverse=True)
    return {"reports": reports, "changes": changes}
