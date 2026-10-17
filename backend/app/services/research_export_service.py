"""연구 DB 내보내기 배치 (SDD-209 B13 / BE-R3 · MG-7).

연구 동의(미철회) 참여자의 **비식별 데이터만** 세션 단위 번들로 만들어 S3 스테이징 prefix 에 올린다. Spark(DGX)는
운영 서버로 접속하지 않고 이 prefix 를 **pull** 한 뒤 ack API 로 회신한다(운영→Spark push 없음). 이 SDD 에서
Spark 실접속·실전송은 하지 않는다.

번들(``<prefix><batch_id>/``)
- ``sessions.parquet``  — 가명 세션 ID + 허용된 세션 메타(상대 시각만, 절대 시각·제목·메모 없음)
- ``subjects.parquet``  — 연구 가명 ID(HMAC)·키 버전·성별·생년월(YYYY-MM)·revision
- ``eeg_raw.parquet``   — EEG raw 청크 원본 바이트(payload)와 해석 메타. PPG/ACC raw 는 서버에 저장되지 않아 없다.
- ``features.parquet``  — EEG 지표 + PPG/ACC **파생 지표**
- ``manifest.json``     — batch_id·key_version·파일별 행 수/바이트/sha256/컬럼 목록·허용 필드 목록 해시

안전장치
- **허용 필드 화이트리스트**: 번들 컬럼이 허용 목록과 정확히 같지 않으면 업로드 0 (``ExportValidationError``).
- 문자열 셀 스캔: 이메일·전화 형태와 이 배치 참가자의 이름·이메일·세션 제목 원문이 하나라도 있으면 업로드 0.
- 원본 session/participant/user UUID, 이름·이메일·전화, 녹취/STT, 음성·영상, 호스트/기관 식별자, 절대 시각은 번들에 없다.
- append-only: 재내보내기는 새 revision 항목이 추가될 뿐 기존 항목은 바뀌지 않으며, 내용 해시가 같으면 건너뛴다.
- 기본 ``RESEARCH_EXPORT_ENABLED=false``.
"""

from __future__ import annotations

import hashlib
import hmac
import io
import json
import logging
import re
import uuid
from datetime import datetime, timezone

import pyarrow as pa
import pyarrow.parquet as pq
from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.models.eeg_feature import EEGFeatureWindow
from app.models.record import EEGRawChunk
from app.models.research import ResearchConsent
from app.models.research_export import ResearchExportBatch, ResearchExportItem
from app.models.session import Session as SessionModel, SessionParticipant
from app.models.user import User
from app.services import research_consent_service, storage_service

logger = logging.getLogger(__name__)

SCHEMA_VERSION = "1.0"
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
ALLOWED_COLUMNS: dict[str, tuple[str, ...]] = {
    "sessions": ("session_pseudo", "type", "participant_mode", "location_type", "linkband_mode", "duration_min"),
    "subjects": (
        "research_subject_id", "key_version", "participant_pseudo", "session_pseudo", "gender",
        "birth_year_month", "revision",
    ),
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
        .filter(
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


def _participant_data(db: DBSession, consent: ResearchConsent, pseudo_p: str, pseudo_s: str) -> dict:
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
        .filter(EEGRawChunk.participant_id == pid, EEGRawChunk.upload_status == "uploaded")
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
    return {"features": feature_rows, "raw": raw_rows}


def _pending_consents(db: DBSession, session_id: uuid.UUID) -> list[ResearchConsent]:
    rows = (
        db.query(ResearchConsent)
        .filter(
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

    key_version = research_consent_service.current_key_version()
    pseudo_s = _pseudo("session", session.id, key_version)
    participants = {
        p.id: p
        for p in db.query(SessionParticipant)
        .filter(SessionParticipant.session_id == session_id)
        .execution_options(include_removed=True)
        .all()
    }
    forbidden: set[str] = set()
    for p in participants.values():
        for v in (p.guest_name, p.report_email):
            if v and len(v.strip()) >= 2:
                forbidden.add(v.strip().casefold())
        if p.user_id:
            user = db.query(User).filter(User.id == p.user_id).first()
            if user:
                for v in (user.name, user.email):
                    if v and len(v.strip()) >= 2:
                        forbidden.add(v.strip().casefold())
    for v in (session.title, session.notes):
        if v and len(v.strip()) >= 2:
            forbidden.add(v.strip().casefold())

    subjects, raw_rows, feature_rows, items = [], [], [], []
    for consent in consents:
        pseudo_p = _pseudo("participant", consent.participant_id, key_version)
        data = _participant_data(db, consent, pseudo_p, pseudo_s)
        if not data["features"] and not data["raw"]:
            continue  # 내보낼 데이터가 없으면 건너뜀(상태 유지)
        revision, last_hash = _next_revision(db, consent.id)
        content_hash = _canonical_hash([
            consent.research_subject_id, consent.gender, consent.birth_year_month,
            data["features"],
            [(r["chunk_index"], hashlib.sha256(r["payload"]).hexdigest()) for r in data["raw"]],
        ])
        if last_hash == content_hash:
            continue  # 이미 같은 내용을 내보냈다(중복 제거)
        subjects.append({
            "research_subject_id": consent.research_subject_id, "key_version": consent.key_version or key_version,
            "participant_pseudo": pseudo_p, "session_pseudo": pseudo_s, "gender": consent.gender,
            "birth_year_month": consent.birth_year_month, "revision": revision,
        })
        raw_rows += data["raw"]
        feature_rows += data["features"]
        items.append({
            "consent_id": consent.id, "research_subject_id": consent.research_subject_id, "revision": revision,
            "content_sha256": content_hash, "rows": {"raw": len(data["raw"]), "features": len(data["features"])},
        })
    if not items:
        return None

    session_row = {
        "session_pseudo": pseudo_s, "type": session.type, "participant_mode": session.participant_mode,
        "location_type": session.location_type, "linkband_mode": session.linkband_mode,
        "duration_min": session.duration_min,
    }
    _validate_enums([session_row])
    tables = {
        "sessions": _table("sessions", [session_row]),
        "subjects": _table("subjects", subjects),
        "eeg_raw": _table("eeg_raw", raw_rows),
        "features": _table("features", feature_rows),
    }
    files: dict[str, bytes] = {}
    manifest_files = []
    for name, table in tables.items():
        _validate_table(name, table)
        _scan_strings(table, forbidden)
        blob = _parquet_bytes(table)
        files[f"{name}.parquet"] = blob
        manifest_files.append({
            "name": f"{name}.parquet", "rows": table.num_rows, "bytes": len(blob), "sha256": _sha256(blob),
            "columns": list(table.schema.names),
        })
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
    batches = db.query(ResearchExportBatch).filter(ResearchExportBatch.status == "uploaded").all()
    cancelled = 0
    for batch in batches:
        items = db.query(ResearchExportItem).filter(ResearchExportItem.batch_id == batch.id).all()
        consents = {
            c.id: c
            for c in db.query(ResearchConsent).filter(ResearchConsent.id.in_([i.consent_id for i in items])).all()
        }
        if not any(_is_withdrawn(consents.get(i.consent_id)) for i in items):
            continue
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
            .filter(ResearchConsent.export_state == STATE_PENDING, ResearchConsent.consented.is_(True))
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
        for b in rows
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
