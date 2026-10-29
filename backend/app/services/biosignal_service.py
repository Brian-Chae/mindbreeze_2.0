"""SDD-244 T04 — 세 신호(EEG/PPG/ACC) raw v2 presign / 검증 ACK / capability.

기존 eeg_raw_service(v1)와 같은 원장(eeg_raw_chunks)을 쓰되 identity 를
(session, participant, signal_type, stream_id, segment_id, chunk_index) 로 확장한다.
- 객체 key 는 내용 주소(sha256 포함)이고 PUT 은 SHA-256 서명 헤더에 바인딩된다 → 같은 key 에는 같은 바이트만.
- 같은 identity 에 다른 checksum 이 오면 409(요청 전체 미반영), 기존 행은 보존한다.
- ACK 는 저장소가 확인한 존재·크기·SHA-256 이 모두 일치할 때만 uploaded 로 확정한다(검증 불가=실패).
"""
import logging
from datetime import datetime, timezone
from fractions import Fraction
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.models.biosignal import BiosignalSegment, BiosignalStream
from app.models.record import EEGRawChunk
from app.schemas.biosignal import (
    AckRequest, AckResult, PresignChunk, PresignRequest, MAX_BATCH, MAX_OBJECT_BYTES,
)
from app.services import eeg_raw_service, session_service, storage_service

logger = logging.getLogger(__name__)

RAW_V2_SCHEMA = "mb-biosignal-raw-v2"
SIGNALS = ("eeg", "ppg", "acc")
PRESIGN_EXPIRES_SEC = storage_service.PRESIGNED_PUT_DEFAULT_EXPIRES_IN


RESERVED_ALIAS_PREFIXES = ("RAWMISSING-", "FEATMISSING-", "IDXMISSING-", "GAPMISSING-", "GAPUNEXPECTED")


def check_alias_reserved(alias: str) -> None:
    """서버가 manifest 에서 합성하는 alias(GAPS, *MISSING-*)는 클라이언트가 쓸 수 없다."""
    if alias == "GAPS" or alias.startswith(RESERVED_ALIAS_PREFIXES):
        raise HTTPException(status_code=422, detail="예약된 alias 입니다")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _us(moment: datetime) -> str:
    return str(int(moment.timestamp() * 1_000_000))


def _window_server_time(stream, mono_us: Fraction) -> datetime:
    """장치 단조시각 → 서버 시계. 서버가 서명한 anchor(anchor_server_at ↔ anchor_monotonic_us)만 기준이다."""
    from datetime import timedelta

    return stream.anchor_server_at + timedelta(microseconds=float(mono_us - int(stream.anchor_monotonic_us)))


def raw_window_mono(meta: PresignChunk) -> tuple[Fraction, Fraction]:
    """raw 청크가 덮는 단조시각 창 [start, end(배타)] (µs, 유리수)."""
    h = meta.header
    step = Fraction(1_000_000) * h.rate.denominator / h.rate.numerator
    base = int(h.anchor.monotonic_us) - h.anchor.sample_index * step

    return base + h.first_sample_index * step, base + h.end_sample_index_exclusive * step


def archive_gate(db: DBSession, sid: UUID, participant, capture_stream_id: UUID | None,
                 windows: list[tuple[Fraction, Fraction] | None], *, windowless_ok: list[bool] | None = None) -> dict | None:
    """SDD-246 T09 — 종료 이후·오프라인 사후전송 수락 판정(T03 evaluate_ingest 가 기준).

    capture_stream_id 가 없으면 None(현행 동작 유지). 하나라도 거절·격리면 요청 전체를 반영하지 않는다.
    archive 수락은 live 최신성을 바꾸지 않는다: capture_stream/outbox 를 쓰지 않고 live_fresh_applied=False 로 고정한다.
    """
    if capture_stream_id is None:
        return None
    from app.models.live_state import CaptureStream
    from app.services.session_live_commands import evaluate_ingest

    stream = db.get(CaptureStream, capture_stream_id)
    if stream is None or stream.session_id != sid:
        raise HTTPException(status_code=404, detail={"code": "capture_stream_not_found"})
    if stream.participant_id != participant.id:
        raise HTTPException(status_code=403, detail={"code": "capture_stream_not_owned"})
    for i, window in enumerate(windows):
        if window is None and windowless_ok and windowless_ok[i]:
            # 측정 구간이 없는 메타(normalization/algorithm): stream 개설 시각(항상 cutoff 이전)으로 권한 코드·deadline 만 판정한다.
            decision = evaluate_ingest(db, stream_id=stream.id, window_start_at=stream.opened_at, window_end_at=stream.opened_at, now=_now())
            if decision.verdict != "accept":
                status = 403 if decision.verdict == "reject" else 409
                code = "archive_rejected" if decision.verdict == "reject" else "pending_time_review"
                raise HTTPException(status_code=status, detail={"code": code, "reason": decision.code})
            continue
        if window is None or stream.anchor_server_at is None or stream.anchor_monotonic_us is None:
            # 창을 서버 시계로 환산할 수 없다: 종료/철회 cutoff 가 있으면 입증 불가 → 격리, 없으면 현행대로 수락.
            if stream.cutoff_at is not None:
                raise HTTPException(status_code=409, detail={"code": "pending_time_review", "reason": "window_unproven"})
            continue
        start, end = _window_server_time(stream, window[0]), _window_server_time(stream, window[1])
        decision = evaluate_ingest(db, stream_id=stream.id, window_start_at=start, window_end_at=end, now=_now())
        if decision.verdict == "reject":
            raise HTTPException(status_code=403, detail={"code": "archive_rejected", "reason": decision.code})
        if decision.verdict == "pending_time_review":
            raise HTTPException(status_code=409, detail={"code": "pending_time_review", "reason": decision.code})
    return {"verdict": "accept", "code": None, "live_fresh_applied": False}


def resolve_participant(sid: UUID, participant_id: UUID | None, db: DBSession, *, current_user_id, entry_credential):
    return session_service.resolve_upload_participant(
        sid, str(participant_id) if participant_id else None, current_user_id, db,
        entry_credential=entry_credential, allow_completed=True,
    )


def _object_key(sid: UUID, pid: UUID, meta: PresignChunk) -> str:
    h = meta.header
    return (
        f"biosignal-raw/{sid}/{pid}/{h.stream_id}/{h.segment_id}/{h.signal_type}/"
        f"{h.chunk_index:08d}-{meta.checksum}.bin"
    )


def _time_ms(header, sample_index: int) -> float:
    """anchor 기준 유리수 시각(µs) → ms. 최종 출력에서만 float 로 변환한다."""
    a = header.anchor
    # 실측 rate 가 있으면 그것으로 시간축을 만든다 — ACC 처럼 명목(30Hz)과 실제(≈26Hz)가 다른 신호가 종료 시각을 짧게 보이지 않게.
    rate = header.observed_rate or header.rate
    us = Fraction(int(a.relative_us)) + Fraction(sample_index - a.sample_index) * 1_000_000 * rate.denominator / rate.numerator
    return float(us / 1000)


def _check_sizes(meta: PresignChunk) -> None:
    """size_bytes 는 MBRAW002(8)+header 길이(4)+header(≤64KiB)+section 합과 일관돼야 한다."""
    body = sum(s.length for s in meta.header.sections)
    overhead = meta.size_bytes - 12 - body
    if overhead <= 0 or overhead > 65536 or meta.size_bytes > MAX_OBJECT_BYTES:
        raise HTTPException(status_code=422, detail="size_bytes 가 header/section 합과 맞지 않습니다")


def _conflict(code: str, conflicts: list[dict]) -> HTTPException:
    return HTTPException(status_code=409, detail={"code": code, "conflicts": conflicts})


def _ensure_stream_segment(sid: UUID, participant, meta: PresignChunk, play_group_id: str | None, db: DBSession) -> None:
    h = meta.header
    stream_id = str(h.stream_id)
    stream = (
        db.query(BiosignalStream)
        .filter_by(session_id=sid, participant_id=participant.id, stream_id=stream_id)
        .first()
    )
    if stream is None:
        try:
            with db.begin_nested():
                stream = BiosignalStream(
                    session_id=sid, participant_id=participant.id, stream_id=stream_id, play_group_id=play_group_id
                )
                db.add(stream)
                db.flush()
        except IntegrityError:
            stream = (
                db.query(BiosignalStream)
                .filter_by(session_id=sid, participant_id=participant.id, stream_id=stream_id)
                .one()
            )
    seg = (
        db.query(BiosignalSegment)
        .filter_by(stream_pk=stream.id, segment_id=str(h.segment_id), signal_type=h.signal_type)
        .first()
    )
    if seg is None:
        try:
            with db.begin_nested():
                db.add(BiosignalSegment(
                    stream_pk=stream.id, segment_id=str(h.segment_id), signal_type=h.signal_type,
                    profile_id=h.parser_profile.profile_id, profile_hash=h.parser_profile.parameters_hash,
                    time_basis=h.time_basis, rate_numerator=h.rate.numerator, rate_denominator=h.rate.denominator,
                ))
                db.flush()
        except IntegrityError:
            pass  # 동시 등록 — 이미 존재


def _new_row(sid: UUID, participant, meta: PresignChunk, play_group_id: str | None) -> EEGRawChunk:
    h = meta.header
    last = h.end_sample_index_exclusive - 1 if h.sample_count else h.first_sample_index
    return EEGRawChunk(
        session_id=sid, participant_id=participant.id, user_id=participant.user_id,
        stream_id=str(h.stream_id), segment_id=str(h.segment_id), signal_type=h.signal_type,
        chunk_index=h.chunk_index, chunk_alias=meta.chunk_alias, play_group_id=play_group_id,
        start_ms=_time_ms(h, h.first_sample_index), end_ms=_time_ms(h, last),
        sample_rate=max(1, round(h.rate.numerator / h.rate.denominator)),
        channel_count=len(h.channels), unit=h.units[0][:20], schema_version=RAW_V2_SCHEMA,
        checksum=meta.checksum, size_bytes=meta.size_bytes, object_key=_object_key(sid, participant.id, meta),
        sample_count=h.sample_count, packet_count=h.packet_count, first_sample_index=h.first_sample_index,
        time_basis=h.time_basis, parser_profile_id=h.parser_profile.profile_id,
        parser_profile_hash=h.parser_profile.parameters_hash, header=h.model_dump(mode="json"),
        upload_status="pending",
    )


def _identity(meta: PresignChunk) -> tuple:
    h = meta.header
    return (h.signal_type, str(h.stream_id), str(h.segment_id), h.chunk_index)


def _row_identity(row: EEGRawChunk) -> tuple:
    return (row.signal_type, row.stream_id, row.segment_id, row.chunk_index)


def _identity_view(identity: tuple) -> dict:
    return dict(zip(("signal_type", "stream_id", "segment_id", "chunk_index"), identity))


def presign_raw(session_id: str, payload: PresignRequest, db: DBSession, *, current_user_id=None, entry_credential=None) -> dict:
    sid, _ = eeg_raw_service._get_session(session_id, db)
    participant = resolve_participant(sid, payload.participant_id, db, current_user_id=current_user_id, entry_credential=entry_credential)
    for meta in payload.chunks:
        _check_sizes(meta)
    archive = archive_gate(db, sid, participant, payload.capture_stream_id, [raw_window_mono(m) for m in payload.chunks])

    streams = {str(m.header.stream_id) for m in payload.chunks}
    aliases = {m.chunk_alias for m in payload.chunks}
    for alias in aliases:
        check_alias_reserved(alias)
    from app.models.biosignal import BiosignalArtifact
    clash = (
        db.query(BiosignalArtifact.artifact_alias)
        .filter(BiosignalArtifact.session_id == sid, BiosignalArtifact.participant_id == participant.id,
                BiosignalArtifact.artifact_alias.in_(aliases)).all()
    )
    if clash:
        raise _conflict("alias_conflict", [{"chunk_alias": a} for (a,) in clash])
    rows = (
        db.query(EEGRawChunk)
        .filter(
            EEGRawChunk.session_id == sid, EEGRawChunk.participant_id == participant.id,
            EEGRawChunk.schema_version == RAW_V2_SCHEMA,
            (EEGRawChunk.stream_id.in_(streams)) | (EEGRawChunk.chunk_alias.in_(aliases)),
        )
        .all()
    )
    by_identity = {_row_identity(r): r for r in rows}
    by_alias = {r.chunk_alias: r for r in rows if r.chunk_alias}

    conflicts: list[dict] = []
    alias_conflicts: list[dict] = []
    planned: dict[tuple, PresignChunk] = {}
    for meta in payload.chunks:
        ident = _identity(meta)
        existing = by_identity.get(ident) or None
        prior = planned.get(ident)
        if prior is not None and (prior.checksum != meta.checksum or prior.size_bytes != meta.size_bytes):
            conflicts.append({**_identity_view(ident), "existing_checksum": prior.checksum, "attempted_checksum": meta.checksum})
            continue
        if existing is not None and (existing.checksum != meta.checksum or existing.size_bytes != meta.size_bytes):
            conflicts.append({**_identity_view(ident), "existing_checksum": existing.checksum, "attempted_checksum": meta.checksum})
            continue
        owner = by_alias.get(meta.chunk_alias)
        if owner is not None and _row_identity(owner) != ident:
            alias_conflicts.append({"chunk_alias": meta.chunk_alias, **_identity_view(ident)})
            continue
        planned.setdefault(ident, meta)
    if conflicts:
        logger.warning("[biosignal] identity 충돌 session=%s participant=%s n=%d", sid, participant.id, len(conflicts))
        raise _conflict("chunk_identity_conflict", conflicts)
    if alias_conflicts:
        raise _conflict("alias_conflict", alias_conflicts)

    items: list[dict] = []
    resolved: dict[tuple, EEGRawChunk] = dict(by_identity)
    for meta in payload.chunks:
        ident = _identity(meta)
        row = resolved.get(ident)
        if row is None:
            _ensure_stream_segment(sid, participant, meta, payload.play_group_id, db)
            row = _new_row(sid, participant, meta, payload.play_group_id)
            try:
                with db.begin_nested():
                    db.add(row)
                    db.flush()
            except IntegrityError:
                # 동시 발급 경합 — 승자 행을 읽어 같은 내용이면 재사용, 다르면 충돌
                row = (
                    db.query(EEGRawChunk)
                    .filter(
                        EEGRawChunk.session_id == sid, EEGRawChunk.participant_id == participant.id,
                        EEGRawChunk.signal_type == ident[0], EEGRawChunk.stream_id == ident[1],
                        EEGRawChunk.segment_id == ident[2], EEGRawChunk.chunk_index == ident[3],
                    )
                    .first()
                )
                if row is None:
                    db.rollback()
                    raise _conflict("alias_conflict", [{"chunk_alias": meta.chunk_alias, **_identity_view(ident)}])
                if row.checksum != meta.checksum:
                    db.rollback()
                    raise _conflict("chunk_identity_conflict", [{**_identity_view(ident), "existing_checksum": row.checksum, "attempted_checksum": meta.checksum}])
            resolved[ident] = row

        if row.upload_status == "uploaded":
            url, headers, expires = None, {}, 0
        else:
            if row.upload_status == "failed":
                row.upload_status, row.failure_reason = "pending", None
            url, headers = storage_service.generate_presigned_put_checksummed(
                row.object_key, checksum_sha256_hex=row.checksum, content_type=meta.content_type
            )
            expires = PRESIGN_EXPIRES_SEC
        items.append({
            "chunk_id": str(row.id), "chunk_alias": row.chunk_alias, "signal_type": row.signal_type,
            "stream_id": row.stream_id, "segment_id": row.segment_id, "chunk_index": row.chunk_index,
            "object_key": row.object_key, "checksum": row.checksum, "size_bytes": row.size_bytes,
            "upload_url": url, "upload_headers": headers, "upload_status": row.upload_status,
            "expires_in_sec": expires,
        })
    db.commit()
    out = {"session_id": str(sid), "participant_id": str(participant.id), "chunks": items}
    if archive is not None:
        out["archive_ingest"] = archive
    return out


def _result(row: EEGRawChunk, status: str, reason: str | None = None) -> dict:
    return AckResult(
        chunk_id=row.id, chunk_alias=row.chunk_alias, upload_status=status, checksum=row.checksum,
        size_bytes=row.size_bytes,
        verified_at_us=_us(row.verified_at) if status == "uploaded" and row.verified_at else None,
        failure_reason=reason, object_version_id=row.object_version_id if status == "uploaded" else None,
    ).model_dump(mode="json")


def ack_raw(session_id: str, payload: AckRequest, db: DBSession, *, current_user_id=None, entry_credential=None) -> dict:
    sid, _ = eeg_raw_service._get_session(session_id, db)
    participant = resolve_participant(sid, payload.participant_id, db, current_user_id=current_user_id, entry_credential=entry_credential)
    wanted = [item.chunk_id for item in payload.chunks]
    rows = (
        db.query(EEGRawChunk)
        .filter(
            EEGRawChunk.id.in_(wanted), EEGRawChunk.session_id == sid,
            EEGRawChunk.participant_id == participant.id, EEGRawChunk.schema_version == RAW_V2_SCHEMA,
        )
        .all()
    )
    by_id = {r.id: r for r in rows}
    if any(cid not in by_id for cid in wanted):
        raise HTTPException(status_code=404, detail="raw 청크를 찾을 수 없습니다")

    results: list[dict] = []
    acked = failed = 0
    for item in payload.chunks:
        row = by_id[item.chunk_id]
        if item.checksum != row.checksum or item.size_bytes != row.size_bytes:
            # 등록값은 덮어쓰지 않는다. 이미 uploaded 인 행의 상태도 바꾸지 않는다.
            failed += 1
            results.append(_result(row, "failed", "ack_metadata_mismatch"))
            continue
        if row.upload_status == "uploaded":
            results.append(_result(row, "uploaded"))
            continue
        ok, version = storage_service.verify_object_sha256(
            row.object_key, expected_size=row.size_bytes, expected_sha256_hex=row.checksum
        )
        if ok is True:
            row.upload_status, row.uploaded_at, row.verified_at = "uploaded", _now(), _now()
            row.object_version_id, row.failure_reason = version, None
            acked += 1
            results.append(_result(row, "uploaded"))
        else:
            # 검증 불가(None)도 성공으로 보지 않는다. payload 는 클라이언트가 계속 보관한다.
            reason = "verification_unavailable" if ok is None else "object_verification_failed"
            row.upload_status, row.uploaded_at, row.verified_at, row.failure_reason = "failed", None, None, reason
            failed += 1
            results.append(_result(row, "failed", reason))

    db.flush()
    record = eeg_raw_service._sync_eeg_record(sid, participant, payload.play_group_id, db)
    from app.services import biosignal_manifest_service  # 순환 import 회피
    biosignal_manifest_service.refresh_if_closing(db, sid, participant.id)  # 후발 ACK → 새 revision
    db.commit()
    logger.info("[biosignal] raw ack session=%s participant=%s acked=%d failed=%d", sid, participant.id, acked, failed)
    return {
        "session_id": str(sid), "acked": acked, "failed": failed, "chunks": results,
        "eeg_record_id": str(record.id) if record else None, "file_count": record.file_count if record else 0,
    }


def capabilities(session_id: str, participant_id: UUID | None, db: DBSession, *, current_user_id=None, entry_credential=None) -> dict:
    from app.models.research import ResearchConsent
    from app.services.recording_consent_service import assert_eeg_upload_allowed

    sid, _ = eeg_raw_service._get_session(session_id, db)
    participant = session_service.resolve_participant_actor(
        sid, db, entry_credential=entry_credential, current_user_id=current_user_id,
        participant_id=str(participant_id) if participant_id else None,
    )
    allowed, reason = True, None
    try:
        session_service._assert_upload_eligible(participant)
        assert_eeg_upload_allowed(participant)
    except HTTPException as exc:
        allowed, reason = False, str(exc.detail)

    consent = db.query(ResearchConsent).filter(ResearchConsent.participant_id == participant.id).first()
    if consent is not None and consent.withdrawn_at is not None:
        eeg_state, eeg_reason = "withdrawn", None
    elif consent is not None and consent.consented:
        eeg_state, eeg_reason = "consented", None
    else:
        eeg_state, eeg_reason = "not_consented", None
    signals = []
    for signal in SIGNALS:
        if signal == "eeg":
            state, why = eeg_state, eeg_reason
        else:
            # 현재 연구 동의 범위는 신호별로 정의돼 있지 않다 — 자동 확장하지 않는다(SDD-244 plan §2.5).
            state, why = "unknown", "signal_scope_consent_not_defined"
        signals.append({
            "signal": signal, "upload_allowed": allowed, "reason": reason,
            "research_consent": state, "research_reason": why,
        })
    return {
        "session_id": str(sid), "participant_id": str(participant.id),
        "raw_schemas": [RAW_V2_SCHEMA], "artifact_kinds": ["feature", "raw_derived", "indices", "normalization", "algorithm"],
        "events": True, "max_batch": MAX_BATCH, "max_object_bytes": MAX_OBJECT_BYTES,
        "upload_immutability": "checksum_bound", "legacy_eeg_raw": True, "signals": signals,
    }
