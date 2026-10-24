"""연구 DB 내보내기 배치 (SDD-209 B13 / BE-R3 · MG-7).

연구 동의(미철회) 참여자의 **비식별 데이터만** 세션 단위 번들로 만들어 S3 스테이징 prefix 에 올린다. Spark(DGX)는
운영 서버로 접속하지 않고 이 prefix 를 **pull** 한 뒤 ack API 로 회신한다(운영→Spark push 없음). 이 SDD 에서
Spark 실접속·실전송은 하지 않는다.

번들: sessions/subjects/eeg_raw/features/facilitators Parquet + manifest.json.
확장 고지 r5-2 동의 이후 시작한 회차만 절대 시각·프로그램·진행자 정보를 포함한다.
구동의는 기존 namespace와 null 확장 컬럼을 유지한다. 참여자 실명·연락처·원본 ID는 금지한다.
진행자 실명·계정 ID는 facilitators 지정 셀에서만 허용하며 참여자 이름 충돌은 실패한다.
허용 컬럼/enum/PII 검증이 끝나기 전에는 업로드하지 않는다. 기본 내보내기는 비활성이다.
"""

from __future__ import annotations

import hashlib
import hmac
import io
import json
import logging
import math
import re
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import pyarrow as pa
import pyarrow.parquet as pq
from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession
from sqlalchemy.orm.attributes import set_committed_value

from app.config import settings
from app.models.class_program import Class, ClassInstructor
from app.models.eeg_feature import EEGFeatureWindow
from app.models.record import EEGRawChunk
from app.models.research import ResearchConsent
from app.models.research_export import ResearchExportBatch, ResearchExportItem
from app.models.session import Session as SessionModel, SessionParticipant
from app.models.user import User
from app.services import research_consent_service, storage_service

logger = logging.getLogger(__name__)

SCHEMA_VERSION = "2.0"
EXPANDED_NOTICE_VERSION = "r5-2"
TARGET_STATUSES = ("completed", "cancelled")
# ack 대기·완료 상태는 재내보내기 대상이 아니다. 내보내기 대상 = pending.
STATE_PENDING = research_consent_service.STATE_PENDING
STATE_EXPORTED = "exported"
STATE_ACKED = "acked"

SESSION_ENUMS = {
    "type": {"clinical", "hypnosis", "meditation", "custom"},
    "participant_mode": {"one_on_one", "group"},
    "location_type": {"online", "offline"},
    "linkband_mode": {"none", "optional", "required"},
    "session_kind": {"regular", "makeup"},
    "schedule_mode": {"fixed", "rolling"},
}

# ── 허용 필드 목록(화이트리스트) — 번들 컬럼은 이 목록과 정확히 같아야 한다 ──────────────────
FEATURE_METRIC_COLUMNS = (
    "focus_index", "cognitive_load", "relaxation_index", "stress_index", "emotional_stability",
    "total_neural_activity", "faa", "hemispheric_balance",
    "delta_power", "theta_power", "alpha_power", "beta_power", "gamma_power", "total_power",
    "meditation_level", "attention_level", "signal_quality",
    # PPG/ACC 파생 지표 (raw 는 서버 미저장)
    "sdnn", "rmssd", "lf_power", "hf_power", "lf_hf_ratio", "heart_rate", "respiratory_rate", "motion",
)
SESSION_METADATA_COLUMNS = (
    "started_at_utc", "started_at_kst", "ended_at_utc", "ended_at_kst",
    "session_time_source", "session_time_reason", "seq", "session_kind",
    "schedule_mode", "planned_session_count", "default_duration_min", "class_pseudo",
)
SUBJECT_METADATA_COLUMNS = (
    "measurement_started_at_utc", "measurement_started_at_kst",
    "measurement_ended_at_utc", "measurement_ended_at_kst",
    "measurement_time_source", "measurement_time_reason",
)
ALLOWED_COLUMNS: dict[str, tuple[str, ...]] = {
    "sessions": ("session_pseudo", "type", "participant_mode", "location_type", "linkband_mode", "duration_min", *SESSION_METADATA_COLUMNS),
    "subjects": (
        "research_subject_id", "key_version", "participant_pseudo", "session_pseudo", "gender",
        "birth_year_month", "revision", *SUBJECT_METADATA_COLUMNS,
    ),
    "facilitators": ("session_pseudo", "user_id", "real_name", "account_role", "session_role"),
    "eeg_raw": (
        "participant_pseudo", "session_pseudo", "chunk_index", "start_rel_ms", "end_rel_ms", "sample_rate",
        "channel_count", "unit", "schema_version", "payload",
    ),
    "features": (
        "participant_pseudo", "session_pseudo", "window_index", "t_rel_ms", "quality", *FEATURE_METRIC_COLUMNS,
    ),
}
FIELD_LIST_SHA256 = hashlib.sha256(
    json.dumps({k: list(v) for k, v in sorted(ALLOWED_COLUMNS.items())}, ensure_ascii=False).encode()
).hexdigest()

_EMAIL_RE = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
_PHONE_RE = re.compile(r"\b0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}\b")


class ExportValidationError(RuntimeError):
    """허용 필드 검증·비식별 스캔 실패 — 업로드하지 않는다."""


class ExportUploadError(RuntimeError):
    """스테이징 업로드 실패 — 부분 업로드는 정리하고 배치는 failed."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── 가명 ID ─────────────────────────────────────────────────────────────────

def _pseudo(kind: str, value: uuid.UUID, key_version: int) -> str:
    key = research_consent_service.key_for_version(key_version)
    if not key:
        raise ExportValidationError("research_key_missing")
    return hmac.new(key.encode("utf-8"), f"{kind}|{value}".encode("utf-8"), hashlib.sha256).hexdigest()[:32]


# ── 상태 전이: 종료 후 큐 등록 ───────────────────────────────────────────────

def queue_session(session_id: uuid.UUID, db: DBSession) -> int:
    """세션 종료(또는 삭제 전) 시 연구 동의 건을 내보내기 큐(``pending``)에 올린다. 이미 큐/적재 상태는 그대로.

    ``export_state`` 가 ``not_applicable`` 인데 동의 중인 비정상 행만 pending 으로 올린다. 키 미설정/식별 부족(blocked_*)·
    철회는 올리지 않는다. 반환: 새로 큐에 올린 건수.
    """
    rows = (
        db.query(ResearchConsent)
        .join(SessionParticipant, SessionParticipant.id == ResearchConsent.participant_id)
        .execution_options(include_removed=True)
        .filter(
            # 기관 정보 유무·구 동의 true와 무관하게 비회원 전부 제외한다.
            SessionParticipant.user_id.isnot(None),
            ResearchConsent.session_id == session_id,
            ResearchConsent.consented.is_(True),
            ResearchConsent.withdrawn_at.is_(None),
            ResearchConsent.export_state == "not_applicable",
            ResearchConsent.research_subject_id.isnot(None),
        )
        .all()
    )
    for r in rows:
        r.export_state = STATE_PENDING
    if rows:
        db.commit()
    return len(rows)


def on_session_completed(session_id: uuid.UUID, db: DBSession) -> int:
    """세션 종료 훅(best-effort) — 큐 등록만 한다(번들 생성·업로드는 cron 이 이어받는다)."""
    try:
        return queue_session(session_id, db)
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("[research_export] 종료 후 큐 등록 실패: session=%s", session_id)
        return 0


# ── 번들 생성 ───────────────────────────────────────────────────────────────

def _table(name: str, rows: list[dict]) -> pa.Table:
    cols = ALLOWED_COLUMNS[name]
    spec: dict[str, pa.DataType] = {
        "session_pseudo": pa.string(), "type": pa.string(), "participant_mode": pa.string(),
        "location_type": pa.string(), "linkband_mode": pa.string(), "duration_min": pa.int64(),
        "research_subject_id": pa.string(), "key_version": pa.int64(), "participant_pseudo": pa.string(),
        "gender": pa.string(), "birth_year_month": pa.string(), "revision": pa.int64(),
        "chunk_index": pa.int64(), "start_rel_ms": pa.float64(), "end_rel_ms": pa.float64(),
        "sample_rate": pa.int64(), "channel_count": pa.int64(), "unit": pa.string(),
        "schema_version": pa.string(), "payload": pa.binary(), "window_index": pa.int64(),
        "t_rel_ms": pa.float64(), "quality": pa.string(),
        **{c: pa.float64() for c in FEATURE_METRIC_COLUMNS},
        **{c: pa.string() for c in (*SESSION_METADATA_COLUMNS, *SUBJECT_METADATA_COLUMNS,
                                    "user_id", "real_name", "account_role", "session_role")},
        **{c: pa.int64() for c in ("seq", "planned_session_count", "default_duration_min")},
    }
    schema = pa.schema([(c, spec[c]) for c in cols])
    return pa.Table.from_pylist([{c: r.get(c) for c in cols} for r in rows], schema=schema)


def _validate_table(name: str, table: pa.Table) -> None:
    if tuple(table.schema.names) != ALLOWED_COLUMNS[name]:
        extra = set(table.schema.names) - set(ALLOWED_COLUMNS[name])
        raise ExportValidationError(f"disallowed_columns:{name}:{sorted(extra)}")


def _scan_strings(table: pa.Table, forbidden: set[str]) -> None:
    for col, typ in zip(table.schema.names, table.schema.types):
        if not pa.types.is_string(typ):
            continue
        for value in table.column(col).to_pylist():
            if not value:
                continue
            if _EMAIL_RE.search(value) or _PHONE_RE.search(value):
                raise ExportValidationError(f"pii_pattern:{col}")
            lowered = value.casefold()
            for token in forbidden:
                if token and token in lowered:
                    raise ExportValidationError(f"pii_literal:{col}")


def _validate_enums(sessions: list[dict]) -> None:
    for row in sessions:
        for col, allowed in SESSION_ENUMS.items():
            if row.get(col) is not None and row[col] not in allowed:
                raise ExportValidationError(f"enum_value:{col}")


def _utc(value: datetime | None) -> datetime | None:
    # PostgreSQL은 timezone-aware, SQLite 테스트는 UTC naive로 읽힌다.
    if value is None:
        return None
    return None if value.tzinfo is None else value.astimezone(timezone.utc)


def _iso_pair(value: datetime | None) -> tuple[str | None, str | None]:
    value = _utc(value)
    return (value.isoformat(), value.astimezone(ZoneInfo("Asia/Seoul")).isoformat()) if value else (None, None)


def _expanded_scope(consent: ResearchConsent, session: SessionModel) -> bool:
    return bool(consent.notice_version == EXPANDED_NOTICE_VERSION and consent.consented_at is not None
                and _utc(session.started_at) is not None and _utc(consent.consented_at) is not None
                and _utc(consent.consented_at) <= _utc(session.started_at))


def _session_metadata(db: DBSession, session: SessionModel, expanded: bool) -> dict:
    row = dict.fromkeys(SESSION_METADATA_COLUMNS)
    if not expanded:
        row["session_time_reason"] = "legacy_consent_scope"
        return row
    start, end = _utc(session.started_at), _utc(session.ended_at)
    if start is not None and end is not None and end < start:
        row["session_time_reason"] = "reversed_session_endpoints"
    else:
        row["started_at_utc"], row["started_at_kst"] = _iso_pair(start)
        row["ended_at_utc"], row["ended_at_kst"] = _iso_pair(end)
        row["session_time_source"] = "sessions.started_at_ended_at"
        row["session_time_reason"] = "missing_session_endpoint" if start is None or end is None else None
    row.update(seq=session.seq, session_kind=session.session_kind)
    if session.class_id:
        program = db.query(Class).filter(Class.id == session.class_id).execution_options(include_hidden=True).first()
        if program:
            row.update(class_pseudo=_pseudo("class:r5-2", program.id, research_consent_service.current_key_version()),
                       schedule_mode=program.schedule_mode, planned_session_count=program.planned_session_count,
                       default_duration_min=program.default_duration_min)
    return row


def _facilitators(db: DBSession, session: SessionModel, pseudo_s: str) -> list[dict]:
    # 추가/제거 구간이 회차와 겹치는 관계. 이름·역할은 현재 값이며 실제 출석 증빙은 아니다.
    assignments = {session.host_id: "host"}
    if session.class_id:
        for relation in db.query(ClassInstructor).filter(
            ClassInstructor.class_id == session.class_id,
        ).all():
            added_at, removed_at = relation.added_at, relation.removed_at
            if db.get_bind().dialect.name == "sqlite":
                added_at = added_at.replace(tzinfo=timezone.utc) if added_at and added_at.tzinfo is None else added_at
                removed_at = removed_at.replace(tzinfo=timezone.utc) if removed_at and removed_at.tzinfo is None else removed_at
            start, end = _utc(session.started_at), _utc(session.ended_at)
            added_at, removed_at = _utc(added_at), _utc(removed_at)
            if added_at is None or end is None or added_at > end:
                continue
            if relation.removed_at is None:
                if relation.status != "active":
                    continue  # 제거 시점 없는 removed 관계는 당시 존재 여부를 확인할 수 없다.
            elif removed_at is None or start is None or removed_at < start or removed_at < added_at:
                continue
            if relation.scope_session_id is None or relation.scope_session_id == session.id:
                if relation.role not in {"lead", "assistant", "guest"}:
                    raise ExportValidationError("enum_value:session_role")
                if relation.user_id != session.host_id:
                    assignments[relation.user_id] = relation.role
    rows = []
    for user_id, role in sorted(assignments.items(), key=lambda pair: str(pair[0])):
        user = db.query(User).filter(User.id == user_id).first()
        if user is None:
            raise ExportValidationError("facilitator_account_missing")
        rows.append({"session_pseudo": pseudo_s, "user_id": str(user.id), "real_name": user.name,
                     "account_role": user.role, "session_role": role})
    return rows


def _measurement_metadata(chunks: list[EEGRawChunk], session: SessionModel, expanded: bool) -> dict:
    row = dict.fromkeys(SUBJECT_METADATA_COLUMNS)
    reason = None
    if not expanded:
        reason = "legacy_consent_scope"
    elif not chunks:
        reason = "no_raw_chunks"
    else:
        start, end = _utc(session.started_at), _utc(session.ended_at)
        if start is None or end is None or end < start:
            reason = "invalid_session_interval"
        else:
            endpoints = []
            stream_endpoints: dict[str | None, list[tuple[int, float, float]]] = {}
            lower, upper = start.timestamp() * 1000, end.timestamp() * 1000
            for chunk in chunks:
                a, b = chunk.start_ms, chunk.end_ms
                if a is None or b is None:
                    reason = "missing_raw_endpoint"
                elif not math.isfinite(a) or not math.isfinite(b):
                    reason = "non_finite_raw_endpoint"
                elif a < lower or b < lower or a > upper or b > upper or a < 946684800000 or b >= 4102444800000:
                    reason = "raw_outside_session"
                elif b < a:
                    reason = "reversed_raw_endpoints"
                if reason:
                    break
                endpoints.append((a, b))
                stream_endpoints.setdefault(chunk.stream_id, []).append((chunk.chunk_index, a, b))
            if not reason:
                # 장비 시계 재시작/역행은 절대 시각 근거로 사용할 수 없다.
                reset = False
                for stream_points in stream_endpoints.values():
                    ordered = sorted(stream_points)
                    if any(b[1] < a[1] for a, b in zip(ordered, ordered[1:])):
                        reset = True
                        break
                if reset:
                    reason = "raw_clock_reset"
                else:
                    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
                    first = epoch + timedelta(microseconds=int(Decimal(str(min(a for a,b in endpoints))) * 1000))
                    last = epoch + timedelta(microseconds=int(Decimal(str(max(b for a,b in endpoints))) * 1000))
                    row["measurement_started_at_utc"], row["measurement_started_at_kst"] = _iso_pair(first)
                    row["measurement_ended_at_utc"], row["measurement_ended_at_kst"] = _iso_pair(last)
                    row["measurement_time_source"] = "eeg_raw_chunk_endpoints"
    row["measurement_time_reason"] = reason
    return row


def _parquet_bytes(table: pa.Table) -> bytes:
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="zstd")
    return buf.getvalue()


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _canonical_hash(parts: list) -> str:
    h = hashlib.sha256()
    for part in parts:
        h.update(json.dumps(part, sort_keys=True, default=str, ensure_ascii=False).encode())
        h.update(b"\x00")
    return h.hexdigest()


def _participant_data(db: DBSession, consent: ResearchConsent, pseudo_p: str, pseudo_s: str,
                      session: SessionModel, expanded: bool) -> dict:
    """한 동의 건의 raw/지표 행(가명·상대 시각). 읽기 실패한 raw 는 예외 — 일부만 올리지 않는다."""
    pid = consent.participant_id
    windows = (
        db.query(EEGFeatureWindow)
        .filter(EEGFeatureWindow.participant_id == pid)
        .order_by(EEGFeatureWindow.play_group_id, EEGFeatureWindow.window_index, EEGFeatureWindow.id)
        .all()
    )
    chunks = (
        db.query(EEGRawChunk)
        .filter(EEGRawChunk.participant_id == pid, EEGRawChunk.upload_status == "uploaded",
                EEGRawChunk.schema_version == "1.0", EEGRawChunk.signal_type == "eeg")
        .order_by(EEGRawChunk.stream_id, EEGRawChunk.chunk_index)
        .all()
    )
    # 상대 시각 기준: 이 참여자의 가장 이른 장비 시각(장비 시계의 절대 의미 여부가 미확인이라 절대값은 싣지 않는다)
    stamps = [w.device_timestamp_ms for w in windows if w.device_timestamp_ms is not None]
    stamps += [c.start_ms for c in chunks if c.start_ms is not None]
    base = min(stamps) if stamps else None

    def rel(v):
        return None if (v is None or base is None) else float(v) - float(base)

    feature_rows = []
    for w in windows:
        row = {
            "participant_pseudo": pseudo_p, "session_pseudo": pseudo_s, "window_index": w.window_index,
            "t_rel_ms": rel(w.device_timestamp_ms), "quality": w.quality,
        }
        for c in FEATURE_METRIC_COLUMNS:
            row[c] = getattr(w, c, None)
        feature_rows.append(row)

    raw_rows = []
    for c in chunks:
        payload = storage_service.download_bytes(c.object_key)
        if payload is None:
            raise ExportUploadError("raw_object_unreadable")
        raw_rows.append({
            "participant_pseudo": pseudo_p, "session_pseudo": pseudo_s, "chunk_index": c.chunk_index,
            "start_rel_ms": rel(c.start_ms), "end_rel_ms": rel(c.end_ms), "sample_rate": c.sample_rate,
            "channel_count": c.channel_count, "unit": c.unit, "schema_version": c.schema_version,
            "payload": payload,
        })
    return {"features": feature_rows, "raw": raw_rows,
            "measurement": _measurement_metadata(chunks, session, expanded),
            "raw_metadata": [(str(c.stream_id), c.chunk_index, c.start_ms, c.end_ms, c.sample_rate,
                              c.channel_count, c.unit, c.schema_version) for c in chunks]}


def _pending_consents(db: DBSession, session_id: uuid.UUID) -> list[ResearchConsent]:
    rows = (
        db.query(ResearchConsent)
        .join(SessionParticipant, SessionParticipant.id == ResearchConsent.participant_id)
        .execution_options(include_removed=True)
        .filter(
            # 기관 정보 유무·구 동의 true와 무관하게 비회원 전부 제외한다.
            SessionParticipant.user_id.isnot(None),
            ResearchConsent.session_id == session_id,
            ResearchConsent.consented.is_(True),
            ResearchConsent.withdrawn_at.is_(None),
            ResearchConsent.export_state == STATE_PENDING,
            ResearchConsent.research_subject_id.isnot(None),
        )
        .order_by(ResearchConsent.created_at, ResearchConsent.id)
        .all()
    )
    return [
        r for r in rows
        if not research_consent_service._withdrawn_subject(  # noqa: SLF001 — 같은 도메인의 철회 대조
            r.research_subject_id, r.key_version or research_consent_service.current_key_version(), db
        )
    ]


def _next_revision(db: DBSession, consent_id: uuid.UUID) -> tuple[int, str | None]:
    last = (
        db.query(ResearchExportItem)
        .join(ResearchExportBatch, ResearchExportBatch.id == ResearchExportItem.batch_id)
        .filter(ResearchExportItem.consent_id == consent_id, ResearchExportBatch.status.in_(("uploaded", "acked")))
        .order_by(ResearchExportItem.revision.desc())
        .first()
    )
    return (last.revision + 1, last.content_sha256) if last else (1, None)


def build_session_bundle(db: DBSession, session_id: uuid.UUID) -> dict | None:
    """세션 1개의 번들 파일(이름 → 바이트)과 항목 요약을 만든다. 내보낼 게 없으면 None.

    업로드는 하지 않는다. 검증 실패 시 ``ExportValidationError``.
    """
    session = db.query(SessionModel).filter(SessionModel.id == session_id).execution_options(include_hidden=True).first()
    if session is None or session.status not in TARGET_STATUSES:
        return None
    consents = _pending_consents(db, session_id)
    if not consents:
        return None

    # SQLite가 timezone을 버리는 테스트 어댑터에 한해서만 UTC를 복원한다.
    # 운영에서 timezone 없는 시각은 추측하지 않는다.
    if db.get_bind().dialect.name == "sqlite":
        for obj, columns in [(session, ("started_at", "ended_at")),
                             *((c, ("consented_at",)) for c in consents)]:
            for column in columns:
                value = getattr(obj, column)
                if value is not None and value.tzinfo is None:
                    set_committed_value(obj, column, value.replace(tzinfo=timezone.utc))
    key_version = research_consent_service.current_key_version()
    pseudo_s = _pseudo("session", session.id, key_version)
    participants = {
        p.id: p
        for p in db.query(SessionParticipant)
        .filter(SessionParticipant.session_id == session_id)
        .execution_options(include_removed=True)
        .all()
    }
    forbidden: set[str] = {str(session_id), *(str(c.id) for c in consents)}
    for p in participants.values():
        forbidden.add(str(p.id))
        if p.user_id:
            forbidden.add(str(p.user_id))
        for v in (p.guest_name, p.report_email):
            if v and len(v.strip()) >= 2:
                forbidden.add(v.strip().casefold())
        if p.user_id:
            user = db.query(User).filter(User.id == p.user_id).first()
            if user:
                for v in (user.name, user.email):
                    if v and len(v.strip()) >= 2:
                        forbidden.add(v.strip().casefold())
    participant_forbidden = forbidden.copy()
    for v in (session.title, session.notes):
        if v and len(v.strip()) >= 2:
            forbidden.add(v.strip().casefold())

    subjects, raw_rows, feature_rows, items = [], [], [], []
    session_rows: dict[str, dict] = {}
    facilitator_rows: dict[str, list[dict]] = {}
    for consent in consents:
        expanded = _expanded_scope(consent, session)
        scope = "expanded-r5-2" if expanded else "legacy"
        # 레거시 가명은 보존하고 확장 가명만 별도 namespace를 사용한다.
        pseudo_s = _pseudo("session:expanded-r5-2" if expanded else "session", session.id, key_version)
        pseudo_p = _pseudo("participant:expanded-r5-2" if expanded else "participant", consent.participant_id, key_version)
        session_row = {
            "session_pseudo": pseudo_s, "type": session.type, "participant_mode": session.participant_mode,
            "location_type": session.location_type, "linkband_mode": session.linkband_mode,
            "duration_min": session.duration_min, **_session_metadata(db, session, expanded),
        }
        facilitators = _facilitators(db, session, pseudo_s) if expanded else []
        data = _participant_data(db, consent, pseudo_p, pseudo_s, session, expanded)
        if not data["features"] and not data["raw"]:
            continue  # 내보낼 데이터가 없으면 건너뜀(상태 유지)
        revision, last_hash = _next_revision(db, consent.id)
        content_hash = _canonical_hash([
            SCHEMA_VERSION, FIELD_LIST_SHA256, scope, session_row, facilitators, data["measurement"],
            data["raw_metadata"], consent.research_subject_id, consent.gender, consent.birth_year_month,
            data["features"],
            [(r["chunk_index"], hashlib.sha256(r["payload"]).hexdigest()) for r in data["raw"]],
        ])
        if last_hash == content_hash:
            continue  # 이미 같은 내용을 내보냈다(중복 제거)
        subjects.append({
            "research_subject_id": consent.research_subject_id, "key_version": consent.key_version or key_version,
            "participant_pseudo": pseudo_p, "session_pseudo": pseudo_s, "gender": consent.gender,
            "birth_year_month": consent.birth_year_month, "revision": revision, **data["measurement"],
        })
        session_rows[pseudo_s] = session_row
        facilitator_rows[pseudo_s] = facilitators
        raw_rows += data["raw"]
        feature_rows += data["features"]
        items.append({
            "consent_id": consent.id, "research_subject_id": consent.research_subject_id, "revision": revision,
            "content_sha256": content_hash, "rows": {"raw": len(data["raw"]), "features": len(data["features"])},
        })
    if not items:
        return None

    facilitators = [row for group in facilitator_rows.values() for row in group]
    tables = {
        "sessions": _table("sessions", list(session_rows.values())),
        "subjects": _table("subjects", subjects),
        "facilitators": _table("facilitators", facilitators),
        "eeg_raw": _table("eeg_raw", raw_rows),
        "features": _table("features", feature_rows),
    }
    files: dict[str, bytes] = {}
    manifest_files = []
    for name, table in tables.items():
        _validate_table(name, table)
        # 진행자 실명은 해당 셀에서만 허용. 참여자/제목 금지는 이 셀에도 적용한다.
        if name == "facilitators":
            _scan_strings(table.select(["real_name"]), participant_forbidden)
            _scan_strings(table.drop(["real_name"]), forbidden)
        else:
            _scan_strings(table, forbidden)
        facilitator_names = {r["real_name"].strip().casefold() for r in facilitators if r["real_name"]}
        if name == "facilitators":
            _scan_strings(table.drop(["real_name"]), facilitator_names)
        else:
            _scan_strings(table, facilitator_names)
        blob = _parquet_bytes(table)
        files[f"{name}.parquet"] = blob
        manifest_files.append({
            "name": f"{name}.parquet", "rows": table.num_rows, "bytes": len(blob), "sha256": _sha256(blob),
            "columns": list(table.schema.names),
        })
    _validate_enums(list(session_rows.values()))
    for row in subjects:
        if row["gender"] is not None and row["gender"] not in {"male", "female", "other"}:
            raise ExportValidationError("enum_value:gender")
        if row["birth_year_month"] is not None and not re.fullmatch(r"[0-9]{4}-(0[1-9]|1[0-2])", row["birth_year_month"]):
            raise ExportValidationError("invalid_birth_year_month")
    for row in facilitators:
        if row["account_role"] not in {"counselor", "org_admin", "platform_admin", "client"}:
            raise ExportValidationError("enum_value:account_role")
        if row["session_role"] not in {"host", "lead", "assistant", "guest"}:
            raise ExportValidationError("enum_value:session_role")
    total = sum(len(b) for b in files.values())
    if total > settings.research_export_max_batch_bytes:
        raise ExportValidationError("batch_too_large")
    return {"files": files, "manifest_files": manifest_files, "items": items, "key_version": key_version,
            "session_pseudo": pseudo_s, "total_bytes": total}


def _manifest_bytes(batch_id: uuid.UUID, bundle: dict) -> bytes:
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "batch_id": str(batch_id),
        "key_version": bundle["key_version"],
        "field_list_sha256": FIELD_LIST_SHA256,
        "consent_scope": "r5-2 and consented_at <= session.started_at; otherwise legacy namespace and null metadata",
        "time_provenance": "session DB endpoints; raw browser ISO epoch-ms endpoints validated within session, not device-clock certification",
        "facilitator_provenance": "session.host_id and ClassInstructor relation intervals overlapping session (added_at <= end; active without removed_at or removed_at >= start; global or matching scope_session_id); current account name/role snapshot, not historical attendance",

        "subjects": [
            {"research_subject_id": i["research_subject_id"], "revision": i["revision"], "rows": i["rows"]}
            for i in bundle["items"]
        ],
        "files": bundle["manifest_files"],
    }
    return json.dumps(manifest, sort_keys=True, ensure_ascii=False, indent=2).encode("utf-8")


# ── 업로드·재시도·알림 ───────────────────────────────────────────────────────

def _prefix_for(batch_id: uuid.UUID) -> str:
    base = settings.research_export_prefix
    if not base.endswith("/"):
        base += "/"
    return f"{base}{batch_id}/"


def _cleanup_objects(keys: list[str]) -> None:
    for key in keys:
        try:
            storage_service.delete_object(key)
        except Exception:  # noqa: BLE001 — best-effort
            logger.warning("[research_export] 스테이징 객체 정리 실패: %s", key)


def _upload_bundle(prefix: str, bundle: dict, manifest: bytes) -> list[str]:
    """모든 파일을 prefix 아래에만 쓴다. manifest 는 마지막에 쓴다(Spark 는 manifest 가 있는 배치만 처리)."""
    uploaded: list[str] = []
    try:
        for name, blob in bundle["files"].items():
            key = prefix + name
            if not storage_service.upload_bytes(key, blob, content_type="application/vnd.apache.parquet"):
                raise ExportUploadError(f"upload_failed:{name}")
            uploaded.append(key)
        key = prefix + "manifest.json"
        if not storage_service.upload_bytes(key, manifest, content_type="application/json"):
            raise ExportUploadError("upload_failed:manifest.json")
        uploaded.append(key)
    except Exception:
        _cleanup_objects(uploaded)  # 부분 업로드 정리
        raise
    return uploaded


def _notify_failure(db: DBSession, session_id: uuid.UUID, attempts: int) -> None:
    from app.services import notification_service

    for (admin_id,) in db.query(User.id).filter(User.role == "platform_admin").all():
        try:
            notification_service.notify_event(
                "research_export_failed",
                admin_id,
                {
                    "title": "연구 DB 내보내기가 반복 실패하고 있어요",
                    "body": f"같은 클래스의 내보내기가 {attempts}회 연속 실패했어요. 스테이징 저장소 설정을 확인해 주세요.",
                    "extra": {"event_type": "research_export_failed", "target_type": "notice"},
                },
                db,
            )
        except Exception:  # noqa: BLE001
            logger.exception("[research_export] 실패 알림 발송 실패")


def _failed_streak(db: DBSession, session_id: uuid.UUID) -> int:
    streak = 0
    for b in (
        db.query(ResearchExportBatch)
        .filter(ResearchExportBatch.session_id == session_id, ResearchExportBatch.status.in_(("failed", "uploaded", "acked")))
        .order_by(ResearchExportBatch.created_at.desc(), ResearchExportBatch.id.desc())
        .all()
    ):
        if b.status != "failed":
            break
        streak += 1
    return streak


def export_session(db: DBSession, session_id: uuid.UUID) -> dict:
    """세션 1개를 번들로 만들어 스테이징에 올린다. 결과: {status, batch_id?}."""
    batch_id = uuid.uuid4()
    batch = ResearchExportBatch(id=batch_id, session_id=session_id, status="building", prefix=_prefix_for(batch_id))
    try:
        bundle = build_session_bundle(db, session_id)
    except ExportValidationError as exc:
        db.rollback()
        return _record_failure(db, batch, str(exc), session_id)
    except ExportUploadError as exc:
        db.rollback()
        return _record_failure(db, batch, str(exc), session_id)
    if bundle is None:
        return {"status": "nothing_to_export"}
    manifest = _manifest_bytes(batch_id, bundle)
    batch.key_version = bundle["key_version"]
    batch.manifest_sha256 = _sha256(manifest)
    batch.total_bytes = bundle["total_bytes"] + len(manifest)
    batch.file_count = len(bundle["files"]) + 1
    batch.attempt = _failed_streak(db, session_id) + 1
    db.add(batch)
    db.commit()
    try:
        uploaded_keys = _upload_bundle(batch.prefix, bundle, manifest)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        batch = db.query(ResearchExportBatch).filter(ResearchExportBatch.id == batch_id).one()
        return _record_failure(db, batch, f"{type(exc).__name__}:{exc}", session_id, persisted=True)

    for item in bundle["items"]:
        db.add(ResearchExportItem(batch_id=batch_id, **item))
        consent = db.query(ResearchConsent).filter(ResearchConsent.id == item["consent_id"]).one()
        consent.export_state = STATE_EXPORTED
    batch.status = "uploaded"
    batch.uploaded_at = _now()
    db.commit()
    return {"status": "uploaded", "batch_id": str(batch_id), "keys": uploaded_keys, "items": len(bundle["items"])}


def _record_failure(db: DBSession, batch: ResearchExportBatch, error: str, session_id: uuid.UUID,
                    *, persisted: bool = False) -> dict:
    if not persisted:
        batch.attempt = _failed_streak(db, session_id) + 1
        db.add(batch)
    batch.status = "failed"
    batch.last_error = error[:500]
    db.commit()
    streak = _failed_streak(db, session_id)
    if streak >= settings.research_export_max_attempts and batch.alerted_at is None:
        already = (
            db.query(ResearchExportBatch)
            .filter(ResearchExportBatch.session_id == session_id, ResearchExportBatch.alerted_at.isnot(None),
                    ResearchExportBatch.status == "failed")
            .count()
        )
        if not already:
            _notify_failure(db, session_id, streak)
            batch.alerted_at = _now()
            db.commit()
    logger.warning("[research_export] 배치 실패: batch=%s error=%s", batch.id, error[:120])
    return {"status": "failed", "batch_id": str(batch.id), "error": error[:120], "attempt": batch.attempt}


# ── 철회와 배치 경합 ────────────────────────────────────────────────────────

def cancel_batches_for_withdrawn(db: DBSession) -> int:
    """철회된 동의 건이 들어 있는 미ack 배치를 취소한다(스테이징 객체 삭제, 남은 유효 건은 다시 pending)."""
    batches = db.query(ResearchExportBatch).filter(ResearchExportBatch.status.in_(("uploaded", "acked"))).all()
    cancelled = 0
    for batch in batches:
        items = db.query(ResearchExportItem).filter(ResearchExportItem.batch_id == batch.id).all()
        if batch.status == "acked" and not any(i.bundle_schema_version == "research-v3" for i in items):
            continue
        consents = {
            c.id: c
            for c in db.query(ResearchConsent).filter(ResearchConsent.id.in_([i.consent_id for i in items])).all()
        }
        if not any(_is_withdrawn(consents.get(i.consent_id)) or (i.bundle_schema_version=='research-v3' and signal_consent_status(db,consents.get(i.consent_id),'eeg','raw')=='withdrawn') for i in items):
            continue
        if any(i.bundle_schema_version == 'research-v3' for i in items):
            names=[f['name'] for i in items for f in i.rows.get('files',[])]
            _queue_signal_deletions(db,batch.prefix,[*names,'manifest.json'],'research_withdrawn')
        else:
            _cleanup_objects([batch.prefix + n for n in (*[f"{k}.parquet" for k in ALLOWED_COLUMNS], "manifest.json")])
        for i in items:
            c = consents.get(i.consent_id)
            if c is not None and not _is_withdrawn(c) and c.export_state == STATE_EXPORTED:
                c.export_state = STATE_PENDING  # 유효한 건은 다음 배치로 다시 내보낸다
        batch.status = "cancelled"
        batch.last_error = "withdrawn_during_batch"
        cancelled += 1
    if cancelled:
        db.commit()
    return cancelled


def _is_withdrawn(consent: ResearchConsent | None) -> bool:
    return (
        consent is None
        or not consent.consented
        or consent.withdrawn_at is not None
        or consent.export_state in ("withdrawn", "blocked_withdrawn")
    )


# ── 실행 단위 ───────────────────────────────────────────────────────────────

def run_export(db: DBSession, *, session_ids: list[uuid.UUID] | None = None, force: bool = False) -> dict:
    """대기 중(pending) 연구 동의 건이 있는 종료·취소 세션을 세션 단위로 내보낸다."""
    if not (settings.research_export_enabled or force):
        return {"skipped": "research_export_disabled"}
    cancelled = cancel_batches_for_withdrawn(db)
    if session_ids is None:
        session_ids = [
            sid for (sid,) in db.query(ResearchConsent.session_id)
            .join(SessionParticipant, SessionParticipant.id == ResearchConsent.participant_id)
            .execution_options(include_removed=True)
            .filter(SessionParticipant.user_id.isnot(None), ResearchConsent.export_state == STATE_PENDING, ResearchConsent.consented.is_(True))
            .distinct().all()
        ]
    results = [export_session(db, sid) for sid in session_ids]
    return {"cancelled_batches": cancelled, "sessions": len(session_ids), "results": results}


# ── ack / 조회 (Spark pull 쪽) ──────────────────────────────────────────────

def verify_service_token(token: str | None) -> None:
    expected = settings.research_export_ack_token or ""
    if not expected:
        raise HTTPException(status_code=503, detail="내보내기 확인 API 가 설정되지 않았어요")
    if not token or not hmac.compare_digest(token.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="서비스 토큰이 올바르지 않아요")


def _batch_has_guest(db: DBSession, batch_id: uuid.UUID) -> bool:
    """구버전이 만든 비회원 사본은 재전달하지 않는다. 기존 객체·기록은 삭제하지 않는다."""
    return db.query(ResearchExportItem.id).join(
        ResearchConsent, ResearchConsent.id == ResearchExportItem.consent_id
    ).outerjoin(
        SessionParticipant, SessionParticipant.id == ResearchConsent.participant_id
    ).filter(
        ResearchExportItem.batch_id == batch_id, SessionParticipant.user_id.is_(None)
    ).execution_options(include_removed=True).first() is not None


def list_uploaded_batches(db: DBSession) -> list[dict]:
    rows = (
        db.query(ResearchExportBatch)
        .filter(ResearchExportBatch.status == "uploaded")
        .order_by(ResearchExportBatch.created_at, ResearchExportBatch.id)
        .all()
    )
    return [
        {"batch_id": str(b.id), "prefix": b.prefix, "manifest_key": b.prefix + "manifest.json",
         "manifest_sha256": b.manifest_sha256, "file_count": b.file_count, "total_bytes": b.total_bytes}
        for b in rows if not _batch_has_guest(db, b.id) and _batch_scope_allowed(db, b.id)
        and not db.query(ResearchExportItem.id).filter_by(batch_id=b.id, bundle_schema_version="research-v3").first()
    ]


def ack_batch(db: DBSession, batch_id: str, sha256: str) -> dict:
    """Spark 가 적재를 마치면 batch_id·manifest sha256 으로 회신한다. 멱등."""
    try:
        bid = uuid.UUID(str(batch_id))
    except (TypeError, ValueError):
        raise HTTPException(status_code=404, detail="배치를 찾을 수 없어요")
    batch = db.query(ResearchExportBatch).filter(ResearchExportBatch.id == bid).with_for_update().first()
    if batch is None:
        raise HTTPException(status_code=404, detail="배치를 찾을 수 없어요")
    if db.query(ResearchExportItem.id).filter_by(batch_id=bid, bundle_schema_version="research-v3").first():
        raise HTTPException(status_code=409, detail="signal_scope_ack_required")
    if _batch_has_guest(db, batch.id):
        raise HTTPException(status_code=409, detail="비회원 데이터가 포함된 배치는 반출 대상이 아닙니다")
    if batch.status == "acked":
        if not hmac.compare_digest((sha256 or "").lower(), batch.manifest_sha256 or ""):
            raise HTTPException(status_code=409, detail="sha256 이 일치하지 않아요")
        return {"batch_id": str(batch.id), "status": "acked", "acked_at": batch.acked_at, "already": True}
    if batch.status != "uploaded":
        raise HTTPException(status_code=409, detail=f"ack 할 수 없는 배치 상태예요: {batch.status}")
    if not hmac.compare_digest((sha256 or "").lower(), batch.manifest_sha256 or ""):
        raise HTTPException(status_code=409, detail="sha256 이 일치하지 않아요")
    # 철회와 경합: ack 직전에 철회된 건이 있으면 배치를 취소한다
    items = db.query(ResearchExportItem).filter(ResearchExportItem.batch_id == bid).all()
    consents = {c.id: c for c in db.query(ResearchConsent).filter(ResearchConsent.id.in_([i.consent_id for i in items])).all()}
    if any(_is_withdrawn(consents.get(i.consent_id)) for i in items):
        db.commit()
        cancel_batches_for_withdrawn(db)
        raise HTTPException(status_code=409, detail="철회된 건이 있어 배치가 취소됐어요")
    now = _now()
    for i in items:
        c = consents.get(i.consent_id)
        if c is not None and c.export_state == STATE_EXPORTED:
            c.export_state = STATE_ACKED
    batch.status = "acked"
    batch.acked_at = now
    db.commit()
    return {"batch_id": str(batch.id), "status": "acked", "acked_at": now, "already": False}


# ── SDD-244: 명시적 신호 범주 v3. 기존 동의를 PPG/ACC/신규 범주로 확대하지 않는다. ──
from app.models.biosignal import BiosignalManifestRevision, BiosignalArtifact
from app.models.research_export import ResearchSignalReceipt, ObjectDeletionOutbox

SIGNAL_SCHEMA = 'research-v3'


def signal_consent_status(db: DBSession, consent: ResearchConsent | None, signal: str, kind: str) -> str:
    if _is_withdrawn(consent):
        return 'withdrawn' if consent and consent.withdrawn_at else 'not_consented'
    if not consent.research_subject_id or consent.export_state in ('blocked_key_missing','blocked_identity_missing'):
        return 'unknown'
    if research_consent_service._withdrawn_subject(consent.research_subject_id,consent.key_version or research_consent_service.current_key_version(),db):
        return 'withdrawn'
    participant = db.query(SessionParticipant).filter_by(id=consent.participant_id).execution_options(include_removed=True).first()
    if participant is None or participant.user_id is None:
        return 'not_consented'
    if signal != 'eeg' or kind not in ('raw', 'feature'):
        return 'unknown'
    return 'consented'


def _locked_consent(db: DBSession, sid, pid):
    return db.query(ResearchConsent).filter_by(session_id=sid,participant_id=pid).populate_existing().with_for_update().first()


def _scope_key(scope: dict) -> tuple:
    return (scope.get('signal'),scope.get('artifact_kind'),scope.get('manifest_revision'),scope.get('manifest_sha256'))


def _batch_scope_allowed(db: DBSession, bid) -> bool:
    items=db.query(ResearchExportItem).filter_by(batch_id=bid).all()
    if not items: return False
    for item in items:
        consent=db.query(ResearchConsent).filter_by(id=item.consent_id).populate_existing().first()
        if _is_withdrawn(consent): return False
        if item.bundle_schema_version==SIGNAL_SCHEMA:
            if not item.signal_scope or any(signal_consent_status(db,consent,s['signal'],s['artifact_kind'])!='consented' for s in item.signal_scope): return False
    return True


def signal_research_hold(db: DBSession, session_id, participant_id, signal: str, kind: str, artifact_sha256: str) -> bool:
    """정확히 해당 artifact를 포함한 revision/hash 영수증만 인정한다. v2 ACK는 영향 없음."""
    consent=db.query(ResearchConsent).filter_by(session_id=session_id,participant_id=participant_id).first()
    status=signal_consent_status(db,consent,signal,kind)
    if signal!='eeg' or kind not in ('raw','feature') or status in ('not_consented','withdrawn'): return False
    receipts=db.query(ResearchSignalReceipt).filter_by(session_id=session_id,participant_id=participant_id,
        consent_id=consent.id,signal=signal,artifact_kind=kind,schema_version=SIGNAL_SCHEMA).filter(ResearchSignalReceipt.acked_at.isnot(None)).all()
    for receipt in receipts:
        revision=db.query(BiosignalManifestRevision).filter_by(session_id=session_id,participant_id=participant_id,revision=receipt.manifest_revision,content_sha256=receipt.manifest_sha256).first()
        item=db.query(ResearchExportItem).filter_by(batch_id=receipt.batch_id,consent_id=consent.id,bundle_schema_version=SIGNAL_SCHEMA).first()
        included=item is not None and any(a.get('sha256')==artifact_sha256 and a.get('signal')==signal and a.get('artifact_kind')==kind for a in item.rows.get('transferred_artifacts',[]))
        if included and revision and any(a.get('sha256')==artifact_sha256 and a.get('artifact_kind')==kind for a in revision.content.get('artifacts',[])):
            return False
    return True


def export_signal_revision(db: DBSession, session_id, participant_id, revision: int, *, receiver_versions: list[str]) -> dict:
    """v3 수신자만, pinned revision의 EEG 기존 동의 범주만 생성/업로드한다.

    신규 신호/indices/raw-derived는 동의 범위 정의 전 unknown이다. 운영 실행은
    research_export_enabled와 서비스 토큰 API를 함께 통과해야 한다.
    """
    if SIGNAL_SCHEMA not in receiver_versions:
        return {'status':'pending','reason':'receiver_capability_unknown'}
    if not settings.research_export_enabled:
        return {'status':'pending','reason':'research_export_disabled'}
    sid,pid=uuid.UUID(str(session_id)),uuid.UUID(str(participant_id))
    session=db.query(SessionModel).filter_by(id=sid).execution_options(include_hidden=True).first()
    if session is None or session.status not in TARGET_STATUSES:
        raise HTTPException(409,'session_not_closed')
    consent=_locked_consent(db,sid,pid)
    if signal_consent_status(db,consent,'eeg','raw')!='consented':
        raise HTTPException(403,'signal_consent_required')
    pinned=db.query(BiosignalManifestRevision).filter_by(session_id=sid,participant_id=pid,revision=revision).first()
    if pinned is None: raise HTTPException(404,'manifest_revision_not_found')
    from app.schemas.biosignal import ManifestRevision, ExportSelection, ExportPolicy
    from app.services.biosignal_export_adapter import iter_export_artifacts
    manifest=ManifestRevision.model_validate(pinned.content)
    selection=ExportSelection(signals=['eeg'],time_range={'from_us':str(-(2**63)),'to_us':str(2**63-1)},sample_format='parquet',view_kind=manifest.default_view if manifest.default_view!='unavailable' else 'participant_player')
    policy=ExportPolicy(time_policy='relative_only',raw_packets_authorized=False,allowed_artifact_kinds=['raw','feature'],policy_revision=SIGNAL_SCHEMA)
    def check(m,ref,p):
        current=_locked_consent(db,sid,pid)
        return signal_consent_status(db,current,'eeg',ref.artifact_kind if ref else 'raw')=='consented'
    def read(key,version):
        # 내용 주소 객체를 전체 hash로 검증하므로 unversioned read 변조도 반출되지 않는다.
        return storage_service.download_bytes(key)
    files={}; manifest_files=[]; kinds=set(); transferred={}
    for artifact in iter_export_artifacts(manifest,selection,policy,db=db,session_id=sid,participant_id=pid,reader=read,policy_check=check,
            retention_hold_check=lambda m,ref,p: signal_research_hold(db,sid,pid,'eeg',ref.artifact_kind,ref.sha256)):
        meta=artifact.metadata
        if meta.artifact_kind not in ('raw','feature'): continue
        blob=b''.join(artifact.iter_bytes())
        files[meta.path]=blob; kinds.add(meta.artifact_kind)
        source=next(a for a in manifest.artifacts if a.artifact_id_alias==meta.artifact_id_alias)
        transferred[source.artifact_id_alias]={'signal':'eeg','artifact_kind':source.artifact_kind,'sha256':source.sha256}
        manifest_files.append({'name':meta.path,'sha256':meta.sha256,'bytes':len(blob),'rows':meta.row_count})
        if sum(map(len,files.values()))>settings.research_export_max_batch_bytes: raise ExportValidationError('batch_too_large')
    if not files: return {'status':'pending','reason':'no_authorized_artifacts'}
    scopes=[{'signal':'eeg','artifact_kind':kind,'manifest_revision':revision,'manifest_sha256':pinned.content_sha256} for kind in sorted(kinds)]
    content_hash=_canonical_hash([SIGNAL_SCHEMA,scopes,manifest_files])
    existing=db.query(ResearchExportItem).filter_by(consent_id=consent.id,bundle_schema_version=SIGNAL_SCHEMA,content_sha256=content_hash).order_by(ResearchExportItem.created_at.desc()).first()
    if existing:
        batch=db.get(ResearchExportBatch,existing.batch_id)
        if batch and batch.status in ('uploaded','acked'): return {'status':batch.status,'batch_id':str(batch.id),'already':True}
    batch=ResearchExportBatch(session_id=sid,status='building')
    db.add(batch);db.flush();batch.prefix=_prefix_for(batch.id)
    manifest_bytes=json.dumps({'schema_version':SIGNAL_SCHEMA,'signal_scope':scopes,'files':manifest_files},sort_keys=True,separators=(',',':')).encode()
    batch.manifest_sha256=_sha256(manifest_bytes)
    batch.file_count=len(files)+1;batch.total_bytes=sum(map(len,files.values()))+len(manifest_bytes)
    if batch.total_bytes>settings.research_export_max_batch_bytes: raise ExportValidationError('batch_too_large')
    # 동의 잠금을 유지한 채 업로드·원장 확정. 철회가 먼저 commit되면 check에서 거부된다.
    for name,blob in {**files,'manifest.json':manifest_bytes}.items():
        if not check(manifest,None,policy): raise HTTPException(409,'consent_withdrawn')
        try:
            uploaded=storage_service.upload_bytes(batch.prefix+name,blob)
        except Exception:
            uploaded=False
        if not uploaded:
            _queue_signal_deletions(db,batch.prefix,[*files,'manifest.json'],'export_failed')
            batch.status='failed';batch.last_error='upload_failed';db.commit()
            raise ExportUploadError('signal_upload_failed')
    next_revision,_=_next_revision(db,consent.id)
    db.add(ResearchExportItem(batch_id=batch.id,consent_id=consent.id,research_subject_id=consent.research_subject_id,
        revision=next_revision,content_sha256=content_hash,rows={'files':manifest_files,'transferred_artifacts':list(transferred.values())},bundle_schema_version=SIGNAL_SCHEMA,signal_scope=scopes))
    for scope in scopes:
        receipt=db.query(ResearchSignalReceipt).filter_by(participant_id=pid,**{k:v for k,v in scope.items()}).with_for_update().first()
        if receipt is None:
            receipt=ResearchSignalReceipt(session_id=sid,participant_id=pid,consent_id=consent.id,schema_version=SIGNAL_SCHEMA,**scope)
            db.add(receipt)
        if receipt.acked_at is None: receipt.batch_id=batch.id
    batch.status='uploaded';batch.uploaded_at=_now();db.commit()
    return {'status':'uploaded','batch_id':str(batch.id),'signal_scope':scopes}


def list_signal_batches(db: DBSession, receiver_versions: list[str]) -> list[dict]:
    if SIGNAL_SCHEMA not in receiver_versions: return []
    result=[]
    for batch in db.query(ResearchExportBatch).filter_by(status='uploaded').all():
        items=db.query(ResearchExportItem).filter_by(batch_id=batch.id,bundle_schema_version=SIGNAL_SCHEMA).all()
        if not items or not _batch_scope_allowed(db,batch.id) or _batch_has_guest(db,batch.id): continue
        result.append({'batch_id':str(batch.id),'manifest_key':batch.prefix+'manifest.json','manifest_sha256':batch.manifest_sha256,
            'bundle_schema_version':SIGNAL_SCHEMA,'signal_scope':[s for i in items for s in i.signal_scope]})
    return result


def ack_signal_batch(db: DBSession, batch_id: str, sha256: str, scopes: list[dict]) -> dict:
    try: bid=uuid.UUID(str(batch_id))
    except ValueError: raise HTTPException(404,'batch_not_found')
    batch=db.query(ResearchExportBatch).filter_by(id=bid).populate_existing().with_for_update().first()
    if batch is None: raise HTTPException(404,'batch_not_found')
    items=db.query(ResearchExportItem).filter_by(batch_id=bid).all()
    if not items or any(i.bundle_schema_version!=SIGNAL_SCHEMA for i in items): raise HTTPException(409,'signal_batch_required')
    for item in sorted(items,key=lambda i:str(i.consent_id)):
        db.query(ResearchConsent).filter_by(id=item.consent_id).populate_existing().with_for_update().first()
    if not _batch_scope_allowed(db,bid): raise HTTPException(409,'consent_withdrawn_or_scope_unknown')
    expected={_scope_key(s) for i in items for s in i.signal_scope}
    if len(scopes)!=len(expected) or {_scope_key(s) for s in scopes}!=expected: raise HTTPException(409,'signal_scope_mismatch')
    if not hmac.compare_digest(sha256,batch.manifest_sha256 or ''): raise HTTPException(409,'manifest_hash_mismatch')
    if batch.status not in ('uploaded','acked'): raise HTTPException(409,'batch_not_uploaded')
    receipts=db.query(ResearchSignalReceipt).filter_by(batch_id=bid).with_for_update().all()
    if {_scope_key({'signal':r.signal,'artifact_kind':r.artifact_kind,'manifest_revision':r.manifest_revision,'manifest_sha256':r.manifest_sha256}) for r in receipts}!=expected:
        raise HTTPException(409,'receipt_scope_mismatch')
    already=batch.status=='acked';now=_now()
    for r in receipts:
        if r.acked_at is None: r.acked_at=now
    batch.status='acked';batch.acked_at=batch.acked_at or now
    db.commit()
    return {'batch_id':str(bid),'status':'acked','already':already}


def _queue_signal_deletions(db: DBSession, prefix: str, names: list[str], reason: str) -> None:
    """실제 반출 경로를 tombstone/outbox에 보존한다. 객체 삭제는 통합 sweep이 재시도."""
    for name in names:
        key=prefix+name
        if not db.query(ObjectDeletionOutbox.id).filter_by(object_key=key).first():
            db.add(ObjectDeletionOutbox(object_key=key,source_table='research_export_items',reason=reason,state='pending',tombstone={'kind':'research_copy'}))
            db.flush()
