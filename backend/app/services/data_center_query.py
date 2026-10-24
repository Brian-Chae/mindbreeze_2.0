"""SDD-243 데이터 센터 탐색·집계·개별 열람(B02).

모든 쿼리는 `data_center_policy.scoped_sessions/scoped_participants` 에서 출발해 서버가 범위를 강제한다.
- 목록은 안정 keyset cursor `(time,id)`, 필터 해시에 바인딩. 일반 목록에 PII 원문·원시 배열·자유 JSON 없음.
- 확인된 0 과 미집계(None)를 구별한다. 저장량은 원장(EEG raw 업로드 완료 청크) 기준 **부분 집계**다.
- 개인정보 열람은 대상 1건·요청 필드만 일시 반환하고 로그에는 원문 없이 actor/대상/필드/시각만 남긴다.
"""
import base64
import hashlib
import json
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.orm import Query, Session as DBSession

from app.models.class_program import Class, ClassMember
from app.models.client_profile import ClientProfile
from app.models.eeg_feature import EEGFeatureWindow
from app.models.organization import Organization
from app.models.record import EEGRawChunk, Report, SessionRecord
from app.models.research import ResearchConsent
from app.models.session import Session, SessionParticipant
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership
from app.schemas import data_center as dc
from app.services.data_center_policy import (ResolvedContext, _active_facilitator_member, aware, class_in_scope,
                                             deny, not_found, scoped_participants, scoped_sessions, session_in_scope)

audit_logger = logging.getLogger('audit.data_center_contact_reveal')
KST = timezone(timedelta(hours=9))
RAW_RETENTION_DAYS = 90  # 244 계약 retention=raw_90_days
SESSION_TIME = func.coalesce(Session.started_at, Session.scheduled_at, Session.created_at)
EMPTY_COUNT = dc.Count(value=None, unavailable_reason='미집계')


def now() -> datetime:
    return datetime.now(timezone.utc)


# ── 기간·cursor 공통 ────────────────────────────────────────────────────

def kst_range(date_from: str | None, date_to: str | None) -> tuple[datetime | None, datetime | None]:
    """KST 달력일 → UTC [시작일 00:00, 종료일 다음날 00:00)."""
    try:
        start = datetime.combine(date.fromisoformat(date_from), datetime.min.time(), KST) if date_from else None
        end = (datetime.combine(date.fromisoformat(date_to), datetime.min.time(), KST) + timedelta(days=1)
               if date_to else None)
    except ValueError:
        raise deny(422, 'date_invalid', '날짜 형식이 올바르지 않습니다') from None
    if start and end and start >= end:
        raise deny(422, 'period_reversed', '시작일이 종료일보다 늦습니다')
    return (start.astimezone(timezone.utc) if start else None, end.astimezone(timezone.utc) if end else None)


def filters_hash(context: ResolvedContext, resource: str, query: dc.DataCenterQuery, **extra: object) -> str:
    payload = {'r': resource, 'org': str(context.scope_org_id), 'role': context.role,
               'f': query.model_dump(exclude={'limit', 'cursor'}), 'x': {k: str(v) for k, v in extra.items()}}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def encode_cursor(payload: dict, flt: str, as_of: datetime) -> str:
    raw = json.dumps({'p': payload, 'h': flt, 'a': as_of.isoformat()}, default=str)
    return base64.urlsafe_b64encode(raw.encode()).decode()


def decode_cursor(cursor: str, flt: str) -> tuple[dict, datetime]:
    try:
        data = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        payload, bound, as_of = data['p'], data['h'], datetime.fromisoformat(data['a'])
    except (ValueError, KeyError, TypeError):
        raise deny(400, 'invalid_cursor', '잘못된 cursor 입니다') from None
    if bound != flt:
        raise deny(400, 'cursor_mismatch', '필터가 바뀐 cursor 입니다. 처음부터 다시 조회해 주세요')
    return payload, as_of


def _key_value(value):
    return value.isoformat() if isinstance(value, datetime) else value


def paginate(query: Query, key_expr, id_expr, query_in: dc.DataCenterQuery, flt: str, *, desc: bool,
             key_is_time: bool = True, id_cast=UUID) -> tuple[list, str | None, datetime]:
    """(엔티티..., key) 행을 keyset 으로 자른다. 반환 rows 는 limit 개, next_cursor 는 다음 페이지가 있을 때만."""
    as_of = now()
    q = query.add_columns(key_expr.label('_k'))
    if query_in.cursor:
        payload, as_of = decode_cursor(query_in.cursor, flt)
        key = datetime.fromisoformat(payload['k']) if key_is_time else payload['k']
        cur_id = id_cast(payload['id'])
        before = (key_expr < key) | and_(key_expr == key, id_expr < cur_id) if desc else \
            (key_expr > key) | and_(key_expr == key, id_expr > cur_id)
        q = q.filter(before)
    order = (key_expr.desc(), id_expr.desc()) if desc else (key_expr.asc(), id_expr.asc())
    rows = q.order_by(*order).limit(query_in.limit + 1).all()
    more = len(rows) > query_in.limit
    rows = rows[:query_in.limit]
    next_cursor = None
    if more and rows:
        last = rows[-1]
        next_cursor = encode_cursor({'k': _key_value(last[-1]), 'id': str(getattr(last[0], 'id'))}, flt, as_of)
    return rows, next_cursor, as_of


def page(items: list, next_cursor: str | None, total: int | None, as_of: datetime, flt: str) -> dc.DataCenterPage:
    return dc.DataCenterPage(items=items, next_cursor=next_cursor, total=total, as_of=as_of, filters_hash=flt)


def _range_filter(q: Query, col, query: dc.DataCenterQuery) -> Query:
    start, end = kst_range(query.date_from, query.date_to)
    if start:
        q = q.filter(col >= start)
    if end:
        q = q.filter(col < end)
    return q


def like(value: str) -> str:
    return '%' + value.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'


# ── 측정 보유 통계 ──────────────────────────────────────────────────────

@dataclass
class Stats:
    feature_total: int = 0
    quality: dict[str, int] = field(default_factory=dict)
    raw_chunks: int = 0
    raw_bytes: int = 0
    raw_samples: int = 0
    raw_first: datetime | None = None

    @property
    def has_data(self) -> bool:
        return self.feature_total > 0 or self.raw_chunks > 0


def _has_feature():
    return exists().where(EEGFeatureWindow.participant_id == SessionParticipant.id)


def _has_raw():
    return exists().where(and_(EEGRawChunk.participant_id == SessionParticipant.id,
                               EEGRawChunk.upload_status == 'uploaded'))


def measure_stats(db: DBSession, participant_ids: list[UUID]) -> dict[UUID, Stats]:
    stats: dict[UUID, Stats] = defaultdict(Stats)
    if not participant_ids:
        return stats
    for pid, quality, n in db.query(EEGFeatureWindow.participant_id, EEGFeatureWindow.quality, func.count()).filter(
            EEGFeatureWindow.participant_id.in_(participant_ids)).group_by(EEGFeatureWindow.participant_id,
                                                                           EEGFeatureWindow.quality).all():
        stats[pid].feature_total += n
        stats[pid].quality[quality] = n
    for chunk in db.query(EEGRawChunk).filter(EEGRawChunk.participant_id.in_(participant_ids),
                                              EEGRawChunk.upload_status == 'uploaded').all():
        s = stats[chunk.participant_id]
        s.raw_chunks += 1
        s.raw_bytes += chunk.size_bytes or 0
        if chunk.start_ms is not None and chunk.end_ms is not None and chunk.end_ms >= chunk.start_ms:
            s.raw_samples += round((chunk.end_ms - chunk.start_ms) / 1000 * (chunk.sample_rate or 250))
        stamp = aware(chunk.uploaded_at or chunk.created_at)
        if stamp and (s.raw_first is None or stamp < s.raw_first):
            s.raw_first = stamp
    return stats


def quality_label(stat: Stats) -> str:
    total = stat.feature_total
    if not total:
        return 'unknown'
    invalid, degraded = stat.quality.get('invalid', 0), stat.quality.get('degraded', 0)
    if invalid * 2 >= total:
        return 'poor'
    return 'degraded' if invalid or degraded else 'good'


def participant_aliases(db: DBSession, session_ids: list[UUID]) -> dict[UUID, str]:
    """회차 안 참여자 별칭 P01…. (joined_at, id) 순서라 페이지가 달라도 안정적이다."""
    aliases: dict[UUID, str] = {}
    counters: dict[UUID, int] = defaultdict(int)
    rows = db.query(SessionParticipant.id, SessionParticipant.session_id).filter(
        SessionParticipant.session_id.in_(session_ids), SessionParticipant.removed_at.is_(None),
        SessionParticipant.waitlist_cancelled_at.is_(None), SessionParticipant.is_waitlisted.is_(False)
    ).order_by(SessionParticipant.joined_at, SessionParticipant.id).all()
    for pid, sid in rows:
        counters[sid] += 1
        aliases[pid] = f'P{counters[sid]:02d}'
    return aliases


def _signals(stat: Stats, band_used: bool) -> list[dc.SignalHolding]:
    if stat.raw_chunks:
        eeg = dc.SignalHolding(signal='eeg', availability='available',
                               sample_count=dc.Count(value=stat.raw_samples, partial=True,
                                                     unavailable_reason='청크 시간 범위 기준 추정'))
    elif stat.feature_total:
        eeg = dc.SignalHolding(signal='eeg', availability='unknown', unavailable_reason='raw_absent_features_only',
                               sample_count=dc.Count(value=None, unavailable_reason='raw 미보유(만료·미업로드 구분 불가)'))
    else:
        eeg = dc.SignalHolding(signal='eeg', availability='not_collected',
                               unavailable_reason='measured_without_data' if band_used else 'band_not_used',
                               sample_count=dc.Count(value=None, unavailable_reason='미수집'))
    other = [dc.SignalHolding(signal=sig, availability='not_collected', unavailable_reason='storage_not_connected',
                              sample_count=dc.Count(value=None, unavailable_reason='미수집'))
             for sig in ('ppg', 'acc')]
    return [eeg, *other]


# ── 1~2 개요·인벤토리 ───────────────────────────────────────────────────

def _scope_label(context: ResolvedContext) -> str:
    return context.scope_org_name or '전체 플랫폼'


def _scoped_class_query(db: DBSession, context: ResolvedContext) -> Query:
    query = db.query(Class)
    if context.scope_org_id is not None:
        query = query.filter(Class.organization_id == context.scope_org_id,
                             Class.organization_attribution_known.is_(True), Class.status != 'draft')
    return query


def _storage(db: DBSession, context: ResolvedContext) -> int:
    ids = scoped_sessions(db, context).with_entities(Session.id).statement
    total = db.query(func.coalesce(func.sum(EEGRawChunk.size_bytes), 0)).filter(
        EEGRawChunk.session_id.in_(ids), EEGRawChunk.upload_status == 'uploaded').scalar()
    return int(total or 0)


def _measurement_total(db: DBSession, context: ResolvedContext) -> int:
    return scoped_participants(db, context).filter(or_(_has_feature(), _has_raw())).count()


def summary(db: DBSession, context: ResolvedContext) -> dc.SummaryResponse:
    sessions = scoped_sessions(db, context)
    ended = sessions.filter(Session.status == 'completed').count()
    kpis = [
        dc.KpiItem(key='classes', label='클래스', unit='개', count=dc.Count(value=_scoped_class_query(db, context).count())),
        dc.KpiItem(key='sessions', label='종료된 회차', unit='회', count=dc.Count(value=ended)),
        dc.KpiItem(key='participants', label='참여 기록', unit='건', count=dc.Count(value=scoped_participants(db, context).count())),
        dc.KpiItem(key='measurements', label='측정 보유(세션×참여자)', unit='건', count=dc.Count(value=_measurement_total(db, context))),
        dc.KpiItem(key='storage_bytes', label='저장량(원장 기준 EEG raw)', unit='B',
                   count=dc.Count(value=_storage(db, context), partial=True,
                                  unavailable_reason='EEG raw 업로드 완료 청크만 집계')),
    ]
    if context.is_platform:
        kpis.insert(0, dc.KpiItem(key='users', label='계정(고유)', unit='명',
                                  count=dc.Count(value=db.query(User).count())))
        kpis.append(dc.KpiItem(key='retention_due_7d', label='7일 내 만료 예정', unit='건',
                               count=dc.Count(value=None, unavailable_reason='보관 기한 원장 미연결')))
    return dc.SummaryResponse(as_of=now(), scope_label=_scope_label(context), kpis=kpis)


def inventory(db: DBSession, context: ResolvedContext) -> dc.InventoryResponse:
    ids = scoped_sessions(db, context).with_entities(Session.id).statement
    raw_count = db.query(func.count(EEGRawChunk.id)).filter(
        EEGRawChunk.session_id.in_(ids), EEGRawChunk.upload_status == 'uploaded').scalar() or 0
    feat_count = db.query(func.count(EEGFeatureWindow.id)).filter(EEGFeatureWindow.session_id.in_(ids)).scalar() or 0
    hidden = dc.Count(value=None, unavailable_reason='권한상 비노출')
    not_connected = dc.Count(value=None, unavailable_reason='미수집 또는 저장소 미연결')
    reports, records = hidden, hidden
    if context.is_platform:  # 본문이 아니라 존재·건수만
        reports = dc.Count(value=db.query(func.count(Report.id)).filter(Report.session_id.in_(ids)).scalar() or 0)
        records = dc.Count(value=db.query(func.count(SessionRecord.id)).filter(SessionRecord.session_id.in_(ids)).scalar() or 0)
    items = [
        dc.InventoryItem(kind='eeg_raw', label='EEG 원파형', storage_category='S3 객체(원장)',
                         retention_policy='raw 90일', count=dc.Count(value=raw_count, partial=True), exportable=True),
        dc.InventoryItem(kind='eeg_features', label='EEG feature(1초)', storage_category='DB', retention_policy='feature 정책',
                         count=dc.Count(value=feat_count), exportable=True),
        dc.InventoryItem(kind='ppg_raw', label='PPG 원파형', storage_category='S3 객체(원장)', retention_policy='raw 90일',
                         count=not_connected, exportable=False, note='수집 파이프라인(SDD-244) 인수 전'),
        dc.InventoryItem(kind='acc_raw', label='ACC 원파형', storage_category='S3 객체(원장)', retention_policy='raw 90일',
                         count=not_connected, exportable=False, note='수집 파이프라인(SDD-244) 인수 전'),
        dc.InventoryItem(kind='indices', label='당시 표시값(6지표)', storage_category='DB/객체', retention_policy='feature 정책',
                         count=not_connected, exportable=False, note='표시 스냅샷 수집 인수 전'),
        dc.InventoryItem(kind='reports', label='리포트', storage_category='DB', retention_policy='리포트 정책', count=reports,
                         exportable=False, note='존재·건수만, 본문 반출 없음'),
        dc.InventoryItem(kind='session_records', label='회차 기록(음성·전사)', storage_category='DB/S3',
                         retention_policy='기록 정책', count=records, exportable=False, note='존재·건수만, 본문 반출 없음'),
    ]
    return dc.InventoryResponse(as_of=now(), items=items)


# ── 3~5 사용자 데이터 ───────────────────────────────────────────────────

def _universe_user_ids(db: DBSession, context: ResolvedContext):
    """org 범위의 사용자 ID select. 플랫폼은 None(전체)."""
    if context.scope_org_id is None:
        return None
    sess_ids = scoped_sessions(db, context).with_entities(Session.id).statement
    participants = select(SessionParticipant.user_id).where(
        SessionParticipant.session_id.in_(sess_ids), SessionParticipant.user_id.isnot(None),
        SessionParticipant.removed_at.is_(None))
    hosts = scoped_sessions(db, context).with_entities(Session.host_id).statement
    members = select(UserOrgMembership.user_id).where(UserOrgMembership.org_id == context.scope_org_id,
                                                      UserOrgMembership.status == 'active')
    return participants.union(hosts, members)


def _scoped_guests(db: DBSession, context: ResolvedContext) -> Query:
    query = db.query(ClassMember).filter(ClassMember.kind == 'guest', ClassMember.canonical_member_id.is_(None))
    if context.scope_org_id is not None:
        query = query.filter(ClassMember.class_id.in_(
            _scoped_class_query(db, context).with_entities(Class.id).statement))
    return query


def _guest_source_ids(db: DBSession, guest_ids: list[UUID]) -> dict[UUID, list[UUID]]:
    """canonical(survivor) → [survivor + 병합 원본] 매핑. 이름/이메일 추정 병합은 하지 않는다."""
    mapping: dict[UUID, list[UUID]] = {g: [g] for g in guest_ids}
    if guest_ids:
        for src, canon in db.query(ClassMember.id, ClassMember.canonical_member_id).filter(
                ClassMember.canonical_member_id.in_(guest_ids)).all():
            mapping[canon].append(src)
    return mapping


def _participations(db: DBSession, context: ResolvedContext, *, user_ids: list[UUID] | None = None,
                    member_ids: list[UUID] | None = None) -> list[SessionParticipant]:
    q = scoped_participants(db, context)
    if user_ids is not None:
        q = q.filter(SessionParticipant.user_id.in_(user_ids))
    if member_ids is not None:
        q = q.filter(SessionParticipant.member_id.in_(member_ids))
    return q.all()


def _holdings(db: DBSession, parts: list[SessionParticipant], key) -> dict:
    stats = measure_stats(db, [p.id for p in parts])
    out: dict = defaultdict(lambda: {'sessions': 0, 'measurements': 0})
    for p in parts:
        k = key(p)
        out[k]['sessions'] += 1
        out[k]['measurements'] += 1 if stats[p.id].has_data else 0
    return out


def list_subjects(db: DBSession, context: ResolvedContext, query: dc.DataCenterQuery, role: str | None = None) -> dc.DataCenterPage:
    flt = filters_hash(context, 'subjects', query, role=role)
    phase = 0
    cursor_payload: dict | None = None
    if query.cursor:
        cursor_payload, _ = decode_cursor(query.cursor, flt)
        phase = cursor_payload['ph']
    want_users = query.kind in (None, 'user')
    want_guests = query.kind in (None, 'guest') and role is None and query.status is None
    items: list[dc.SubjectListItem] = []
    next_cursor: str | None = None
    as_of = now()
    total = 0
    limit = query.limit

    uq = db.query(User)
    uni = _universe_user_ids(db, context)
    if uni is not None:
        uq = uq.filter(User.id.in_(uni))
    if role:
        uq = uq.filter(User.role == role)
    if query.status:
        uq = uq.filter(User.status == query.status)
    if query.q:
        uq = uq.filter(or_(User.name.ilike(like(query.q), escape='\\'), User.email.ilike(like(query.q), escape='\\')))
    gq = _scoped_guests(db, context)
    if query.q:
        gq = gq.filter(ClassMember.guest_name.ilike(like(query.q), escape='\\'), ClassMember.pii_scrubbed_at.is_(None))
    if want_users:
        total += uq.count()
    if want_guests:
        total += gq.count()

    def keyset(q: Query, entity_time, entity_id, p: dict | None, ph: int):
        q = q.add_columns(entity_time.label('_k'))
        if p is not None and p['ph'] == ph:
            key, cid = datetime.fromisoformat(p['k']), UUID(p['id'])
            q = q.filter((entity_time < key) | and_(entity_time == key, entity_id < cid))
        return q.order_by(entity_time.desc(), entity_id.desc())

    remaining = limit
    if want_users and phase == 0:
        rows = keyset(uq, User.created_at, User.id, cursor_payload, 0).limit(remaining + 1).all()
        more = len(rows) > remaining
        rows = rows[:remaining]
        items += _user_subjects(db, context, [r[0] for r in rows])
        remaining -= len(rows)
        if more:
            last = rows[-1]
            next_cursor = encode_cursor({'ph': 0, 'k': _key_value(last[1]), 'id': str(last[0].id)}, flt, as_of)
            remaining = 0
    if remaining > 0 and want_guests:
        rows = keyset(gq, ClassMember.joined_at, ClassMember.id, cursor_payload, 1).limit(remaining + 1).all()
        more = len(rows) > remaining
        rows = rows[:remaining]
        items += _guest_subjects(db, context, [r[0] for r in rows])
        if more:
            last = rows[-1]
            next_cursor = encode_cursor({'ph': 1, 'k': _key_value(last[1]), 'id': str(last[0].id)}, flt, as_of)
    elif remaining == 0 and next_cursor is None and want_guests and want_users and phase == 0 and gq.count():
        next_cursor = encode_cursor({'ph': 1, 'k': datetime.max.replace(tzinfo=timezone.utc).isoformat(),
                                     'id': str(UUID(int=2**128 - 1))}, flt, as_of)
    return page(items, next_cursor, total, as_of, flt)


def _user_subjects(db: DBSession, context: ResolvedContext, users: list[User]) -> list[dc.SubjectListItem]:
    ids = [u.id for u in users]
    parts = _participations(db, context, user_ids=ids)
    held = _holdings(db, parts, lambda p: p.user_id)
    org_names: dict[UUID, list[str]] = defaultdict(list)
    if context.is_platform and ids:
        for uid, name in db.query(UserOrgMembership.user_id, Organization.name).join(
                Organization, Organization.id == UserOrgMembership.org_id).filter(
                UserOrgMembership.user_id.in_(ids), UserOrgMembership.status == 'active',
                Organization.kind != 'individual').order_by(Organization.name).all():
            org_names[uid].append(name)
    birth = {uid for (uid,) in db.query(ClientProfile.user_id).filter(
        ClientProfile.user_id.in_(ids), ClientProfile.birth_date.isnot(None)).all()} if ids else set()
    items = []
    for user in users:
        h = held.get(user.id, {'sessions': 0, 'measurements': 0})
        member_type = None
        if not context.is_platform and user.role == 'client':
            member_type = 'member' if h['sessions'] else 'non_member'
        items.append(dc.SubjectListItem(
            subject_type='user', subject_id=user.id, display_name=user.name, email=user.email, role=user.role,
            status=user.status, org_names=[context.scope_org_name] if (not context.is_platform and context.scope_org_name)
            else org_names.get(user.id, []), member_type=member_type,
            holdings={'sessions': dc.Count(value=h['sessions']), 'measurements': dc.Count(value=h['measurements'])},
            contact_on_file=bool(user.phone) or user.id in birth, created_at=aware(user.created_at)))
    return items


def _guest_subjects(db: DBSession, context: ResolvedContext, guests: list[ClassMember]) -> list[dc.SubjectListItem]:
    mapping = _guest_source_ids(db, [g.id for g in guests])
    all_ids = [i for ids in mapping.values() for i in ids]
    parts = _participations(db, context, member_ids=all_ids)
    reverse = {i: canon for canon, ids in mapping.items() for i in ids}
    held = _holdings(db, parts, lambda p: reverse.get(p.member_id))
    org_by_class = {cid: name for cid, name in db.query(Class.id, Organization.name).join(
        Organization, Organization.id == Class.organization_id).filter(
        Class.id.in_([g.class_id for g in guests])).all()} if guests else {}
    items = []
    for g in guests:
        h = held.get(g.id, {'sessions': 0, 'measurements': 0})
        scrubbed = g.pii_scrubbed_at is not None
        items.append(dc.SubjectListItem(
            subject_type='guest', subject_id=g.id, display_name=None if scrubbed else g.guest_name, email=None, role=None,
            status=g.status, org_names=[org_by_class[g.class_id]] if g.class_id in org_by_class else [],
            member_type='non_member',
            holdings={'sessions': dc.Count(value=h['sessions']), 'measurements': dc.Count(value=h['measurements'])},
            contact_on_file=bool(g.birth_date) and not scrubbed, created_at=aware(g.joined_at)))
    return items


def _subject(db: DBSession, context: ResolvedContext, subject_type: str, subject_id: UUID):
    """범위 안 대상만 반환(아니면 404). 플랫폼은 전역, 기관은 §5.1 교집합."""
    if subject_type == 'user':
        user = db.get(User, subject_id)
        if user is None:
            raise not_found()
        uni = _universe_user_ids(db, context)
        if uni is not None and db.query(User.id).filter(User.id == subject_id, User.id.in_(uni)).first() is None:
            raise not_found()
        return user
    guest = _scoped_guests(db, context).filter(ClassMember.id == subject_id).first()
    if guest is None:
        raise not_found()
    return guest


def subject_holdings(db: DBSession, context: ResolvedContext, subject_type: str, subject_id: UUID,
                     query: dc.DataCenterQuery) -> dc.SubjectHoldings:
    subject = _subject(db, context, subject_type, subject_id)
    if subject_type == 'user':
        parts = _participations(db, context, user_ids=[subject_id])
    else:
        parts = _participations(db, context, member_ids=_guest_source_ids(db, [subject_id])[subject_id])
    stats = measure_stats(db, [p.id for p in parts])
    sessions = {s.id: s for s in db.query(Session).filter(Session.id.in_([p.session_id for p in parts])).all()} if parts else {}
    events: list[dc.HoldingEvent] = []
    for p in parts:
        s = sessions[p.session_id]
        at = aware(s.started_at or s.scheduled_at or s.created_at)
        events.append(dc.HoldingEvent(at=at, kind='session_participation', label=s.title or '명상 회차',
                                      session_id=s.id, status=p.attendance_status))
        if stats[p.id].has_data:
            events.append(dc.HoldingEvent(at=at, kind='measurement', label='측정 보유', session_id=s.id, status=None))
    events.sort(key=lambda e: (e.at, str(e.session_id), e.kind), reverse=True)
    flt = filters_hash(context, 'holdings', query, subject=subject_id)
    offset = 0
    as_of = now()
    if query.cursor:
        payload, as_of = decode_cursor(query.cursor, flt)
        offset = int(payload['o'])
    chunk = events[offset:offset + query.limit]
    next_cursor = encode_cursor({'o': offset + query.limit}, flt, as_of) if offset + query.limit < len(events) else None
    counts = {'sessions': dc.Count(value=len(parts)), 'measurements': dc.Count(value=sum(1 for p in parts if stats[p.id].has_data))}
    return dc.SubjectHoldings(subject_type=subject_type, subject_id=subject_id, as_of=as_of,  # type: ignore[arg-type]
                              events=chunk, counts=counts, next_cursor=next_cursor)


def contact_reveal(db: DBSession, context: ResolvedContext, subject_type: str, subject_id: UUID,
                   fields: list[str]) -> dc.ContactRevealResponse:
    """대상 1건·요청 필드만 일시 반환. 로그에는 원문 없이 actor/대상/필드/시각만 남긴다."""
    subject = _subject(db, context, subject_type, subject_id)
    phone: str | None = None
    birth: str | None = None
    if subject_type == 'user':
        phone = subject.phone if 'phone' in fields else None
        if 'birth_date' in fields:
            profile = db.query(ClientProfile).filter(ClientProfile.user_id == subject_id).first()
            value = profile.birth_date if profile and profile.birth_date else subject.birth_date
            birth = str(value) if value else None
    elif subject.pii_scrubbed_at is None and 'birth_date' in fields and subject.birth_date:
        birth = str(subject.birth_date)  # 비회원은 연락처 필드 자체가 없다
    unavailable = [f for f, v in (('phone', phone), ('birth_date', birth)) if f in fields and not v]
    audit_logger.info('reveal fields=%s actor=%s role=%s org=%s target=%s:%s allowed=true at=%s', ','.join(fields),
                      context.actor_id, context.role, context.scope_org_id, subject_type, subject_id,
                      now().isoformat())
    return dc.ContactRevealResponse(subject_type=subject_type, subject_id=subject_id, phone=phone,  # type: ignore[arg-type]
                                    birth_date=birth, unavailable=unavailable)


# ── 26~30 클래스·회차·참여자 ────────────────────────────────────────────

def _session_rows(db: DBSession, context: ResolvedContext, sessions: list[Session]) -> list[dc.SessionRow]:
    ids = [s.id for s in sessions]
    counts: dict[UUID, int] = {}
    measured: dict[UUID, int] = {}
    size: dict[UUID, int] = {}
    if ids:
        base = scoped_participants(db, context).filter(SessionParticipant.session_id.in_(ids))
        counts = dict(base.with_entities(SessionParticipant.session_id, func.count()).group_by(
            SessionParticipant.session_id).all())
        measured = dict(base.filter(or_(_has_feature(), _has_raw())).with_entities(
            SessionParticipant.session_id, func.count()).group_by(SessionParticipant.session_id).all())
        size = dict(db.query(EEGRawChunk.session_id, func.coalesce(func.sum(EEGRawChunk.size_bytes), 0)).filter(
            EEGRawChunk.session_id.in_(ids), EEGRawChunk.upload_status == 'uploaded').group_by(
            EEGRawChunk.session_id).all())
    rows = []
    for s in sessions:
        done = s.status == 'completed'
        rows.append(dc.SessionRow(
            session_id=s.id, class_id=s.class_id, seq=s.seq, title=s.title, scheduled_at=aware(s.scheduled_at),
            started_at=aware(s.started_at), ended_at=aware(s.ended_at), status=s.status,
            participant_count=dc.Count(value=counts.get(s.id, 0)), measured_count=dc.Count(value=measured.get(s.id, 0)),
            estimated_bytes=dc.Count(value=int(size.get(s.id, 0)), partial=True,
                                     unavailable_reason='EEG raw 업로드 완료 청크만 집계'),
            exportable=done, exclusion_reason=None if done else 'not_completed'))
    return rows


def list_classes(db: DBSession, context: ResolvedContext, query: dc.DataCenterQuery) -> dc.DataCenterPage:
    flt = filters_hash(context, 'classes', query)
    q = _scoped_class_query(db, context)
    if query.q:
        q = q.filter(Class.title.ilike(like(query.q), escape='\\'))
    if query.status:
        q = q.filter(Class.status == query.status)
    total = q.count()
    desc = query.sort != 'time_asc'
    if query.sort == 'name_asc':
        rows, nxt, as_of = paginate_text(q, Class.title, Class.id, query, flt)
    else:
        rows, nxt, as_of = paginate(q, Class.created_at, Class.id, query, flt, desc=desc)
    classes = [r[0] for r in rows]
    ids = [c.id for c in classes]
    org_names = {oid: n for oid, n in db.query(Organization.id, Organization.name).filter(
        Organization.id.in_([c.organization_id for c in classes if c.organization_id])).all()} if classes else {}
    ended: dict[UUID, int] = {}
    last: dict[UUID, datetime] = {}
    bytes_by_class: dict[UUID, int] = {}
    hosts: dict[UUID, list[UUID]] = defaultdict(list)
    if ids:
        sq = scoped_sessions(db, context).filter(Session.class_id.in_(ids))
        ended = dict(sq.filter(Session.status == 'completed').with_entities(Session.class_id, func.count()).group_by(
            Session.class_id).all())
        last = dict(sq.with_entities(Session.class_id, func.max(SESSION_TIME)).group_by(Session.class_id).all())
        ses_ids = sq.with_entities(Session.id).statement
        bytes_by_class = dict(db.query(Session.class_id, func.coalesce(func.sum(EEGRawChunk.size_bytes), 0)).join(
            EEGRawChunk, EEGRawChunk.session_id == Session.id).filter(
            Session.id.in_(ses_ids), EEGRawChunk.upload_status == 'uploaded').group_by(Session.class_id).all())
        for cid, host in sq.with_entities(Session.class_id, Session.host_id).order_by(SESSION_TIME, Session.id).all():
            if host not in hosts[cid]:
                hosts[cid].append(host)
    items = [dc.ClassListItem(
        class_id=c.id, title=c.title, org_id=c.organization_id, org_name=org_names.get(c.organization_id),
        status=c.status, ended_session_count=dc.Count(value=int(ended.get(c.id, 0))),
        stored_bytes=dc.Count(value=int(bytes_by_class.get(c.id, 0)), partial=True,
                              unavailable_reason='EEG raw 업로드 완료 청크만 집계'),
        facilitator_aliases=[f'F{i + 1}' for i in range(len(hosts.get(c.id, [])))],
        attribution='confirmed' if (c.organization_attribution_known and c.organization_id) else 'needs_confirmation',
        last_session_at=aware(last.get(c.id))) for c in classes]
    return page(items, nxt, total, as_of, flt)


def paginate_text(query: Query, text_expr, id_expr, query_in: dc.DataCenterQuery, flt: str):
    """이름 오름차순 keyset (제목 null 은 빈 문자열로 취급)."""
    as_of = now()
    key_expr = func.coalesce(text_expr, '')
    q = query.add_columns(key_expr.label('_k'))
    if query_in.cursor:
        payload, as_of = decode_cursor(query_in.cursor, flt)
        key, cur_id = payload['k'], UUID(payload['id'])
        q = q.filter((key_expr > key) | and_(key_expr == key, id_expr > cur_id))
    rows = q.order_by(key_expr.asc(), id_expr.asc()).limit(query_in.limit + 1).all()
    more = len(rows) > query_in.limit
    rows = rows[:query_in.limit]
    nxt = encode_cursor({'k': rows[-1][-1], 'id': str(rows[-1][0].id)}, flt, as_of) if more and rows else None
    return rows, nxt, as_of


def _sessions_page(db: DBSession, context: ResolvedContext, base: Query, query: dc.DataCenterQuery, flt: str,
                   *, desc: bool = True) -> tuple[dc.DataCenterPage, int]:
    start, end = kst_range(query.date_from, query.date_to)
    if start:
        base = base.filter(SESSION_TIME >= start)
    if end:
        base = base.filter(SESSION_TIME < end)
    if query.status:
        base = base.filter(Session.status == query.status)
    total = base.count()
    rows, nxt, as_of = paginate(base, SESSION_TIME, Session.id, query, flt, desc=desc)
    return page(_session_rows(db, context, [r[0] for r in rows]), nxt, total, as_of, flt), total


def class_sessions(db: DBSession, context: ResolvedContext, class_id: UUID, query: dc.DataCenterQuery) -> dc.ClassSessionsResponse:
    cls = class_in_scope(db, context, class_id)
    flt = filters_hash(context, 'class_sessions', query, cls=class_id)
    base = scoped_sessions(db, context).filter(Session.class_id == class_id)
    result, _ = _sessions_page(db, context, base, query, flt, desc=query.sort != 'time_asc')
    org_name = db.query(Organization.name).filter(Organization.id == cls.organization_id).scalar() if cls.organization_id else None
    return dc.ClassSessionsResponse(class_id=cls.id, title=cls.title, org_name=org_name, sessions=result)


def session_participants(db: DBSession, context: ResolvedContext, session_id: UUID,
                         query: dc.DataCenterQuery) -> dc.SessionParticipantsResponse:
    session = session_in_scope(db, context, session_id)
    flt = filters_hash(context, 'participants', query, session=session_id)
    base = scoped_participants(db, context).filter(SessionParticipant.session_id == session_id)
    total = base.count()
    rows, nxt, as_of = paginate(base, SessionParticipant.joined_at, SessionParticipant.id, query, flt, desc=False)
    parts = [r[0] for r in rows]
    aliases = participant_aliases(db, [session_id])
    stats = measure_stats(db, [p.id for p in parts])
    show_names = context.capabilities().can_export_identified
    users = {u.id: u for u in db.query(User).filter(User.id.in_([p.user_id for p in parts if p.user_id])).all()} if parts else {}
    members = {m.id: m for m in db.query(ClassMember).filter(ClassMember.id.in_([p.member_id for p in parts if p.member_id])).all()} if parts else {}
    research: dict[UUID, str] = {}
    if context.is_platform and parts:
        for rc in db.query(ResearchConsent).filter(ResearchConsent.participant_id.in_([p.id for p in parts])).all():
            research[rc.participant_id] = 'withdrawn' if rc.withdrawn_at else ('agreed' if rc.consented else 'none')
    items = []
    for p in parts:
        stat = stats[p.id]
        band_used = bool(p.band_connected) or stat.has_data
        measurement = 'available' if stat.has_data else ('not_collected' if band_used else 'band_not_used')
        consent = 'agreed' if p.consent_eeg else 'none'
        reason = None
        if measurement != 'available':
            reason = measurement
        elif consent != 'agreed':
            reason = 'consent_missing'
        user = users.get(p.user_id) if p.user_id else None
        member = members.get(p.member_id) if p.member_id else None
        name = None
        if show_names:
            name = user.name if user else (None if (p.pii_scrubbed_at or (member and member.pii_scrubbed_at))
                                           else (p.guest_name or (member.guest_name if member else None)))
        subject_type, subject_id = (('user', p.user_id) if p.user_id else
                                    (('guest', (member.canonical_member_id or member.id) if member else None)))
        items.append(dc.ParticipantRow(
            participant_id=p.id, alias=aliases.get(p.id, '?'), display_name=name, subject_type=subject_type,  # type: ignore[arg-type]
            subject_id=subject_id, attendance_status=p.attendance_status, band_used=band_used, measurement=measurement,  # type: ignore[arg-type]
            general_consent=consent, research_consent=research.get(p.id, 'none') if context.is_platform else 'not_visible',  # type: ignore[arg-type]
            retention_deadline=(stat.raw_first + timedelta(days=RAW_RETENTION_DAYS)) if stat.raw_first else None,
            selectable=reason is None, unselectable_reason=reason))
    row = _session_rows(db, context, [session])[0]
    return dc.SessionParticipantsResponse(session=row, participants=page(items, nxt, total, as_of, flt))


def _batches(total: int, size: int) -> list[dc.SessionBatch]:
    return [dc.SessionBatch(index=i + 1, first=i * size + 1, last=min((i + 1) * size, total),
                            count=min(size, total - i * size)) for i in range((total + size - 1) // size)]


def member_sessions(db: DBSession, context: ResolvedContext, member_id: UUID, query: dc.DataCenterQuery,
                    subject_type: str = 'user') -> dc.SubjectSessionsResponse:
    if subject_type == 'user':
        mine = scoped_participants(db, context).filter(SessionParticipant.user_id == member_id)
    else:
        guest = _subject(db, context, 'guest', member_id)
        mine = scoped_participants(db, context).filter(
            SessionParticipant.member_id.in_(_guest_source_ids(db, [guest.id])[guest.id]))
    if mine.first() is None:
        raise not_found()
    base = scoped_sessions(db, context).filter(Session.id.in_(mine.with_entities(SessionParticipant.session_id).statement))
    flt = filters_hash(context, 'member_sessions', query, member=member_id, st=subject_type)
    result, total = _sessions_page(db, context, base, query, flt, desc=False)
    size = context.policy.member_facilitator_max_sessions
    return dc.SubjectSessionsResponse(subject_id=member_id, as_of=result.as_of, total=total,
                                      max_sessions_per_request=size, batches=_batches(total, size), sessions=result)


def facilitator_sessions(db: DBSession, context: ResolvedContext, facilitator_id: UUID,
                         query: dc.DataCenterQuery) -> dc.SubjectSessionsResponse:
    user = db.get(User, facilitator_id)
    if user is None or (context.scope_org_id is not None
                        and not _active_facilitator_member(db, context.scope_org_id, facilitator_id)):
        raise not_found()
    if not query.date_from or not query.date_to:
        raise deny(422, 'period_required', '상담사 단위는 시작일과 종료일이 필요합니다')
    base = scoped_sessions(db, context).filter(Session.host_id == facilitator_id)
    flt = filters_hash(context, 'facilitator_sessions', query, facilitator=facilitator_id)
    result, total = _sessions_page(db, context, base, query, flt, desc=False)
    size = context.policy.member_facilitator_max_sessions
    return dc.SubjectSessionsResponse(subject_id=facilitator_id, as_of=result.as_of, total=total,
                                      max_sessions_per_request=size, batches=_batches(total, size), sessions=result)


# ── 6~7 측정 ────────────────────────────────────────────────────────────

def list_measurements(db: DBSession, context: ResolvedContext, query: dc.DataCenterQuery) -> dc.DataCenterPage:
    flt = filters_hash(context, 'measurements', query)
    base = scoped_participants(db, context).filter(or_(_has_feature(), _has_raw())).join(
        Session, Session.id == SessionParticipant.session_id)
    start, end = kst_range(query.date_from, query.date_to)
    if start:
        base = base.filter(SESSION_TIME >= start)
    if end:
        base = base.filter(SESSION_TIME < end)
    total = base.count()
    rows, nxt, as_of = paginate(base, SESSION_TIME, SessionParticipant.id, query, flt, desc=query.sort != 'time_asc')
    parts = [r[0] for r in rows]
    stats = measure_stats(db, [p.id for p in parts])
    aliases = participant_aliases(db, list({p.session_id for p in parts}))
    sessions = {s.id: s for s in db.query(Session).filter(Session.id.in_({p.session_id for p in parts})).all()} if parts else {}
    items = []
    for p in parts:
        s = sessions[p.session_id]
        stat = stats[p.id]
        items.append(dc.MeasurementListItem(
            session_id=p.session_id, participant_id=p.id, alias=aliases.get(p.id, '?'), class_id=s.class_id,
            started_at=aware(s.started_at), signals=_signals(stat, True),
            feature_windows=dc.Count(value=stat.feature_total), quality=quality_label(stat),  # type: ignore[arg-type]
            band_used=True))
    return page(items, nxt, total, as_of, flt)


def measurement_detail(db: DBSession, context: ResolvedContext, session_id: UUID,
                       participant_id: UUID) -> dc.MeasurementDetail:
    part = scoped_participants(db, context).filter(SessionParticipant.id == participant_id,
                                                   SessionParticipant.session_id == session_id).first()
    if part is None:
        raise not_found()
    stat = measure_stats(db, [part.id])[part.id]
    band_used = bool(part.band_connected) or stat.has_data
    return dc.MeasurementDetail(
        session_id=session_id, participant_id=participant_id, alias=participant_aliases(db, [session_id]).get(part.id, '?'),
        as_of=now(), manifest_revision=None, manifest_state='not_connected', signals=_signals(stat, band_used),
        feature_windows=dc.Count(value=stat.feature_total), consent='agreed' if part.consent_eeg else 'none',
        retention_deadline=(stat.raw_first + timedelta(days=RAW_RETENTION_DAYS)) if stat.raw_first else None,
        allowed_formats=['csv', 'parquet'], band_used=band_used,
        default_view='participant_player' if stat.feature_total else 'unavailable')
