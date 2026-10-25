"""SDD-244 T05 — 산출물(feature/raw_derived/indices/normalization/algorithm) presign / 검증 ACK / 색인.

raw v2(biosignal_service)와 같은 불변성 규칙을 따른다: 내용 주소 key, SHA-256 서명 헤더, 검증 ACK,
슬롯 충돌 409. indices 는 ACK 시 1Hz 검색 원장(display_snapshots)에, normalization 은 content-addressed
원장에 반영한다(둘 다 정본은 객체이고 DB 는 검색용 사본).
"""
import gzip
import json
import logging
import zlib
from datetime import datetime, timezone
from fractions import Fraction
from uuid import UUID

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.models.record import EEGRawChunk
from app.models.biosignal import (
    BiosignalArtifact, BiosignalFeatureAlias, DisplaySnapshot, NormalizationSnapshotRow,
)
from app.schemas.biosignal import (
    ArtifactAckRequest, ArtifactAckResult, ArtifactPresignChunk, ArtifactPresignRequest,
    DisplaySnapshot as DisplaySnapshotDTO, NormalizationSnapshot as NormalizationSnapshotDTO,
)
from app.services import biosignal_service, eeg_raw_service, storage_service

logger = logging.getLogger(__name__)

RETENTION = {
    "raw_derived": "raw_90_days",  # 파형 사본은 raw 와 같은 90일 정책
    "feature": "feature_policy",
    "indices": "metadata_policy",
    "normalization": "metadata_policy",
    "algorithm": "metadata_policy",
}
MAX_DECODED_BYTES = 16 * 1024 * 1024


def _slot(m) -> tuple:
    return (
        m.artifact_kind, str(m.stream_id) if m.stream_id else None, str(m.segment_id) if m.segment_id else None,
        m.signal, str(m.view_instance_id) if m.view_instance_id else None, m.sequence,
    )


def _row_slot(r: BiosignalArtifact) -> tuple:
    return (r.artifact_kind, r.stream_id, r.segment_id, r.signal, r.view_instance_id, r.sequence)


def _validate_scope(m: ArtifactPresignChunk) -> None:
    need: tuple[str, ...]
    if m.artifact_kind in ("feature", "raw_derived"):
        need = ("signal", "segment_id", "stream_id")
    elif m.artifact_kind == "indices":
        need = ("stream_id", "view_instance_id")
    else:
        need = ()
    missing = [n for n in need if getattr(m, n) is None]
    if missing:
        raise HTTPException(status_code=422, detail=f"{m.artifact_kind} 에는 {', '.join(missing)} 가 필요합니다")
    if m.feature_id_aliases and m.artifact_kind != "feature":
        raise HTTPException(status_code=422, detail="feature_id_aliases 는 feature 에만 허용됩니다")
    if m.first_sequence is not None and m.last_sequence is not None and m.last_sequence < m.first_sequence:
        raise HTTPException(status_code=422, detail="sequence 범위가 역전됐습니다")


def _check_aliases(sid, pid, aliases: set[str], db: DBSession) -> None:
    """raw chunk_alias 와 artifact_alias 는 한 회차·참여자 안에서 서로 겹치지 않는다(manifest 의 artifact ID 유일성)."""
    for alias in aliases:
        biosignal_service.check_alias_reserved(alias)
    clash = (
        db.query(EEGRawChunk.chunk_alias)
        .filter(EEGRawChunk.session_id == sid, EEGRawChunk.participant_id == pid, EEGRawChunk.chunk_alias.in_(aliases))
        .all()
    )
    if clash:
        raise _conflict("alias_conflict", [{"artifact_alias": a} for (a,) in clash])


def _object_key(sid, pid, m: ArtifactPresignChunk) -> str:
    return f"biosignal-artifacts/{sid}/{pid}/{m.artifact_kind}/{m.artifact_alias}-{m.checksum}.bin"


def _new_row(sid, participant, m: ArtifactPresignChunk, play_group_id) -> BiosignalArtifact:
    return BiosignalArtifact(
        session_id=sid, participant_id=participant.id, artifact_alias=m.artifact_alias, artifact_kind=m.artifact_kind,
        signal=m.signal, stream_id=str(m.stream_id) if m.stream_id else None,
        segment_id=str(m.segment_id) if m.segment_id else None,
        view_instance_id=str(m.view_instance_id) if m.view_instance_id else None, play_group_id=play_group_id,
        sequence=m.sequence, first_sequence=m.first_sequence, last_sequence=m.last_sequence, row_count=m.row_count,
        content_encoding=m.content_encoding, schema_version=m.schema_version, checksum=m.checksum,
        uncompressed_sha256=m.uncompressed_sha256, size_bytes=m.size_bytes,
        time_from_us=int(m.time_range.from_us) if m.time_range else None,
        time_to_us=int(m.time_range.to_us) if m.time_range else None,
        retention_class=RETENTION[m.artifact_kind], object_key=_object_key(sid, participant.id, m),
        upload_status="pending",
    )


def _conflict(code: str, items: list[dict]) -> HTTPException:
    return HTTPException(status_code=409, detail={"code": code, "conflicts": items})


def presign(session_id: str, payload: ArtifactPresignRequest, db: DBSession, *, current_user_id=None, entry_credential=None) -> dict:
    sid, _ = eeg_raw_service._get_session(session_id, db)
    participant = biosignal_service.resolve_participant(
        sid, payload.participant_id, db, current_user_id=current_user_id, entry_credential=entry_credential)
    for m in payload.chunks:
        _validate_scope(m)
    archive = biosignal_service.archive_gate(
        db, sid, participant, payload.capture_stream_id,
        [(Fraction(int(m.monotonic_range.from_us)), Fraction(int(m.monotonic_range.to_us))) if m.monotonic_range else None for m in payload.chunks])

    aliases = {m.artifact_alias for m in payload.chunks}
    _check_aliases(sid, participant.id, aliases, db)
    kinds = {m.artifact_kind for m in payload.chunks}
    rows = (
        db.query(BiosignalArtifact)
        .filter(
            BiosignalArtifact.session_id == sid, BiosignalArtifact.participant_id == participant.id,
            (BiosignalArtifact.artifact_alias.in_(aliases)) | (BiosignalArtifact.artifact_kind.in_(kinds)),
        )
        .all()
    )
    by_slot = {_row_slot(r): r for r in rows}
    by_alias = {r.artifact_alias: r for r in rows}

    slot_conflicts, alias_conflicts = [], []
    planned: dict[tuple, ArtifactPresignChunk] = {}
    for m in payload.chunks:
        slot = _slot(m)
        existing = by_slot.get(slot) or planned.get(slot)
        if existing is not None and (existing.checksum != m.checksum or existing.size_bytes != m.size_bytes):
            slot_conflicts.append({
                "artifact_kind": m.artifact_kind, "sequence": m.sequence,
                "existing_checksum": existing.checksum, "attempted_checksum": m.checksum,
            })
            continue
        owner = by_alias.get(m.artifact_alias)
        if owner is not None and _row_slot(owner) != slot:
            alias_conflicts.append({"artifact_alias": m.artifact_alias, "artifact_kind": m.artifact_kind, "sequence": m.sequence})
            continue
        planned.setdefault(slot, m)
    if slot_conflicts:
        raise _conflict("artifact_conflict", slot_conflicts)
    if alias_conflicts:
        raise _conflict("alias_conflict", alias_conflicts)

    items: list[dict] = []
    resolved = dict(by_slot)
    for m in payload.chunks:
        slot = _slot(m)
        row = resolved.get(slot)
        if row is None:
            row = _new_row(sid, participant, m, payload.play_group_id)
            try:
                with db.begin_nested():
                    db.add(row)
                    db.flush()
            except IntegrityError:
                db.rollback()
                raise _conflict("alias_conflict", [{"artifact_alias": m.artifact_alias, "artifact_kind": m.artifact_kind, "sequence": m.sequence}])
            resolved[slot] = row
        _index_feature_aliases(sid, participant.id, row, m.feature_id_aliases, db)
        if row.upload_status == "uploaded":
            url, headers, expires = None, {}, 0
        else:
            if row.upload_status == "failed":
                row.upload_status, row.failure_reason = "pending", None
            url, headers = storage_service.generate_presigned_put_checksummed(
                row.object_key, checksum_sha256_hex=row.checksum, content_type=m.content_type)
            expires = biosignal_service.PRESIGN_EXPIRES_SEC
        items.append({
            "artifact_id": str(row.id), "artifact_alias": row.artifact_alias, "artifact_kind": row.artifact_kind,
            "sequence": row.sequence, "object_key": row.object_key, "checksum": row.checksum,
            "size_bytes": row.size_bytes, "upload_url": url, "upload_headers": headers,
            "upload_status": row.upload_status, "expires_in_sec": expires,
        })
    db.commit()
    out = {"session_id": str(sid), "participant_id": str(participant.id), "chunks": items}
    if archive is not None:
        out["archive_ingest"] = archive
    return out


def _index_feature_aliases(sid, pid, row: BiosignalArtifact, aliases: list[str], db: DBSession) -> None:
    for alias in dict.fromkeys(aliases):
        found = (
            db.query(BiosignalFeatureAlias)
            .filter_by(session_id=sid, participant_id=pid, feature_alias=alias).first()
        )
        if found is not None:
            if found.artifact_pk != row.id:
                db.rollback()
                raise _conflict("alias_conflict", [{"feature_alias": alias}])
            continue
        db.add(BiosignalFeatureAlias(session_id=sid, participant_id=pid, feature_alias=alias, artifact_pk=row.id))
    db.flush()


def resolve_feature_alias(db: DBSession, session_id, participant_id, alias: str) -> BiosignalArtifact | None:
    """source_feature_id(= feature_id_alias) → 그 feature 가 담긴 artifact. 없으면 None(미해석 참조)."""
    link = (
        db.query(BiosignalFeatureAlias)
        .filter_by(session_id=session_id, participant_id=participant_id, feature_alias=alias).first()
    )
    return db.get(BiosignalArtifact, link.artifact_pk) if link else None


def _decode(data: bytes, encoding: str) -> bytes:
    if encoding == "identity":
        return data
    out = zlib.decompressobj(wbits=31).decompress(data, MAX_DECODED_BYTES + 1)
    if len(out) > MAX_DECODED_BYTES:
        raise ValueError("decoded_too_large")
    return out


def _lines(raw: bytes) -> list[dict]:
    rows = [json.loads(line) for line in raw.decode("utf-8").splitlines() if line.strip()]
    if not all(isinstance(r, dict) for r in rows):
        raise ValueError("not_objects")
    return rows


def _index_content(row: BiosignalArtifact, db: DBSession) -> tuple[int, str | None]:
    """indices/normalization 객체를 해석해 검색 원장에 반영한다. (색인 행 수, 실패 사유)."""
    if row.artifact_kind not in ("indices", "normalization"):
        return 0, None
    data = storage_service.download_bytes(row.object_key)
    if data is None:
        return 0, "content_unreadable"
    try:
        raw = _decode(data, row.content_encoding)
        if row.uncompressed_sha256 is not None:
            import hashlib
            if hashlib.sha256(raw).hexdigest() != row.uncompressed_sha256:
                return 0, "uncompressed_hash_mismatch"
        rows = _lines(raw)
    except (ValueError, OSError, zlib.error, EOFError, UnicodeDecodeError):
        return 0, "content_schema_invalid"
    if len(rows) != row.row_count:
        return 0, "row_count_mismatch"
    if row.artifact_kind == "indices":
        return _index_snapshots(row, rows, db)
    return _index_models(rows, db)


def _index_snapshots(row: BiosignalArtifact, rows: list[dict], db: DBSession) -> tuple[int, str | None]:
    try:
        snaps = [DisplaySnapshotDTO.model_validate(r) for r in rows]
    except ValidationError:
        return 0, "content_schema_invalid"
    keys = {(s.stream_alias, s.view_instance_alias, s.second_index) for s in snaps}
    existing = {
        (r.stream_alias, r.view_instance_alias, r.second_index)
        for r in db.query(DisplaySnapshot).filter(
            DisplaySnapshot.session_id == row.session_id, DisplaySnapshot.participant_id == row.participant_id,
            DisplaySnapshot.stream_alias.in_({k[0] for k in keys}),
        ).all()
    }
    count = 0
    for s in snaps:
        key = (s.stream_alias, s.view_instance_alias, s.second_index)
        if key in existing:
            count += 1  # 재전송: 첫 기록 유지(불변), 색인된 것으로 센다
            continue
        existing.add(key)
        match = {True: "true", False: "false"}.get(s.display_match, str(s.display_match))
        db.add(DisplaySnapshot(
            session_id=row.session_id, participant_id=row.participant_id, artifact_pk=row.id,
            stream_alias=s.stream_alias, view_instance_alias=s.view_instance_alias,
            view_instance_id=row.view_instance_id, view_kind=s.view_kind, second_index=s.second_index,
            t_rel_ms=s.t_rel_ms, play_group_id=s.play_group_id, window_index=s.window_index,
            displayed_at_us=int(s.displayed_at_us) if s.displayed_at_us is not None else None,
            render_status=s.render_status, source=s.source, display_match=match,
            focus_value=s.focus.value, relaxation_value=s.relaxation.value, emotional_value=s.emotional.value,
            bpm_value=s.bpm.value, respiration_value=s.respiration.value, hrv_value=s.hrv.value,
            normalization_hash=s.normalization.params_hash if s.normalization else None,
            source_feature_aliases=sorted({
                m.source_feature_id for m in (s.focus, s.relaxation, s.emotional, s.bpm, s.respiration, s.hrv)
                if m.source_feature_id
            }),
            display_pipeline_version=s.display_pipeline_version, unavailable_reason=s.unavailable_reason,
        ))
        count += 1
    db.flush()
    return count, None


def _index_models(rows: list[dict], db: DBSession) -> tuple[int, str | None]:
    try:
        models = [NormalizationSnapshotDTO.model_validate(r) for r in rows]
    except ValidationError:
        return 0, "content_schema_invalid"
    for m in models:
        if db.query(NormalizationSnapshotRow).filter_by(params_hash=m.params_hash).first() is not None:
            continue
        try:
            with db.begin_nested():
                db.add(NormalizationSnapshotRow(
                    params_hash=m.params_hash, model_id_alias=m.model_id_alias, version=m.version,
                    formula_version=m.formula_version, content=m.model_dump(mode="json")))
                db.flush()
        except IntegrityError:
            pass  # 동시 등록 — 동일 hash 는 같은 내용
    return len(models), None


def _result(row: BiosignalArtifact, status: str, reason: str | None = None, indexed: int = 0) -> dict:
    return ArtifactAckResult(
        artifact_id=row.id, artifact_alias=row.artifact_alias, artifact_kind=row.artifact_kind, upload_status=status,
        checksum=row.checksum, size_bytes=row.size_bytes,
        verified_at_us=biosignal_service._us(row.verified_at) if status == "uploaded" and row.verified_at else None,
        failure_reason=reason, indexed_rows=indexed,
    ).model_dump(mode="json")


def ack(session_id: str, payload: ArtifactAckRequest, db: DBSession, *, current_user_id=None, entry_credential=None) -> dict:
    sid, _ = eeg_raw_service._get_session(session_id, db)
    participant = biosignal_service.resolve_participant(
        sid, payload.participant_id, db, current_user_id=current_user_id, entry_credential=entry_credential)
    wanted = [i.artifact_id for i in payload.chunks]
    rows = {
        r.id: r for r in db.query(BiosignalArtifact).filter(
            BiosignalArtifact.id.in_(wanted), BiosignalArtifact.session_id == sid,
            BiosignalArtifact.participant_id == participant.id).all()
    }
    if any(w not in rows for w in wanted):
        raise HTTPException(status_code=404, detail="산출물을 찾을 수 없습니다")

    results, acked, failed = [], 0, 0
    for item in payload.chunks:
        row = rows[item.artifact_id]
        if item.checksum != row.checksum or item.size_bytes != row.size_bytes:
            failed += 1
            results.append(_result(row, "failed", "ack_metadata_mismatch"))
            continue
        if row.upload_status == "uploaded":
            indexed = db.query(DisplaySnapshot).filter_by(artifact_pk=row.id).count() if row.artifact_kind == "indices" else 0
            results.append(_result(row, "uploaded", indexed=indexed))
            continue
        ok, version = storage_service.verify_object_sha256(
            row.object_key, expected_size=row.size_bytes, expected_sha256_hex=row.checksum)
        if ok is not True:
            reason = "verification_unavailable" if ok is None else "object_verification_failed"
            row.upload_status, row.verified_at, row.failure_reason = "failed", None, reason
            failed += 1
            results.append(_result(row, "failed", reason))
            continue
        indexed, bad = _index_content(row, db)
        if bad is not None:
            row.upload_status, row.verified_at, row.failure_reason = "failed", None, bad
            failed += 1
            results.append(_result(row, "failed", bad))
            continue
        row.upload_status, row.verified_at, row.object_version_id, row.failure_reason = (
            "uploaded", datetime.now(timezone.utc), version, None)
        acked += 1
        results.append(_result(row, "uploaded", indexed=indexed))
    db.flush()
    from app.services import biosignal_manifest_service  # 순환 import 회피
    biosignal_manifest_service.refresh_if_closing(db, sid, participant.id)  # 후발 ACK → 새 revision
    db.commit()
    logger.info("[biosignal] artifact ack session=%s participant=%s acked=%d failed=%d", sid, participant.id, acked, failed)
    return {"session_id": str(sid), "acked": acked, "failed": failed, "chunks": results}
